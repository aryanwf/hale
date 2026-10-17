import { afterEach, describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import type { Id } from "./_generated/dataModel";
import { localDate } from "@hale/contracts/time";
import schema from "./schema";
import * as conversations from "./conversations";
import * as patients from "./patients";
import * as people from "./people";
import * as privacy from "./privacy";
import * as recordings from "./recordings";
import * as transcriptions from "./transcriptions";

const app = defineTestApp({ schema }).defineModules({ conversations, patients, people, privacy, recordings, transcriptions });
const tests: ReturnType<typeof app.createTest>[] = [];

afterEach(async () => {
  for (const t of tests.splice(0)) {
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
    });
    await t.finishInProgressScheduledFunctions();
  }
});

async function createPatient(options: { recordingConsent?: boolean; externalAIConsent?: boolean } = {}) {
  const t = app.createTest();
  tests.push(t);
  const owner = t.withIdentity({ subject: "user_privacy-patient" });
  const patientId = await owner.mutation(app.api.patients.create, {
    name: "Fictional Privacy Patient", timezone: "UTC",
    recordingConsent: options.recordingConsent ?? true,
    ...(options.externalAIConsent === undefined ? {} : { externalAIConsent: options.externalAIConsent }),
  });
  return { t, owner, patientId };
}

async function createPendingTranscription(t: ReturnType<typeof app.createTest>, patientId: Id<"patients">) {
  const now = Date.now();
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("recordingSessions", {
      patientId, subject: "user_privacy-patient", startedAt: now - 10_000, timezone: "UTC", state: "stopped", endedAt: now,
      consentConfirmedAt: now - 10_000,
    });
    const storageId = await ctx.storage.store(new Blob(["fictional patient audio"], { type: "audio/mp4" }));
    const chunkId = await ctx.db.insert("audioChunks", {
      patientId, sessionId, sequence: 0, storageId, capturedAt: now - 10_000, endedAt: now,
      mimeType: "audio/mp4", state: "queued", expiresAt: now + 60_000,
    });
    const conversationId = await ctx.db.insert("conversations", {
      patientId, chunkId, title: "Private test conversation", summary: "Waiting for transcription.",
      startedAt: now - 10_000, duration: 10, localDate: localDate(now, "UTC"), people: [], state: "queued",
    });
    const jobId = await ctx.db.insert("processingJobs", {
      patientId, chunkId, state: "queued", attempts: 0, generation: 0, createdAt: now, updatedAt: now,
    });
    return { storageId, chunkId, conversationId, jobId };
  });
}

