import { makeFunctionReference } from "convex/server";
import { v, ConvexError, type GenericId } from "convex/values";
import type { RecallAnswer } from "@hale/contracts";
import { recallEvidence } from "@hale/contracts/recall";
import { isSarvamLanguageCode, supportsSarvamTextToSpeech } from "@hale/contracts/languages";
import { isLocalDate, localDate, resolveDayQuestion } from "@hale/contracts/time";
import { synthesizeSpeech } from "./lib/sarvam";
import { action, internalMutation, query } from "./lib/functions";
import { requireMember } from "./authz";
import { loadSpace } from "./conversations";

type RecallArgs = { patientId: GenericId<"patients">; question: string; day?: string };
const recallRef = makeFunctionReference<"query", RecallArgs, RecallAnswer>("assistant:recall");
const deleteSpeechRef = makeFunctionReference<"mutation", { storageId: GenericId<"_storage"> }, null>("assistant:deleteSpeech");

// Reactive, read-only extraction. Generated prose never enters the evidence bank.
export const recall = query({
  args: { patientId: v.id("patients"), question: v.string(), day: v.optional(v.string()) },
  handler: async (ctx, { patientId, question, day }) => {
    const { patient } = await requireMember(ctx, patientId, "memories:read");
    if (!question.trim() || question.length > 1000) throw new ConvexError("Enter a question between 1 and 1000 characters.");
    if (day !== undefined && !isLocalDate(day)) throw new ConvexError("Choose a valid calendar day.");
    const today = localDate(new Date(), patient.timezone);
    const selected = resolveDayQuestion(question, today, day);
    const { space, limited } = await loadSpace(ctx, patientId, { day: selected, includeTurns: true });
    const answer = recallEvidence(space, question, today, day);
    return { ...answer, text: answer.text + (limited ? " This answer covers a limited set of available records, not the whole day. Select a day or review the original conversations for more context." : "") };
  },
});

export const speakAnswer = action({
  args: { patientId: v.id("patients"), question: v.string(), day: v.optional(v.string()), languageCode: v.string() },
  handler: async (ctx, args) => {
    if (!isSarvamLanguageCode(args.languageCode) || !supportsSarvamTextToSpeech(args.languageCode)) {
      throw new ConvexError("Sarvam speech is not available in this language.");
    }
    const recallArgs: RecallArgs = { patientId: args.patientId, question: args.question, day: args.day };
    const answer: RecallAnswer = await ctx.runQuery(recallRef, recallArgs);
    if (!answer.text.trim()) throw new ConvexError("There is no answer to read aloud.");
    if (answer.text.length > 2_500) throw new ConvexError("This answer is too long for one speech request.");

    let audio: Uint8Array;
    try {
      audio = await synthesizeSpeech(answer.text, args.languageCode);
    } catch {
      throw new ConvexError("Sarvam could not prepare speech right now. Please try again.");
    }

    // Recheck authorization and the exact source-bound answer before issuing a temporary playback URL.
    const currentAnswer: RecallAnswer = await ctx.runQuery(recallRef, recallArgs);
    if (JSON.stringify(currentAnswer) !== JSON.stringify(answer)) throw new ConvexError("This answer has changed. Ask again before playing it.");

    const bytes = new Uint8Array(audio.byteLength);
    bytes.set(audio);
    const storageId = await ctx.storage.store(new Blob([bytes.buffer], { type: "audio/wav" }));
    const url = await ctx.storage.getUrl(storageId);
    if (!url) {
      await ctx.storage.delete(storageId);
      throw new ConvexError("Temporary speech audio could not be prepared.");
    }
    const expiresAt = Date.now() + 5 * 60_000;
    try {
      await ctx.scheduler.runAfter(5 * 60_000, deleteSpeechRef, { storageId });
    } catch {
      await ctx.storage.delete(storageId);
      throw new ConvexError("Temporary speech audio could not be prepared.");
    }
    return { url, expiresAt };
  },
});

export const deleteSpeech = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    if (await ctx.db.system.get("_storage", storageId)) await ctx.storage.delete(storageId);
    return null;
  },
});
