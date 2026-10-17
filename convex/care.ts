import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { requireMember } from "./authz";
import { insertCareAlert } from "./lib/careAlerts";
import { sendCareEmail } from "./lib/careEmail";
import { internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from "./lib/functions";

const deliverEmailQueryRef = makeFunctionReference<"query">("care:emailPayload");
const setEmailStatusRef = makeFunctionReference<"mutation">("care:setEmailStatus");
const fireReminderRef = makeFunctionReference<"mutation">("care:fireAppointmentReminder");
const MAX_CONTACTS = 20;
const MAX_PUSH_SUBSCRIPTIONS = 10;
const MAX_APPOINTMENT_HORIZON_MS = 5 * 366 * 24 * 60 * 60 * 1000;

async function hasActiveSource(ctx: QueryCtx, patientId: Id<"patients">, conversationId: Id<"conversations">): Promise<boolean> {
  const conversation = await ctx.db.get(conversationId);
  return Boolean(conversation && !conversation.deletedAt && conversation.patientId === patientId);
}

function contactName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/u.test(name)) {
    throw new ConvexError("Enter a contact name between 2 and 100 characters.");
  }
  return name;
}

function contactEmail(value: string): string {
  const email = value.trim().toLowerCase();
  const [local, domain, extra] = email.split("@");
  const domainLabels = domain?.split(".") ?? [];
  const topLevelLabel = domainLabels.at(-1);
  if (
    extra !== undefined || !local || local.length > 64 || !domain || domain.length > 253 || email.length > 254 ||
    local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+$/iu.test(local) || domainLabels.length < 2 ||
    !topLevelLabel || topLevelLabel.length < 2 ||
    domainLabels.some((label) => !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/iu.test(label))
  ) {
    throw new ConvexError("Enter a valid email address.");
  }
  return email;
}

function validateScheduledAt(value: number, now: number): void {
  if (!Number.isFinite(value) || value < 0 || !Number.isFinite(new Date(value).getTime())) {
    throw new ConvexError("Appointment time must be a valid absolute timestamp.");
  }
  if (value < now - MAX_APPOINTMENT_HORIZON_MS || value > now + MAX_APPOINTMENT_HORIZON_MS) {
    throw new ConvexError("Choose an appointment time within five years of today.");
  }
}

function validatePushSubscription(endpoint: string, p256dh: string, auth: string): void {
  let url: URL;
  try { url = new URL(endpoint); }
  catch { throw new ConvexError("Browser push subscription is invalid."); }
  const supportedPushHost = url.hostname === "fcm.googleapis.com" || url.hostname === "web.push.apple.com" ||
    url.hostname.endsWith(".push.services.mozilla.com") || url.hostname.endsWith(".notify.windows.com");
  if (endpoint.length > 2_048 || url.protocol !== "https:" || (url.port && url.port !== "443") || !supportedPushHost || url.username || url.password || url.hash ||
    !/^[A-Za-z0-9_-]{40,200}$/u.test(p256dh) || !/^[A-Za-z0-9_-]{16,100}$/u.test(auth)) {
    throw new ConvexError("Browser push subscription is invalid.");
  }
}

