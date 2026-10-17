import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as patients from "./patients";
import * as privacy from "./privacy";
import * as recordings from "./recordings";
import * as transcriptions from "./transcriptions";
import * as speakerMatching from "./speakerMatching";

const app = defineTestApp({ schema }).defineModules({ patients, privacy, recordings, transcriptions, speakerMatching });
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

  test("schedules selected-speaker matching after transcription and retains only transcript text", async () => {
    const t = app.createTest();
    tests.push(t);
    const owner = t.withIdentity({ subject: "expected-speaker-owner" });
    const patientId = await owner.mutation(app.api.patients.create, { name: "Fictional Patient", timezone: "UTC", recordingConsent: true });
    const personId = await t.run(async (ctx) => (await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", patientId)).first())!._id);
    const sessionId = await owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true, expectedPeople: [personId] });
    const capturedAt = Date.now() - 1_000;
    const endedAt = Date.now();
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["consented upload"], { type: "audio/mp4" })));
    const { chunkId } = await owner.mutation(app.internal.recordings.acceptChunk, { sessionId, sequence: 0, storageId, capturedAt, endedAt, mimeType: "audio/mp4" });
    const jobId = await t.run(async (ctx) => (await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).unique())!._id);
    const matchJobId = await t.run(async (ctx) => (await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).unique())!._id);
    mockFetch(async () => Response.json({
      transcript: "Hello there.", language_code: "en-IN",
      timestamps: { words: ["Hello", "there."], start_time_seconds: [0, 0.4], end_time_seconds: [0.35, 0.9] },
    }));

    await t.action(app.internal.transcriptions.transcribe, { jobId });
    expect(await t.run((ctx) => ctx.db.get(matchJobId))).toMatchObject({ state: "queued", expectedPeople: [personId] });
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(2);
    await t.action(app.internal.speakerMatching.process, { jobId: matchJobId });

    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(matchJobId))).toMatchObject({ state: "skipped" });
    const conversation = await t.run((ctx) => ctx.db.query("conversations").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).unique());
    expect(conversation).toMatchObject({ state: "ready", summary: expect.stringContaining("No selected person") });
    const turns = await t.run((ctx) => ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversation!._id)).collect());
    expect(turns.map((turn) => turn.text)).toEqual(["Hello there."]);
    expect(turns.every((turn) => turn.uncertain && !turn.personId)).toBe(true);
  });

  test("uses Saaras v4 and saves timestamped turns as unknown, without diarization claims", async () => {
    const { t, jobId, conversationId, chunkId, storageId } = await setup();
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
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();

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
    const { t, jobId, chunkId, conversationId, storageId } = await setup();
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
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
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

  test("uses Sarvam batch transcription for clips longer than the REST limit and deletes source audio after saving text", async () => {
    const { t, jobId, chunkId, conversationId, storageId } = await setup();
    await t.run(async (ctx) => {
      const chunk = await ctx.db.get(chunkId);
      if (chunk) {
        await ctx.db.patch(chunkId, { endedAt: chunk.capturedAt + 45_000 });
        await ctx.db.patch(conversationId, { duration: 45 });
      }
    });
    const calls: { url: string; init?: RequestInit }[] = [];
    mockFetch(async (url, init) => {
      calls.push({ url, init });
      if (url === "https://api.sarvam.ai/speech-to-text/job/v1") return Response.json({ job_id: "sarvam-batch-1" });
      if (url.endsWith("/upload-files")) return Response.json({ upload_urls: { "conversation.m4a": { file_url: "https://upload.example/signed" } } });
      if (url === "https://upload.example/signed") return new Response(null, { status: 201 });
      if (url.endsWith("/sarvam-batch-1/start")) return Response.json({ job_id: "sarvam-batch-1", job_state: "Running" });
      if (url.endsWith("/sarvam-batch-1/status")) return Response.json({
        job_id: "sarvam-batch-1", job_state: "Completed",
        job_details: [{ state: "Success", outputs: [{ file_name: "0.json" }] }],
      });
      if (url.endsWith("/download-files")) return Response.json({ download_urls: { "0.json": { file_url: "https://download.example/result" } } });
      if (url === "https://download.example/result") return Response.json({
        transcript: "This longer clip was transcribed.", language_code: "en-IN",
        timestamps: { chunks: ["This longer clip was transcribed."], start_time_seconds: [0], end_time_seconds: [20] },
      });
      throw new Error(`Unexpected mocked request: ${url}`);
    });

    await t.action(app.internal.transcriptions.transcribe, { jobId });

    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "processing", attempts: 1, providerJobId: "sarvam-batch-1" });
    expect(JSON.parse(String(calls[0]?.init?.body))).toMatchObject({ job_parameters: { model: "saaras:v4", with_timestamps: true } });
    expect(calls[2]?.init?.headers).toMatchObject({ "x-ms-blob-type": "BlockBlob", "Content-Type": "audio/mp4" });

    await t.action(app.internal.transcriptions.pollBatch, { jobId, generation: 1, attempt: 0 });
    expect(await t.run((ctx) => ctx.db.get(jobId))).toMatchObject({ state: "ready" });
    expect((await t.run((ctx) => ctx.db.get(jobId)))?.providerJobId).toBeUndefined();
    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    const turns = await t.run((ctx) => ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", conversationId)).collect());
    expect(turns.map((turn) => turn.text)).toEqual(["This longer clip was transcribed."]);
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "ready", summary: expect.stringContaining("Only transcript text is kept") });
  });

  test("audio expiry invalidates a stale speaker job but preserves already completed transcript text", async () => {
    const { t, patientId, chunkId, storageId, conversationId } = await setup();
    const seeded = await t.run(async (ctx) => {
      const now = Date.now();
      const turnId = await ctx.db.insert("transcriptTurns", {
        patientId, conversationId, speaker: "Unknown speaker", start: 0, end: 2,
        text: "Transcript survives temporary audio expiry.", uncertain: true,
      });
      const matchJobId = await ctx.db.insert("speakerMatchingJobs", {
        patientId, chunkId, conversationId, expectedPeople: [], state: "processing", attempts: 1,
        generation: 4, providerJobId: "late-provider-job", createdAt: now, updatedAt: now - 86_400_000,
      });
      await ctx.db.patch(chunkId, { expiresAt: now - 1, state: "ready" });
      await ctx.db.patch(conversationId, { state: "processing" });
      await ctx.db.patch((await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).unique())!._id, { state: "ready" });
      return { turnId, matchJobId };
    });

    await t.mutation(app.internal.privacy.expireAudio, {});

    expect(await t.run((ctx) => ctx.storage.getUrl(storageId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(seeded.matchJobId))).toMatchObject({ state: "failed", generation: 5 });
    expect(await t.run((ctx) => ctx.db.get(seeded.turnId))).toMatchObject({ text: "Transcript survives temporary audio expiry.", speaker: "Unknown speaker", uncertain: true });
    expect(await t.run((ctx) => ctx.db.get(conversationId))).toMatchObject({ state: "ready", people: [], summary: expect.stringContaining("every voice remains unknown") });
    expect(await t.mutation(app.internal.speakerMatching.complete, { jobId: seeded.matchJobId, generation: 4, assignments: [] })).toBe(false);
  });
});
