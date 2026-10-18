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
const previousEnabled = process.env.FAMILY_SUMMARIES_ENABLED;

beforeEach(() => {
  process.env.FAMILY_SUMMARIES_ENABLED = "true";
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
  if (previousEnabled === undefined) delete process.env.FAMILY_SUMMARIES_ENABLED;
  else process.env.FAMILY_SUMMARIES_ENABLED = previousEnabled;
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

async function rows(t: ReturnType<typeof app.createTest>, patientId: Id<"patients">) {
  return t.run(async (ctx) => ({
    summaries: await ctx.db.query("familySummaries").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100),
    legacyDeliveries: await ctx.db.query("familySummaryDeliveries").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100),
  }));
}

describe("family summaries", () => {
  test("creates one weekday nightly summary from same-patient ready transcript sources", async () => {
    const { t, family, patientId } = await setup();
    const date = "2026-10-16";
    const source = await addSource(t, patientId, date, "We watered the garden together.");
    const now = Date.parse(`${date}T21:00:00Z`);

    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });

    const stored = await rows(t, patientId);
    expect(stored.summaries).toHaveLength(1);
    expect(stored.summaries[0]).toMatchObject({ kind: "nightly", periodKey: date, sourceTurnIds: [source.turnId] });
    expect(stored.legacyDeliveries).toEqual([]);
    const read = await family.query(app.api.familySummaries.read, { patientId });
    expect(read).toMatchObject({ enabled: true });
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

  test("Sunday creates a separate weekly recap without creating delivery work", async () => {
    const { t, family, patientId } = await setup();
    await addSource(t, patientId, "2026-10-12", "We visited the library on Monday.");
    await addSource(t, patientId, "2026-10-18", "We shared tea on Sunday.");
    const now = Date.parse("2026-10-18T21:00:00Z");

    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });

    const stored = await rows(t, patientId);
    expect(stored.summaries.map((summary) => summary.kind).sort()).toEqual(["nightly", "weekly"]);
    const weekly = stored.summaries.find((summary) => summary.kind === "weekly")!;
    expect(weekly).toMatchObject({ periodStart: "2026-10-12", periodEnd: "2026-10-18" });
    expect(weekly.afterSummaryId).toBeUndefined();
    expect(stored.legacyDeliveries).toEqual([]);
    expect((await family.query(app.api.familySummaries.read, { patientId })).summaries).toHaveLength(2);
  });

  test("the feature flag prevents summary work until re-enabled", async () => {
    const { t, patientId } = await setup();
    const date = "2026-10-16";
    await addSource(t, patientId, date, "Synthetic flag test source.");
    const now = Date.parse(`${date}T21:00:00Z`);

    process.env.FAMILY_SUMMARIES_ENABLED = "false";
    await t.mutation(app.internal.familySummaries.tick, {});
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    expect((await rows(t, patientId)).summaries).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);

    process.env.FAMILY_SUMMARIES_ENABLED = "true";
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    expect((await rows(t, patientId)).summaries).toHaveLength(1);
    expect((await rows(t, patientId)).legacyDeliveries).toEqual([]);
  });

  test("family authorization is checked before reading summaries", async () => {
    const { t, owner, family, patientId } = await setup();
    await expect(t.withIdentity({ subject: "outsider" }).query(app.api.familySummaries.read, { patientId })).rejects.toThrow("permission");
    await expect(owner.query(app.api.familySummaries.read, { patientId })).rejects.toThrow("authorized family members");
    expect(await family.query(app.api.familySummaries.read, { patientId })).toMatchObject({ enabled: true, summaries: [] });
  });

  test("deleting a source removes its quote from the rendered summary", async () => {
    const { t, owner, family, patientId } = await setup();
    const date = "2026-10-16";
    const source = await addSource(t, patientId, date, "This synthetic source should disappear when deleted.");
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now: Date.parse(`${date}T21:00:00Z`) });

    await owner.mutation(app.api.privacy.deleteConversation, { conversationId: source.conversationId });
    const read = await family.query(app.api.familySummaries.read, { patientId });
    expect(read.summaries[0]?.entries).toEqual([]);
    expect(read.summaries[0]?.intro).toContain("No processed");
  });

  test("account deletion also clears retained legacy summary email records", async () => {
    const { t, owner, patientId } = await setup();
    const date = "2026-10-16";
    await addSource(t, patientId, date, "Synthetic account deletion source.");
    const now = Date.parse(`${date}T21:00:00Z`);
    await t.mutation(app.internal.familySummaries.generateForPatient, { patientId, now });
    const summary = (await rows(t, patientId)).summaries[0]!;
    await t.run(async (ctx) => {
      await ctx.db.insert("familySummaryPreferences", {
        patientId, subject: "synthetic-family", nightly: true, weekly: false,
        email: "family@example.test", updatedAt: now, testEmailSentAt: now,
      });
      await ctx.db.insert("familySummaryDeliveries", {
        patientId, summaryId: summary._id, recipientSubject: "synthetic-family",
        status: "sent", attempts: 1, nextAttemptAt: now, createdAt: now, deliveredAt: now,
      });
    });
    expect((await rows(t, patientId)).legacyDeliveries).toHaveLength(1);

    await owner.mutation(app.api.accounts.deleteMyData, { confirmation: "DELETE" });
    expect(await rows(t, patientId)).toEqual({ summaries: [], legacyDeliveries: [] });
    expect(await t.run((ctx) => ctx.db.query("familySummaryPreferences").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(10))).toEqual([]);
  });
});
