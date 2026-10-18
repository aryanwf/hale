import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, query, type MutationCtx, type QueryCtx } from "./lib/functions";
import { requireMember } from "./authz";
import { env } from "./_generated/server";
import {
  isSunday,
  MAX_NIGHTLY_SOURCE_TURNS,
  MAX_SUMMARY_BACKFILL_DAYS,
  MAX_WEEKLY_SOURCE_TURNS,
  isSummaryWindowOpen,
  summaryContentIntro,
  summaryDateThrough,
  weeklyPeriodStart,
} from "./lib/familySummaryLogic";
import { shiftDate } from "@hale/contracts/time";

const MAX_PATIENTS_PER_SCAN = 25;
const MAX_CONVERSATIONS_PER_SUMMARY = 100;
const MAX_TURNS_PER_CONVERSATION = 25;
const MAX_SOURCE_TURNS_READ = 200;
const MAX_EXCERPT_LENGTH = 500;

const scanPatientsRef = makeFunctionReference<"mutation">("familySummaries:scanPatients");
const generatePatientRef = makeFunctionReference<"mutation">("familySummaries:generateForPatient");

const summaryKindValidator = v.union(v.literal("nightly"), v.literal("weekly"));
const entryValidator = v.object({
  date: v.string(), recordedAt: v.number(), excerpt: v.string(), truncated: v.boolean(),
  conversationId: v.id("conversations"), turnId: v.id("transcriptTurns"),
});
const summaryCardValidator = v.object({
  id: v.id("familySummaries"), kind: summaryKindValidator,
  periodKey: v.string(), periodStart: v.string(), periodEnd: v.string(), generatedAt: v.number(),
  intro: v.string(), entries: v.array(entryValidator),
});
const readResultValidator = v.object({
  enabled: v.boolean(), summaries: v.array(summaryCardValidator),
});

type SummaryKind = "nightly" | "weekly";
type SummaryEntry = { date: string; recordedAt: number; excerpt: string; truncated: boolean; conversationId: Id<"conversations">; turnId: Id<"transcriptTurns"> };
type ReadSummary = {
  id: Id<"familySummaries">; kind: SummaryKind; periodKey: string; periodStart: string; periodEnd: string;
  generatedAt: number; intro: string; entries: SummaryEntry[];
};

function enabled() {
  return env.FAMILY_SUMMARIES_ENABLED === "true";
}

async function requireFamilyMember(ctx: QueryCtx, patientId: Id<"patients">) {
  const access = await requireMember(ctx, patientId, "memories:read");
  if (access.membership.role !== "family") throw new ConvexError("Family summaries are available to authorized family members only.");
  return access;
}

async function sourceTurnIds(
  ctx: MutationCtx,
  patientId: Id<"patients">,
  periodStart: string,
  periodEnd: string,
  limit: number,
) {
  const conversations = await ctx.db.query("conversations").withIndex("by_patient_date", (q) =>
    q.eq("patientId", patientId).gte("localDate", periodStart).lte("localDate", periodEnd),
  ).order("asc").take(MAX_CONVERSATIONS_PER_SUMMARY + 1);
  const result: Id<"transcriptTurns">[] = [];
  let turnsRead = 0;
  for (const conversation of conversations.slice(0, MAX_CONVERSATIONS_PER_SUMMARY)) {
    if (result.length >= limit || turnsRead >= MAX_SOURCE_TURNS_READ) break;
    if (conversation.patientId !== patientId || conversation.deletedAt || conversation.state !== "ready") continue;
    const turns = await ctx.db.query("transcriptTurns").withIndex("by_conversation", (q) =>
      q.eq("conversationId", conversation._id),
    ).order("asc").take(Math.min(MAX_TURNS_PER_CONVERSATION, MAX_SOURCE_TURNS_READ - turnsRead));
    turnsRead += turns.length;
    for (const turn of turns) {
      if (turn.patientId !== patientId || !turn.text.trim()) continue;
      result.push(turn._id);
      if (result.length >= limit) break;
    }
  }
  return result;
}

async function resolveEntries(ctx: QueryCtx, summary: Doc<"familySummaries">): Promise<SummaryEntry[]> {
  const entries: SummaryEntry[] = [];
  for (const turnId of summary.sourceTurnIds.slice(0, MAX_WEEKLY_SOURCE_TURNS)) {
    const turn = await ctx.db.get(turnId);
    if (!turn || turn.patientId !== summary.patientId || !turn.text.trim()) continue;
    const conversation = await ctx.db.get(turn.conversationId);
    if (!conversation || conversation.patientId !== summary.patientId || conversation.deletedAt || conversation.state !== "ready") continue;
    const original = turn.text.trim();
    entries.push({
      date: conversation.localDate,
      recordedAt: conversation.startedAt + turn.start * 1000,
      excerpt: original.slice(0, MAX_EXCERPT_LENGTH),
      truncated: original.length > MAX_EXCERPT_LENGTH,
      conversationId: conversation._id,
      turnId: turn._id,
    });
  }
  return entries.sort((left, right) => left.date.localeCompare(right.date) || left.recordedAt - right.recordedAt);
}

