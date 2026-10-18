import { v, ConvexError, type GenericId } from "convex/values";
import { mutation, query, internalMutation, type MutationCtx } from "./lib/functions";
import { EXTERNAL_AI_POLICY_VERSION, hasActiveConsent, hasExternalAIConsent, requireMember } from "./authz";
import { makeFunctionReference, paginationOptsValidator } from "convex/server";
import { conversationForChunk, settleLiveChunk } from "./lib/liveConversations";
import { localDate } from "@hale/contracts/time";

const purgeLiveRef = makeFunctionReference<"mutation">("privacy:purgeLiveConversation");
const purgeCareRef = makeFunctionReference<"mutation">("privacy:purgeCareConversation");
const retentionSweepRef = makeFunctionReference<"mutation">("privacy:retentionSweep");
const retentionSweepPatientRef = makeFunctionReference<"mutation">("privacy:retentionSweepPatient");
const expireRetainedConversationRef = makeFunctionReference<"mutation">("privacy:expireRetainedConversation");
const revokeExternalAISessionsRef = makeFunctionReference<"mutation">("privacy:revokeExternalAISessions");
const revokeRecordingSessionsRef = makeFunctionReference<"mutation">("privacy:revokeRecordingSessions");
const CARE_PURGE_BATCH_SIZE = 25;
const RECORDING_POLICY_VERSION = "2026-10-17-recording-v1";

const accessResource = v.union(
  v.literal("privacy_center"), v.literal("overview"), v.literal("conversations"),
  v.literal("conversation"), v.literal("memories"), v.literal("family_access"),
  v.literal("care"), v.literal("settings"),
);

async function requirePatientManager(ctx: MutationCtx, patientId: GenericId<"patients">) {
  const access = await requireMember(ctx, patientId, "sharing:manage");
  if (access.membership.role !== "patient" || access.identity.subject !== access.patient.createdBy) {
    throw new ConvexError("Only the patient can change this privacy setting.");
  }
  return access;
}

function auditActorName(actor: string, patientSubject: string, patientName: string, family: { subject: string; name: string }[]): string {
  if (actor === "system:retention") return "Automatic retention policy";
  if (actor === "system") return "Hale system";
  if (actor === patientSubject) return patientName;
  if (family.some((member) => member.subject === actor)) return family.find((member) => member.subject === actor)!.name;
  return "Former or unavailable member";
}

