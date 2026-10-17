import { makeFunctionReference } from "convex/server";
import { ConvexError, v, type GenericId } from "convex/values";
import {
  SARVAM_BATCH_STT_MAX_SECONDS,
  SARVAM_REALTIME_STT_MAX_SECONDS,
  pollBatchTranscription,
  startBatchTranscription,
  transcribeAudio,
  SarvamApiError,
} from "./lib/sarvam";
import { requireMember } from "./authz";
import { internalAction, internalMutation, internalQuery, mutation, type MutationCtx } from "./lib/functions";
import { conversationForChunk, refreshLiveConversation, settleLiveChunk } from "./lib/liveConversations";

const transcribeRef = makeFunctionReference<"action">("transcriptions:transcribe");
const claimRef = makeFunctionReference<"mutation">("transcriptions:claim");
const completeRef = makeFunctionReference<"mutation">("transcriptions:complete");
const failRef = makeFunctionReference<"mutation">("transcriptions:fail");
const setBatchJobRef = makeFunctionReference<"mutation">("transcriptions:setBatchJob");
const scheduleBatchPollRef = makeFunctionReference<"mutation">("transcriptions:scheduleBatchPoll");
const readBatchJobRef = makeFunctionReference<"query">("transcriptions:readBatchJob");
const pollBatchRef = makeFunctionReference<"action">("transcriptions:pollBatch");
const speakerMatchingRef = makeFunctionReference<"action">("speakerMatching:process");

const MAX_PROVIDER_SEGMENTS = 5_000;
const MAX_TURNS = 500;
const MAX_TRANSCRIPT_CHARACTERS = 100_000;
const MAX_ATTEMPTS = 3;
const MAX_BATCH_POLLS = 1_440;

type TranscriptTurnInput = { start: number; end: number; text: string };

/** Keep transcript text anonymous until separate speaker matching succeeds. */
export function makeUnknownTurns(
  transcript: string,
  timestamps: { segments: string[]; startTimeSeconds: number[]; endTimeSeconds: number[] } | undefined,
  durationSeconds: number,
): TranscriptTurnInput[] {
  const wholeText = transcript.trim();
  if (wholeText.length > MAX_TRANSCRIPT_CHARACTERS) throw new Error("Sarvam transcript exceeded the supported size.");
  if (!wholeText) return [];

  const validTimestamps = timestamps
    && timestamps.segments.length === timestamps.startTimeSeconds.length
    && timestamps.segments.length === timestamps.endTimeSeconds.length
    && timestamps.segments.length <= MAX_PROVIDER_SEGMENTS;
  if (!validTimestamps) return [{ start: 0, end: durationSeconds, text: wholeText }];
  const hasInvalidTimestamp = timestamps.segments.some((word, index) =>
    !word.trim() || !Number.isFinite(timestamps.startTimeSeconds[index]) || !Number.isFinite(timestamps.endTimeSeconds[index]) ||
    timestamps.endTimeSeconds[index] <= timestamps.startTimeSeconds[index] || timestamps.startTimeSeconds[index] < 0 ||
    timestamps.endTimeSeconds[index] > durationSeconds,
  );
  if (hasInvalidTimestamp) return [{ start: 0, end: durationSeconds, text: wholeText }];

  const turns: TranscriptTurnInput[] = [];
  let current: TranscriptTurnInput | undefined;
  for (let index = 0; index < timestamps.segments.length; index++) {
    const word = timestamps.segments[index]?.trim();
    const rawStart = timestamps.startTimeSeconds[index];
    const rawEnd = timestamps.endTimeSeconds[index];
    if (!word || !Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart) continue;
    const start = Math.max(0, Math.min(durationSeconds, rawStart));
    const end = Math.max(start, Math.min(durationSeconds, rawEnd));
    if (end <= start) continue;

    const gap = current ? start - current.end : 0;
    const sentenceEnded = current && /[.!?।॥]$/.test(current.text);
    if (current && (gap > 1.25 || sentenceEnded)) {
      turns.push(current);
      current = undefined;
    }

    if (!current) current = { start, end, text: word };
    else {
      const punctuation = /^[,.;:!?।॥…%)\]}]/u.test(word);
      current.text = `${current.text}${punctuation ? "" : " "}${word}`.slice(0, MAX_TRANSCRIPT_CHARACTERS);
      current.end = end;
    }
  }
  if (current) turns.push(current);

  // Timestamp payloads are optional and occasionally incomplete. Preserve the complete text rather than dropping it.
  if (!turns.length) return [{ start: 0, end: durationSeconds, text: wholeText }];
  if (turns.length > MAX_TURNS || turns.reduce((total, turn) => total + turn.text.length, 0) > MAX_TRANSCRIPT_CHARACTERS) {
    return [{ start: 0, end: durationSeconds, text: wholeText }];
  }
  return turns;
}

