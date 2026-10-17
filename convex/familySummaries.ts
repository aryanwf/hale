import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx, type MutationCtx, type QueryCtx } from "./lib/functions";
import { requireIdentity, requireMember } from "./authz";
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
const MAX_DELIVERIES_PER_SCAN = 40;
const MAX_FAMILY_RECIPIENTS = 100;
const MAX_CONVERSATIONS_PER_SUMMARY = 100;
const MAX_TURNS_PER_CONVERSATION = 25;
const MAX_SOURCE_TURNS_READ = 200;
const MAX_DELIVERY_ATTEMPTS = 4;
const DELIVERY_LEASE_MS = 5 * 60_000;
const WEEKLY_RECHECK_MS = 5 * 60_000;
const TEST_EMAIL_COOLDOWN_MS = 15 * 60_000;
const MAX_EXCERPT_LENGTH = 500;

const scanPatientsRef = makeFunctionReference<"mutation">("familySummaries:scanPatients");
const scanQueuedDeliveriesRef = makeFunctionReference<"mutation">("familySummaries:scanQueuedDeliveries");
const scanStaleDeliveriesRef = makeFunctionReference<"mutation">("familySummaries:scanStaleDeliveries");
const generatePatientRef = makeFunctionReference<"mutation">("familySummaries:generateForPatient");
const deliverRef = makeFunctionReference<"action">("familySummaries:deliver");
const claimDeliveryRef = makeFunctionReference<"mutation">("familySummaries:claimDelivery");
const deliveryPayloadRef = makeFunctionReference<"query">("familySummaries:deliveryPayload");
const markSentRef = makeFunctionReference<"mutation">("familySummaries:markSent");
const markFailedRef = makeFunctionReference<"mutation">("familySummaries:markFailed");
const markSkippedRef = makeFunctionReference<"mutation">("familySummaries:markSkipped");
const reserveTestEmailRef = makeFunctionReference<"mutation">("familySummaries:reserveTestEmail");

const summaryKindValidator = v.union(v.literal("nightly"), v.literal("weekly"));
const deliveryStateValidator = v.union(v.literal("queued"), v.literal("sending"), v.literal("sent"), v.literal("failed"), v.literal("skipped"));
const preferencesValidator = v.object({ nightly: v.boolean(), weekly: v.boolean() });
const entryValidator = v.object({
  date: v.string(), recordedAt: v.number(), excerpt: v.string(), truncated: v.boolean(),
  conversationId: v.id("conversations"), turnId: v.id("transcriptTurns"),
});
const summaryCardValidator = v.object({
  id: v.id("familySummaries"), kind: summaryKindValidator,
  periodKey: v.string(), periodStart: v.string(), periodEnd: v.string(), generatedAt: v.number(),
  intro: v.string(), entries: v.array(entryValidator),
  deliveryState: v.union(v.null(), deliveryStateValidator), deliveredAt: v.union(v.null(), v.number()),
});
const readResultValidator = v.object({
  enabled: v.boolean(), notificationDeliveryConfigured: v.boolean(), testEmailAvailable: v.boolean(),
  verifiedEmailAvailable: v.boolean(), preferences: preferencesValidator,
  summaries: v.array(summaryCardValidator),
});

type SummaryKind = "nightly" | "weekly";
type DeliveryState = "queued" | "sending" | "sent" | "failed" | "skipped";
type SummaryEntry = { date: string; recordedAt: number; excerpt: string; truncated: boolean; conversationId: Id<"conversations">; turnId: Id<"transcriptTurns"> };
type ReadSummary = {
  id: Id<"familySummaries">; kind: SummaryKind; periodKey: string; periodStart: string; periodEnd: string;
  generatedAt: number; intro: string; entries: SummaryEntry[]; deliveryState: DeliveryState | null; deliveredAt: number | null;
};
type ClaimResult = { state: "claimed"; attempt: number } | { state: "waiting" | "busy" | "done" | "disabled" };