export const center = query({
  args: { patientId: v.id("patients") },
  handler: async (ctx, { patientId }) => {
    const { identity, membership, patient } = await requireMember(ctx, patientId, "memories:read");
    const [privacySettings, memberships, people, events, conversations, recordingEnabled, externalAIEnabled] = await Promise.all([
      ctx.db.query("privacySettings").withIndex("by_patient", (q) => q.eq("patientId", patientId)).unique(),
      ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", patientId)).take(101),
      ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100),
      ctx.db.query("auditEvents").withIndex("by_patient", (q) => q.eq("patientId", patientId)).order("desc").take(40),
      ctx.db.query("conversations").withIndex("by_patient_date", (q) => q.eq("patientId", patientId)).order("desc").take(20),
      hasActiveConsent(ctx, patientId, patient.createdBy, "recording"),
      hasExternalAIConsent(ctx, patientId),
    ]);
    const activeFamily = memberships.filter((item) => item.active && item.role === "family");
    const family = activeFamily.map((item) => {
      const person = people.find((candidate) => candidate.linkedSubject === item.subject);
      return {
        id: person?._id ?? "",
        name: person?.name ?? "Family member",
        relationship: person?.relationship ?? "Family",
        role: "family" as const,
        permissions: [
          ...(item.capabilities.includes("memories:read") ? ["Read conversations, transcripts and memories"] : ["No active data permissions"]),
          ...(item.capabilities.includes("care:manage") ? ["Manage Care contacts and review alerts"] : []),
        ],
        active: true,
      };
    });
    const auditFamily = activeFamily.map((member) => ({
      subject: member.subject,
      name: people.find((person) => person.linkedSubject === member.subject)?.name ?? "Family member",
    }));
    const accessHistory = await Promise.all(events.map(async (event) => {
      const hasConversationTarget = event.operation === "access.conversation.viewed" || event.operation === "conversation.deleted" || event.operation === "conversation.retention_deleted";
      const conversation = hasConversationTarget ? await ctx.db.get(event.target as GenericId<"conversations">) : null;
      const targetLabel = hasConversationTarget
        ? conversation?.patientId === patientId ? conversation.title : "Deleted or unavailable conversation"
        : event.operation.startsWith("family.") ? "Family access"
          : event.operation === "patient.created" ? "Patient space"
            : event.operation === "data.export.requested" ? "Authorized data export"
              : event.operation.startsWith("privacy.") ? "Privacy settings"
                : event.operation.startsWith("access.") ? event.operation.slice("access.".length).replace(/\.viewed$/u, "").replaceAll("_", " ")
                  : "Patient information";
      return {
        id: event._id,
        actor: auditActorName(event.actor, patient.createdBy, patient.name, auditFamily),
        operation: event.operation,
        targetLabel,
        timestamp: event.timestamp,
      };
    }));
    return {
      patient: { id: patient._id, name: patient.name, timezone: patient.timezone },
      viewer: { role: membership.role, name: identity.name ?? (membership.role === "patient" ? patient.name : "Family member") },
      permissions: {
        canManagePrivacy: membership.role === "patient" && identity.subject === patient.createdBy && membership.capabilities.includes("sharing:manage"),
        canManageFamily: membership.role === "patient" && identity.subject === patient.createdBy && membership.capabilities.includes("sharing:manage"),
        canDeleteRecords: membership.capabilities.includes("evidence:delete"),
      },
      settings: {
        recordingEnabled,
        externalAIEnabled,
        retentionDays: privacySettings?.retentionDays ?? null,
        updatedAt: privacySettings?.updatedAt ?? null,
      },
      family: [{ id: patient._id, name: patient.name, relationship: "Patient", role: "patient" as const, permissions: ["Manage recordings, privacy and family access"], active: true }, ...family],
      accessHistory,
      recentConversations: conversations.filter((conversation) => !conversation.deletedAt).slice(0, 12).map((conversation) => ({
        id: conversation._id,
        title: conversation.title,
        startedAt: conversation.startedAt,
        state: conversation.state,
      })),
    };
  },
});

export const recordAccess = mutation({
  args: { patientId: v.id("patients"), resource: accessResource, conversationId: v.optional(v.id("conversations")) },
  returns: v.null(),
  handler: async (ctx, { patientId, resource, conversationId }) => {
    const { identity } = await requireMember(ctx, patientId, "memories:read");
    if ((resource === "conversation") !== Boolean(conversationId)) throw new ConvexError("Choose a valid access-history resource.");
    if (conversationId) {
      const conversation = await ctx.db.get(conversationId);
      if (!conversation || conversation.deletedAt || conversation.patientId !== patientId) throw new ConvexError("Conversation unavailable.");
    }
    await ctx.db.insert("auditEvents", {
      patientId,
      actor: identity.subject,
      operation: `access.${resource}.viewed`,
      target: conversationId ?? resource,
      timestamp: Date.now(),
    });
    return null;
  },
});

export const setRecordingConsent = mutation({
  args: { patientId: v.id("patients"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { patientId, enabled }) => {
    const { identity } = await requirePatientManager(ctx, patientId);
    const consents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
      q.eq("patientId", patientId).eq("subject", identity.subject).eq("purpose", "recording"),
    ).order("desc").take(100);
    const active = consents.filter((consent) => !consent.revokedAt);
    if (enabled && active.some((consent) => consent.policyVersion === RECORDING_POLICY_VERSION)) return null;
    const now = Date.now();
    for (const consent of active) await ctx.db.patch(consent._id, { revokedAt: now });
    if (enabled) await ctx.db.insert("consents", {
      patientId, subject: identity.subject, purpose: "recording", policyVersion: RECORDING_POLICY_VERSION, grantedAt: now,
    });
    if (!enabled) {
      const sessions = await ctx.db.query("recordingSessions").withIndex("by_patient", (q) => q.eq("patientId", patientId))
        .order("desc").paginate({ numItems: 50, cursor: null });
      for (const session of sessions.page) {
        if (session.subject === identity.subject && session.startedAt <= now && !session.consentRevokedAt) {
          await ctx.db.patch(session._id, {
            consentRevokedAt: now,
            ...(session.state !== "stopped" ? { state: "stopped" as const, endedAt: now } : {}),
          });
        }
      }
      if (!sessions.isDone) await ctx.scheduler.runAfter(0, revokeRecordingSessionsRef, {
        patientId, subject: identity.subject, revokedAt: now, cursor: sessions.continueCursor,
      });
    }
    await ctx.db.insert("auditEvents", {
      patientId, actor: identity.subject, operation: enabled ? "privacy.recording_consent.granted" : "privacy.recording_consent.revoked",
      target: patientId, timestamp: now,
    });
    return null;
  },
});