export const dashboard = query({
  args: { patientId: v.id("patients") },
  handler: async (ctx, { patientId }) => {
    const { membership } = await requireMember(ctx, patientId, "memories:read");
    const canManageCare = membership.capabilities.includes("care:manage");
    const [proposals, appointments, alerts] = await Promise.all([
      ctx.db.query("careProposals")
        .withIndex("by_patient_status_createdAt", (q) => q.eq("patientId", patientId).eq("status", "needs_review"))
        .order("desc").take(100),
      ctx.db.query("careProposals")
        .withIndex("by_patient_kind_status_createdAt", (q) => q.eq("patientId", patientId).eq("kind", "appointment").eq("status", "confirmed"))
        .order("desc").take(100),
      ctx.db.query("careAlerts")
        .withIndex("by_patient_createdAt", (q) => q.eq("patientId", patientId))
        .order("desc").take(100),
    ]);
    const contacts = canManageCare
      ? await ctx.db.query("emergencyContacts")
        .withIndex("by_patient_createdAt", (q) => q.eq("patientId", patientId))
        .order("desc").take(MAX_CONTACTS)
      : [];
    const proposalRow = (proposal: Doc<"careProposals">) => ({
      id: proposal._id,
      kind: proposal.kind,
      priority: proposal.priority,
      status: proposal.status,
      title: proposal.title,
      summary: proposal.summary,
      proposedAt: proposal.proposedAt,
      scheduledAt: proposal.scheduledAt,
      createdAt: proposal.createdAt,
      conversationId: proposal.conversationId,
      turnIds: proposal.turnIds,
      sourceText: proposal.sourceText,
    });
    const [visibleProposals, visibleAppointments, visibleAlerts] = await Promise.all([
      Promise.all(proposals.map(async (proposal) => await hasActiveSource(ctx, patientId, proposal.conversationId) ? proposalRow(proposal) : null)),
      Promise.all(appointments.map(async (proposal) => await hasActiveSource(ctx, patientId, proposal.conversationId) ? proposalRow(proposal) : null)),
      Promise.all(alerts.map(async (alert) => !alert.conversationId || await hasActiveSource(ctx, patientId, alert.conversationId)
        ? {
          id: alert._id,
          kind: alert.kind,
          priority: alert.priority,
          title: alert.title,
          body: alert.body,
          createdAt: alert.createdAt,
          emailStatus: alert.emailStatus,
          pushStatus: alert.pushStatus,
          acknowledged: alert.acknowledged,
          conversationId: alert.conversationId ?? null,
          turnIds: alert.turnIds,
        }
        : null)),
    ]);
    return {
      canManage: canManageCare,
      proposals: visibleProposals.filter((proposal) => proposal !== null),
      appointments: visibleAppointments.filter((proposal) => proposal !== null),
      contacts: contacts.map((contact) => ({ id: contact._id, name: contact.name, email: contact.email, enabled: contact.enabled })),
      alerts: visibleAlerts.filter((alert) => alert !== null),
    };
  },
});

export const pushConfig = query({
  args: { patientId: v.id("patients") },
  returns: v.object({ publicKey: v.union(v.string(), v.null()), subscribed: v.boolean() }),
  handler: async (ctx, { patientId }) => {
    const { identity } = await requireMember(ctx, patientId, "memories:read");
    const subscription = await ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", identity.subject))
      .first();
    const configured = Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
    return { publicKey: configured ? env.VAPID_PUBLIC_KEY! : null, subscribed: Boolean(subscription) };
  },
});

export const savePushSubscription = mutation({
  args: { patientId: v.id("patients"), endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { identity } = await requireMember(ctx, args.patientId, "memories:read");
    validatePushSubscription(args.endpoint, args.p256dh, args.auth);
    const existing = await ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient_subject_endpoint", (q) => q.eq("patientId", args.patientId).eq("subject", identity.subject).eq("endpoint", args.endpoint))
      .unique();
    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { p256dh: args.p256dh, auth: args.auth, updatedAt: now });
      await ctx.db.insert("auditEvents", { patientId: args.patientId, actor: identity.subject, operation: "care.web_push.enabled", target: args.patientId, timestamp: now });
      return null;
    }
    const subscriptions = await ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient_subject", (q) => q.eq("patientId", args.patientId).eq("subject", identity.subject))
      .take(MAX_PUSH_SUBSCRIPTIONS);
    if (subscriptions.length >= MAX_PUSH_SUBSCRIPTIONS) throw new ConvexError("This account has reached its ten-device push notification limit for this space.");
    await ctx.db.insert("webNotificationSubscriptions", {
      patientId: args.patientId, subject: identity.subject, endpoint: args.endpoint,
      p256dh: args.p256dh, auth: args.auth, createdAt: now, updatedAt: now,
    });
    await ctx.db.insert("auditEvents", { patientId: args.patientId, actor: identity.subject, operation: "care.web_push.enabled", target: args.patientId, timestamp: now });
    return null;
  },
});

