import { makeFunctionReference } from "convex/server";
import { v, type GenericId } from "convex/values";
import { VOICE_MATCHING_POLICY } from "@hale/contracts/voice";
import { PyannoteApiError, pyannoteRequest } from "./lib/pyannote";
import { matchTranscriptTurns, type MatchCandidate } from "./lib/speakerMatching";
import { internalAction, internalMutation, internalQuery, type DataModel, type MutationCtx } from "./lib/functions";
import { hasExternalAIConsent } from "./authz";

const processRef = makeFunctionReference<"action">("speakerMatching:process");
const pollRef = makeFunctionReference<"action">("speakerMatching:poll");
const claimRef = makeFunctionReference<"mutation">("speakerMatching:claim");
const setProviderJobRef = makeFunctionReference<"mutation">("speakerMatching:setProviderJob");
const readRef = makeFunctionReference<"query">("speakerMatching:read");
const completeRef = makeFunctionReference<"mutation">("speakerMatching:complete");
const failRef = makeFunctionReference<"mutation">("speakerMatching:fail");
const schedulePollRef = makeFunctionReference<"mutation">("speakerMatching:schedulePoll");
const CONFIDENCE_THRESHOLD = 70;
const MAX_ATTEMPTS = 3;
const MAX_POLLS = 1_440;

type Candidate = Omit<MatchCandidate, "personId"> & {
  personId: GenericId<"people">;
  profileId: GenericId<"familyProfiles">;
  enrollmentVersion: number;
  voiceprint: string;
};

export const claim = internalMutation({
  args: { jobId: v.id("speakerMatchingJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "queued") return null;
    const [chunk, conversation, transcription] = await Promise.all([
      ctx.db.get(job.chunkId),
      ctx.db.get(job.conversationId),
      ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", job.chunkId)).unique(),
    ]);
    if (!chunk || chunk.patientId !== job.patientId || chunk.deletedAt || !conversation || conversation.patientId !== job.patientId || conversation.deletedAt || transcription?.state !== "ready") {
      await finishWithoutMatches(ctx, job, "failed", "Speaker identification could not use this source.");
      return null;
    }
    if (!await hasExternalAIConsent(ctx, job.patientId)) {
      await finishWithoutMatches(ctx, job, "skipped", "Speaker matching stopped because external AI consent is disabled.");
      return null;
    }
    if (!chunk.storageId || chunk.expiresAt <= Date.now()) {
      await finishWithoutMatches(ctx, job, "failed", "The temporary audio expired before speaker identification completed.");
      return null;
    }

    const candidates: Candidate[] = [];
    for (const personId of job.expectedPeople) {
      const eligible = await eligibleProfile(ctx, job.patientId, personId);
      if (!eligible || eligible.profile.voiceprint!.length > 20_000) continue;
      candidates.push({
        label: `p_${crypto.randomUUID().replaceAll("-", "")}`,
        personId,
        profileId: eligible.profile._id,
        enrollmentVersion: eligible.profile.enrollmentVersion ?? 0,
        voiceprint: eligible.profile.voiceprint!,
      });
    }
    if (!candidates.length) {
      await finishWithoutMatches(ctx, job, "skipped", "No selected person has an active, eligible voice profile. Speakers remain unknown.");
      return null;
    }

    const generation = job.generation + 1;
    const now = Date.now();
    await ctx.db.patch(job._id, {
      state: "processing",
      attempts: job.attempts + 1,
      generation,
      candidates: candidates.map(({ label, personId, profileId, enrollmentVersion }) => ({ label, personId, profileId, enrollmentVersion })),
      error: undefined,
      updatedAt: now,
    });
    return {
      storageId: chunk.storageId,
      generation,
      candidates,
    };
  },
});

export const setProviderJob = internalMutation({
  args: { jobId: v.id("speakerMatchingJobs"), generation: v.number(), providerJobId: v.string() },
  handler: async (ctx, { jobId, generation, providerJobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation) return null;
    if (!await hasExternalAIConsent(ctx, job.patientId)) {
      await finishWithoutMatches(ctx, job, "skipped", "Speaker matching stopped because external AI consent was withdrawn.");
      return null;
    }
    await ctx.db.patch(jobId, { providerJobId, updatedAt: Date.now() });
    await ctx.scheduler.runAfter(5_000, pollRef, { jobId, generation, attempt: 0 });
    return null;
  },
});

export const schedulePoll = internalMutation({
  args: { jobId: v.id("speakerMatchingJobs"), generation: v.number(), attempt: v.number() },
  handler: async (ctx, { jobId, generation, attempt }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation || !job.providerJobId) return null;
    if (!await hasExternalAIConsent(ctx, job.patientId)) return null;
    await ctx.db.patch(jobId, { updatedAt: Date.now() });
    await ctx.scheduler.runAfter(pollDelayMs(attempt), pollRef, { jobId, generation, attempt });
    return null;
  },
});