export const setExternalAIConsent = mutation({
  args: { patientId: v.id("patients"), enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, { patientId, enabled }) => {
    const { identity } = await requirePatientManager(ctx, patientId);
    const consents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
      q.eq("patientId", patientId).eq("subject", identity.subject).eq("purpose", "external_ai"),
    ).order("desc").take(100);
    const active = consents.filter((consent) => !consent.revokedAt);
    if (enabled && active.some((consent) => consent.policyVersion === EXTERNAL_AI_POLICY_VERSION)) return null;
    const now = Date.now();
    for (const consent of active) await ctx.db.patch(consent._id, { revokedAt: now });
    if (enabled) await ctx.db.insert("consents", {
      patientId, subject: identity.subject, purpose: "external_ai", policyVersion: EXTERNAL_AI_POLICY_VERSION, grantedAt: now,
    });
    await ctx.db.insert("auditEvents", {
      patientId, actor: identity.subject, operation: enabled ? "privacy.external_ai_consent.granted" : "privacy.external_ai_consent.revoked",
      target: patientId, timestamp: now,
    });
    if (!enabled) {
      const sessions = await ctx.db.query("recordingSessions").withIndex("by_patient", (q) => q.eq("patientId", patientId))
        .order("desc").paginate({ numItems: 50, cursor: null });
      for (const session of sessions.page) {
        if (session.subject === identity.subject && session.startedAt <= now && !session.externalAIRevokedAt) {
          await ctx.db.patch(session._id, {
            externalAIRevokedAt: now,
            ...(session.state !== "stopped" ? { state: "stopped" as const, endedAt: now } : {}),
          });
        }
      }
      if (!sessions.isDone) await ctx.scheduler.runAfter(0, revokeExternalAISessionsRef, {
        patientId, subject: identity.subject, revokedAt: now, cursor: sessions.continueCursor,
      });
      await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("privacy:cancelExternalWork"), {
        patientId, processingCursor: null, speakerCursor: null,
      });
    }
    return null;
  },
});

export const setRetention = mutation({
  args: { patientId: v.id("patients"), retentionDays: v.union(v.literal(7), v.literal(30), v.null()) },
  returns: v.null(),
  handler: async (ctx, { patientId, retentionDays }) => {
    const { identity } = await requirePatientManager(ctx, patientId);
    const existing = await ctx.db.query("privacySettings").withIndex("by_patient", (q) => q.eq("patientId", patientId)).unique();
    const now = Date.now();
    if (existing) await ctx.db.patch(existing._id, { retentionDays, updatedAt: now, updatedBy: identity.subject });
    else await ctx.db.insert("privacySettings", { patientId, retentionDays, updatedAt: now, updatedBy: identity.subject });
    await ctx.db.insert("auditEvents", {
      patientId, actor: identity.subject,
      operation: retentionDays === null ? "privacy.retention.set_manual" : `privacy.retention.set_${retentionDays}_days`,
      target: patientId, timestamp: now,
    });
    if (retentionDays !== null) await ctx.scheduler.runAfter(0, retentionSweepRef, { paginationOpts: { numItems: 10, cursor: null } });
    return null;
  },
});

export const requestExport = mutation({
  args: { patientId: v.id("patients") },
  returns: v.null(),
  handler: async (ctx, { patientId }) => {
    const { identity } = await requireMember(ctx, patientId, "memories:read");
    await ctx.db.insert("auditEvents", {
      patientId, actor: identity.subject, operation: "data.export.requested", target: patientId, timestamp: Date.now(),
    });
    return null;
  },
});