function enabled() {
  return env.FAMILY_SUMMARIES_ENABLED === "true";
}

function emailMode(): string | undefined {
  return env.FAMILY_SUMMARIES_EMAIL_MODE;
}

function validEmail(value: string | undefined): value is string {
  return Boolean(value && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
}

function emailTransportConfigured() {
  return validEmail(env.FAMILY_SUMMARIES_FROM_EMAIL) && Boolean(env.RESEND_API_KEY);
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

async function scheduleDependentWeekly(ctx: MutationCtx, nightlySummaryId: Id<"familySummaries">, now: number) {
  if (!enabled()) return;
  const nightly = await ctx.db.get(nightlySummaryId);
  if (!nightly || nightly.kind !== "nightly") return;
  const outstanding = await ctx.db.query("familySummaryDeliveries").withIndex("by_summary", (q) =>
    q.eq("summaryId", nightlySummaryId),
  ).take(MAX_FAMILY_RECIPIENTS + 1);
  if (outstanding.length > MAX_FAMILY_RECIPIENTS) return;
  if (outstanding.some((delivery) => delivery.status === "queued" || delivery.status === "sending")) return;
  const weekly = await ctx.db.query("familySummaries").withIndex("by_patient_kind_period", (q) =>
    q.eq("patientId", nightly.patientId).eq("kind", "weekly").eq("periodKey", nightly.periodKey),
  ).unique();
  if (!weekly || weekly.afterSummaryId !== nightlySummaryId) return;
  const deliveries = await ctx.db.query("familySummaryDeliveries").withIndex("by_summary", (q) =>
    q.eq("summaryId", weekly._id),
  ).take(MAX_FAMILY_RECIPIENTS + 1);
  if (deliveries.length > MAX_FAMILY_RECIPIENTS) return;
  for (const delivery of deliveries) {
    if (delivery.status === "queued" && delivery.nextAttemptAt <= now) {
      await ctx.scheduler.runAfter(0, deliverRef, { deliveryId: delivery._id });
    }
  }
}

async function createOrGetSummary(
  ctx: MutationCtx,
  patient: Doc<"patients">,
  kind: SummaryKind,
  periodStart: string,
  periodEnd: string,
  now: number,
  afterSummaryId?: Id<"familySummaries">,
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
    sourceTurnIds: ids, generatedAt: now, afterSummaryId,
  });
  return (await ctx.db.get(id))!;
}

async function ensureDeliveries(ctx: MutationCtx, summary: Doc<"familySummaries">, now: number) {
  if (!enabled() || emailMode() !== "live" || !summary.sourceTurnIds.length) return;
  const members = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
    q.eq("patientId", summary.patientId),
  ).take(101);
  for (const member of members) {
    if (!member.active || member.role !== "family" || !member.capabilities.includes("memories:read")) continue;
    const preference = await ctx.db.query("familySummaryPreferences").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", summary.patientId).eq("subject", member.subject),
    ).unique();
    if (!preference || !(summary.kind === "nightly" ? preference.nightly : preference.weekly) || !validEmail(preference.email)) continue;
    const existing = await ctx.db.query("familySummaryDeliveries").withIndex("by_summary_recipient", (q) =>
      q.eq("summaryId", summary._id).eq("recipientSubject", member.subject),
    ).unique();
    if (!existing) {
      const deliveryId = await ctx.db.insert("familySummaryDeliveries", {
        patientId: summary.patientId, summaryId: summary._id, recipientSubject: member.subject,
        status: "queued", attempts: 0, nextAttemptAt: now, createdAt: now,
      });
      await ctx.scheduler.runAfter(0, deliverRef, { deliveryId });
    } else if (existing.status === "skipped" && ["Notifications are off.", "Family email delivery is not enabled."].includes(existing.skippedReason ?? "")) {
      await ctx.db.patch(existing._id, { status: "queued", attempts: 0, nextAttemptAt: now, skippedReason: undefined, lastError: undefined });
      await ctx.scheduler.runAfter(0, deliverRef, { deliveryId: existing._id });
    }
  }
}