export const read = internalQuery({
  args: { jobId: v.id("speakerMatchingJobs"), generation: v.number() },
  handler: async (ctx, { jobId, generation }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation || !job.providerJobId) return null;
    if (!await hasExternalAIConsent(ctx, job.patientId)) return null;
    const [turns, chunk] = await Promise.all([
      ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) => q.eq("conversationId", job.conversationId)).take(500),
      ctx.db.get(job.chunkId),
    ]);
    if (!chunk || chunk.deletedAt || chunk.patientId !== job.patientId) return null;
    return {
      providerJobId: job.providerJobId,
      candidates: (job.candidates ?? []).map(({ label, personId }) => ({ label, personId })),
      turns: turns.filter((turn) => turn.patientId === job.patientId).map(({ _id, start, end }) => ({ id: _id, start, end })),
      durationSeconds: (chunk.endedAt - chunk.capturedAt) / 1000,
    };
  },
});

export const complete = internalMutation({
  args: {
    jobId: v.id("speakerMatchingJobs"),
    generation: v.number(),
    assignments: v.array(v.object({ turnId: v.id("transcriptTurns"), label: v.optional(v.string()) })),
  },
  handler: async (ctx, { jobId, generation, assignments }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation) return false;
    const [chunk, conversation, transcription] = await Promise.all([
      ctx.db.get(job.chunkId),
      ctx.db.get(job.conversationId),
      ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", job.chunkId)).unique(),
    ]);
    if (!chunk || chunk.deletedAt || !conversation || conversation.deletedAt || conversation.patientId !== job.patientId || transcription?.state !== "ready") return false;
    if (!await hasExternalAIConsent(ctx, job.patientId)) {
      await finishWithoutMatches(ctx, job, "skipped", "Speaker matching stopped because external AI consent was withdrawn.");
      return false;
    }

    const byLabel = new Map((job.candidates ?? []).map((candidate) => [candidate.label, candidate]));
    const matchedPeople = new Set<GenericId<"people">>();
    const seenTurns = new Set<GenericId<"transcriptTurns">>();
    for (const assignment of assignments) {
      if (seenTurns.has(assignment.turnId)) continue;
      seenTurns.add(assignment.turnId);
      if (!assignment.label) continue;
      const candidate = byLabel.get(assignment.label);
      if (!candidate || !job.expectedPeople.includes(candidate.personId)) continue;
      const turn = await ctx.db.get(assignment.turnId);
      if (!turn || turn.patientId !== job.patientId || turn.conversationId !== job.conversationId) continue;
      const eligible = await eligibleProfile(ctx, job.patientId, candidate.personId);
      if (!eligible || eligible.profile._id !== candidate.profileId || (eligible.profile.enrollmentVersion ?? 0) !== candidate.enrollmentVersion) continue;
      await ctx.db.patch(turn._id, { speaker: eligible.person.name, personId: eligible.person._id, uncertain: false });
      matchedPeople.add(eligible.person._id);
    }

    await ctx.db.patch(job._id, { state: "ready", providerJobId: undefined, updatedAt: Date.now(), error: undefined });
    await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
    await ctx.db.patch(conversation._id, {
      state: "ready",
      people: [...matchedPeople],
      summary: matchedPeople.size
        ? "Transcript prepared. Speaker labels are automated and may be wrong; unrecognized or uncertain speech remains unknown. The source recording was deleted after processing."
        : "Transcript prepared. No speaker met the matching safeguards, so every voice remains unknown. The source recording was deleted after processing.",
    });
    return true;
  },
});