export const exportIndex = query({
  args: { patientId: v.id("patients"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { patientId, paginationOpts }) => {
    const { patient } = await requireMember(ctx, patientId, "memories:read");
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > 100) throw new ConvexError("Export pages are limited to 100 conversations.");
    const page = await ctx.db.query("conversations")
      .withIndex("by_patient_date", (q) => q.eq("patientId", patientId))
      .order("desc")
      .paginate(paginationOpts);
    return {
      patient: { id: patient._id, name: patient.name, timezone: patient.timezone },
      page: page.page.filter((conversation) => !conversation.deletedAt).map((conversation) => ({
        id: conversation._id, title: conversation.title, summary: conversation.summary,
        startedAt: conversation.startedAt, duration: conversation.duration, localDate: conversation.localDate,
        people: conversation.people, state: conversation.state,
      })),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const exportConversationPage = query({
  args: {
    conversationId: v.id("conversations"),
    turnsPaginationOpts: paginationOptsValidator,
    memoriesPaginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { conversationId, turnsPaginationOpts, memoriesPaginationOpts }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.deletedAt) throw new ConvexError("Conversation unavailable.");
    await requireMember(ctx, conversation.patientId, "memories:read");
    if (turnsPaginationOpts.numItems > 100 || memoriesPaginationOpts.numItems > 100) throw new ConvexError("Export pages are limited to 100 records.");
    const [turns, memories] = await Promise.all([
      ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).paginate(turnsPaginationOpts),
      ctx.db.query("memories").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).paginate(memoriesPaginationOpts),
    ]);
    return {
      conversation: {
        id: conversation._id, title: conversation.title, summary: conversation.summary,
        startedAt: conversation.startedAt, duration: conversation.duration, localDate: conversation.localDate,
        people: conversation.people, state: conversation.state,
      },
      turns: {
        page: turns.page.filter((turn) => turn.patientId === conversation.patientId).map(({ _id, speaker, personId, start, end, text, uncertain }) => ({
          id: _id, speaker, personId, start, end, text, uncertain,
        })),
        isDone: turns.isDone, continueCursor: turns.continueCursor,
      },
      memories: {
        page: memories.page.filter((memory) => memory.patientId === conversation.patientId).map(({ _id, kind, title, text, localDate: date, plannedFor, occurredAt, turnIds, people: memoryPeople }) => ({
          id: _id, kind, title, text, localDate: date, plannedFor, occurredAt, turnIds, people: memoryPeople,
        })),
        isDone: memories.isDone, continueCursor: memories.continueCursor,
      },
    };
  },
});

async function cancelScheduled(ctx: MutationCtx, scheduledId: GenericId<"_scheduled_functions">): Promise<void> {
  try { await ctx.scheduler.cancel(scheduledId); }
  catch { /* The job may already have completed or be running. */ }
}

async function purgeCareBatch(ctx: MutationCtx, conversationId: GenericId<"conversations">): Promise<boolean> {
  const [proposals, alerts] = await Promise.all([
    ctx.db.query("careProposals").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(CARE_PURGE_BATCH_SIZE),
    ctx.db.query("careAlerts").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(CARE_PURGE_BATCH_SIZE),
  ]);
  for (const proposal of proposals) {
    for (const reminderJobId of proposal.reminderJobIds ?? []) await cancelScheduled(ctx, reminderJobId);
    await ctx.db.delete(proposal._id);
  }
  for (const alert of alerts) {
    if (alert.emailJobId) await cancelScheduled(ctx, alert.emailJobId);
    if (alert.pushJobId) await cancelScheduled(ctx, alert.pushJobId);
    await ctx.db.delete(alert._id);
  }
  const [moreProposals, moreAlerts] = await Promise.all([
    ctx.db.query("careProposals").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(1),
    ctx.db.query("careAlerts").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(1),
  ]);
  return moreProposals.length > 0 || moreAlerts.length > 0;
}

export const deleteConversation = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation) throw new ConvexError("Conversation unavailable.");
    const { identity } = await requireMember(ctx, conversation.patientId, "evidence:delete");
    if (conversation.deletedAt) return;
    const now = Date.now();
    // Tombstones survive retries, so late ingestion can never recreate deleted evidence.
    await ctx.db.patch(conversationId, { deletedAt: now });
    if (await purgeCareBatch(ctx, conversationId)) await ctx.scheduler.runAfter(0, purgeCareRef, { conversationId });
    if (conversation.sessionId) {
      const session = await ctx.db.get(conversation.sessionId);
      if (session) await ctx.db.patch(session._id, { state: "stopped", endedAt: now, privacyDeletedAt: now });
      await ctx.db.patch(conversationId, { title: "Deleted conversation", summary: "", people: [] });
      await ctx.scheduler.runAfter(0, purgeLiveRef, { conversationId });
      await ctx.db.insert("auditEvents", { patientId: conversation.patientId, actor: identity.subject, operation: "conversation.deleted", target: conversationId, timestamp: now });
      return;
    }
    const chunk = await ctx.db.get(conversation.chunkId);
    if (chunk) {
      if (chunk.storageId) await ctx.storage.delete(chunk.storageId);
      const session = await ctx.db.get(chunk.sessionId);
      if (session) await ctx.db.patch(session._id, { state: "stopped", endedAt: now, privacyDeletedAt: now });
      await ctx.db.patch(chunk._id, { deletedAt: now, storageId: undefined, state: "failed" });
      const jobs = await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).take(50);
      for (const job of jobs) await ctx.db.patch(job._id, {
        state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1, error: "Source deleted.", updatedAt: now,
      });
      const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
      if (speakerJob) await ctx.db.patch(speakerJob._id, { state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1, error: "Source deleted.", updatedAt: now });
      await ctx.db.delete(chunk._id);
    }
    const turns = await ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(100);
    const memories = await ctx.db.query("memories").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(100);
    for (const turn of turns) await ctx.db.delete(turn._id);
    for (const memory of memories) await ctx.db.delete(memory._id);
    await ctx.db.patch(conversationId, { title: "Deleted conversation", summary: "", people: [] });
    await ctx.db.insert("auditEvents", { patientId: conversation.patientId, actor: identity.subject, operation: "conversation.deleted", target: conversationId, timestamp: now });
    const [moreTurns, moreMemories] = await Promise.all([
      ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(1),
      ctx.db.query("memories").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).take(1),
    ]);
    if (moreTurns.length || moreMemories.length) await ctx.scheduler.runAfter(0, purgeLiveRef, { conversationId });
  },
});