export const read = query({
  args: { patientId: v.id("patients") },
  returns: readResultValidator,
  handler: async (ctx, { patientId }) => {
    const { identity } = await requireFamilyMember(ctx, patientId);
    const preference = await ctx.db.query("familySummaryPreferences").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", identity.subject),
    ).unique();
    const isEnabled = enabled();
    const summaries = isEnabled
      ? await ctx.db.query("familySummaries").withIndex("by_patient_generatedAt", (q) => q.eq("patientId", patientId)).order("desc").take(12)
      : [];
    const summaryCards: ReadSummary[] = [];
    for (const summary of summaries) {
      const entries = await resolveEntries(ctx, summary);
      const delivery = await ctx.db.query("familySummaryDeliveries").withIndex("by_summary_recipient", (q) =>
        q.eq("summaryId", summary._id).eq("recipientSubject", identity.subject),
      ).unique();
      summaryCards.push({
        id: summary._id, kind: summary.kind, periodKey: summary.periodKey,
        periodStart: summary.periodStart, periodEnd: summary.periodEnd,
        generatedAt: summary.generatedAt, intro: summaryContentIntro(entries.length), entries,
        deliveryState: delivery?.status ?? null, deliveredAt: delivery?.deliveredAt ?? null,
      });
    }
    const verifiedEmailAvailable = identity.emailVerified === true && validEmail(identity.email);
    return {
      enabled: isEnabled,
      notificationDeliveryConfigured: isEnabled && emailMode() === "live" && emailTransportConfigured(),
      testEmailAvailable: isEnabled && emailMode() === "test" && validEmail(env.FAMILY_SUMMARIES_TEST_EMAIL) && emailTransportConfigured(),
      verifiedEmailAvailable,
      preferences: { nightly: preference?.nightly ?? false, weekly: preference?.weekly ?? false },
      summaries: summaryCards,
    };
  },
});

export const setPreferences = mutation({
  args: { patientId: v.id("patients"), nightly: v.boolean(), weekly: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { identity } = await requireFamilyMember(ctx, args.patientId);
    const shouldEmail = args.nightly || args.weekly;
    const existing = await ctx.db.query("familySummaryPreferences").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", args.patientId).eq("subject", identity.subject),
    ).unique();
    const enablingNewPreference = (args.nightly && !existing?.nightly) || (args.weekly && !existing?.weekly);
    const currentVerifiedEmail = identity.emailVerified === true && validEmail(identity.email) ? identity.email.trim().toLowerCase() : undefined;
    const selectedEmail = currentVerifiedEmail ?? existing?.email;
    if (enablingNewPreference && !currentVerifiedEmail) throw new ConvexError("A verified email address is required for summary delivery.");
    if (shouldEmail && !validEmail(selectedEmail)) throw new ConvexError("A verified email address is required for summary delivery.");
    const values = {
      nightly: args.nightly, weekly: args.weekly,
      email: shouldEmail ? selectedEmail : undefined,
      updatedAt: Date.now(),
    };
    if (existing) await ctx.db.patch(existing._id, values);
    else await ctx.db.insert("familySummaryPreferences", { patientId: args.patientId, subject: identity.subject, ...values });
    return null;
  },
});

