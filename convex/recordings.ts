import { makeFunctionReference } from "convex/server";
import { v, ConvexError } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "./lib/functions";
import { refreshLiveConversation } from "./lib/liveConversations";
import { requireMember, requireRecordingConsent } from "./authz";
import { localDate } from "@hale/contracts/time";
import { audioDurationLimit } from "@hale/contracts/audio";

const transcribeRef = makeFunctionReference<"action">("transcriptions:transcribe");
// Long enough for Sarvam's two-hour batch inputs and optional pyannote matching,
// but still a bounded fallback if a provider job or scheduled worker stalls.
const TEMP_AUDIO_TTL_MS = 24 * 60 * 60_000;

export const authorizeUpload = internalQuery({
  args: { sessionId: v.id("recordingSessions") },
  returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new ConvexError("Session unavailable.");
    const { identity } = await requireMember(ctx, session.patientId, "recordings:create");
    if (identity.subject !== session.subject) throw new ConvexError("Session owner mismatch.");
    await requireRecordingConsent(ctx, session.patientId, identity.subject);
    return null;
  },
});

export const start = mutation({
  args: { patientId: v.id("patients"), participantsConsented: v.boolean(), captureMode: v.optional(v.union(v.literal("native"), v.literal("web"))), expectedPeople: v.optional(v.array(v.id("people"))), continuous: v.optional(v.boolean()) },
  returns: v.id("recordingSessions"),
  handler: async (ctx, { patientId, participantsConsented, captureMode, expectedPeople = [], continuous }) => {
    const { identity, patient } = await requireMember(ctx, patientId, "recordings:create");
    await requireRecordingConsent(ctx, patientId, identity.subject);
    if (!participantsConsented) throw new ConvexError("Confirm consent from everyone taking part before recording.");
    if (continuous && (captureMode !== "native" || expectedPeople.length)) throw new ConvexError("Live recording requires the native app. Live speakers remain unnamed.");
    if (expectedPeople.length > 50 || new Set(expectedPeople).size !== expectedPeople.length) throw new ConvexError("Choose up to 50 different people to recognize.");
    for (const personId of expectedPeople) {
      const person = await ctx.db.get(personId);
      if (!person || person.patientId !== patientId) throw new ConvexError("A selected person is not part of this patient space.");
    }
    return ctx.db.insert("recordingSessions", { patientId, subject: identity.subject, timezone: patient.timezone, startedAt: Date.now(), consentConfirmedAt: Date.now(), state: "recording", captureMode: captureMode ?? "web", expectedPeople, continuous, ...(continuous ? { lastChunkAt: Date.now() } : {}) });
  },
});

export const setState = mutation({
  args: { sessionId: v.id("recordingSessions"), state: v.union(v.literal("recording"), v.literal("paused"), v.literal("interrupted"), v.literal("stopped")) },
  returns: v.null(),
  handler: async (ctx, { sessionId, state }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) throw new ConvexError("Session unavailable.");
    const { identity } = await requireMember(ctx, session.patientId, "recordings:create");
    if (session.subject !== identity.subject) throw new ConvexError("This session belongs to another user.");
    await requireRecordingConsent(ctx, session.patientId, identity.subject);
    if (session.state === "stopped") {
      if (state === "stopped") return null;
      throw new ConvexError("This session has ended. Start a new one.");
    }
    await ctx.db.patch(sessionId, { state, ...(state === "stopped" ? { endedAt: Date.now() } : {}) });
    if (session.conversationId) await refreshLiveConversation(ctx, session.conversationId);
    return null;
  },
});