export const claim = internalMutation({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "queued") return null;
    const chunk = await ctx.db.get(job.chunkId);
    const conversation = chunk ? await conversationForChunk(ctx, chunk) : null;
    if (!chunk || chunk.patientId !== job.patientId || chunk.deletedAt || !conversation || conversation.patientId !== job.patientId || conversation.deletedAt) {
      const now = Date.now();
      if (chunk) {
        await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
        await ctx.db.patch(chunk._id, { state: "failed" });
      }
      await ctx.db.patch(jobId, { state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1, error: "Source deleted or unavailable.", updatedAt: now });
      const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", job.chunkId)).unique();
      if (speakerJob && !["ready", "failed", "skipped"].includes(speakerJob.state)) {
        await ctx.db.patch(speakerJob._id, { state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1, error: "Source deleted or unavailable.", updatedAt: now });
      }
      return null;
    }
    if (!chunk.storageId || chunk.expiresAt <= Date.now()) {
      const now = Date.now();
      await ctx.db.patch(jobId, { state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1, error: "Audio is no longer available.", updatedAt: now });
      await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
      await ctx.db.patch(chunk._id, { state: "failed" });
      const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
      if (speakerJob && !["ready", "failed", "skipped"].includes(speakerJob.state)) {
        await ctx.db.patch(speakerJob._id, { state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1, error: "Transcription could not start before temporary audio expired.", updatedAt: now });
      }
      if (conversation.sessionId) await settleLiveChunk(ctx, conversation, "failed");
      else await ctx.db.patch(conversation._id, { state: "failed", summary: "Transcription could not start before temporary audio expired. The temporary audio was deleted; record again to retry." });
      return null;
    }

    const now = Date.now();
    const generation = (job.generation ?? 0) + 1;
    await ctx.db.patch(jobId, { state: "processing", attempts: (job.attempts ?? 0) + 1, generation, updatedAt: now, error: undefined });
    await ctx.db.patch(chunk._id, { state: "processing" });
    if (!conversation.sessionId) await ctx.db.patch(conversation._id, { state: "processing", summary: "Sarvam AI is preparing a timestamped transcript. Speakers remain unnamed." });
    return {
      storageId: chunk.storageId,
      durationSeconds: (chunk.endedAt - chunk.capturedAt) / 1000,
      mimeType: chunk.mimeType,
      generation,
      continuous: Boolean(conversation.sessionId),
    };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("processingJobs"),
    generation: v.number(),
    turns: v.array(v.object({ start: v.number(), end: v.number(), text: v.string() })),
    languageCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.state !== "processing" || job.generation !== args.generation) return false;
    const chunk = await ctx.db.get(job.chunkId);
    const conversation = chunk ? await conversationForChunk(ctx, chunk) : null;
    if (!chunk || chunk.patientId !== job.patientId || chunk.deletedAt || !conversation || conversation.patientId !== job.patientId || conversation.deletedAt) return false;
    const chunkDuration = (chunk.endedAt - chunk.capturedAt) / 1000;
    if ((!args.turns.length && !conversation.sessionId) || args.turns.length > MAX_TURNS || args.turns.some((turn) =>
      !Number.isFinite(turn.start) || !Number.isFinite(turn.end) || turn.start < 0 || turn.end <= turn.start || turn.end > chunkDuration + 1 ||
      !turn.text.trim() || turn.text.length > MAX_TRANSCRIPT_CHARACTERS,
    )) throw new ConvexError("The transcription result was invalid.");

    const now = Date.now();
    const offset = conversation.sessionId ? (chunk.capturedAt - conversation.startedAt) / 1000 : 0;
    for (const turn of args.turns) {
      await ctx.db.insert("transcriptTurns", {
        patientId: job.patientId,
        conversationId: conversation._id,
        chunkId: chunk._id,
        speaker: "Unknown speaker",
        start: offset + turn.start,
        end: offset + turn.end,
        text: turn.text,
        uncertain: true,
      });
    }
    await ctx.db.patch(job._id, { state: "ready", error: undefined, providerJobId: undefined, updatedAt: now });
    await ctx.db.patch(chunk._id, { state: "ready" });
    if (conversation.sessionId) {
      await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
      await settleLiveChunk(ctx, conversation, "ready");
      return true;
    }
    const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunk._id)).unique();
    await ctx.db.patch(conversation._id, {
      state: speakerJob ? "processing" : "ready",
      title: "Recorded conversation",
      summary: speakerJob
        ? "Transcript prepared. Checking only the people selected for this conversation; other voices remain unknown. Temporary audio will be deleted when matching finishes."
        : `Transcript prepared with Sarvam AI${args.languageCode ? ` (${args.languageCode})` : ""}. Only transcript text is kept; the temporary source audio was deleted.`,
    });
    if (speakerJob) await ctx.scheduler.runAfter(0, speakerMatchingRef, { jobId: speakerJob._id });
    else await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
    return true;
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("processingJobs"), generation: v.number(), retryable: v.boolean(), unsupportedDuration: v.optional(v.boolean()) },
  handler: async (ctx, { jobId, generation, retryable, unsupportedDuration }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation) return null;
    const chunk = await ctx.db.get(job.chunkId);
    const conversation = chunk ? await conversationForChunk(ctx, chunk) : null;
    if (!chunk || chunk.deletedAt || !conversation || conversation.deletedAt) {
      const now = Date.now();
      if (chunk) {
        await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
        await ctx.db.patch(chunk._id, { state: "failed" });
      }
      await ctx.db.patch(jobId, { state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1, error: "Source deleted or unavailable.", updatedAt: now });
      await failSpeakerJob(ctx, job.chunkId, now, "Source deleted or unavailable.");
      return null;
    }

    const now = Date.now();
    const willRetry = retryable && (job.attempts ?? 1) < MAX_ATTEMPTS && chunk.storageId && chunk.expiresAt > now;
    if (willRetry) {
      await ctx.db.patch(jobId, { state: "queued", error: "Temporary Sarvam transcription error; retry scheduled.", updatedAt: now });
      await ctx.db.patch(chunk._id, { state: "queued" });
      if (!conversation.sessionId) await ctx.db.patch(conversation._id, { state: "queued", summary: "A temporary transcription problem occurred. Hale will retry automatically." });
      const delayMs = Math.min(2_000 * 2 ** Math.max(0, (job.attempts ?? 1) - 1), 15_000);
      await ctx.scheduler.runAfter(delayMs, transcribeRef, { jobId });
      return null;
    }

    const error = unsupportedDuration ? "Clip exceeds Saaras batch duration limit." : "Sarvam transcription could not be completed.";
    await ctx.db.patch(jobId, { state: "failed", error, providerJobId: undefined, updatedAt: now });
    await ctx.db.patch(chunk._id, { state: "failed" });
    await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
    await failSpeakerJob(ctx, chunk._id, now, "Transcription failed; temporary audio was deleted.");
    if (conversation.sessionId) {
      await settleLiveChunk(ctx, conversation, "failed");
      return null;
    }
    await ctx.db.patch(conversation._id, {
      state: "failed",
      summary: unsupportedDuration
        ? `Sarvam batch transcription accepts clips up to ${SARVAM_BATCH_STT_MAX_SECONDS / 3600} hours. This clip is longer, so no transcript was prepared. The temporary audio was deleted.`
        : "A transcript could not be prepared. The temporary audio was deleted; record again to retry.",
    });
    return null;
  },
});