export const tick = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, { now }) => {
    if (!enabled()) return null;
    const currentTime = now ?? Date.now();
    await ctx.scheduler.runAfter(0, scanPatientsRef, { cursor: null, now: currentTime });
    await ctx.scheduler.runAfter(0, scanQueuedDeliveriesRef, { cursor: null, now: currentTime });
    await ctx.scheduler.runAfter(0, scanStaleDeliveriesRef, { cursor: null, now: currentTime });
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
        await ensureDeliveries(ctx, current, currentTime);
        if (isSunday(throughDate)) {
          const weekly = await createOrGetSummary(ctx, patient, "weekly", weeklyPeriodStart(throughDate), throughDate, currentTime, current._id);
          await ensureDeliveries(ctx, weekly, currentTime);
        }
      }
      return null;
    }
    for (const date of dates) {
      if (!enabled()) return null;
      const nightly = await createOrGetSummary(ctx, patient, "nightly", date, date, currentTime);
      await ensureDeliveries(ctx, nightly, currentTime);
      if (isSunday(date)) {
        const weekly = await createOrGetSummary(ctx, patient, "weekly", weeklyPeriodStart(date), date, currentTime, nightly._id);
        await ensureDeliveries(ctx, weekly, currentTime);
      }
    }
    return null;
  },
});

export const scanQueuedDeliveries = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const queued = await ctx.db.query("familySummaryDeliveries").withIndex("by_status_nextAttempt", (q) =>
      q.eq("status", "queued").lte("nextAttemptAt", args.now),
    ).paginate({ cursor: args.cursor, numItems: MAX_DELIVERIES_PER_SCAN });
    for (const delivery of queued.page) {
      if (!enabled()) return null;
      await ctx.scheduler.runAfter(0, deliverRef, { deliveryId: delivery._id });
    }
    if (!queued.isDone && enabled()) {
      await ctx.scheduler.runAfter(0, scanQueuedDeliveriesRef, { cursor: queued.continueCursor, now: args.now });
    }
    return null;
  },
});

export const scanStaleDeliveries = internalMutation({
  args: { cursor: v.union(v.string(), v.null()), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const stale = await ctx.db.query("familySummaryDeliveries").withIndex("by_status_claimedAt", (q) =>
      q.eq("status", "sending").lte("claimedAt", args.now - DELIVERY_LEASE_MS),
    ).paginate({ cursor: args.cursor, numItems: MAX_DELIVERIES_PER_SCAN });
    for (const delivery of stale.page) {
      if (!enabled()) return null;
      await ctx.scheduler.runAfter(0, deliverRef, { deliveryId: delivery._id });
    }
    if (!stale.isDone && enabled()) {
      await ctx.scheduler.runAfter(0, scanStaleDeliveriesRef, { cursor: stale.continueCursor, now: args.now });
    }
    return null;
  },
});