describe("Privacy & Security Center authorization and consent", () => {
  test("privacy defaults are restrictive, access is scoped, and history records the signed-in actor", async () => {
    const { t, owner, patientId } = await createPatient();
    const center = await owner.query(app.api.privacy.center, { patientId });
    expect(center.settings).toMatchObject({ recordingEnabled: true, externalAIEnabled: false, retentionDays: null });
    expect(center.permissions).toMatchObject({ canManagePrivacy: true, canManageFamily: true, canDeleteRecords: true });
    await expect(owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true })).rejects.toThrow("external AI");

    await expect(t.query(app.api.privacy.center, { patientId })).rejects.toThrow("sign in");
    await expect(t.withIdentity({ subject: "privacy-outsider" }).query(app.api.privacy.center, { patientId })).rejects.toThrow("permission");
    await owner.mutation(app.api.privacy.recordAccess, { patientId, resource: "privacy_center" });
    const updated = await owner.query(app.api.privacy.center, { patientId });
    expect(updated.accessHistory[0]).toMatchObject({ operation: "access.privacy_center.viewed", actor: "Fictional Privacy Patient" });
  });

  test("family readers can inspect policy but cannot change consent; revocation blocks future patient reads", async () => {
    const { t, owner, patientId } = await createPatient();
    const personId = await t.run((ctx) => ctx.db.insert("people", {
      patientId, name: "Fictional Family Reader", relationship: "Daughter", enrollment: "not_enrolled",
      isPatient: false, linkedSubject: "privacy-family",
    }));
    await t.run((ctx) => ctx.db.insert("memberships", {
      patientId, subject: "privacy-family", role: "family", capabilities: ["memories:read"], active: true,
    }));
    const family = t.withIdentity({ subject: "privacy-family" });
    expect((await family.query(app.api.privacy.center, { patientId })).family).toContainEqual(expect.objectContaining({
      id: personId, name: "Fictional Family Reader", role: "family", permissions: ["Read conversations, transcripts and memories"],
    }));
    await expect(family.mutation(app.api.privacy.setExternalAIConsent, { patientId, enabled: true })).rejects.toThrow("permission");
    await expect(family.mutation(app.api.privacy.setRetention, { patientId, retentionDays: 7 })).rejects.toThrow("permission");

    await owner.mutation(app.api.people.unlinkFamilyMember, { patientId, personId });
    await expect(family.query(app.api.privacy.center, { patientId })).rejects.toThrow("permission");
    await expect(family.query(app.api.conversations.space, { patientId })).rejects.toThrow("permission");
  });

  test("transcription deletes audio without external-AI consent and cannot persist after consent is withdrawn", async () => {
    const { t, owner, patientId } = await createPatient();
    const denied = await createPendingTranscription(t, patientId);
    expect(await owner.mutation(app.internal.transcriptions.claim, { jobId: denied.jobId })).toBeNull();
    expect(await t.run((ctx) => ctx.storage.getUrl(denied.storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(denied.jobId))).toMatchObject({ state: "failed", error: "External AI processing is disabled by the patient." });

    await owner.mutation(app.api.privacy.setExternalAIConsent, { patientId, enabled: true });
    const allowed = await createPendingTranscription(t, patientId);
    const claim = await owner.mutation(app.internal.transcriptions.claim, { jobId: allowed.jobId });
    expect(claim).toMatchObject({ storageId: allowed.storageId });

    await owner.mutation(app.api.privacy.setExternalAIConsent, { patientId, enabled: false });
    expect(await owner.mutation(app.internal.transcriptions.complete, {
      jobId: allowed.jobId, generation: claim!.generation,
      turns: [{ start: 0, end: 2, text: "This private sentence must not be saved." }],
    })).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("transcriptTurns").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(allowed.jobId))).toMatchObject({ state: "failed" });
  });

  test("recording consent stops active sessions and blocks new recording sessions", async () => {
    const { t, owner, patientId } = await createPatient({ externalAIConsent: true });
    const sessionId = await owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true });
    await owner.mutation(app.api.privacy.setRecordingConsent, { patientId, enabled: false });
    await expect(owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true })).rejects.toThrow("consent");
    expect(await owner.query(app.api.privacy.center, { patientId })).toMatchObject({ settings: { recordingEnabled: false } });
    await expect(owner.mutation(app.api.recordings.setState, { sessionId, state: "recording" })).rejects.toThrow("consent");
    await owner.mutation(app.api.privacy.setRecordingConsent, { patientId, enabled: true });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["late upload"], { type: "audio/mp4" })));
    const capturedAt = Date.now();
    await expect(owner.mutation(app.internal.recordings.acceptChunk, {
      sessionId, sequence: 99, storageId, capturedAt, endedAt: capturedAt + 1, mimeType: "audio/mp4",
    })).rejects.toThrow("withdrawn");
  });

  test("external-AI revocation invalidates old recording sessions even after later re-consent", async () => {
    const { t, owner, patientId } = await createPatient({ externalAIConsent: true });
    const sessionId = await owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true });
    await owner.mutation(app.api.privacy.setExternalAIConsent, { patientId, enabled: false });
    await owner.mutation(app.api.privacy.setExternalAIConsent, { patientId, enabled: true });
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["old session audio"], { type: "audio/mp4" })));
    const capturedAt = Date.now();
    await expect(owner.mutation(app.internal.recordings.acceptChunk, {
      sessionId, sequence: 0, storageId, capturedAt, endedAt: capturedAt + 1, mimeType: "audio/mp4",
    })).rejects.toThrow("External AI consent");
  });

  test("retention removes expired conversation evidence and leaves a minimal audit event", async () => {
    const { t, owner, patientId } = await createPatient();
    const old = await t.run(async (ctx) => {
      const now = Date.now();
      const sessionId = await ctx.db.insert("recordingSessions", {
        patientId, subject: "user_privacy-patient", startedAt: now - 30 * 24 * 60 * 60_000,
        endedAt: now - 30 * 24 * 60 * 60_000 + 1_000, timezone: "UTC", state: "stopped", consentConfirmedAt: now - 30 * 24 * 60 * 60_000,
      });
      const chunkId = await ctx.db.insert("audioChunks", {
        patientId, sessionId, sequence: 0, capturedAt: now - 30 * 24 * 60 * 60_000,
        endedAt: now - 30 * 24 * 60 * 60_000 + 1_000, mimeType: "audio/mp4", state: "ready", expiresAt: now,
      });
      const conversationId = await ctx.db.insert("conversations", {
        patientId, chunkId, title: "Old private conversation", summary: "Private summary.",
        startedAt: now - 30 * 24 * 60 * 60_000, duration: 1,
        localDate: localDate(now - 30 * 24 * 60 * 60_000, "UTC"), people: [], state: "ready",
      });
      const turnId = await ctx.db.insert("transcriptTurns", {
        patientId, conversationId, speaker: "Unknown speaker", start: 0, end: 1,
        text: "Old private transcript.", uncertain: true,
      });
      await ctx.db.insert("memories", {
        patientId, conversationId, kind: "conversation_topic", title: "Private memory", text: "Private memory text.",
        localDate: localDate(now - 30 * 24 * 60 * 60_000, "UTC"), turnIds: [turnId], people: [],
      });
      return { conversationId };
    });
    await owner.mutation(app.api.privacy.setRetention, { patientId, retentionDays: 7 });
    expect((await owner.query(app.api.privacy.center, { patientId })).settings.retentionDays).toBe(7);
    expect(await t.run((ctx) => ctx.db.query("conversations").withIndex("by_patient_deletedAt_date", (q) =>
      q.eq("patientId", patientId).eq("deletedAt", undefined).lt("localDate", localDate(Date.now() - 7 * 24 * 60 * 60_000, "UTC")),
    ).take(25))).toHaveLength(1);
    await t.finishAllScheduledFunctions(() => {});
    expect(await t.run((ctx) => ctx.db.get(old.conversationId))).toMatchObject({ deletedAt: expect.any(Number), title: "Deleted conversation", summary: "" });
    expect(await t.run((ctx) => ctx.db.query("transcriptTurns").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("memories").collect())).toHaveLength(0);
    expect((await owner.query(app.api.privacy.center, { patientId })).accessHistory).toContainEqual(expect.objectContaining({ operation: "conversation.retention_deleted" }));
  });
});