// Only the authenticated HTTP upload action supplies storage IDs. Clients cannot attach guessed files.
export const acceptChunk = internalMutation({
  args: {
    sessionId: v.id("recordingSessions"), sequence: v.number(), storageId: v.id("_storage"),
    capturedAt: v.number(), endedAt: v.number(), mimeType: v.string(),
  },
  returns: v.object({ chunkId: v.id("audioChunks"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new ConvexError("Session unavailable.");
    const { identity } = await requireMember(ctx, session.patientId, "recordings:create");
    if (identity.subject !== session.subject) throw new ConvexError("Session owner mismatch.");
    await requireRecordingConsent(ctx, session.patientId, identity.subject);
    const durationLimit = audioDurationLimit(session.captureMode);
    if (!Number.isInteger(args.sequence) || args.sequence < 0 || !Number.isFinite(args.capturedAt) || !Number.isFinite(args.endedAt) || args.endedAt <= args.capturedAt || args.endedAt - args.capturedAt > durationLimit || args.capturedAt < session.startedAt - 10_000 || args.endedAt > Date.now() + 10_000) throw new ConvexError("Invalid segment timing.");
    if (session.endedAt && args.endedAt > session.endedAt + 1000) throw new ConvexError("This audio was captured after the session ended.");
    if (session.continuous && args.endedAt - args.capturedAt > 30_000) throw new ConvexError("Live segments must be at most 30 seconds.");
    if (session.conversationId && (await ctx.db.get(session.conversationId))?.deletedAt) throw new ConvexError("This conversation has been deleted.");
    const existing = await ctx.db.query("audioChunks").withIndex("by_session_sequence", (q) => q.eq("sessionId", args.sessionId).eq("sequence", args.sequence)).unique();
    if (existing) {
      if (existing.deletedAt) throw new ConvexError("This evidence has been deleted.");
      return { chunkId: existing._id, duplicate: true };
    }
    const now = Date.now();
    const chunkId = await ctx.db.insert("audioChunks", { ...args, patientId: session.patientId, state: "queued", expiresAt: now + TEMP_AUDIO_TTL_MS });
    const jobId = await ctx.db.insert("processingJobs", { patientId: session.patientId, chunkId, state: "queued", attempts: 0, createdAt: now, updatedAt: now });
    const conversationId = session.continuous && session.conversationId ? session.conversationId : await ctx.db.insert("conversations", {
      patientId: session.patientId, chunkId, title: "New recording", summary: "Audio uploaded. Waiting for the audio worker; no transcript has been generated yet.",
      startedAt: args.capturedAt, duration: (args.endedAt - args.capturedAt) / 1000,
      localDate: localDate(args.capturedAt, session.timezone), people: [], state: "queued",
      ...(session.continuous ? { sessionId: session._id, pendingChunks: 0, failedChunks: 0, processedChunks: 0 } : {}),
    });
    if (session.continuous) {
      const conversation = await ctx.db.get(conversationId);
      if (!conversation || conversation.deletedAt) throw new ConvexError("Conversation unavailable.");
      if (args.capturedAt < conversation.startedAt) throw new ConvexError("Live segments must not precede the conversation’s start.");
      await ctx.db.patch(chunkId, { conversationId });
      await ctx.db.patch(session._id, { conversationId, lastChunkAt: now });
      await ctx.db.patch(conversationId, {
        title: "Recorded conversation",
        duration: Math.max(conversation.duration, (args.endedAt - conversation.startedAt) / 1000),
        pendingChunks: (conversation.pendingChunks ?? 0) + 1,
      });
      await refreshLiveConversation(ctx, conversationId);
    }
    if (session.expectedPeople?.length) {
      await ctx.db.insert("speakerMatchingJobs", {
        patientId: session.patientId,
        chunkId,
        conversationId,
        expectedPeople: session.expectedPeople,
        state: "queued",
        attempts: 0,
        generation: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, transcribeRef, { jobId });
    return { chunkId, duplicate: false };
  },
});

export const live = query({
  args: { sessionId: v.id("recordingSessions") },
  returns: v.union(v.null(), v.object({
    conversationId: v.union(v.id("conversations"), v.null()), pending: v.number(), failed: v.number(),
    turns: v.array(v.object({ id: v.id("transcriptTurns"), start: v.number(), end: v.number(), text: v.string(), speaker: v.string(), uncertain: v.boolean() })),
  })),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db.get(sessionId);
    if (!session) return null;
    const { identity } = await requireMember(ctx, session.patientId, "memories:read");
    if (session.subject !== identity.subject) throw new ConvexError("Session owner mismatch.");
    const conversation = session.conversationId ? await ctx.db.get(session.conversationId) : null;
    if (conversation?.deletedAt) return null;
    const turns = conversation ? await ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversation._id)).order("desc").take(80) : [];
    return {
      conversationId: conversation?._id ?? null, pending: conversation?.pendingChunks ?? 0, failed: conversation?.failedChunks ?? 0,
      turns: turns.reverse().map(({ _id, start, end, text, speaker, uncertain }) => ({ id: _id, start, end, text, speaker, uncertain })),
    };
  },
});
