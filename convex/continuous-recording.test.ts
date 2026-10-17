import { afterEach, describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as patients from "./patients";
import * as recordings from "./recordings";
import * as transcriptions from "./transcriptions";
import * as conversations from "./conversations";
import * as privacy from "./privacy";
import * as assistant from "./assistant";

const app = defineTestApp({ schema }).defineModules({ patients, recordings, transcriptions, conversations, privacy, assistant });
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

async function setup() {
  const t = app.createTest();
  tests.push(t);
  const owner = t.withIdentity({ subject: "continuous-owner" });
  const patientId = await owner.mutation(app.api.patients.create, { name: "Synthetic Test", timezone: "UTC", recordingConsent: true });
  const sessionId = await owner.mutation(app.api.recordings.start, { patientId, participantsConsented: true, captureMode: "native", continuous: true });
  const capturedAt = Date.now() - 1000;
  await t.run((ctx) => ctx.db.patch(sessionId, { startedAt: capturedAt }));
  async function upload(sequence: number) {
    const storageId = await t.run((ctx) => ctx.storage.store(new Blob(["synthetic audio"], { type: "audio/wav" })));
    const args = { sessionId, sequence, capturedAt: capturedAt + sequence * 1000, endedAt: capturedAt + sequence * 1000 + 1000, storageId, mimeType: "audio/wav" };
    const result = await owner.mutation(app.internal.recordings.acceptChunk, args);
    const job = await t.run((ctx) => ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", result.chunkId)).unique());
    return { ...result, jobId: job!._id, args, storageId };
  }
  async function finish(jobId: (Awaited<ReturnType<typeof upload>>)["jobId"], text: string) {
    const claimed = await t.mutation(app.internal.transcriptions.claim, { jobId });
    return t.mutation(app.internal.transcriptions.complete, { jobId, generation: claimed!.generation, turns: text ? [{ start: 0, end: 0.5, text }] : [] });
  }
  return { t, owner, patientId, sessionId, upload, finish };
}

describe("continuous conversation recording", () => {
  test("appends separately processed segments to one ordered conversation", async () => {
    const { t, owner, sessionId, upload, finish } = await setup();
    const first = await upload(0);
    const second = await upload(1);
    await finish(second.jobId, "Second sentence.");
    await finish(first.jobId, "First sentence.");
    const live = await owner.query(app.api.recordings.live, { sessionId });
    expect(live?.turns.map(({ start, text }) => ({ start, text }))).toEqual([
      { start: 0, text: "First sentence." }, { start: 1, text: "Second sentence." },
    ]);
    expect(await t.run((ctx) => ctx.db.query("conversations").collect())).toHaveLength(1);
  });

  test("a retried upload and duplicate worker completion cannot duplicate dialogue", async () => {
    const { t, owner, sessionId, upload, finish } = await setup();
    const clip = await upload(0);
    await owner.mutation(app.internal.recordings.acceptChunk, clip.args);
    await finish(clip.jobId, "Only once.");
    await t.mutation(app.internal.transcriptions.complete, { jobId: clip.jobId, generation: 1, turns: [{ start: 0, end: 0.5, text: "Only once." }] });
    expect((await owner.query(app.api.recordings.live, { sessionId }))?.turns).toHaveLength(1);
  });

  test("switching off waits for outstanding transcription before marking ready", async () => {
    const { t, owner, sessionId, upload, finish } = await setup();
    const clip = await upload(0);
    await owner.mutation(app.api.recordings.setState, { sessionId, state: "stopped" });
    const live = await owner.query(app.api.recordings.live, { sessionId });
    expect(await t.run((ctx) => ctx.db.get(live!.conversationId!))).toMatchObject({ state: "processing", pendingChunks: 1 });
    await finish(clip.jobId, "Last words.");
    expect(await t.run((ctx) => ctx.db.get(live!.conversationId!))).toMatchObject({ state: "ready", pendingChunks: 0 });
  });

  test("silent live segments finish without inventing speech or failing the session", async () => {
    const { owner, sessionId, upload, finish } = await setup();
    const clip = await upload(0);
    await finish(clip.jobId, "");
    expect(await owner.query(app.api.recordings.live, { sessionId })).toMatchObject({ failed: 0, pending: 0, turns: [] });
  });

  test("failure of one segment preserves already saved dialogue", async () => {
    const { t, owner, sessionId, upload, finish } = await setup();
    const first = await upload(0);
    const second = await upload(1);
    await finish(first.jobId, "Keep these words.");
    const claimed = await t.mutation(app.internal.transcriptions.claim, { jobId: second.jobId });
    await t.mutation(app.internal.transcriptions.fail, { jobId: second.jobId, generation: claimed!.generation, retryable: false });
    expect(await owner.query(app.api.recordings.live, { sessionId })).toMatchObject({ failed: 1, pending: 0, turns: [{ text: "Keep these words." }] });
  });

  test("temporary audio is deleted as soon as each live segment is transcribed", async () => {
    const { t, upload, finish } = await setup();
    const clip = await upload(0);
    await finish(clip.jobId, "Saved words.");
    expect(await t.run((ctx) => ctx.storage.get(clip.storageId))).toBeNull();
  });

  test("another identity cannot read the live session", async () => {
    const { t, sessionId } = await setup();
    await expect(t.withIdentity({ subject: "outsider" }).query(app.api.recordings.live, { sessionId })).rejects.toThrow();
  });

  test("deleting a conversation rejects later uploads and late transcription", async () => {
    const { t, owner, sessionId, upload } = await setup();
    const first = await upload(0);
    const second = await upload(1);
    const claimed = await t.mutation(app.internal.transcriptions.claim, { jobId: second.jobId });
    const live = await owner.query(app.api.recordings.live, { sessionId });
    await owner.mutation(app.api.privacy.deleteConversation, { conversationId: live!.conversationId! });
    await expect(owner.mutation(app.internal.recordings.acceptChunk, first.args)).rejects.toThrow("deleted");
    expect(await t.mutation(app.internal.transcriptions.complete, { jobId: second.jobId, generation: claimed!.generation, turns: [{ start: 0, end: 0.5, text: "Late words." }] })).toBe(false);
    await t.mutation(app.internal.privacy.purgeLiveConversation, { conversationId: live!.conversationId! });
    expect(await t.run((ctx) => ctx.db.query("audioChunks").collect())).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("transcriptTurns").collect())).toHaveLength(0);
  });

  test("dialogue pagination can retrieve later segments", async () => {
    const { owner, sessionId, upload, finish } = await setup();
    await finish((await upload(0)).jobId, "First.");
    await finish((await upload(1)).jobId, "Second.");
    const live = await owner.query(app.api.recordings.live, { sessionId });
    const first = await owner.query(app.api.conversations.transcriptPage, { conversationId: live!.conversationId!, paginationOpts: { numItems: 1, cursor: null } });
    const second = await owner.query(app.api.conversations.transcriptPage, { conversationId: live!.conversationId!, paginationOpts: { numItems: 1, cursor: first.continueCursor } });
    expect(second.page.map((turn) => turn.text)).toEqual(["Second."]);
  });

  test("Ask Hale can cite saved words before recording is switched off", async () => {
    const { owner, patientId, upload, finish } = await setup();
    await finish((await upload(0)).jobId, "We will visit the garden on Saturday.");
    const answer = await owner.query(app.api.assistant.recall, { patientId, question: "What was said about the garden?" });
    expect(answer.citations.map((citation) => citation.excerpt)).toEqual(["We will visit the garden on Saturday."]);
  });

  test("expiry settles a missing segment without losing an earlier transcript", async () => {
    const { t, owner, sessionId, upload, finish } = await setup();
    await finish((await upload(0)).jobId, "These words survived.");
    const next = await upload(1);
    await t.run((ctx) => ctx.db.patch(next.chunkId, { expiresAt: Date.now() - 1 }));
    await t.mutation(app.internal.privacy.expireAudio, {});
    expect(await owner.query(app.api.recordings.live, { sessionId })).toMatchObject({ pending: 0, failed: 1, turns: [{ text: "These words survived." }] });
  });

  test("an abandoned live session stops without restarting or erasing dialogue", async () => {
    const { t, owner, sessionId, upload, finish } = await setup();
    await finish((await upload(0)).jobId, "Saved before interruption.");
    await t.run((ctx) => ctx.db.patch(sessionId, { lastChunkAt: Date.now() - 11 * 60_000 }));
    await t.mutation(app.internal.transcriptions.recoverStale, {});
    expect(await t.run((ctx) => ctx.db.get(sessionId))).toMatchObject({ state: "stopped" });
    expect((await owner.query(app.api.recordings.live, { sessionId }))?.turns).toHaveLength(1);
  });

  test("large live conversations are deleted in bounded cleanup batches", async () => {
    const { t, owner, patientId, sessionId, upload } = await setup();
    await upload(0);
    const live = await owner.query(app.api.recordings.live, { sessionId });
    const conversationId = live!.conversationId!;
    await t.run(async (ctx) => {
      for (let sequence = 1; sequence <= 50; sequence++) await ctx.db.insert("audioChunks", {
        patientId, sessionId, conversationId, sequence, capturedAt: 1000, endedAt: 2000, mimeType: "audio/wav", state: "ready", expiresAt: 3000,
      });
    });
    await owner.mutation(app.api.privacy.deleteConversation, { conversationId });
    await t.mutation(app.internal.privacy.purgeLiveConversation, { conversationId });
    expect(await t.run((ctx) => ctx.db.query("audioChunks").collect())).toHaveLength(1);
    await t.mutation(app.internal.privacy.purgeLiveConversation, { conversationId });
    expect(await t.run((ctx) => ctx.db.query("audioChunks").collect())).toHaveLength(0);
  });
});