export const removePushSubscription = mutation({
  args: { patientId: v.id("patients") },
  returns: v.null(),
  handler: async (ctx, { patientId }) => {
    const { identity } = await requireMember(ctx, patientId, "memories:read");
    const subscriptions = await ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", identity.subject))
      .take(MAX_PUSH_SUBSCRIPTIONS);
    for (const subscription of subscriptions) await ctx.db.delete(subscription._id);
    if (subscriptions.length) {
      await ctx.db.insert("auditEvents", { patientId, actor: identity.subject, operation: "care.web_push.disabled", target: patientId, timestamp: Date.now() });
    }
    return null;
  },
});

export const addContact = mutation({
  args: { patientId: v.id("patients"), name: v.string(), email: v.string() },
  returns: v.id("emergencyContacts"),
  handler: async (ctx, args) => {
    const { identity } = await requireMember(ctx, args.patientId, "care:manage");
    const name = contactName(args.name);
    const email = contactEmail(args.email);
    const existing = await ctx.db.query("emergencyContacts")
      .withIndex("by_patient_email", (q) => q.eq("patientId", args.patientId).eq("email", email)).unique();
    if (existing) return existing._id;
    const contacts = await ctx.db.query("emergencyContacts")
      .withIndex("by_patient_createdAt", (q) => q.eq("patientId", args.patientId)).take(MAX_CONTACTS);
    if (contacts.length >= MAX_CONTACTS) throw new ConvexError("A patient space can have up to 20 emergency contacts.");
    const now = Date.now();
    const contactId = await ctx.db.insert("emergencyContacts", {
      patientId: args.patientId, createdBy: identity.subject, name, email, enabled: true, createdAt: now,
    });
    await ctx.db.insert("auditEvents", { patientId: args.patientId, actor: identity.subject, operation: "care.contact.added", target: contactId, timestamp: now });
    return contactId;
  },
});

export const removeContact = mutation({
  args: { patientId: v.id("patients"), contactId: v.id("emergencyContacts") },
  returns: v.null(),
  handler: async (ctx, { patientId, contactId }) => {
    const { identity } = await requireMember(ctx, patientId, "care:manage");
    const contact = await ctx.db.get(contactId);
    if (!contact || contact.patientId !== patientId) throw new ConvexError("Emergency contact unavailable.");
    await ctx.db.insert("auditEvents", { patientId, actor: identity.subject, operation: "care.contact.removed", target: contactId, timestamp: Date.now() });
    await ctx.db.delete(contactId);
    return null;
  },
});

export const reviewProposal = mutation({
  args: {
    proposalId: v.id("careProposals"),
    decision: v.union(v.literal("confirm"), v.literal("dismiss")),
    scheduledAt: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new ConvexError("Care proposal unavailable.");
    const { identity } = await requireMember(ctx, proposal.patientId, "care:manage");
    const conversation = await ctx.db.get(proposal.conversationId);
    if (!conversation || conversation.deletedAt || conversation.patientId !== proposal.patientId) {
      throw new ConvexError("Care proposal source is unavailable.");
    }
    const now = Date.now();
    if (args.scheduledAt !== undefined) validateScheduledAt(args.scheduledAt, now);
    if (proposal.kind !== "appointment" && args.scheduledAt !== undefined) {
      throw new ConvexError("Only appointment proposals can have a scheduled time.");
    }
    if (proposal.status === "dismissed" && args.decision === "dismiss") return null;
    if (proposal.status === "confirmed" && args.decision === "confirm") return null;
    if (proposal.status !== "needs_review") throw new ConvexError("This proposal has already been reviewed.");

    if (args.decision === "dismiss") {
      await ctx.db.patch(proposal._id, { status: "dismissed" });
      await ctx.db.insert("auditEvents", {
        patientId: proposal.patientId, actor: identity.subject, operation: "care.proposal.dismissed",
        target: proposal._id, timestamp: now,
      });
      return null;
    }
    const scheduledAt = args.scheduledAt ?? (
      proposal.proposedAt !== null && Number.isFinite(proposal.proposedAt) &&
      proposal.proposedAt >= now - MAX_APPOINTMENT_HORIZON_MS && proposal.proposedAt <= now + MAX_APPOINTMENT_HORIZON_MS
        ? proposal.proposedAt
        : null
    );
    if (proposal.kind === "appointment" && (scheduledAt === null || scheduledAt <= now)) {
      throw new ConvexError("Choose a future appointment date and time before confirming.");
    }
    await ctx.db.patch(proposal._id, {
      status: "confirmed",
      scheduledAt,
      ...(proposal.kind === "appointment" ? { title: proposal.title.replace(/^Suggestion:\s*/u, "") } : {}),
    });
    await ctx.db.insert("auditEvents", {
      patientId: proposal.patientId, actor: identity.subject, operation: "care.proposal.confirmed",
      target: proposal._id, timestamp: now,
    });

    if (proposal.kind === "appointment" && scheduledAt !== null && scheduledAt > now) {
      const reminderJobIds: Id<"_scheduled_functions">[] = [];
      for (const hoursBefore of [24, 2]) {
        const fireAt = scheduledAt - hoursBefore * 60 * 60 * 1000;
        if (fireAt <= now && (hoursBefore !== 2 || scheduledAt <= now)) continue;
        const jobId = fireAt <= now
          ? await ctx.scheduler.runAfter(0, fireReminderRef, { proposalId: proposal._id, scheduledAt, hoursBefore })
          : await ctx.scheduler.runAt(new Date(fireAt), fireReminderRef, { proposalId: proposal._id, scheduledAt, hoursBefore });
        reminderJobIds.push(jobId);
      }
      if (reminderJobIds.length) await ctx.db.patch(proposal._id, { reminderJobIds });
    }
    return null;
  },
});

