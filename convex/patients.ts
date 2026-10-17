import { v, ConvexError } from "convex/values";
import { PATIENT_CAPABILITIES } from "@hale/contracts";
import { query, mutation, type QueryCtx } from "./lib/functions";
import { requireIdentity } from "./authz";

async function listPatients(ctx: QueryCtx, role?: "patient" | "family") {
  const identity = await requireIdentity(ctx);
  const memberships = await ctx.db.query("memberships").withIndex("by_subject", (q) => q.eq("subject", identity.subject)).take(100);
  return (await Promise.all(memberships.filter((item) => item.active && (!role || item.role === role)).map(async (membership) => {
    const patient = await ctx.db.get(membership.patientId);
    return patient ? { id: patient._id, name: patient.name, timezone: patient.timezone, capabilities: membership.capabilities } : null;
  }))).filter((item) => item !== null);
}

export const list = query({
  args: {},
  handler: (ctx) => listPatients(ctx),
});

export const listForRole = query({
  args: { role: v.union(v.literal("patient"), v.literal("family")) },
  returns: v.array(v.object({ id: v.id("patients"), name: v.string(), timezone: v.string(), capabilities: v.array(v.string()) })),
  handler: (ctx, { role }) => listPatients(ctx, role),
});

export const create = mutation({
  args: { name: v.string(), timezone: v.string(), recordingConsent: v.boolean() },
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 100) throw new ConvexError("Enter a name between 2 and 100 characters.");
    try { new Intl.DateTimeFormat("en", { timeZone: args.timezone }).format(); }
    catch { throw new ConvexError("Choose a valid IANA timezone."); }
    // A double click must not silently create duplicate spaces.
    const existing = await ctx.db.query("memberships").withIndex("by_subject", (q) => q.eq("subject", identity.subject)).collect();
    if (existing.some((item) => item.active && item.role === "patient")) throw new ConvexError("You already have a patient space.");
    const now = Date.now();
    const patientId = await ctx.db.insert("patients", { name, timezone: args.timezone, createdBy: identity.subject, audioRetentionDays: 7, createdAt: now });
    await ctx.db.insert("memberships", { patientId, subject: identity.subject, role: "patient", capabilities: PATIENT_CAPABILITIES, active: true });
    await ctx.db.insert("people", { patientId, name, relationship: "You · patient", enrollment: "not_enrolled", isPatient: true });
    if (args.recordingConsent) await ctx.db.insert("consents", { patientId, subject: identity.subject, purpose: "recording", policyVersion: "2026-10-15-v1", grantedAt: now });
    await ctx.db.insert("auditEvents", { patientId, actor: identity.subject, operation: "patient.created", target: patientId, timestamp: now });
    return patientId;
  },
});