export const cancelExternalWork = internalMutation({
  args: {
    patientId: v.id("patients"),
    processingCursor: v.union(v.string(), v.null()),
    speakerCursor: v.union(v.string(), v.null()),
  },
  returns: v.null(),
  handler: async (ctx, { patientId, processingCursor, speakerCursor }) => {
    if (await hasExternalAIConsent(ctx, patientId)) return null;
    const now = Date.now();
    const [processing, speakerMatching] = await Promise.all([
      ctx.db.query("processingJobs").withIndex("by_patientId", (q) => q.eq("patientId", patientId))
        .paginate({ numItems: 50, cursor: processingCursor }),
      ctx.db.query("speakerMatchingJobs").withIndex("by_patientId", (q) => q.eq("patientId", patientId))
        .paginate({ numItems: 50, cursor: speakerCursor }),
    ]);
    for (const job of processing.page) {
      if (job.state !== "queued" && job.state !== "processing") continue;
      const chunk = await ctx.db.get(job.chunkId);
      if (chunk?.storageId) await ctx.storage.delete(chunk.storageId);
      if (chunk) await ctx.db.patch(chunk._id, { storageId: undefined, expiresAt: now, state: "failed" });
      await ctx.db.patch(job._id, {
        state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1,
        error: "External AI processing consent was withdrawn.", updatedAt: now,
      });
      if (chunk) {
        const conversation = await conversationForChunk(ctx, chunk);
        if (conversation && !conversation.deletedAt) {
          if (conversation.sessionId) await settleLiveChunk(ctx, conversation, "failed");
          else await ctx.db.patch(conversation._id, {
            state: "failed", summary: "Transcript processing stopped because external AI consent was withdrawn. Temporary audio was deleted.",
          });
        }
      }
    }
    for (const job of speakerMatching.page) {
      if (job.state !== "queued" && job.state !== "processing") continue;
      const chunk = await ctx.db.get(job.chunkId);
      if (chunk?.storageId) await ctx.storage.delete(chunk.storageId);
      if (chunk) await ctx.db.patch(chunk._id, { storageId: undefined, expiresAt: now });
      await ctx.db.patch(job._id, {
        state: "failed", providerJobId: undefined, generation: job.generation + 1, candidates: undefined,
        error: "External AI processing consent was withdrawn.", updatedAt: now,
      });
      const conversation = await ctx.db.get(job.conversationId);
      if (conversation && !conversation.deletedAt) await ctx.db.patch(conversation._id, {
        state: "ready", summary: "Transcript text remains available. Speaker matching stopped because external AI consent was withdrawn.",
      });
    }
    if (!processing.isDone || !speakerMatching.isDone) {
      await ctx.scheduler.runAfter(0, makeFunctionReference<"mutation">("privacy:cancelExternalWork"), {
        patientId, processingCursor: processing.continueCursor, speakerCursor: speakerMatching.continueCursor,
      });
    }
    return null;
  },
});