export const fail = internalMutation({
  args: { jobId: v.id("speakerMatchingJobs"), generation: v.number(), retryable: v.boolean(), message: v.optional(v.string()) },
  handler: async (ctx, { jobId, generation, retryable, message }) => {
    const job = await ctx.db.get(jobId);
    if (!job || job.state !== "processing" || job.generation !== generation) return null;
    const chunk = await ctx.db.get(job.chunkId);
    if (retryable && job.attempts < MAX_ATTEMPTS && chunk?.storageId && chunk.expiresAt > Date.now() && !chunk.deletedAt) {
      const delayMs = Math.min(2_000 * 2 ** Math.max(0, job.attempts - 1), 15_000);
      await ctx.db.patch(job._id, { state: "queued", providerJobId: undefined, error: "Temporary speaker-identification error; retry scheduled.", updatedAt: Date.now() });
      await ctx.scheduler.runAfter(delayMs, processRef, { jobId });
      return null;
    }
    await finishWithoutMatches(ctx, job, "failed", message ?? "Speaker identification could not be completed. Transcript text is still available; speakers remain unknown.");
    return null;
  },
});

export const process = internalAction({
  args: { jobId: v.id("speakerMatchingJobs") },
  handler: async (ctx, { jobId }) => {
    const claimed = await ctx.runMutation(claimRef, { jobId }) as { storageId: GenericId<"_storage">; generation: number; candidates: Candidate[] } | null;
    if (!claimed) return null;
    try {
      const url = await ctx.storage.getUrl(claimed.storageId);
      if (!url) throw new Error("Temporary audio is unavailable.");
      const result = await pyannoteRequest("identify", {
        url,
        model: "precision-2",
        voiceprints: claimed.candidates.map(({ label, voiceprint }) => ({ label, voiceprint })),
        matching: { threshold: CONFIDENCE_THRESHOLD, exclusive: true },
      });
      if (typeof result.jobId !== "string" || !result.jobId) throw new Error("pyannote returned an invalid job response.");
      await ctx.runMutation(setProviderJobRef, { jobId, generation: claimed.generation, providerJobId: result.jobId });
    } catch (error) {
      await ctx.runMutation(failRef, {
        jobId,
        generation: claimed.generation,
        retryable: isRetryable(error),
        message: error instanceof Error && error.message.includes("not configured") ? "Speaker identification is not configured. Transcript text is still available; speakers remain unknown." : undefined,
      });
    }
    return null;
  },
});

export const poll = internalAction({
  args: { jobId: v.id("speakerMatchingJobs"), generation: v.number(), attempt: v.number() },
  handler: async (ctx, { jobId, generation, attempt }) => {
    const current = await ctx.runQuery(readRef, { jobId, generation }) as {
      providerJobId: string;
      candidates: MatchCandidate[];
      turns: { id: GenericId<"transcriptTurns">; start: number; end: number }[];
      durationSeconds: number;
    } | null;
    if (!current) return null;
    if (attempt >= MAX_POLLS) {
      await ctx.runMutation(failRef, { jobId, generation, retryable: false, message: "Speaker identification timed out. Transcript text is still available; speakers remain unknown." });
      return null;
    }
    try {
      const result = await pyannoteRequest(`jobs/${encodeURIComponent(current.providerJobId)}`);
      if (result.jobId !== current.providerJobId) throw new Error("pyannote returned a mismatched job.");
      if (result.status === "succeeded") {
        const assignments = matchTranscriptTurns(current.turns, result.output, current.candidates, current.durationSeconds);
        await ctx.runMutation(completeRef, { jobId, generation, assignments });
        return null;
      }
      if (result.status === "failed" || result.status === "canceled") {
        await ctx.runMutation(failRef, { jobId, generation, retryable: false, message: "Speaker identification did not complete. Transcript text is still available; speakers remain unknown." });
        return null;
      }
    } catch (error) {
      if (error instanceof Error && /mismatched job|invalid (?:identification|diarization|confidence|result)|identification returned an invalid/i.test(error.message)) {
        await ctx.runMutation(failRef, { jobId, generation, retryable: false });
        return null;
      }
      // Provider/network errors are retried by the bounded poll loop.
    }
    await ctx.runMutation(schedulePollRef, { jobId, generation, attempt: attempt + 1 });
    return null;
  },
});

