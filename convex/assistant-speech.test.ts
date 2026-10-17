import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import { localDate } from "@hale/contracts/time";
import schema from "./schema";
import * as assistant from "./assistant";
import * as conversations from "./conversations";
import * as patients from "./patients";

const app = defineTestApp({ schema }).defineModules({ assistant, conversations, patients });
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
  const owner = t.withIdentity({ subject: "speech-owner" });
  const patientId = await owner.mutation(app.api.patients.create, { name: "Fictional Patient", timezone: "UTC", recordingConsent: true, externalAIConsent: true });
  const conversationId = await t.run(async (ctx) => {
    const now = Date.now();
    const sessionId = await ctx.db.insert("recordingSessions", { patientId, subject: "speech-owner", startedAt: now - 10_000, timezone: "UTC", state: "stopped", consentConfirmedAt: now - 10_000 });
    const chunkId = await ctx.db.insert("audioChunks", { patientId, sessionId, sequence: 0, capturedAt: now - 10_000, endedAt: now, mimeType: "audio/mp4", state: "ready", expiresAt: now + 86_400_000 });
    const id = await ctx.db.insert("conversations", { patientId, chunkId, title: "Garden conversation", summary: "A real source transcript.", startedAt: now - 10_000, duration: 10, localDate: localDate(new Date(now), "UTC"), people: [], state: "ready" });
    await ctx.db.insert("transcriptTurns", { patientId, conversationId: id, speaker: "Unknown speaker", start: 0, end: 5, text: "We will water the garden on Saturday.", uncertain: true });
    return id;
  });
  return { t, owner, patientId, conversationId };
}

describe("Sarvam answer speech", () => {
  test("authorizes source-bound recall and stores temporary Bulbul v3 audio", async () => {
    const { t, owner, patientId } = await setup();
    let call: { url: string; init?: RequestInit } | undefined;
    mockFetch(async (url, init) => {
      call = { url, init };
      return Response.json({ audios: [btoa("RIFF-speech-audio")] });
    });

    const speech = await owner.action(app.api.assistant.speakAnswer, { patientId, question: "What about the garden?", languageCode: "en-IN" });

    expect(call?.url).toBe("https://api.sarvam.ai/text-to-speech");
    expect(call?.init?.headers).toMatchObject({ "api-subscription-key": "sarvam-test-key", "Content-Type": "application/json" });
    expect(JSON.parse(String(call?.init?.body))).toMatchObject({ model: "bulbul:v3", language_code: "en-IN", text: expect.stringContaining("garden") });
    expect(speech.url).toContain("storage");
    expect(speech.expiresAt).toBeGreaterThan(Date.now());
    const stored = await t.run((ctx) => ctx.db.system.query("_storage").collect());
    expect(stored).toHaveLength(1);
    expect(await t.run((ctx) => ctx.storage.getUrl(stored[0]._id))).toBe(speech.url);

    await t.mutation(app.internal.assistant.deleteSpeech, { storageId: stored[0]._id });
    expect(await t.run((ctx) => ctx.storage.getUrl(stored[0]._id))).toBeNull();
  });

  test("does not call Sarvam or return audio to an account without patient access", async () => {
    const { t, patientId } = await setup();
    let calls = 0;
    mockFetch(async () => { calls++; return Response.json({ audios: [btoa("audio")] }); });

    await expect(t.withIdentity({ subject: "outsider" }).action(app.api.assistant.speakAnswer, {
      patientId, question: "What about the garden?", languageCode: "en-IN",
    })).rejects.toThrow("permission");
    expect(calls).toBe(0);
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(0);
  });

  test("rechecks access after synthesis and does not create a URL after access is revoked", async () => {
    const { t, owner, patientId } = await setup();
    mockFetch(async () => {
      await t.run(async (ctx) => {
        const membership = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", "speech-owner")).unique();
        if (membership) await ctx.db.patch(membership._id, { active: false });
      });
      return Response.json({ audios: [btoa("audio")] });
    });

    await expect(owner.action(app.api.assistant.speakAnswer, { patientId, question: "What about the garden?", languageCode: "en-IN" })).rejects.toThrow("permission");
    expect(await t.run((ctx) => ctx.db.system.query("_storage").collect())).toHaveLength(0);
  });
});