export const acknowledgeAlert = mutation({
  args: { alertId: v.id("careAlerts") },
  returns: v.null(),
  handler: async (ctx, { alertId }) => {
    const alert = await ctx.db.get(alertId);
    if (!alert) throw new ConvexError("Care alert unavailable.");
    const { identity } = await requireMember(ctx, alert.patientId, "care:manage");
    if (alert.conversationId) {
      const conversation = await ctx.db.get(alert.conversationId);
      if (!conversation || conversation.deletedAt || conversation.patientId !== alert.patientId) {
        throw new ConvexError("Care alert source is unavailable.");
      }
    }
    if (!alert.acknowledged) {
      await ctx.db.patch(alertId, { acknowledged: true });
      await ctx.db.insert("auditEvents", {
        patientId: alert.patientId, actor: identity.subject, operation: "care.alert.acknowledged",
        target: alertId, timestamp: Date.now(),
      });
    }
    return null;
  },
});

export const fireAppointmentReminder = internalMutation({
  args: { proposalId: v.id("careProposals"), scheduledAt: v.number(), hoursBefore: v.number() },
  returns: v.null(),
  handler: async (ctx, { proposalId, scheduledAt, hoursBefore }) => {
    const proposal = await ctx.db.get(proposalId);
    if (!proposal || proposal.kind !== "appointment" || proposal.status !== "confirmed" || proposal.scheduledAt !== scheduledAt ||
      !Number.isInteger(hoursBefore) || ![2, 24].includes(hoursBefore)) return null;
    const conversation = await ctx.db.get(proposal.conversationId);
    if (!conversation || conversation.deletedAt || conversation.patientId !== proposal.patientId) return null;
    const now = Date.now();
    if (now < scheduledAt - hoursBefore * 60 * 60 * 1000 || now >= scheduledAt) return null;
    await insertCareAlert(ctx, {
      patientId: proposal.patientId,
      conversationId: proposal.conversationId,
      kind: "appointment_reminder",
      priority: "routine",
      title: "Appointment reminder",
      body: "A confirmed appointment is coming up. Review the details in Hale.",
      turnIds: proposal.turnIds,
      sourceKey: `appointment-reminder:v1:${proposal._id}:${hoursBefore}`,
    });
    return null;
  },
});

