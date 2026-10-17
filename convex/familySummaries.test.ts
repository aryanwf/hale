import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import * as familySummaries from "./familySummaries";
import * as patients from "./patients";
import * as families from "./families";
import * as privacy from "./privacy";
import * as accounts from "./accounts";

const app = defineTestApp({ schema }).defineModules({ familySummaries, patients, families, privacy, accounts });
const tests: ReturnType<typeof app.createTest>[] = [];
const originalFetch = globalThis.fetch;
const featureEnvKeys = [
  "FAMILY_SUMMARIES_ENABLED", "FAMILY_SUMMARIES_EMAIL_MODE", "FAMILY_SUMMARIES_TEST_EMAIL",
  "FAMILY_SUMMARIES_FROM_EMAIL", "RESEND_API_KEY",
] as const;
let previousEnv: Partial<Record<(typeof featureEnvKeys)[number], string | undefined>> = {};

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init), {
    preconnect: originalFetch.preconnect,
  });
}

beforeEach(() => {
  previousEnv = Object.fromEntries(featureEnvKeys.map((key) => [key, process.env[key]]));
  process.env.FAMILY_SUMMARIES_ENABLED = "true";
  process.env.FAMILY_SUMMARIES_EMAIL_MODE = "live";
  process.env.FAMILY_SUMMARIES_FROM_EMAIL = "summaries@example.test";
  process.env.RESEND_API_KEY = "resend-test-key";
  delete process.env.FAMILY_SUMMARIES_TEST_EMAIL;
  globalThis.fetch = originalFetch;
});

afterEach(async () => {
  for (const t of tests.splice(0)) {
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.state.kind === "pending") await ctx.scheduler.cancel(job._id);
      }
    });
    await t.finishInProgressScheduledFunctions();
  }
  globalThis.fetch = originalFetch;
  for (const key of featureEnvKeys) {
    const value = previousEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function setup(timezone = "UTC") {
  const t = app.createTest();
  tests.push(t);
  const owner = t.withIdentity({ subject: "synthetic-patient" });
  const family = t.withIdentity({ subject: "synthetic-family", email: "family@example.test", emailVerified: true });
  const patientId = await owner.mutation(app.api.patients.create, { name: "Fictional Patient", timezone, recordingConsent: true });
  const code = await family.mutation(app.api.families.createCode, {});
  await owner.mutation(app.api.families.link, { patientId, code: code.code });
  return { t, owner, family, patientId };
}

async function addSource(t: ReturnType<typeof app.createTest>, patientId: Id<"patients">, localDay: string, text: string, startedAt = Date.parse(`${localDay}T18:00:00Z`)) {
  return t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("recordingSessions", {
      patientId, subject: "synthetic-patient", startedAt, timezone: "UTC",
      state: "stopped", consentConfirmedAt: startedAt,
    });
    const chunkId = await ctx.db.insert("audioChunks", {
      patientId, sessionId, sequence: 0, capturedAt: startedAt,
      endedAt: startedAt + 60_000, mimeType: "audio/mp4", state: "ready", expiresAt: startedAt + 86_400_000,
    });
    const conversationId = await ctx.db.insert("conversations", {
      patientId, chunkId, title: "Synthetic conversation", summary: "Synthetic source only.",
      startedAt, duration: 60, localDate: localDay, people: [], state: "ready",
    });
    const turnId = await ctx.db.insert("transcriptTurns", {
      patientId, conversationId, speaker: "Unknown speaker", start: 3, end: 8,
      text, uncertain: true,
    });
    return { conversationId, turnId };
  });
}

async function enablePreferences(family: ReturnType<ReturnType<typeof app.createTest>["withIdentity"]>, patientId: Id<"patients">, nightly: boolean, weekly: boolean) {
  await family.mutation(app.api.familySummaries.setPreferences, { patientId, nightly, weekly });
}

async function rows(t: ReturnType<typeof app.createTest>, patientId: Id<"patients">) {
  return t.run(async (ctx) => ({
    summaries: await ctx.db.query("familySummaries").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100),
    deliveries: await ctx.db.query("familySummaryDeliveries").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100),
  }));
}

