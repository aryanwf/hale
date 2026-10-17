import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as patients from "./patients";
import * as privacy from "./privacy";
import * as recordings from "./recordings";
import * as transcriptions from "./transcriptions";

const app = defineTestApp({ schema }).defineModules({ patients, privacy, recordings, transcriptions });
const tests: ReturnType<typeof app.createTest>[] = [];
const originalFetch = globalThis.fetch;
let previousKey: string | undefined;

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => handler(String(input), init), { preconnect: originalFetch.preconnect });
}

beforeEach(() => {
  previousKey = process.env.SARVAM_API_KEY;
  process.env.SARVAM_API_KEY = "sarvam-test-key";
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
  if (previousKey === undefined) delete process.env.SARVAM_API_KEY;
  else process.env.SARVAM_API_KEY = previousKey;
});

async function setup() {
  const t = app.createTest();
  tests.push(t);
  const owner = t.withIdentity({ subject: "transcription-owner" });
  const patientId = await owner.mutation(app.api.patients.create, {
    name: "Fictional Patient", timezone: "UTC", recordingConsent: true,
  });
  const capturedAt = Date.now() - 30_000;
  const seeded = await t.run(async (ctx) => {
    const sessionId = await ctx.db.insert("recordingSessions", {
      patientId, subject: "transcription-owner", startedAt: capturedAt, timezone: "UTC", state: "stopped", consentConfirmedAt: capturedAt,
    });
    const storageId = await ctx.storage.store(new Blob(["consented sample audio"], { type: "audio/mp4;codecs=opus" }));
    const chunkId = await ctx.db.insert("audioChunks", {
      patientId, sessionId, sequence: 0, storageId, capturedAt, endedAt: capturedAt + 25_000,
      mimeType: "audio/mp4;codecs=opus", state: "queued", expiresAt: Date.now() + 86_400_000,
    });
    const jobId = await ctx.db.insert("processingJobs", { patientId, chunkId, state: "queued", attempts: 0, generation: 0, createdAt: Date.now(), updatedAt: Date.now() });
    const conversationId = await ctx.db.insert("conversations", {
      patientId, chunkId, title: "New recording", summary: "Waiting for transcription.", startedAt: capturedAt,
      duration: 25, localDate: "2026-10-17", people: [], state: "queued",
    });
    return { storageId, chunkId, jobId, conversationId };
  });
  return { t, owner, patientId, ...seeded };
}

const successfulResponse = () => Response.json({
  transcript: "Hello there. Thank you.",
  language_code: "en-IN",
  timestamps: {
    words: ["Hello", "there.", "Thank", "you."],
    start_time_seconds: [0, 0.45, 2, 2.4],
    end_time_seconds: [0.4, 0.9, 2.3, 2.8],
  },
});