export const emailPayload = internalQuery({
  args: { alertId: v.id("careAlerts") },
  handler: async (ctx, { alertId }) => {
    const alert = await ctx.db.get(alertId);
    if (!alert || alert.emailStatus !== "pending") return null;
    if (alert.conversationId) {
      const conversation = await ctx.db.get(alert.conversationId);
      if (!conversation || conversation.deletedAt || conversation.patientId !== alert.patientId) return null;
    }
    const contacts = await ctx.db.query("emergencyContacts")
      .withIndex("by_patient_createdAt", (q) => q.eq("patientId", alert.patientId))
      .take(MAX_CONTACTS);
    return {
      kind: alert.kind,
      recipients: contacts.filter((contact) => contact.enabled).map((contact) => contact.email),
    };
  },
});

export const setEmailStatus = internalMutation({
  args: {
    alertId: v.id("careAlerts"),
    status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, { alertId, status }) => {
    const alert = await ctx.db.get(alertId);
    if (alert?.emailStatus === "pending") await ctx.db.patch(alertId, { emailStatus: status, emailJobId: undefined });
    return null;
  },
});

export const deliverAlertEmail = internalAction({
  args: { alertId: v.id("careAlerts") },
  handler: async (ctx, { alertId }) => {
    const payload: { kind: "urgent" | "appointment_reminder"; recipients: string[] } | null = await ctx.runQuery(deliverEmailQueryRef, { alertId });
    if (!payload) return null;
    const status = payload.recipients.length
      ? await sendCareEmail(payload.recipients, payload.kind, `care-alert-${alertId}`)
      : "skipped";
    await ctx.runMutation(setEmailStatusRef, { alertId, status });
    return null;
  },
});

export const pushPayload = internalQuery({
  args: { alertId: v.id("careAlerts") },
  returns: v.union(v.null(), v.object({
    priority: v.union(v.literal("routine"), v.literal("urgent")),
    notification: v.object({ title: v.string(), body: v.string(), path: v.string(), tag: v.string() }),
    subscriptions: v.array(v.object({
      id: v.id("webNotificationSubscriptions"), endpoint: v.string(), p256dh: v.string(), auth: v.string(),
    })),
  })),
  handler: async (ctx, { alertId }) => {
    const alert = await ctx.db.get(alertId);
    if (!alert || alert.pushStatus !== "pending") return null;
    if (alert.conversationId) {
      const conversation = await ctx.db.get(alert.conversationId);
      if (!conversation || conversation.deletedAt || conversation.patientId !== alert.patientId) return null;
    }
    const subscriptions = await ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient", (q) => q.eq("patientId", alert.patientId))
      .take(100);
    const authorizedSubscriptions = [];
    for (const subscription of subscriptions) {
      const membership = await ctx.db.query("memberships")
        .withIndex("by_patient_subject", (q) => q.eq("patientId", alert.patientId).eq("subject", subscription.subject))
        .unique();
      if (membership?.active && membership.capabilities.includes("memories:read")) {
        authorizedSubscriptions.push({
          id: subscription._id,
          endpoint: subscription.endpoint,
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        });
      }
    }
    return {
      priority: alert.priority,
      notification: {
        title: alert.priority === "urgent" ? "Hale care alert" : "Hale appointment reminder",
        body: alert.priority === "urgent"
          ? "A possible urgent phrase needs review in Hale."
          : "A confirmed-in-Hale appointment reminder is ready.",
        path: "/family/care",
        tag: `hale-care-alert-${alertId}`,
      },
      subscriptions: authorizedSubscriptions,
    };
  },
});

export const removePushSubscriptionRecord = internalMutation({
  args: { subscriptionId: v.id("webNotificationSubscriptions") },
  returns: v.null(),
  handler: async (ctx, { subscriptionId }) => {
    const subscription = await ctx.db.get(subscriptionId);
    if (subscription) await ctx.db.delete(subscriptionId);
    return null;
  },
});

export const setPushStatus = internalMutation({
  args: {
    alertId: v.id("careAlerts"),
    status: v.union(v.literal("sent"), v.literal("skipped"), v.literal("failed")),
  },
  returns: v.null(),
  handler: async (ctx, { alertId, status }) => {
    const alert = await ctx.db.get(alertId);
    if (alert?.pushStatus === "pending") await ctx.db.patch(alertId, { pushStatus: status, pushJobId: undefined });
    return null;
  },
});