export const transcribe = internalAction({
  args: { jobId: v.id("processingJobs") },
  handler: async (ctx, { jobId }) => {
    const claimed: {
      storageId: GenericId<"_storage">;
      durationSeconds: number;
      mimeType: string;
      generation: number;
      continuous: boolean;
    } | null = await ctx.runMutation(claimRef, { jobId });
    if (!claimed) return null;

    try {
      const audio = await ctx.storage.get(claimed.storageId);
      if (!audio) throw new Error("The source audio is unavailable.");
      if (claimed.durationSeconds > SARVAM_BATCH_STT_MAX_SECONDS) throw new Error(`Sarvam batch transcription accepts clips up to ${SARVAM_BATCH_STT_MAX_SECONDS} seconds.`);
      if (claimed.durationSeconds > SARVAM_REALTIME_STT_MAX_SECONDS) {
        const providerJobId = await startBatchTranscription(audio);
        await ctx.runMutation(setBatchJobRef, { jobId, generation: claimed.generation, providerJobId });
        return null;
      }
      const result = await transcribeAudio(audio, {
        durationSeconds: claimed.durationSeconds,
        filename: recordingFilename(claimed.mimeType),
        withTimestamps: true,
      });
      const turns = makeUnknownTurns(result.transcript, result.timestamps, claimed.durationSeconds);
      if (!turns.length && !claimed.continuous) throw new Error("Sarvam returned no transcript.");
      await ctx.runMutation(completeRef, { jobId, generation: claimed.generation, turns, languageCode: result.languageCode ?? undefined });
    } catch (error) {
      const retryable = isRetryableSarvamError(error);
      const unsupportedDuration = error instanceof Error && error.message.includes(`accepts clips up to ${SARVAM_BATCH_STT_MAX_SECONDS} seconds`);
      await ctx.runMutation(failRef, { jobId, generation: claimed.generation, retryable, unsupportedDuration });
    }
    return null;
  },
});