async function createOrGetSummary(
  ctx: MutationCtx,
  patient: Doc<"patients">,
  kind: SummaryKind,
  periodStart: string,
  periodEnd: string,
  now: number,
) {
  const existing = await ctx.db.query("familySummaries").withIndex("by_patient_kind_period", (q) =>
    q.eq("patientId", patient._id).eq("kind", kind).eq("periodKey", periodEnd),
  ).unique();
  if (existing) return existing;
  const ids = await sourceTurnIds(
    ctx,
    patient._id,
    periodStart,
    periodEnd,
    kind === "nightly" ? MAX_NIGHTLY_SOURCE_TURNS : MAX_WEEKLY_SOURCE_TURNS,
  );
  const id = await ctx.db.insert("familySummaries", {
    patientId: patient._id, kind, periodKey: periodEnd, periodStart, periodEnd,
    sourceTurnIds: ids, generatedAt: now,
  });
  return (await ctx.db.get(id))!;
}

export const read = query({
  args: { patientId: v.id("patients") },
  returns: readResultValidator,
  handler: async (ctx, { patientId }) => {
    await requireFamilyMember(ctx, patientId);
    const isEnabled = enabled();
    const summaries = isEnabled
      ? await ctx.db.query("familySummaries").withIndex("by_patient_generatedAt", (q) => q.eq("patientId", patientId)).order("desc").take(12)
      : [];
    const summaryCards: ReadSummary[] = [];
    for (const summary of summaries) {
      const entries = await resolveEntries(ctx, summary);
      summaryCards.push({
        id: summary._id, kind: summary.kind, periodKey: summary.periodKey,
        periodStart: summary.periodStart, periodEnd: summary.periodEnd,
        generatedAt: summary.generatedAt, intro: summaryContentIntro(entries.length), entries,
      });
    }
    return { enabled: isEnabled, summaries: summaryCards };
  },
});

export const tick = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { now }) => {
    if (!enabled()) return null;
    const currentTime = now ?? Date.now();
    await ctx.scheduler.runAfter(0, scanPatientsRef, { cursor: null, now: currentTime });
    return null;
  },
});

export const scanPatients = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const page = await ctx.db.query("patients").order("asc").paginate({ cursor: args.cursor, numItems: MAX_PATIENTS_PER_SCAN });
    for (const patient of page.page) {
      if (!enabled()) return null;
      const latest = await ctx.db.query("familySummaries").withIndex("by_patient_kind_period", (q) =>
        q.eq("patientId", patient._id).eq("kind", "nightly"),
      ).order("desc").take(1);
      const throughDate = summaryDateThrough(args.now, patient.timezone);
      const hasBacklog = latest.length > 0 && latest[0].periodEnd < throughDate;
      if (!isSummaryWindowOpen(args.now, patient.timezone) && !hasBacklog) continue;
      await ctx.scheduler.runAfter(0, generatePatientRef, { patientId: patient._id, now: args.now });
    }
    if (!page.isDone && enabled()) {
      await ctx.scheduler.runAfter(0, scanPatientsRef, { cursor: page.continueCursor, now: args.now });
    }
    return null;
  },
});

export const generateForPatient = internalMutation({
  args: { patientId: v.id("patients"), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { patientId, now }) => {
    if (!enabled()) return null;
    const patient = await ctx.db.get(patientId);
    if (!patient) return null;
    const currentTime = now ?? Date.now();
    const throughDate = summaryDateThrough(currentTime, patient.timezone);
    const latest = await ctx.db.query("familySummaries").withIndex("by_patient_kind_period", (q) =>
      q.eq("patientId", patientId).eq("kind", "nightly"),
    ).order("desc").take(1);
    const dates: string[] = [];
    if (!latest.length) dates.push(throughDate);
    else {
      let nextDate = shiftDate(latest[0].periodEnd, 1);
      while (nextDate <= throughDate && dates.length < MAX_SUMMARY_BACKFILL_DAYS) {
        dates.push(nextDate);
        nextDate = shiftDate(nextDate, 1);
      }
    }
    if (!dates.length) {
      const current = await ctx.db.query("familySummaries").withIndex("by_patient_kind_period", (q) =>
        q.eq("patientId", patientId).eq("kind", "nightly").eq("periodKey", throughDate),
      ).unique();
      if (current) {
        if (isSunday(throughDate)) {
          await createOrGetSummary(ctx, patient, "weekly", weeklyPeriodStart(throughDate), throughDate, currentTime);
        }
      }
      return null;
    }
    for (const date of dates) {
      if (!enabled()) return null;
      await createOrGetSummary(ctx, patient, "nightly", date, date, currentTime);
      if (isSunday(date)) {
        await createOrGetSummary(ctx, patient, "weekly", weeklyPeriodStart(date), date, currentTime);
      }
    }
    return null;
  },
});