export const claimDelivery = internalMutation({
  args: { deliveryId: v.id("familySummaryDeliveries"), now: v.optional(v.number()) },
  returns: v.object({ state: v.union(v.literal("claimed"), v.literal("waiting"), v.literal("busy"), v.literal("done"), v.literal("disabled")), attempt: v.optional(v.number()) }),
  handler: async (ctx, { deliveryId, now }) => {
    if (!enabled()) return { state: "disabled" as const };
    const currentTime = now ?? Date.now();
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || ["sent", "failed", "skipped"].includes(delivery.status)) return { state: "done" as const };
    if (delivery.nextAttemptAt > currentTime) return { state: "busy" as const };
    if (delivery.status === "sending" && delivery.claimedAt && delivery.claimedAt + DELIVERY_LEASE_MS > currentTime) return { state: "busy" as const };
    if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await ctx.db.patch(deliveryId, { status: "failed", lastError: "Delivery retry limit reached.", claimedAt: undefined });
      await scheduleDependentWeekly(ctx, delivery.summaryId, currentTime);
      return { state: "done" as const };
    }
    const summary = await ctx.db.get(delivery.summaryId);
    const member = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", delivery.patientId).eq("subject", delivery.recipientSubject),
    ).unique();
    if (!summary || summary.patientId !== delivery.patientId || !member?.active || member.role !== "family" || !member.capabilities.includes("memories:read")) {
      await ctx.db.patch(deliveryId, { status: "skipped", skippedReason: "Family access is no longer active.", claimedAt: undefined });
      await scheduleDependentWeekly(ctx, delivery.summaryId, currentTime);
      return { state: "done" as const };
    }
    const preference = await ctx.db.query("familySummaryPreferences").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", delivery.patientId).eq("subject", delivery.recipientSubject),
    ).unique();
    if (!preference || !(summary.kind === "nightly" ? preference.nightly : preference.weekly) || !validEmail(preference.email)) {
      await ctx.db.patch(deliveryId, { status: "skipped", skippedReason: "Notifications are off.", claimedAt: undefined });
      await scheduleDependentWeekly(ctx, delivery.summaryId, currentTime);
      return { state: "done" as const };
    }
    if (emailMode() !== "live") {
      await ctx.db.patch(deliveryId, { status: "skipped", skippedReason: "Family email delivery is not enabled.", claimedAt: undefined });
      await scheduleDependentWeekly(ctx, delivery.summaryId, currentTime);
      return { state: "done" as const };
    }
    if (!summary.sourceTurnIds.length) {
      await ctx.db.patch(deliveryId, { status: "skipped", skippedReason: "No source excerpts are available.", claimedAt: undefined });
      await scheduleDependentWeekly(ctx, delivery.summaryId, currentTime);
      return { state: "done" as const };
    }
    if (summary.kind === "weekly" && summary.afterSummaryId) {
      const nightlyDeliveries = await ctx.db.query("familySummaryDeliveries").withIndex("by_summary", (q) =>
        q.eq("summaryId", summary.afterSummaryId!),
      ).take(MAX_FAMILY_RECIPIENTS + 1);
      if (nightlyDeliveries.length > MAX_FAMILY_RECIPIENTS) {
        if (enabled()) await ctx.scheduler.runAfter(WEEKLY_RECHECK_MS, deliverRef, { deliveryId });
        return { state: "waiting" as const };
      }
      if (nightlyDeliveries.some((item) => item.status === "queued" || item.status === "sending")) {
        if (enabled()) await ctx.scheduler.runAfter(WEEKLY_RECHECK_MS, deliverRef, { deliveryId });
        return { state: "waiting" as const };
      }
    }
    const attempt = delivery.attempts + 1;
    await ctx.db.patch(deliveryId, { status: "sending", attempts: attempt, claimedAt: currentTime, skippedReason: undefined });
    return { state: "claimed" as const, attempt };
  },
});

export const deliveryPayload = internalQuery({
  args: { deliveryId: v.id("familySummaryDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    if (!enabled() || emailMode() !== "live") return null;
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery || delivery.status !== "sending") return null;
    const [summary, patient, member, preference] = await Promise.all([
      ctx.db.get(delivery.summaryId),
      ctx.db.get(delivery.patientId),
      ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", delivery.patientId).eq("subject", delivery.recipientSubject)).unique(),
      ctx.db.query("familySummaryPreferences").withIndex("by_patient_subject", (q) => q.eq("patientId", delivery.patientId).eq("subject", delivery.recipientSubject)).unique(),
    ]);
    if (!summary || summary.patientId !== delivery.patientId || !patient || !member?.active || member.role !== "family" || !member.capabilities.includes("memories:read")) return null;
    if (!preference || !(summary.kind === "nightly" ? preference.nightly : preference.weekly) || !validEmail(preference.email)) return null;
    const entries = await resolveEntries(ctx, summary);
    if (!entries.length) return null;
    return {
      to: preference.email,
      kind: summary.kind,
      periodStart: summary.periodStart,
      periodEnd: summary.periodEnd,
      timezone: patient.timezone,
      entries,
    };
  },
});

export const markSent = internalMutation({
  args: { deliveryId: v.id("familySummaryDeliveries"), attempt: v.number(), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "sending" || delivery.attempts !== args.attempt) return null;
    const now = args.now ?? Date.now();
    await ctx.db.patch(args.deliveryId, { status: "sent", deliveredAt: now, claimedAt: undefined, lastError: undefined });
    await scheduleDependentWeekly(ctx, delivery.summaryId, now);
    return null;
  },
});

