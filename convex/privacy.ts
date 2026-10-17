import { v, ConvexError } from "convex/values";
import { mutation, internalMutation } from "./lib/functions";
import { requireMember } from "./authz";
import { makeFunctionReference } from "convex/server";
import { conversationForChunk, settleLiveChunk } from "./lib/liveConversations";

const purgeLiveRef = makeFunctionReference<"mutation">("privacy:purgeLiveConversation");

export const deleteConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new ConvexError("Conversation unavailable.");
    const { identity } = await requireMember(ctx, conversation.patientId, "evidence:delete");
    if (conversation.deletedAt) return;
    // Tombstones survive retries, so late ingestion can never recreate deleted evidence.
    await ctx.db.patch(conversationId, { deletedAt: Date.now() });
    if (conversation.sessionId) {
      const session = await ctx.db.get(conversation.sessionId);
      if (session) await ctx.db.patch(session._id, { state: "stopped", endedAt: Date.now() });
      await ctx.db.patch(conversationId, { title: "Deleted conversation", summary: "", people: [] });
      await ctx.scheduler.runAfter(0, purgeLiveRef, { conversationId });
      await ctx.db.insert("auditEvents", { patientId: conversation.patientId, actor: identity.subject, operation: "conversation.deleted", target: conversationId, timestamp: Date.now() });
      return;
    }
    const chunk = await ctx.db.get(conversation.chunkId);
    if (chunk) {
      if (chunk.storageId) await ctx.storage.delete(chunk.storageId);
      await ctx.db.patch(chunk._id, { deletedAt: Date.now(), storageId: undefined, state: "failed" });
      const jobs = await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).collect();
      for (const job of jobs) await ctx.db.patch(job._id, { state: "failed", error: "Source deleted.", updatedAt: Date.now() });
      const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
      if (speakerJob) await ctx.db.patch(speakerJob._id, { state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1, error: "Source deleted.", updatedAt: Date.now() });
    }
    const turns = await ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).collect();
    const memories = await ctx.db.query("memories").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).collect();
    for (const turn of turns) await ctx.db.delete(turn._id);
    for (const memory of memories) await ctx.db.delete(memory._id);
    await ctx.db.patch(conversationId, { title: "Deleted conversation", summary: "", people: [] });
    await ctx.db.insert("auditEvents", { patientId: conversation.patientId, actor: identity.subject, operation: "conversation.deleted", target: conversationId, timestamp: Date.now() });
  },
});

export const purgeLiveConversation = internalMutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation?.deletedAt || !conversation.sessionId) return null;
    const chunks = await ctx.db.query("audioChunks").withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).take(50);
    for (const chunk of chunks) {
      if (chunk.storageId) await ctx.storage.delete(chunk.storageId);
      const job = await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
      if (job) await ctx.db.delete(job._id);
      await ctx.db.delete(chunk._id);
    }
    const turns = await ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(100);
    for (const turn of turns) await ctx.db.delete(turn._id);
    const memories = await ctx.db.query("memories").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(100);
    for (const memory of memories) await ctx.db.delete(memory._id);
    if (chunks.length || turns.length || memories.length) await ctx.scheduler.runAfter(0, purgeLiveRef, { conversationId });
    return null;
  },
});

export const expireAudio = internalMutation({
  args: {},
  handler: async (ctx) => {
    const chunks = await ctx.db.query("audioChunks").withIndex("by_expiry", (q) => q.lte("expiresAt", Date.now()))
      .filter((q) => q.neq(q.field("storageId"), undefined)).take(50);
    for (const chunk of chunks) {
      if (chunk.storageId) await ctx.storage.delete(chunk.storageId);
      const now = Date.now();
      await ctx.db.patch(chunk._id, { storageId: undefined, expiresAt: now });
      const [transcription, speakerJob, conversation] = await Promise.all([
        ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique(),
        ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique(),
        conversationForChunk(ctx, chunk),
      ]);

      if (transcription && transcription.state !== "ready" && transcription.state !== "failed") {
        await ctx.db.patch(transcription._id, {
          state: "failed", providerJobId: undefined, generation: (transcription.generation ?? 0) + 1,
          error: "Temporary audio expired before transcription completed.", updatedAt: now,
        });
        if (speakerJob && speakerJob.state !== "ready" && speakerJob.state !== "failed" && speakerJob.state !== "skipped") {
          await ctx.db.patch(speakerJob._id, {
            state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1,
            error: "Transcription could not complete before temporary audio expired.", updatedAt: now,
          });
        }
        if (conversation?.sessionId && !conversation.deletedAt) await settleLiveChunk(ctx, conversation, "failed");
        else if (conversation && !conversation.deletedAt) {
          await ctx.db.patch(conversation._id, {
            state: "failed", summary: "A transcript could not be prepared before temporary audio expired. The audio was deleted; record again to retry.",
          });
        }
      } else if (transcription?.state === "ready" && speakerJob && speakerJob.state !== "ready" && speakerJob.state !== "failed" && speakerJob.state !== "skipped") {
        // Keep completed transcript text, but invalidate any late matching result.
        await ctx.db.patch(speakerJob._id, {
          state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1,
          error: "Temporary audio expired before speaker matching completed.", updatedAt: now,
        });
        if (conversation && !conversation.deletedAt) {
          await ctx.db.patch(conversation._id, {
            state: "ready", people: [],
            summary: "Transcript prepared. Temporary audio expired before speaker matching completed, so every voice remains unknown.",
          });
        }
      }
    }
  },
});