export const recoverStale = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db.query("speakerMatchingJobs")
      .withIndex("by_state_updated", (q) => q.eq("state", "processing").lt("updatedAt", Date.now() - 10 * 60_000))
      .take(50);
    for (const job of stale) {
      if (job.providerJobId) {
        await ctx.db.patch(job._id, { updatedAt: Date.now() });
        await ctx.scheduler.runAfter(0, pollRef, { jobId: job._id, generation: job.generation, attempt: 0 });
      } else {
        await finishWithoutMatches(ctx, job, "failed", "Speaker identification stopped before the provider job could be confirmed. Transcript text is still available; speakers remain unknown.");
      }
    }
    return stale.length;
  },
});

async function eligibleProfile(ctx: MutationCtx, patientId: GenericId<"patients">, personId: GenericId<"people">) {
  const [patient, person] = await Promise.all([ctx.db.get(patientId), ctx.db.get(personId)]);
  if (!patient || !person || person.patientId !== patientId || !person.voiceConsentAt || person.voiceConsentPolicy !== VOICE_MATCHING_POLICY) return null;
  const isPatient = person.isPatient ?? (person.relationship === "You · patient" && !person.linkedSubject);
  const subject = isPatient ? patient.createdBy : person.linkedSubject;
  if (!subject) return null;
  const [membership, profile, consents] = await Promise.all([
    ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", subject)).unique(),
    person.familyProfileId
      ? ctx.db.get(person.familyProfileId)
      : ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", subject)).unique(),
    ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) => q.eq("patientId", patientId).eq("subject", subject).eq("purpose", "voice_matching")).order("desc").take(100),
  ]);
  const correctRole = isPatient ? membership?.role === "patient" : membership?.role === "family" && person.linkedSubject === subject;
  if (!membership?.active || !correctRole || !profile || profile.subject !== subject || profile.voiceState !== "enrolled" || !profile.voiceprint || !consents.some((consent) => !consent.revokedAt && consent.policyVersion === VOICE_MATCHING_POLICY)) return null;
  if (person.familyProfileId && person.familyProfileId !== profile._id) return null;
  return { person, profile };
}

async function finishWithoutMatches(ctx: MutationCtx, job: DataModel["speakerMatchingJobs"]["document"], state: "failed" | "skipped", summary: string) {
  const now = Date.now();
  await ctx.db.patch(job._id, { state, providerJobId: undefined, error: state === "failed" ? summary : undefined, updatedAt: now, generation: job.generation + 1 });
  const chunk = await ctx.db.get(job.chunkId);
  if (chunk) await deleteTemporaryAudio(ctx, chunk._id, chunk.storageId);
  const [conversation, transcription] = await Promise.all([
    ctx.db.get(job.conversationId),
    ctx.db.query("processingJobs").withIndex("by_chunk", (q) => q.eq("chunkId", job.chunkId)).unique(),
  ]);
  if (conversation && !conversation.deletedAt && transcription?.state === "ready") {
    await ctx.db.patch(conversation._id, { state: "ready", summary });
  }
}

async function deleteTemporaryAudio(ctx: MutationCtx, chunkId: GenericId<"audioChunks">, storageId?: GenericId<"_storage">) {
  if (storageId) await ctx.storage.delete(storageId);
  await ctx.db.patch(chunkId, { storageId: undefined, expiresAt: Date.now() });
}

function pollDelayMs(attempt: number): number {
  if (attempt < 12) return 5_000;
  if (attempt < 24) return 15_000;
  if (attempt < 48) return 30_000;
  return 60_000;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof PyannoteApiError) return error.status === 429 || (error.status !== undefined && error.status >= 500);
  return !(error instanceof Error && /not configured|invalid job response|temporary audio is unavailable/i.test(error.message));
}