export const markFailed = internalMutation({
  args: { deliveryId: v.id("familySummaryDeliveries"), attempt: v.number(), error: v.string(), retryable: v.boolean(), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "sending" || delivery.attempts !== args.attempt) return null;
    const now = args.now ?? Date.now();
    const shouldRetry = args.retryable && args.attempt < MAX_DELIVERY_ATTEMPTS;
    if (shouldRetry) {
      const delay = Math.min(30_000 * 2 ** (args.attempt - 1), 15 * 60_000);
      await ctx.db.patch(args.deliveryId, { status: "queued", nextAttemptAt: now + delay, claimedAt: undefined, lastError: args.error.slice(0, 200) });
      if (enabled()) await ctx.scheduler.runAfter(delay, deliverRef, { deliveryId: args.deliveryId });
    } else {
      await ctx.db.patch(args.deliveryId, { status: "failed", nextAttemptAt: now, claimedAt: undefined, lastError: args.error.slice(0, 200) });
      await scheduleDependentWeekly(ctx, delivery.summaryId, now);
    }
    return null;
  },
});

export const markSkipped = internalMutation({
  args: { deliveryId: v.id("familySummaryDeliveries"), attempt: v.number(), reason: v.string(), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const delivery = await ctx.db.get(args.deliveryId);
    if (!delivery || delivery.status !== "sending" || delivery.attempts !== args.attempt) return null;
    const now = args.now ?? Date.now();
    await ctx.db.patch(args.deliveryId, { status: "skipped", skippedReason: args.reason.slice(0, 200), claimedAt: undefined, nextAttemptAt: now });
    await scheduleDependentWeekly(ctx, delivery.summaryId, now);
    return null;
  },
});

function emailText(payload: NonNullable<Awaited<ReturnType<typeof loadDeliveryPayload>>>) {
  const label = payload.kind === "nightly" ? `Nightly summary · ${payload.periodEnd}` : `Weekly summary · ${payload.periodStart} – ${payload.periodEnd}`;
  const excerpts = payload.entries.map((entry) => {
    const time = new Intl.DateTimeFormat("en-US", { timeZone: payload.timezone, hour: "numeric", minute: "2-digit" }).format(new Date(entry.recordedAt));
    return `${entry.date} at ${time}\n“${entry.excerpt}${entry.truncated ? "…" : ""}”\n`;
  }).join("\n");
  return `Hale family summary\n${label}\n\nThese are direct excerpts from processed transcripts, not an interpretation or medical advice.\n\n${excerpts}\nReview source conversations in your Hale family dashboard.`;
}

type DeliveryPayload = {
  to: string;
  kind: SummaryKind;
  periodStart: string;
  periodEnd: string;
  timezone: string;
  entries: SummaryEntry[];
};

async function loadDeliveryPayload(ctx: ActionCtx, deliveryId: Id<"familySummaryDeliveries">): Promise<DeliveryPayload | null> {
  const result: DeliveryPayload | null = await ctx.runQuery(deliveryPayloadRef, { deliveryId });
  return result;
}

async function resend(to: string, subject: string, text: string, idempotencyKey: string) {
  if (!emailTransportConfigured() || !env.RESEND_API_KEY || !env.FAMILY_SUMMARIES_FROM_EMAIL) {
    return { ok: false as const, retryable: false, error: "Email delivery is not configured." };
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ from: env.FAMILY_SUMMARIES_FROM_EMAIL, to: [to], subject, text }),
    });
    if (response.ok) return { ok: true as const };
    return {
      ok: false as const,
      retryable: response.status === 429 || response.status >= 500,
      error: `Email provider returned HTTP ${response.status}.`,
    };
  } catch {
    return { ok: false as const, retryable: true, error: "Email provider could not be reached." };
  }
}