export const revokeExternalAISessions = internalMutation({
  args: { patientId: v.id("patients"), subject: v.string(), revokedAt: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { patientId, subject, revokedAt, cursor }) => {
    const sessions = await ctx.db.query("recordingSessions").withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .order("desc").paginate({ numItems: 50, cursor });
    for (const session of sessions.page) {
      if (session.subject === subject && session.startedAt <= revokedAt && !session.externalAIRevokedAt) {
        await ctx.db.patch(session._id, {
          externalAIRevokedAt: revokedAt,
          ...(session.state !== "stopped" ? { state: "stopped" as const, endedAt: revokedAt } : {}),
        });
      }
    }
    if (!sessions.isDone) await ctx.scheduler.runAfter(0, revokeExternalAISessionsRef, {
      patientId, subject, revokedAt, cursor: sessions.continueCursor,
    });
    return null;
  },
});

export const revokeRecordingSessions = internalMutation({
  args: { patientId: v.id("patients"), subject: v.string(), revokedAt: v.number(), cursor: v.union(v.string(), v.null()) },
  returns: v.null(),
  handler: async (ctx, { patientId, subject, revokedAt, cursor }) => {
    const sessions = await ctx.db.query("recordingSessions").withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .order("desc").paginate({ numItems: 50, cursor });
    for (const session of sessions.page) {
      if (session.subject === subject && session.startedAt <= revokedAt && !session.consentRevokedAt) {
        await ctx.db.patch(session._id, {
          consentRevokedAt: revokedAt,
          ...(session.state !== "stopped" ? { state: "stopped" as const, endedAt: revokedAt } : {}),
        });
      }
    }
    if (!sessions.isDone) await ctx.scheduler.runAfter(0, revokeRecordingSessionsRef, {
      patientId, subject, revokedAt, cursor: sessions.continueCursor,
    });
    return null;
  },
});

export const expireRetainedConversation = internalMutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.deletedAt) return null;
    const [patient, preferences] = await Promise.all([
      ctx.db.get(conversation.patientId),
      ctx.db.query("privacySettings").withIndex("by_patient", (q) => q.eq("patientId", conversation.patientId)).unique(),
    ]);
    const days = preferences?.retentionDays;
    if (!patient || days === null || days === undefined || conversation.startedAt > Date.now() - days * 24 * 60 * 60_000) return null;
    const now = Date.now();
    await ctx.db.patch(conversationId, { deletedAt: now, title: "Deleted conversation", summary: "", people: [] });
    if (conversation.sessionId) {
      const session = await ctx.db.get(conversation.sessionId);
      if (session) await ctx.db.patch(session._id, { state: "stopped", endedAt: now, privacyDeletedAt: now });
    } else {
      const chunk = await ctx.db.get(conversation.chunkId);
      const session = chunk ? await ctx.db.get(chunk.sessionId) : null;
      if (session) await ctx.db.patch(session._id, { state: "stopped", endedAt: now, privacyDeletedAt: now });
    }
    await ctx.db.insert("auditEvents", {
      patientId: conversation.patientId, actor: "system:retention", operation: "conversation.retention_deleted",
      target: conversationId, timestamp: now,
    });
    if (await purgeCareBatch(ctx, conversationId)) await ctx.scheduler.runAfter(0, purgeCareRef, { conversationId });
    await ctx.scheduler.runAfter(0, purgeLiveRef, { conversationId });
    return null;
  },
});