describe("family summaries", () => {
  test("creates one weekday nightly summary from same-patient ready transcript sources", async () => {
    const { t, family, patientId } = await setup();
    const date = "2026-10-16";
    const source = await addSource(t, patientId, date, "We watered the garden together.");
    await enablePreferences(family, patientId, true, false);
    const now = Date.parse(`${date}T21:00:00Z`);

    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });

    const stored = await rows(t, patientId);
    expect(stored.summaries).toHaveLength(1);
    expect(stored.summaries[0]).toMatchObject({ kind: "nightly", periodKey: date, sourceTurnIds: [source.turnId] });
    expect(stored.deliveries).toHaveLength(1);
    const read = await family.query(app.api.familySummaries.read, { patientId });
    expect(read.summaries[0]?.entries).toMatchObject([{ excerpt: "We watered the garden together.", conversationId: source.conversationId, turnId: source.turnId }]);
    expect(read.summaries[0]?.intro).toContain("Direct excerpts");
  });

  test("the scheduler opens in each patient's local timezone, not at a fixed UTC hour", async () => {
    const { t, patientId } = await setup("America/Los_Angeles");
    await t.mutation(app.internal.familySummaries.scanPatients, { cursor: null, now: Date.parse("2026-10-19T03:59:00Z") });
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);

    await t.mutation(app.internal.familySummaries.scanPatients, { cursor: null, now: Date.parse("2026-10-19T04:00:00Z") });
    const scheduled = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0]?.args).toContainEqual({ patientId, now: Date.parse("2026-10-19T04:00:00Z") });
  });

  test("Sunday creates a separate weekly summary and sends nightly before weekly", async () => {
    const { t, family, patientId } = await setup();
    await addSource(t, patientId, "2026-10-12", "We visited the library on Monday.");
    await addSource(t, patientId, "2026-10-18", "We shared tea on Sunday.");
    await enablePreferences(family, patientId, true, true);
    const now = Date.parse("2026-10-18T21:00:00Z");
    const sentSubjects: string[] = [];
    mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { subject: string; to: string[]; text: string };
      sentSubjects.push(body.subject);
      expect(body.to).toEqual(["family@example.test"]);
      expect(body.text).toContain("direct excerpts");
      return Response.json({ id: "synthetic-email" });
    });

    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    const stored = await rows(t, patientId);
    expect(stored.summaries.map((summary) => summary.kind).sort()).toEqual(["nightly", "weekly"]);
    const nightly = stored.summaries.find((summary) => summary.kind === "nightly")!;
    const weekly = stored.summaries.find((summary) => summary.kind === "weekly")!;
    expect(weekly).toMatchObject({ periodStart: "2026-10-12", periodEnd: "2026-10-18", afterSummaryId: nightly._id });
    const nightlyDelivery = stored.deliveries.find((delivery) => delivery.summaryId === nightly._id)!;
    const weeklyDelivery = stored.deliveries.find((delivery) => delivery.summaryId === weekly._id)!;

    await t.action(app.internal.familySummaries.deliver, { deliveryId: weeklyDelivery._id, now });
    expect(sentSubjects).toEqual([]);
    await t.action(app.internal.familySummaries.deliver, { deliveryId: nightlyDelivery._id, now });
    await t.action(app.internal.familySummaries.deliver, { deliveryId: weeklyDelivery._id, now });
    expect(sentSubjects).toEqual(["Your Hale nightly family summary", "Your Hale weekly family summary"]);
    expect((await rows(t, patientId)).deliveries.every((delivery) => delivery.status === "sent")).toBe(true);
  });

  test("retries transient provider failures and records delivery attempts", async () => {
    const { t, family, patientId } = await setup();
    const date = "2026-10-16";
    await addSource(t, patientId, date, "The synthetic appointment is on Tuesday.");
    await enablePreferences(family, patientId, true, false);
    const now = Date.parse(`${date}T21:00:00Z`);
    let calls = 0;
    mockFetch(() => ++calls === 1 ? Response.json({ error: "temporary" }, { status: 503 }) : Response.json({ id: "synthetic-email" }));
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    const delivery = (await rows(t, patientId)).deliveries[0]!;

    await t.action(app.internal.familySummaries.deliver, { deliveryId: delivery._id, now });
    expect((await rows(t, patientId)).deliveries[0]).toMatchObject({ status: "queued", attempts: 1, lastError: "Email provider returned HTTP 503." });
    await t.action(app.internal.familySummaries.deliver, { deliveryId: delivery._id, now: now + 30_000 });
    expect((await rows(t, patientId)).deliveries[0]).toMatchObject({ status: "sent", attempts: 2 });
    expect(calls).toBe(2);
  });

  test("family authorization and current membership are rechecked before delivery", async () => {
    const { t, owner, family, patientId } = await setup();
    const date = "2026-10-16";
    await addSource(t, patientId, date, "Only an authorized family can receive this.");
    await enablePreferences(family, patientId, true, false);
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now: Date.parse(`${date}T21:00:00Z`) });
    const delivery = (await rows(t, patientId)).deliveries[0]!;
    let sends = 0;
    mockFetch(() => { sends++; return Response.json({ id: "synthetic-email" }); });

    await expect(t.withIdentity({ subject: "outsider" }).query(app.api.familySummaries.read, { patientId })).rejects.toThrow("permission");
    await expect(owner.query(app.api.familySummaries.read, { patientId })).rejects.toThrow("authorized family members");
    await t.run(async (ctx) => {
      const membership = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", "synthetic-family")).unique();
      await ctx.db.patch(membership!._id, { active: false });
    });
    await t.action(app.internal.familySummaries.deliver, { deliveryId: delivery._id, now: Date.now() });
    expect(sends).toBe(0);
    expect((await rows(t, patientId)).deliveries[0]).toMatchObject({ status: "skipped", skippedReason: "Family access is no longer active." });
  });

  test("email preferences require the signed-in family member's verified email claim", async () => {
    const { t, family, patientId } = await setup();
    const unverifiedFamily = t.withIdentity({ subject: "synthetic-family", email: "family@example.test", emailVerified: false });
    await expect(unverifiedFamily.mutation(app.api.familySummaries.setPreferences, { patientId, nightly: true, weekly: false })).rejects.toThrow("verified email");
    expect(await unverifiedFamily.query(app.api.familySummaries.read, { patientId })).toMatchObject({
      verifiedEmailAvailable: false,
      preferences: { nightly: false, weekly: false },
    });
    await enablePreferences(family, patientId, true, true);
    await unverifiedFamily.mutation(app.api.familySummaries.setPreferences, { patientId, nightly: false, weekly: true });
    expect(await unverifiedFamily.query(app.api.familySummaries.read, { patientId })).toMatchObject({
      preferences: { nightly: false, weekly: true },
    });
  });

  test("the flag-off path does not generate, schedule, or deliver; queued work resumes safely after re-enable", async () => {
    const { t, family, patientId } = await setup();
    const date = "2026-10-16";
    await addSource(t, patientId, date, "Synthetic flag test source.");
    await enablePreferences(family, patientId, true, false);
    const now = Date.parse(`${date}T21:00:00Z`);
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    const delivery = (await rows(t, patientId)).deliveries[0]!;
    const before = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    let sends = 0;
    mockFetch(() => { sends++; return Response.json({ id: "synthetic-email" }); });

    process.env.FAMILY_SUMMARIES_ENABLED = "false";
    await t.mutation(app.internal.familySummaries.tick, {});
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now: now + 86_400_000 });
    await t.action(app.internal.familySummaries.deliver, { deliveryId: delivery._id, now });
    const after = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
    expect(after).toHaveLength(before.length);
    expect((await rows(t, patientId)).summaries).toHaveLength(1);
    expect(sends).toBe(0);

    process.env.FAMILY_SUMMARIES_ENABLED = "true";
    await t.action(app.internal.familySummaries.deliver, { deliveryId: delivery._id, now: now + 30_000 });
    expect(sends).toBe(1);
  });

  test("isolated test email goes only to the configured test inbox and contains no patient data", async () => {
    const { t, family, patientId } = await setup();
    await enablePreferences(family, patientId, false, false);
    process.env.FAMILY_SUMMARIES_EMAIL_MODE = "test";
    process.env.FAMILY_SUMMARIES_TEST_EMAIL = "synthetic-inbox@example.test";
    let sentTo = "";
    let emailText = "";
    mockFetch((_url, init) => {
      const body = JSON.parse(String(init?.body)) as { to: string[]; subject: string; text: string };
      sentTo = body.to[0]!;
      emailText = body.text;
      expect(body.subject).toContain("[TEST]");
      return Response.json({ id: "synthetic-test-email" });
    });

    const settings = await family.query(app.api.familySummaries.read, { patientId });
    expect(settings.testEmailAvailable).toBe(true);
    expect(await family.action(app.api.familySummaries.sendTestEmail, { patientId })).toEqual({ sent: true });
    expect(sentTo).toBe("synthetic-inbox@example.test");
    expect(emailText).toContain("contains no patient data");
    expect(emailText).not.toContain("Fictional Patient");
    expect((await family.query(app.api.familySummaries.read, { patientId })).preferences).toEqual({ nightly: false, weekly: false });
  });

  test("deleting a source removes its quote from the rendered summary", async () => {
    const { t, owner, family, patientId } = await setup();
    const date = "2026-10-16";
    const source = await addSource(t, patientId, date, "This synthetic source should disappear when deleted.");
    await enablePreferences(family, patientId, false, false);
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now: Date.parse(`${date}T21:00:00Z`) });

    await owner.mutation(app.api.privacy.deleteConversation, { conversationId: source.conversationId });
    const read = await family.query(app.api.familySummaries.read, { patientId });
    expect(read.summaries[0]?.entries).toEqual([]);
    expect(read.summaries[0]?.intro).toContain("No processed");
  });

  test("patient account deletion removes its summary, preferences, and delivery records", async () => {
    const { t, owner, family, patientId } = await setup();
    const date = "2026-10-16";
    await addSource(t, patientId, date, "Synthetic account deletion source.");
    await enablePreferences(family, patientId, true, false);
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now: Date.parse(`${date}T21:00:00Z`) });
    expect((await rows(t, patientId)).deliveries).toHaveLength(1);

    await owner.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    expect(await rows(t, patientId)).toEqual({ summaries: [], deliveries: [] });
    expect(await t.run((ctx) => ctx.db.query("familySummaryPreferences").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(10))).toEqual([]);
  });
});
