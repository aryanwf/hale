import { ConvexError, v } from "convex/values";
import { mutation, query } from "./lib/functions";
import { requireIdentity, requireMember } from "./authz";

const CODE_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const codeResult = v.object({ code: v.string(), expiresAt: v.number(), linked: v.boolean() });

export const code = query({
  args: {},
  returns: v.union(v.null(), codeResult),
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const link = await ctx.db.query("familyCodes").withIndex("by_owner", (q) => q.eq("owner", identity.tokenIdentifier)).unique();
    return link ? { code: link.code, expiresAt: link.expiresAt, linked: Boolean(link.acceptedAt) } : null;
  },
});

export const createCode = mutation({
  args: {},
  returns: codeResult,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    const existing = await ctx.db.query("familyCodes").withIndex("by_owner", (q) => q.eq("owner", identity.tokenIdentifier)).unique();
    const now = Date.now();
    if (existing && !existing.acceptedAt && existing.expiresAt > now) {
      return { code: existing.code, expiresAt: existing.expiresAt, linked: false };
    }
    // A long random secret avoids guessable short PINs without requiring a shared device.
    const code = crypto.randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase();
    const collision = await ctx.db.query("familyCodes").withIndex("by_code", (q) => q.eq("code", code)).unique();
    if (collision) throw new ConvexError("Please try generating your code again.");
    const fields = { owner: identity.tokenIdentifier, subject: identity.subject, name: identity.name?.slice(0, 100) ?? "Family member", code, createdAt: now, expiresAt: now + CODE_LIFETIME_MS };
    if (existing) await ctx.db.replace(existing._id, fields);
    else await ctx.db.insert("familyCodes", fields);
    return { code, expiresAt: fields.expiresAt, linked: false };
  },
});

export const link = mutation({
  args: { patientId: v.id("patients"), code: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { identity, membership } = await requireMember(ctx, args.patientId, "sharing:manage");
    if (membership.role !== "patient") throw new ConvexError("Only the patient can connect a family member.");
    const code = args.code.replace(/[\s-]/g, "").toUpperCase();
    if (!/^[A-F0-9]{24}$/.test(code)) throw new ConvexError("Check the family code and try again.");
    const invitation = await ctx.db.query("familyCodes").withIndex("by_code", (q) => q.eq("code", code)).unique();
    const now = Date.now();
    if (!invitation || invitation.acceptedAt || invitation.expiresAt <= now) throw new ConvexError("This family code is invalid, expired, or already used.");
    if (invitation.subject === identity.subject) throw new ConvexError("Use a different account for your family member.");
    const existing = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", args.patientId).eq("subject", invitation.subject)).unique();
    if (existing?.active || existing?.role === "patient") throw new ConvexError("This account already has access to your space.");
    const profile = await ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", invitation.subject)).unique();
    const familyProfileId = profile?._id ?? await ctx.db.insert("familyProfiles", {
      subject: invitation.subject, name: invitation.name ?? "Family member", relationship: "Family", voiceState: "not_enrolled", updatedAt: now,
    });
    const person = await ctx.db.query("people").withIndex("by_patient_linked_subject", (q) => q.eq("patientId", args.patientId).eq("linkedSubject", invitation.subject)).unique();
    if (!person) {
      const people = await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", args.patientId)).take(100);
      if (people.length >= 100) throw new ConvexError("Your space has reached its people limit.");
      await ctx.db.insert("people", {
        patientId: args.patientId, name: profile?.name ?? invitation.name ?? "Family member", relationship: profile?.relationship ?? "Family",
        enrollment: "not_enrolled", isPatient: false, linkedSubject: invitation.subject, familyProfileId,
      });
    } else {
      await ctx.db.patch(person._id, { familyProfileId });
    }
    const access = { role: "family" as const, capabilities: ["memories:read"], active: true };
    if (existing) await ctx.db.patch(existing._id, access);
    else await ctx.db.insert("memberships", { patientId: args.patientId, subject: invitation.subject, ...access });
    await ctx.db.patch(invitation._id, { patientId: args.patientId, acceptedAt: now });
    await ctx.db.insert("auditEvents", { patientId: args.patientId, actor: identity.subject, operation: "family.code.linked", target: invitation._id, timestamp: now });
    return null;
  },
});