export const deliver = internalAction({
  args: { deliveryId: v.id("familySummaryDeliveries"), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled()) return null;
    const claim: ClaimResult = await ctx.runMutation(claimDeliveryRef, { deliveryId: args.deliveryId, ...(args.now === undefined ? {} : { now: args.now }) });
    if (claim.state !== "claimed" || claim.attempt === undefined || !enabled()) return null;
    const payload = await loadDeliveryPayload(ctx, args.deliveryId);
    if (!payload) {
      await ctx.runMutation(markSkippedRef, {
        deliveryId: args.deliveryId, attempt: claim.attempt, reason: "Source or family notification access is no longer available.", ...(args.now === undefined ? {} : { now: args.now }),
      });
      return null;
    }
    if (!enabled()) return null;
    const subject = payload.kind === "nightly" ? "Your Hale nightly family summary" : "Your Hale weekly family summary";
    const result = await resend(payload.to, subject, emailText(payload), `hale-family-summary-${args.deliveryId}`);
    if (!result.ok) {
      await ctx.runMutation(markFailedRef, {
        deliveryId: args.deliveryId, attempt: claim.attempt, retryable: result.retryable,
        error: result.error, ...(args.now === undefined ? {} : { now: args.now }),
      });
      return null;
    }
    await ctx.runMutation(markSentRef, { deliveryId: args.deliveryId, attempt: claim.attempt, ...(args.now === undefined ? {} : { now: args.now }) });
    return null;
  },
});

export const reserveTestEmail = internalMutation({
  args: { patientId: v.id("patients"), subject: v.string(), now: v.optional(v.number()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (!enabled() || emailMode() !== "test" || !validEmail(env.FAMILY_SUMMARIES_TEST_EMAIL) || !emailTransportConfigured()) {
      throw new ConvexError("The isolated summary test-email workflow is not configured.");
    }
    const member = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", args.patientId).eq("subject", args.subject),
    ).unique();
    if (!member?.active || member.role !== "family" || !member.capabilities.includes("memories:read")) {
      throw new ConvexError("You don’t have permission to request a test email for this family space.");
    }
    const now = args.now ?? Date.now();
    const preference = await ctx.db.query("familySummaryPreferences").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", args.patientId).eq("subject", args.subject),
    ).unique();
    if (preference?.testEmailSentAt && preference.testEmailSentAt + TEST_EMAIL_COOLDOWN_MS > now) {
      throw new ConvexError("Please wait before requesting another test email.");
    }
    if (preference) await ctx.db.patch(preference._id, { testEmailSentAt: now });
    else await ctx.db.insert("familySummaryPreferences", { patientId: args.patientId, subject: args.subject, nightly: false, weekly: false, updatedAt: now, testEmailSentAt: now });
    return null;
  },
});

export const sendTestEmail = action({
  args: { patientId: v.id("patients") },
  returns: v.object({ sent: v.boolean() }),
  handler: async (ctx, { patientId }) => {
    if (!enabled() || emailMode() !== "test" || !validEmail(env.FAMILY_SUMMARIES_TEST_EMAIL)) {
      throw new ConvexError("The isolated summary test-email workflow is not enabled.");
    }
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Please sign in.");
    await ctx.runMutation(reserveTestEmailRef, { patientId, subject: identity.subject });
    if (!enabled() || emailMode() !== "test" || !validEmail(env.FAMILY_SUMMARIES_TEST_EMAIL)) return { sent: false };
    const idempotencyKey = `hale-family-summary-test-${crypto.randomUUID()}`;
    const result = await resend(
      env.FAMILY_SUMMARIES_TEST_EMAIL,
      "[TEST] Hale family summaries",
      "This is an isolated synthetic test email for Hale family summaries. It contains no patient data and does not change notification preferences.",
      idempotencyKey,
    );
    if (!result.ok) throw new ConvexError("The test email could not be sent. Check the test deployment mail configuration.");
    return { sent: true };
  },
});