export const retentionSweep = internalMutation({
  args: { paginationOpts: paginationOptsValidator },
  returns: v.null(),
  handler: async (ctx, { paginationOpts }) => {
    if (paginationOpts.numItems < 1 || paginationOpts.numItems > 25) throw new ConvexError("Retention sweep page is too large.");
    const patients = await ctx.db.query("patients").paginate(paginationOpts);
    for (const patient of patients.page) {
      const preferences = await ctx.db.query("privacySettings").withIndex("by_patient", (q) => q.eq("patientId", patient._id)).unique();
      const days = preferences?.retentionDays;
      if (days === null || days === undefined) continue;
      await ctx.scheduler.runAfter(0, retentionSweepPatientRef, { patientId: patient._id });
    }
    if (!patients.isDone) await ctx.scheduler.runAfter(0, retentionSweepRef, {
      paginationOpts: { numItems: paginationOpts.numItems, cursor: patients.continueCursor },
    });
    return null;
  },
});

export const retentionSweepPatient = internalMutation({
  args: { patientId: v.id("patients") },
  returns: v.null(),
  handler: async (ctx, { patientId }) => {
    const [patient, preferences] = await Promise.all([
      ctx.db.get(patientId),
      ctx.db.query("privacySettings").withIndex("by_patient", (q) => q.eq("patientId", patientId)).unique(),
    ]);
    const days = preferences?.retentionDays;
    if (!patient || days === null || days === undefined) return null;
    const cutoff = Date.now() - days * 24 * 60 * 60_000;
    const cutoffDate = localDate(cutoff, patient.timezone);
    const candidates = await ctx.db.query("conversations").withIndex("by_patient_deletedAt_date", (q) =>
      q.eq("patientId", patientId).eq("deletedAt", undefined).lte("localDate", cutoffDate),
    ).order("asc").take(100);
    const expired = candidates.filter((conversation) => conversation.startedAt < cutoff).slice(0, 25);
    for (const conversation of expired) {
      const expiredResult: null = await ctx.runMutation(expireRetainedConversationRef, { conversationId: conversation._id });
      void expiredResult;
    }
    if (candidates.length === 100 && expired.length > 0) await ctx.scheduler.runAfter(0, retentionSweepPatientRef, { patientId });
    return null;
  },
});

export const purgeLiveConversation = internalMutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation?.deletedAt) return null;
    const moreCare = await purgeCareBatch(ctx, conversationId);
    if (moreCare) await ctx.scheduler.runAfter(0, purgeCareRef, { conversationId });
    const chunks = await ctx.db.query("audioChunks").withIndex("by_conversationId", (q) => q.eq("conversationId", conversationId)).take(50);
    if (!chunks.some((chunk) => chunk._id === conversation.chunkId)) {
      const originalChunk = await ctx.db.get(conversation.chunkId);
      if (originalChunk) chunks.push(originalChunk);
    }
    for (const chunk of chunks) {
      if (chunk.storageId) await ctx.storage.delete(chunk.storageId);
      const job = await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
      if (job) await ctx.db.delete(job._id);
      const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
      if (speakerJob) await ctx.db.delete(speakerJob._id);
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

export const purgeCareConversation = internalMutation({
  args: { conversationId: v.id("conversations") },
  returns: v.null(),
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation?.deletedAt) return null;
    if (await purgeCareBatch(ctx, conversationId)) await ctx.scheduler.runAfter(0, purgeCareRef, { conversationId });
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
        if (conversation?.sessionId && !conversation.deletedAt) await settleLiveChunk(ctx, conversation, "ready");
        else if (conversation && !conversation.deletedAt) {
          await ctx.db.patch(conversation._id, {
            state: "ready", people: [],
            summary: "Transcript prepared. Temporary audio expired before speaker matching completed, so every voice remains unknown.",
          });
        }
      }
    }
  },
});
