import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  deletedAccounts: defineTable({ identityHash: v.string() }).index("by_identityHash", ["identityHash"]),
  familyCodes: defineTable({
    owner: v.string(), subject: v.string(), code: v.string(), name: v.optional(v.string()),
    createdAt: v.number(), expiresAt: v.number(),
    patientId: v.optional(v.id("patients")), acceptedAt: v.optional(v.number()),
  }).index("by_owner", ["owner"]).index("by_code", ["code"])
    .index("by_subject", ["subject"]).index("by_patientId", ["patientId"]),
  // Account-owned enrollment is separate from patient membership. Never expose voiceprints in public queries.
  familyProfiles: defineTable({
    subject: v.string(), name: v.string(), relationship: v.string(),
    voiceState: v.union(v.literal("not_enrolled"), v.literal("skipped"), v.literal("queued"), v.literal("processing"), v.literal("enrolled"), v.literal("failed"), v.literal("revoked")),
    consentAt: v.optional(v.number()), policyVersion: v.optional(v.string()), revokedAt: v.optional(v.number()),
    requestId: v.optional(v.string()), storageId: v.optional(v.id("_storage")),
    jobId: v.optional(v.string()), voiceprint: v.optional(v.string()), model: v.optional(v.string()),
    message: v.optional(v.string()), updatedAt: v.number(), enrollmentVersion: v.optional(v.number()),
  }).index("by_subject", ["subject"]).index("by_voice_state", ["voiceState", "updatedAt"]),
  patients: defineTable({
    name: v.string(), timezone: v.string(), createdBy: v.string(),
    audioRetentionDays: v.number(), // legacy field; new uploads use short processing TTLs instead
    createdAt: v.number(),
  }).index("by_createdBy", ["createdBy"]),
  memberships: defineTable({
    patientId: v.id("patients"), subject: v.string(),
    role: v.union(v.literal("patient"), v.literal("family")),
    capabilities: v.array(v.string()), active: v.boolean(),
  }).index("by_subject", ["subject"]).index("by_patient_subject", ["patientId", "subject"]),
  consents: defineTable({
    patientId: v.id("patients"), subject: v.string(), purpose: v.string(),
    policyVersion: v.string(), grantedAt: v.number(), revokedAt: v.optional(v.number()),
  }).index("by_subject", ["subject"]).index("by_patient_subject", ["patientId", "subject"])
    .index("by_patient_subject_purpose", ["patientId", "subject", "purpose"]),
  people: defineTable({
    patientId: v.id("patients"), name: v.string(), relationship: v.string(),
    enrollment: v.union(v.literal("not_enrolled"), v.literal("enrolled"), v.literal("revoked")),
    isPatient: v.optional(v.boolean()),
    linkedSubject: v.optional(v.string()), familyProfileId: v.optional(v.id("familyProfiles")),
    voiceConsentAt: v.optional(v.number()), voiceConsentPolicy: v.optional(v.string()),
  }).index("by_patient", ["patientId"])
    .index("by_linkedSubject", ["linkedSubject"]).index("by_familyProfileId", ["familyProfileId"])
    .index("by_patient_linked_subject", ["patientId", "linkedSubject"]),
  patientInvitations: defineTable({
    patientId: v.id("patients"), personId: v.id("people"),
    tokenHash: v.string(), createdBy: v.string(), createdAt: v.number(), expiresAt: v.number(),
    acceptedBy: v.optional(v.string()), acceptedAt: v.optional(v.number()), revokedAt: v.optional(v.number()),
  }).index("by_token_hash", ["tokenHash"])
    .index("by_patient", ["patientId"])
    .index("by_createdBy", ["createdBy"]).index("by_acceptedBy", ["acceptedBy"]).index("by_personId", ["personId"]),
  recordingSessions: defineTable({
    patientId: v.id("patients"), subject: v.string(), startedAt: v.number(),
    endedAt: v.optional(v.number()), timezone: v.string(),
    state: v.union(v.literal("recording"), v.literal("paused"), v.literal("interrupted"), v.literal("stopped")),
    consentConfirmedAt: v.number(),
    captureMode: v.optional(v.union(v.literal("native"), v.literal("web"))),
    continuous: v.optional(v.boolean()), conversationId: v.optional(v.id("conversations")),
    lastChunkAt: v.optional(v.number()),
    expectedPeople: v.optional(v.array(v.id("people"))),
  }).index("by_patient", ["patientId"]).index("by_continuous_state_lastChunkAt", ["continuous", "state", "lastChunkAt"]),
  audioChunks: defineTable({
    patientId: v.id("patients"), sessionId: v.id("recordingSessions"),
    sequence: v.number(), storageId: v.optional(v.id("_storage")),
    conversationId: v.optional(v.id("conversations")),
    capturedAt: v.number(), endedAt: v.number(), mimeType: v.string(),
    state: v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    expiresAt: v.number(), deletedAt: v.optional(v.number()),
  }).index("by_session_sequence", ["sessionId", "sequence"]).index("by_expiry", ["expiresAt"])
    .index("by_conversationId", ["conversationId"])
    .index("by_patientId", ["patientId"]),
  processingJobs: defineTable({
    patientId: v.id("patients"), chunkId: v.id("audioChunks"),
    state: v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    error: v.optional(v.string()), attempts: v.optional(v.number()), generation: v.optional(v.number()), providerJobId: v.optional(v.string()), updatedAt: v.optional(v.number()), createdAt: v.number(),
  }).index("by_chunk", ["chunkId"]).index("by_state", ["state"]).index("by_state_updated", ["state", "updatedAt"])
    .index("by_patientId", ["patientId"]),
  speakerMatchingJobs: defineTable({
    patientId: v.id("patients"), chunkId: v.id("audioChunks"), conversationId: v.id("conversations"),
    expectedPeople: v.array(v.id("people")),
    state: v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("failed"), v.literal("skipped")),
    error: v.optional(v.string()), attempts: v.number(), generation: v.number(),
    providerJobId: v.optional(v.string()),
    candidates: v.optional(v.array(v.object({ label: v.string(), personId: v.id("people"), profileId: v.id("familyProfiles"), enrollmentVersion: v.number() }))),
    updatedAt: v.number(), createdAt: v.number(),
  }).index("by_chunk", ["chunkId"]).index("by_state_updated", ["state", "updatedAt"]),
  conversations: defineTable({
    patientId: v.id("patients"), chunkId: v.id("audioChunks"),
    title: v.string(), summary: v.string(), startedAt: v.number(), duration: v.number(),
    localDate: v.string(), people: v.array(v.id("people")),
    state: v.union(v.literal("queued"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    deletedAt: v.optional(v.number()),
    sessionId: v.optional(v.id("recordingSessions")), pendingChunks: v.optional(v.number()),
    failedChunks: v.optional(v.number()), processedChunks: v.optional(v.number()),
  }).index("by_patient_date", ["patientId", "localDate"]).index("by_chunk", ["chunkId"]),
  transcriptTurns: defineTable({
    patientId: v.id("patients"), conversationId: v.id("conversations"),
    speaker: v.string(), personId: v.optional(v.id("people")),
    chunkId: v.optional(v.id("audioChunks")),
    start: v.number(), end: v.number(), text: v.string(), uncertain: v.boolean(),
  }).index("by_conversation", ["conversationId", "start"])
    .index("by_patientId", ["patientId"]).index("by_personId", ["personId"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["patientId"] }),
  memories: defineTable({
    patientId: v.id("patients"), conversationId: v.id("conversations"),
    kind: v.union(v.literal("reported_activity"), v.literal("plan"), v.literal("personal_fact"), v.literal("conversation_topic")),
    title: v.string(), text: v.string(), localDate: v.string(),
    plannedFor: v.optional(v.string()), occurredAt: v.optional(v.string()),
    turnIds: v.array(v.id("transcriptTurns")), people: v.array(v.id("people")),
  }).index("by_patient_date", ["patientId", "localDate"]).index("by_conversation", ["conversationId"])
    .searchIndex("search_text", { searchField: "text", filterFields: ["patientId"] }),
  auditEvents: defineTable({
    patientId: v.id("patients"), actor: v.string(), operation: v.string(),
    target: v.string(), timestamp: v.number(),
  }).index("by_patient", ["patientId", "timestamp"]).index("by_actor", ["actor"]),
});