export const retry = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const conversation = await ctx.db.get(conversationId);
    if (!conversation || conversation.deletedAt) throw new ConvexError("Conversation unavailable.");
    await requireMember(ctx, conversation.patientId, "recordings:create");
    const chunk = await ctx.db.get(conversation.chunkId);
    const job = await ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", conversation.chunkId)).unique();
    if (!chunk || chunk.patientId !== conversation.patientId || chunk.deletedAt || !chunk.storageId || chunk.expiresAt <= Date.now() || !job || job.patientId !== conversation.patientId) {
      throw new ConvexError("The original audio is no longer available to retry.");
    }
    if ((chunk.endedAt - chunk.capturedAt) / 1000 > SARVAM_BATCH_STT_MAX_SECONDS) {
      throw new ConvexError(`Sarvam batch transcription accepts clips up to ${SARVAM_BATCH_STT_MAX_SECONDS / 3600} hours.`);
    }
    if (job.state === "queued" || job.state === "processing") return null;
    if (job.state === "ready") throw new ConvexError("This conversation already has a transcript.");
    const now = Date.now();
    await ctx.db.patch(job._id, { state: "queued", attempts: 0, providerJobId: undefined, error: undefined, updatedAt: now });
    await ctx.db.patch(chunk._id, { state: "queued" });
    await ctx.db.patch(conversationId, { state: "queued", summary: "Transcription retry queued with Sarvam AI. Speakers remain unnamed." });
    await ctx.scheduler.runAfter(0, transcribeRef, { jobId: job._id });
    return null;
  },
});