describe("Sarvam conversation transcription", () => {
  test("accepting an authorized audio chunk creates one queued job and schedules Sarvam processing", async () => {
    const t = app.createTest();
    tests.push(t);
    const owner = t.withIdentity({ subject: "upload-owner" });
    const patientId = await owner.mutation(app.api.patients.create, { name: "Fictional Patient", timezone: "UTC", recordingConsent: true });
    const sessionId = await owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true });
    const capturedAt = Date.now() - 1_000;
    const endedAt = Date.now();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["consented upload"], { type: "audio/mp4" })));
    const upload = { sessionId, sequence: 0, storageId, capturedAt, endedAt, mimeType: "audio/mp4" };

    expect(await owner.mutation(app.internal.recordings.acceptChunk, upload)).toMatchObject({ duplicate: false });
    expect(await owner.mutation(app.internal.recordings.acceptChunk, upload)).toMatchObject({ duplicate: true });
    expect(await t.run((ctx) => ctx.db.query("processingJobs").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("conversations").collect())).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);
  });

  test("uses Saaras v4 and saves timestamped turns as unknown, without diarization claims", async () => {
    const { t, jobId, conversationId, chunkId } = await setup();
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(async (url, init) => { calls.push({ url, init }); return successfulResponse(); });

    await t.action(app.internal.transcriptions.transcribe, { jobId });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.sarvam.ai/speech-to-text");
    expect(calls[0].init?.headers).toEqual({ "api-subscription-key": "sarvam-test-key" });
    const form = calls[0].init?.body as FormData;
    expect(form.get("model")).toBe("saaras:v4");
    expect(form.get("with_timestamps")).toBe("true");
    expect((form.get("file") as File).name).toBe("recording.m4a");

    const turns = await t.run((ctx) => ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).collect());
    expect(turns).toHaveLength(2);
    expect(turns.map(({ text, speaker, uncertain, start, end }) => ({ text, speaker, uncertain, start, end }))).toEqual([
      { text: "Hello there.", speaker: "Unknown speaker", uncertain: true, start: 0, end: 0.9 },
      { text: "Thank you.", speaker: "Unknown speaker", uncertain: true, start: 2, end: 2.8 },
    ]);
    expect(await t.run((ctx) => ctx.db.get(chunkId))).toMatchObject({ state: "ready" });
    expect(await t.run((ctx) => ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).unique())).toMatchObject({ state: "ready", attempts: 1 });
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "ready", summary: expect.stringContaining("Sarvam AI (en-IN)") });

    await t.action(app.internal.transcriptions.transcribe, { jobId });
    expect(calls).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).collect())).toHaveLength(2);
  });

  test("retains whole transcript text when timestamps are absent or malformed", () => {
    expect(transcriptions.makeUnknownTurns("Full fallback transcript.", undefined, 12)).toEqual([
      { start: 0, end: 12, text: "Full fallback transcript." },
    ]);
    expect(transcriptions.makeUnknownTurns("Full fallback transcript.", {
      segments: ["partial"], startTimeSeconds: [2], endTimeSeconds: [],
    }, 12)).toEqual([{ start: 0, end: 12, text: "Full fallback transcript." }]);
  });

  test("retries transient Sarvam errors and eventually marks an exhausted job failed", async () => {
    const { t, jobId, chunkId, conversationId } = await setup();
    let calls = 0;
    mockFetch(async () => { calls++; return new Response("provider details are private", { status: 503 }); });

    await t.action(app.internal.transcriptions.transcribe, { jobId });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "queued", attempts: 1 });
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "queued" });
    await t.action(app.internal.transcriptions.transcribe, { jobId });
    await t.action(app.internal.transcriptions.transcribe, { jobId });

    expect(calls).toBe(3);
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "failed", attempts: 3, error: "Sarvam transcription could not be completed." });
    expect(await t.run((ctx) => ctx.db.get(chunkId))).toMatchObject({ state: "failed" });
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "failed" });
    expect(JSON.stringify(await t.run((ctx) => ctx.db.get(jobId)))).not.toContain("provider details");
  });

  test("a late Sarvam result cannot restore a deleted conversation", async () => {
    const { t, owner, jobId, conversationId, chunkId } = await setup();
    let calls = 0;
    mockFetch(async () => {
      calls++;
      await owner.mutation(app.api.privacy.deleteConversation, { conversationId });
      return successfulResponse();
    });

    await t.action(app.internal.transcriptions.transcribe, { jobId });

    expect(calls).toBe(1);
    expect(await t.run((ctx) => ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ deletedAt: expect.any(Number), title: "Deleted conversation" });
    expect(await t.run((ctx) => ctx.db.get(chunkId))).toMatchObject({ deletedAt: expect.any(Number), state: "failed" });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "failed", error: "Source deleted." });
  });

  test("audio clips longer than Saaras realtime limit fail safely without a provider call", async () => {
    const { t, jobId, chunkId } = await setup();
    await t.run(async (ctx) => {
      const chunk = await ctx.db.get(chunkId);
      if (chunk) await ctx.db.patch(chunkId, { endedAt: chunk.capturedAt + 31_000 });
    });
    let calls = 0;
    mockFetch(async () => { calls++; return successfulResponse(); });

    await t.action(app.internal.transcriptions.transcribe, { jobId });

    expect(calls).toBe(0);
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "failed", attempts: 1 });
  });
});
