import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { VOICE_MATCHING_POLICY } from "@hale/contracts/voice";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as patients from "./patients";
import * as speakerMatching from "./speakerMatching";

const app = defineTestApp({ schema }).defineModules({ patients, speakerMatching });
const tests: ReturnType<typeof app.createTest>[] = [];
const originalFetch = globalThis.fetch;
let previousKey: string | undefined;

beforeEach(() => {
  previousKey = process.env.PYANNOTE_API_KEY;
  process.env.PYANNOTE_API_KEY = "test-key-not-real";
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
  if (previousKey === undefined) delete process.env.PYANNOTE_API_KEY;
  else process.env.PYANNOTE_API_KEY = previousKey;
});

function mockProvider(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init), { preconnect: originalFetch.preconnect });
}

async function setup() {
  const t = app.createTest();
  tests.push(t);
  const owner = t.withIdentity({ subject: "speaker-owner" });
  const patientId = await owner.mutation(app.api.patients.create, {
    name: "Fictional Patient", timezone: "UTC", recordingConsent: true, externalAIConsent: true,
  });
  const seeded = await t.run(async (ctx) => {
    const now = Date.now();
    const person = await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", patientId)).first();
    if (!person) throw new Error("Missing patient person fixture.");
    const profileId = await ctx.db.insert("familyProfiles", {
      subject: "speaker-owner", name: "Fictional Patient", relationship: "Self", voiceState: "enrolled",
      consentAt: now, policyVersion: "test-policy", voiceprint: "private-test-voiceprint", enrollmentVersion: 4, updatedAt: now,
    });
    await ctx.db.patch(person._id, { familyProfileId: profileId, voiceConsentAt: now, voiceConsentPolicy: VOICE_MATCHING_POLICY });
    await ctx.db.insert("consents", {
      patientId, subject: "speaker-owner", purpose: "voice_matching", policyVersion: VOICE_MATCHING_POLICY, grantedAt: now,
    });
    const sessionId = await ctx.db.insert("recordingSessions", {
      patientId, subject: "speaker-owner", startedAt: now - 4_000, timezone: "UTC", state: "stopped", consentConfirmedAt: now - 4_000,
    });
    const storageId = await ctx.storage.store(new Blob(["temporary audio"], { type: "audio/mp4" }));
    const chunkId = await ctx.db.insert("audioChunks", {
      patientId, sessionId, sequence: 0, storageId, capturedAt: now - 4_000, endedAt: now,
      mimeType: "audio/mp4", state: "ready", expiresAt: now + 60 * 60_000,
    });
    const conversationId = await ctx.db.insert("conversations", {
      patientId, chunkId, title: "Recorded conversation", summary: "Transcript prepared.", startedAt: now - 4_000,
      duration: 4, localDate: "2026-10-17", people: [], state: "processing",
    });
    await ctx.db.insert("processingJobs", { patientId, chunkId, state: "ready", attempts: 1, generation: 1, createdAt: now, updatedAt: now });
    const turnId = await ctx.db.insert("transcriptTurns", {
      patientId, conversationId, chunkId, speaker: "Unknown speaker", start: 0, end: 4,
      text: "Hello there.", uncertain: true,
    });
    const jobId = await ctx.db.insert("speakerMatchingJobs", {
      patientId, chunkId, conversationId, expectedPeople: [person._id], state: "queued", attempts: 0, generation: 0,
      createdAt: now, updatedAt: now,
    });
    return { personId: person._id, profileId, storageId, chunkId, conversationId, turnId, jobId };
  });
  return { t, owner, patientId, ...seeded };
}

describe("pyannote speaker matching", () => {
  test("matches only an expected, actively consented speaker and deletes temporary audio", async () => {
    const { t, jobId, personId, storageId, conversationId, turnId } = await setup();
    const calls: { url: string; init?: RequestInit }[] = [];
    let label = "";
    mockProvider(async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith("/identify")) {
        const body = JSON.parse(String(init?.body)) as { voiceprints: { label: string }[]; matching: { threshold: number; exclusive: boolean } };
        label = body.voiceprints[0]!.label;
        expect(body.matching).toEqual({ threshold: 70, exclusive: true });
        return Response.json({ jobId: "identify-1", status: "created" });
      }
      return Response.json({
        jobId: "identify-1", status: "succeeded",
        output: {
          diarization: [{ speaker: "SPEAKER_00", start: 0, end: 4 }],
          voiceprints: [{ speaker: "SPEAKER_00", match: label, confidence: { [label]: 88 } }],
        },
      });
    });

    await t.action(app.internal.speakerMatching.process, { jobId });
    await t.action(app.internal.speakerMatching.poll, { jobId, generation: 1, attempt: 0 });

    expect(calls.map(({ url }) => url)).toEqual([
      "https://api.pyannote.ai/v1/identify",
      "https://api.pyannote.ai/v1/jobs/identify-1",
    ]);
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(turnId))).toMatchObject({ speaker: "Fictional Patient", personId, uncertain: false });
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "ready", people: [personId], summary: expect.stringContaining("source recording was deleted") });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "ready" });
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.providerJobId).toBeUndefined();
  });

  test("rechecks consent at commit time and leaves the transcript unknown if consent was revoked", async () => {
    const { t, patientId, jobId, personId, profileId, storageId, conversationId, turnId } = await setup();
    let label = "";
    mockProvider(async (url, init) => {
      if (url.endsWith("/identify")) {
        label = (JSON.parse(String(init?.body)) as { voiceprints: { label: string }[] }).voiceprints[0]!.label;
        return Response.json({ jobId: "identify-revoked", status: "created" });
      }
      await t.run(async (ctx) => {
        const active = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) => q.eq("patientId", patientId).eq("subject", "speaker-owner").eq("purpose", "voice_matching")).first();
        if (active) await ctx.db.patch(active._id, { revokedAt: Date.now() });
        await ctx.db.patch(profileId, { voiceState: "revoked", voiceprint: undefined, enrollmentVersion: 5 });
      });
      return Response.json({
        jobId: "identify-revoked", status: "succeeded",
        output: { diarization: [{ speaker: "SPEAKER_00", start: 0, end: 4 }], voiceprints: [{ speaker: "SPEAKER_00", confidence: { [label]: 96 } }] },
      });
    });

    await t.action(app.internal.speakerMatching.process, { jobId });
    await t.action(app.internal.speakerMatching.poll, { jobId, generation: 1, attempt: 0 });

    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(turnId))).toMatchObject({ speaker: "Unknown speaker", uncertain: true });
    expect((await t.run((ctx) => ctx.db.get(turnId)))?.personId).toBeUndefined();
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "ready", people: [], summary: expect.stringContaining("No speaker met the matching safeguards") });
  });
});