export const recoverStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db.query("processingJobs")
      .withIndex("by_state_updated", (q) => q.eq("state", "processing").lt("updatedAt", Date.now() - 10 * 60_000))
      .take(50);
    for (const job of stale) {
      const chunk = await ctx.db.get(job.chunkId);
      const conversation = chunk ? await conversationForChunk(ctx, chunk) : null;
      if (!chunk || chunk.deletedAt || !conversation || conversation.deletedAt) {
        const now = Date.now();
        if (chunk) {
          await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
          await ctx.db.patch(chunk._id, { state: "failed" });
        }
        await ctx.db.patch(job._id, { state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1, error: "Source deleted or unavailable.", updatedAt: now });
        await failSpeakerJob(ctx, job.chunkId, now, "Source deleted or unavailable.");
      } else if (!chunk.storageId || chunk.expiresAt <= Date.now()) {
        const now = Date.now();
        await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
        await ctx.db.patch(chunk._id, { state: "failed" });
        await ctx.db.patch(job._id, { state: "failed", providerJobId: undefined, generation: (job.generation ?? 0) + 1, error: "Temporary audio expired before transcription completed.", updatedAt: now });
        await failSpeakerJob(ctx, job.chunkId, now, "Transcription could not complete before temporary audio expired.");
        if (conversation.sessionId) await settleLiveChunk(ctx, conversation, "failed");
        else await ctx.db.patch(conversation._id, { state: "failed", summary: "A transcript could not be prepared before temporary audio expired. The audio was deleted; record again to retry." });
      } else if (job.providerJobId) {
        await ctx.db.patch(job._id, { updatedAt: Date.now() });
        await ctx.scheduler.runAfter(0, pollBatchRef, { jobId: job._id, generation: job.generation ?? 0, attempt: 0 });
      } else if ((job.attempts ?? 0) < MAX_ATTEMPTS && chunk.storageId && chunk.expiresAt > Date.now()) {
        await ctx.db.patch(job._id, { state: "queued", error: "A stalled transcription will be retried.", updatedAt: Date.now() });
        await ctx.db.patch(chunk._id, { state: "queued" });
        if (!conversation.sessionId) await ctx.db.patch(conversation._id, { state: "queued", summary: "Transcription stalled and has been queued for another attempt. Speakers remain unnamed." });
        await ctx.scheduler.runAfter(0, transcribeRef, { jobId: job._id });
      } else {
        const now = Date.now();
        await ctx.db.patch(job._id, { state: "failed", providerJobId: undefined, error: "Sarvam transcription could not be completed.", updatedAt: now });
        await ctx.db.patch(chunk._id, { state: "failed" });
        await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
        await failSpeakerJob(ctx, job.chunkId, now, "Transcription failed; temporary audio was deleted.");
        if (conversation.sessionId) await settleLiveChunk(ctx, conversation, "failed");
        else await ctx.db.patch(conversation._id, { state: "failed", summary: "A transcript could not be prepared. The temporary audio was deleted; record again to retry." });
      }
    }
    const abandoned = await ctx.db.query("recordingSessions")
      .withIndex("by_continuous_state_lastChunkAt", (q) => q.eq("continuous", true).eq("state", "recording").lt("lastChunkAt", Date.now() - 10 * 60_000)).take(25);
    for (const session of abandoned) {
      await ctx.db.patch(session._id, { state: "stopped", endedAt: Date.now() });
      if (session.conversationId) await refreshLiveConversation(ctx, session.conversationId);
    }
    return stale.length;
  },
});

