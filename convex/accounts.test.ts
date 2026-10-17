import { describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as accounts from "./accounts";
import * as patients from "./patients";
import * as families from "./families";
import * as people from "./people";
import * as voices from "./voices";
import * as transcriptions from "./transcriptions";

const app = defineTestApp({ schema }).defineModules({ accounts, patients, families, people, voices, transcriptions });

async function setup() {
  const t = app.createTest();
  const owner = t.withIdentity({ subject: "user_patient" });
  const family = t.withIdentity({ subject: "user_family" });
  const patientId = await owner.mutation(app.api.patients.create, { name: "Margaret", timezone: "UTC", recordingConsent: true });
  await family.mutation(app.api.voices.saveProfile, { name: "Daniel", relationship: "Son" });
  const code = await family.mutation(app.api.families.createCode, {});
  await owner.mutation(app.api.families.link, { patientId, code: code.code });
  const evidence = await t.run(async (ctx) => {
    const person = await ctx.db.query("people").withIndex("by_patient_linked_subject", (q) => q.eq("patientId", patientId).eq("linkedSubject", "user_family")).unique();
    const storageId = await ctx.storage.store(new Blob(["test audio"], { type: "audio/mp4" }));
    const sessionId = await ctx.db.insert("recordingSessions", { patientId, subject: "user_patient", startedAt: 0, timezone: "UTC", state: "stopped", consentConfirmedAt: 0 });
    const chunkId = await ctx.db.insert("audioChunks", { patientId, sessionId, sequence: 0, storageId, capturedAt: 0, endedAt: 1000, mimeType: "audio/mp4", state: "processing", expiresAt: 9999999999999 });
    const jobId = await ctx.db.insert("processingJobs", { patientId, chunkId, state: "processing", generation: 1, createdAt: 0 });
    const conversationId = await ctx.db.insert("conversations", { patientId, chunkId, title: "A conversation", summary: "A shared moment", startedAt: 0, duration: 1, localDate: "2026-10-17", people: [person!._id], state: "processing" });
    const turnId = await ctx.db.insert("transcriptTurns", { patientId, conversationId, personId: person!._id, speaker: "Daniel", start: 0, end: 1, text: "Let's have lunch.", uncertain: false });
    const memoryId = await ctx.db.insert("memories", { patientId, conversationId, kind: "plan", title: "Lunch", text: "A plan for lunch", localDate: "2026-10-17", people: [person!._id], turnIds: [turnId] });
    const contactId = await ctx.db.insert("emergencyContacts", {
      patientId, createdBy: "user_patient", name: "Emergency Contact", email: "contact@example.com", enabled: true, createdAt: 0,
    });
    const familyContactId = await ctx.db.insert("emergencyContacts", {
      patientId, createdBy: "user_family", name: "Family Contact", email: "family-contact@example.com", enabled: true, createdAt: 0,
    });
    const privacySettingsId = await ctx.db.insert("privacySettings", {
      patientId, retentionDays: 30, updatedAt: 0, updatedBy: "user_patient",
    });
    const pushSubscriptionId = await ctx.db.insert("webNotificationSubscriptions", {
      patientId, subject: "user_family", endpoint: "https://fcm.googleapis.com/fcm/send/family-device",
      p256dh: "A".repeat(87), auth: "B".repeat(22), createdAt: 0, updatedAt: 0,
    });
    const proposalId = await ctx.db.insert("careProposals", {
      patientId, conversationId, sourceChunkId: chunkId, kind: "appointment", priority: "routine", status: "needs_review",
      title: "Suggested appointment", summary: "AI suggestion (unverified).", proposedAt: null, scheduledAt: null,
      createdAt: 0, turnIds: [turnId], sourceText: "Let's have lunch.", sourceKey: "account-test-proposal",
    });
    const alertId = await ctx.db.insert("careAlerts", {
      patientId, conversationId, kind: "appointment_reminder", priority: "routine", title: "Appointment reminder",
      body: "Review the care dashboard.", createdAt: 0, emailStatus: "skipped", pushStatus: "skipped", acknowledged: false,
      turnIds: [turnId], sourceKey: "account-test-alert",
    });
    return { storageId, sessionId, chunkId, jobId, conversationId, turnId, memoryId, contactId, familyContactId, privacySettingsId, pushSubscriptionId, proposalId, alertId, personId: person!._id };
  });
  return { t, owner, family, patientId, evidence };
}

describe("account data deletion", () => {
  test("requires authentication", async () => {
    const t = app.createTest();
    await expect(t.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" })).rejects.toThrow("sign in");
    await expect(t.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" })).rejects.toThrow("sign in");
  });

  test("requires explicit confirmation", async () => {
    const { family } = await setup();
    // @ts-expect-error Deliberately exercise runtime validation of missing confirmation.
    await expect(family.mutation(app.api.accounts.deleteMyData, {})).rejects.toThrow();
  });

  test("cannot target another user through the public mutation", async () => {
    const { family } = await setup();
    // @ts-expect-error Authorization never accepts a caller-supplied subject.
    await expect(family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE", subject: "user_patient" })).rejects.toThrow();
    // @ts-expect-error Permanent deletion also derives identity from authentication only.
    await expect(family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE", subject: "user_patient" })).rejects.toThrow();
  });

  test("family deletion removes profile, code, access, and directory association", async () => {
    const { t, family, evidence } = await setup();
    await family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    const remaining = await t.run(async (ctx) => ({
      profiles: await ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", "user_family")).take(10),
      codes: await ctx.db.query("familyCodes").withIndex("by_subject", (q) => q.eq("subject", "user_family")).take(10),
      memberships: await ctx.db.query("memberships").withIndex("by_subject", (q) => q.eq("subject", "user_family")).take(10),
      contacts: await ctx.db.query("emergencyContacts").withIndex("by_createdBy", (q) => q.eq("createdBy", "user_family")).take(10),
      pushSubscriptions: await ctx.db.query("webNotificationSubscriptions").withIndex("by_subject", (q) => q.eq("subject", "user_family")).take(10),
      person: await ctx.db.get(evidence.personId),
    }));
    expect(remaining).toEqual({ profiles: [], codes: [], memberships: [], contacts: [], pushSubscriptions: [], person: null });
  });

  test("family deletion preserves the patient's evidence and anonymizes tagged speaker references", async () => {
    const { t, family, patientId, evidence } = await setup();
    await family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    const remaining = await t.run(async (ctx) => ({
      patient: await ctx.db.get(patientId), conversation: await ctx.db.get(evidence.conversationId),
      turn: await ctx.db.get(evidence.turnId), memory: await ctx.db.get(evidence.memoryId),
      contact: await ctx.db.get(evidence.contactId), proposal: await ctx.db.get(evidence.proposalId), alert: await ctx.db.get(evidence.alertId),
      privacySettings: await ctx.db.get(evidence.privacySettingsId),
      familyContact: await ctx.db.get(evidence.familyContactId),
      pushSubscription: await ctx.db.get(evidence.pushSubscriptionId),
    }));
    expect(remaining).toMatchObject({
      patient: { name: "Margaret" }, conversation: { people: [] },
      turn: { speaker: "Unknown speaker", text: "Let's have lunch.", uncertain: true }, memory: { people: [] },
      contact: { email: "contact@example.com" }, proposal: { sourceText: "Let's have lunch." }, alert: { title: "Appointment reminder" },
      privacySettings: { retentionDays: 30 },
      familyContact: null,
      pushSubscription: null,
    });
    expect(remaining.turn?.personId).toBeUndefined();
    expect(await t.run(async (ctx) => (await ctx.storage.get(evidence.storageId)) !== null)).toBe(true);
  });

  test("patient deletion cascades through all owned evidence and audio", async () => {
    const { t, owner, patientId, evidence } = await setup();
    await owner.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    const remaining = await t.run(async (ctx) => {
      const ids = [patientId, evidence.sessionId, evidence.chunkId, evidence.jobId, evidence.conversationId, evidence.turnId, evidence.memoryId, evidence.personId, evidence.contactId, evidence.familyContactId, evidence.privacySettingsId, evidence.pushSubscriptionId, evidence.proposalId, evidence.alertId];
      return Promise.all(ids.map((id) => ctx.db.get(id)));
    });
    expect(remaining).toEqual(Array(14).fill(null));
    expect(await t.run((ctx) => ctx.storage.get(evidence.storageId))).toBeNull();
  });

  test("deleting a patient does not delete another family account's profile", async () => {
    const { owner, family } = await setup();
    await owner.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    expect(await family.query(app.api.voices.me, {})).toMatchObject({ profile: { name: "Daniel" } });
  });

  test("late transcription results cannot recreate deleted patient data", async () => {
    const { owner, t, evidence } = await setup();
    await owner.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    expect(await t.mutation(app.internal.transcriptions.complete, { jobId: evidence.jobId, generation: 1, turns: [{ start: 0, end: 1, text: "Late result" }] })).toBe(false);
  });

  test("deleted users can start onboarding again with the same login", async () => {
    const { family } = await setup();
    await family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    expect(await family.query(app.api.patients.list)).toEqual([]);
    expect(await family.mutation(app.api.families.createCode, {})).toMatchObject({ linked: false });
  });

  test("repeated deletion is safe", async () => {
    const { family } = await setup();
    await family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    expect(await family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" })).toEqual({ deletedDocuments: 0, deletedFiles: 0 });
  });

  test("permanent deletion blocks open dashboards from recreating data", async () => {
    const { family } = await setup();
    await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" });
    await expect(family.mutation(app.api.families.createCode, {})).rejects.toThrow("account was deleted");
    await expect(family.mutation(app.api.voices.saveProfile, { name: "Daniel", relationship: "Son" })).rejects.toThrow("account was deleted");
  });

  test("active accounts report their status", async () => {
    const { family } = await setup();
    expect(await family.query(app.api.accounts.status, {})).toBe("active");
  });

  test("signed-out requests report their status", async () => {
    const t = app.createTest();
    expect(await t.query(app.api.accounts.status, {})).toBe("signedOut");
  });

  test("deleted accounts report their status", async () => {
    const { family } = await setup();
    await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" });
    expect(await family.query(app.api.accounts.status, {})).toBe("deleted");
  });

  test("deleted accounts can load the patient list without a runtime error", async () => {
    const { family } = await setup();
    await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" });
    expect(await family.query(app.api.patients.listForRole, { role: "family" })).toEqual([]);
  });

  test("signed-out requests cannot list patients", async () => {
    const t = app.createTest();
    await expect(t.query(app.api.patients.listForRole, { role: "family" })).rejects.toThrow("sign in");
  });

  test("permanent deletion can be retried if Clerk verification was cancelled", async () => {
    const { family } = await setup();
    await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" });
    expect(await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" })).toEqual({ deletedDocuments: 0, deletedFiles: 0 });
  });

  test("permanent deletion only retains an irreversible login-blocking hash", async () => {
    const { t, family } = await setup();
    await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" });
    const tombstones = await t.run((ctx) => ctx.db.query("deletedAccounts").take(10));
    expect(tombstones).toMatchObject([{ identityHash: expect.stringMatching(/^[a-f0-9]{64}$/) }]);
    expect(JSON.stringify(tombstones)).not.toContain("user_family");
  });

  test("deletion removes retained voice samples as well as voiceprints", async () => {
    const { t, family } = await setup();
    const storageId = await t.run(async (ctx) => {
      const profile = await ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", "user_family")).unique();
      const storageId = await ctx.storage.store(new Blob(["test voice sample"]));
      await ctx.db.patch(profile!._id, { storageId, voiceprint: "test biometric data", voiceState: "enrolled" });
      return storageId;
    });
    await family.mutation(app.api.accounts.deleteMyAccount, { confirmation: "DELETE" });
    expect(await t.run((ctx) => ctx.storage.get(storageId))).toBeNull();
  });

  test("admin deletion rejects ambiguous name and email searches", async () => {
    const t = app.createTest();
    await expect(t.mutation(app.internal.accounts.deleteDataForSubject, { subject: "aryansonipixel@gmail.com", confirmation: "DELETE" })).rejects.toThrow("exact Clerk user ID");
  });

  test("oversized deletion fails atomically rather than silently leaving data", async () => {
    const { t, family } = await setup();
    await t.run(async (ctx) => {
      for (let index = 0; index < 1_001; index++) await ctx.db.insert("familyCodes", { owner: `owner-${index}`, subject: "user_family", code: `code-${index}`, createdAt: 0, expiresAt: 1 });
    });
    await expect(family.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" })).rejects.toThrow("No data has been deleted");
    expect(await family.query(app.api.voices.me, {})).toMatchObject({ profile: { name: "Daniel" } });
  });
});