export const setBatchJob = internalMutation({
  args: { jobId: v.id("processingJobs"), generation: v.number(), providerJobId: v.string() },
  handler: async (ctx, { jobId, generation, providerJobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation) return null;
    await ctx.db.patch(jobId, { providerJobId, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(5_000, pollBatchRef, { jobId, generation, attempt: 0 });
    return null;
  },
});

export const scheduleBatchPoll = internalMutation({
  args: { jobId: v.id("processingJobs"), generation: v.number(), attempt: v.number() },
  handler: async (ctx, { jobId, generation, attempt }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation || !job.providerJobId) return null;
    await ctx.db.patch(jobId, { updatedAt: Date.now() });
    await ctx.scheduler.runAfter(batchPollDelayMs(attempt), pollBatchRef, { jobId, generation, attempt });
    return null;
  },
});

export const readBatchJob = internalQuery({
  args: { jobId: v.id("processingJobs"), generation: v.number() },
  handler: async (ctx, { jobId, generation }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation || !job.providerJobId) return null;
    const chunk = await ctx.db.get(job.chunkId);
    if (!chunk || chunk.deletedAt || chunk.patientId !== job.patientId) return null;
    return { providerJobId: job.providerJobId, durationSeconds: (chunk.endedAt - chunk.capturedAt) / 1000 };
  },
});

export const pollBatch = internalAction({
  args: { jobId: v.id("processingJobs"), generation: v.number(), attempt: v.number() },
  handler: async (ctx, { jobId, generation, attempt }) => {
    const current: { providerJobId: string; durationSeconds: number } | null = await ctx.runQuery(readBatchJobRef, { jobId, generation });
    if (!current) return null;
    if (attempt >= MAX_BATCH_POLLS) {
      await ctx.runMutation(failRef, { jobId, generation, retryable: false });
      return null;
    }
    try {
      const result = await pollBatchTranscription(current.providerJobId);
      if (result.state === "failed") {
        await ctx.runMutation(failRef, { jobId, generation, retryable: false });
        return null;
      }
      if (result.state === "completed") {
        const turns = makeUnknownTurns(result.transcript.transcript, result.transcript.timestamps, current.durationSeconds);
        if (!turns.length) throw new Error("Sarvam returned no transcript.");
        await ctx.runMutation(completeRef, { jobId, generation, turns, languageCode: result.transcript.languageCode ?? undefined });
        return null;
      }
    } catch (error) {
      if (!isRetryableSarvamError(error)) {
        await ctx.runMutation(failRef, { jobId, generation, retryable: false });
        return null;
      }
    }
    await ctx.runMutation(scheduleBatchPollRef, { jobId, generation, attempt: attempt + 1 });
    return null;
  },
});

async function deleteTemporaryAudio(ctx: MutationCtx, chunkId: GenericId<"audioChunks">, storageId?: GenericId<"_storage">) {
  if (storageId) await ctx.storage.delete(storageId);
  await ctx.db.patch(chunkId, { storageId: undefined, expiresAt: Date.now() });
}

async function failSpeakerJob(ctx: MutationCtx, chunkId: GenericId<"audioChunks">, now: number, message: string) {
  const speakerJob = await ctx.db.query("speakerMatchingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", chunkId)).unique();
  if (speakerJob && !["ready", "failed", "skipped"].includes(speakerJob.state)) {
    await ctx.db.patch(speakerJob._id, {
      state: "failed", providerJobId: undefined, generation: speakerJob.generation + 1,
      error: message, updatedAt: now,
    });
  }
}

function recordingFilename(mimeType: string): string {
  const mime = mimeType.split(";")[0]?.trim().toLowerCase();
  if (mime === "audio/mp4" || mime === "video/mp4" || mime === "audio/aac") return "recording.m4a";
  if (mime === "audio/ogg") return "recording.ogg";
  if (mime === "audio/wav" || mime === "audio/x-wav") return "recording.wav";
  if (mime === "audio/mpeg") return "recording.mp3";
  return "recording.webm";
}

function batchPollDelayMs(attempt: number): number {
  if (attempt < 12) return 5_000;
  if (attempt < 24) return 15_000;
  if (attempt < 48) return 30_000;
  return 60_000;
}

function isRetryableSarvamError(error: unknown): boolean {
  if (error instanceof SarvamApiError) return error.status === 429 || (error.status !== undefined && error.status >= 500);
  if (error instanceof Error && /not configured|accepts clips up to|unsupported Sarvam|audio is required|returned no transcript|source audio is unavailable|transcript exceeded|transcription result was invalid/i.test(error.message)) return false;
  return true;
}
