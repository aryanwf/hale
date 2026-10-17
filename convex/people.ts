import { ConvexError, v } from "convex/values";
import { VOICE_MATCHING_POLICY } from "@hale/contracts/voice";
import { mutation, query } from "./lib/functions";
import { requireIdentity, requireMember } from "./authz";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FAMILY_READ_CAPABILITIES = ["memories:read"];

async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createToken() {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

export const list = query({
  args: { patientId: v.id("patients") },
  handler: async (ctx, { patientId }) => {
    const { identity, membership } = await requireMember(ctx, patientId, "memories:read");
    const people = await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100);
    const patientProfile = membership.role === "patient"
      ? await ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", identity.subject)).unique()
      : null;
    return Promise.all(people.map(async (person) => {
      const isPatient = person.isPatient ?? (person.relationship === "You · patient" && !person.linkedSubject);
      const isPatientSelf = membership.role === "patient" && isPatient;
      const profile = isPatientSelf
        ? patientProfile
        : person.familyProfileId ? await ctx.db.get(person.familyProfileId) : null;
      const isLinked = Boolean(person.linkedSubject && profile?.subject === person.linkedSubject);
      const linkedMembership = membership.role === "patient" && person.linkedSubject
        ? await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
          q.eq("patientId", patientId).eq("subject", person.linkedSubject!),
        ).unique()
        : null;
      return {
        id: person._id,
        name: person.name,
        relationship: person.relationship,
        isPatient,
        enrollment: profile?.voiceState === "enrolled" ? "enrolled" as const
          : profile?.voiceState === "revoked" ? "revoked" as const
          : person.enrollment,
        linked: isLinked || isPatientSelf,
        isMe: person.linkedSubject === identity.subject || isPatientSelf,
        careAccess: Boolean(isLinked && linkedMembership?.active && linkedMembership.capabilities.includes("care:manage")),
        voiceState: (isLinked || isPatientSelf) ? profile?.voiceState ?? null : null,
        voiceConsentAt: person.voiceConsentAt ?? null,
      };
    }));
  },
});

export const createInvitation = mutation({
  args: { patientId: v.id("patients"), name: v.string(), relationship: v.string() },
  handler: async (ctx, args) => {
    const { identity, patient } = await requireMember(ctx, args.patientId, "sharing:manage");
    const name = args.name.trim();
    const relationship = args.relationship.trim();
    if (name.length < 2 || name.length > 100 || relationship.length < 2 || relationship.length > 80) {
      throw new ConvexError("Enter a name and relationship for this person.");
    }

    const people = await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", args.patientId)).take(100);
    if (people.length >= 100) throw new ConvexError("This patient space has reached its people limit.");

    const now = Date.now();
    const personId = await ctx.db.insert("people", {
      patientId: args.patientId,
      name,
      relationship,
      enrollment: "not_enrolled",
      isPatient: false,
    });
    const token = createToken();
    const invitationId = await ctx.db.insert("patientInvitations", {
      patientId: args.patientId,
      personId,
      tokenHash: await hashToken(token),
      createdBy: identity.subject,
      createdAt: now,
      expiresAt: now + INVITATION_TTL_MS,
    });
    await ctx.db.insert("auditEvents", {
      patientId: args.patientId,
      actor: identity.subject,
      operation: "family.invitation.created",
      target: invitationId,
      timestamp: now,
    });
    return { invitationId, personId, patientName: patient.name, token, expiresAt: now + INVITATION_TTL_MS };
  },
});

export const listInvitations = query({
  args: { patientId: v.id("patients") },
  handler: async (ctx, { patientId }) => {
    await requireMember(ctx, patientId, "sharing:manage");
    const invitations = await ctx.db.query("patientInvitations")
      .withIndex("by_patient", (q) => q.eq("patientId", patientId))
      .order("desc")
      .take(50);
    return Promise.all(invitations.map(async (invitation) => {
      const person = await ctx.db.get(invitation.personId);
      return {
        id: invitation._id,
        personName: person?.name ?? "Unavailable person",
        relationship: person?.relationship ?? "",
        createdAt: invitation.createdAt,
        expiresAt: invitation.expiresAt,
        status: invitation.acceptedAt ? "accepted" as const
          : invitation.revokedAt ? "revoked" as const
          : "pending" as const,
      };
    }));
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("patientInvitations") },
  handler: async (ctx, { invitationId }) => {
    const invitation = await ctx.db.get(invitationId);
    if (!invitation) throw new ConvexError("Invitation unavailable.");
    const { identity } = await requireMember(ctx, invitation.patientId, "sharing:manage");
    if (invitation.acceptedAt) throw new ConvexError("This invitation has already been accepted.");
    if (invitation.revokedAt) return null;
    await ctx.db.patch(invitationId, { revokedAt: Date.now() });
    await ctx.db.insert("auditEvents", {
      patientId: invitation.patientId,
      actor: identity.subject,
      operation: "family.invitation.revoked",
      target: invitationId,
      timestamp: Date.now(),
    });
    return null;
  },
});

export const previewInvitation = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    await requireIdentity(ctx);
    if (token.length !== 64 || !/^[\da-f]+$/i.test(token)) return null;
    const tokenHash = await hashToken(token);
    const invitation = await ctx.db.query("patientInvitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!invitation || invitation.acceptedAt || invitation.revokedAt) return null;
    const [patient, person] = await Promise.all([ctx.db.get(invitation.patientId), ctx.db.get(invitation.personId)]);
    if (!patient || !person || person.patientId !== patient._id) return null;
    return { patientName: patient.name, personName: person.name, relationship: person.relationship, expiresAt: invitation.expiresAt };
  },
});

export const setVoiceMatchingConsent = mutation({
  args: { patientId: v.id("patients"), enabled: v.boolean() },
  handler: async (ctx, { patientId, enabled }) => {
    const { identity, membership } = await requireMember(ctx, patientId, "memories:read");
    let person = await ctx.db.query("people")
      .withIndex("by_patient_linked_subject", (q) => q.eq("patientId", patientId).eq("linkedSubject", identity.subject))
      .unique();
    if (!person && membership.role === "patient") {
      person = (await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(100))
        .find((candidate) => candidate.relationship === "You · patient") ?? null;
    }
    if (!person) throw new ConvexError("Your family profile is not linked to this patient space.");

    const now = Date.now();
    const recentConsents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
      q.eq("patientId", patientId).eq("subject", identity.subject).eq("purpose", "voice_matching"),
    ).order("desc").take(100);
    const active = recentConsents.filter((consent) => !consent.revokedAt);
    if (enabled) {
      await ctx.db.patch(person._id, { voiceConsentAt: now, voiceConsentPolicy: VOICE_MATCHING_POLICY });
      if (!active.some((consent) => consent.policyVersion === VOICE_MATCHING_POLICY)) {
        for (const consent of active) await ctx.db.patch(consent._id, { revokedAt: now });
        await ctx.db.insert("consents", {
          patientId,
          subject: identity.subject,
          purpose: "voice_matching",
          policyVersion: VOICE_MATCHING_POLICY,
          grantedAt: now,
        });
      }
    } else {
      await ctx.db.patch(person._id, { voiceConsentAt: undefined, voiceConsentPolicy: undefined });
      for (const consent of active) await ctx.db.patch(consent._id, { revokedAt: now });
    }

    await ctx.db.insert("auditEvents", {
      patientId,
      actor: identity.subject,
      operation: enabled ? "voice_matching.consent_granted" : "voice_matching.consent_revoked",
      target: person._id,
      timestamp: now,
    });
    return null;
  },
});

export const unlinkFamilyMember = mutation({
  args: { patientId: v.id("patients"), personId: v.id("people") },
  handler: async (ctx, { patientId, personId }) => {
    const { identity } = await requireMember(ctx, patientId, "sharing:manage");
    const person = await ctx.db.get(personId);
    if (!person || person.patientId !== patientId || !person.linkedSubject) {
      throw new ConvexError("This family link is unavailable.");
    }
    if (person.linkedSubject === identity.subject) {
      throw new ConvexError("Ask another patient-space administrator to remove your access.");
    }

    const membership = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", person.linkedSubject!),
    ).unique();
    if (membership?.role === "patient") throw new ConvexError("Patient access cannot be removed through a family link.");

    const now = Date.now();
    if (membership?.active) await ctx.db.patch(membership._id, { active: false });
    const subscriptions = await ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", person.linkedSubject!))
      .take(10);
    for (const subscription of subscriptions) await ctx.db.delete(subscription._id);
    const careContacts = await ctx.db.query("emergencyContacts")
      .withIndex("by_patient_createdBy", (q) => q.eq("patientId", patientId).eq("createdBy", person.linkedSubject!))
      .take(20);
    for (const contact of careContacts) await ctx.db.delete(contact._id);
    const recentConsents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
      q.eq("patientId", patientId).eq("subject", person.linkedSubject!).eq("purpose", "voice_matching"),
    ).order("desc").take(100);
    for (const consent of recentConsents) {
      if (!consent.revokedAt) await ctx.db.patch(consent._id, { revokedAt: now });
    }

    await ctx.db.patch(personId, {
      linkedSubject: undefined,
      familyProfileId: undefined,
      voiceConsentAt: undefined,
      voiceConsentPolicy: undefined,
    });
    await ctx.db.insert("auditEvents", {
      patientId,
      actor: identity.subject,
      operation: "family.member.unlinked",
      target: personId,
      timestamp: now,
    });
    return null;
  },
});

export const acceptInvitation = mutation({
  args: { token: v.string(), useVoiceMatching: v.boolean() },
  handler: async (ctx, { token, useVoiceMatching }) => {
    if (token.length !== 64 || !/^[\da-f]+$/i.test(token)) throw new ConvexError("This invitation is invalid or expired.");
    const identity = await requireIdentity(ctx);
    const tokenHash = await hashToken(token);
    const invitation = await ctx.db.query("patientInvitations")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();

    if (!invitation) throw new ConvexError("This invitation is invalid or expired.");
    if (invitation.acceptedAt && invitation.acceptedBy === identity.subject) {
      return { patientId: invitation.patientId, alreadyAccepted: true };
    }
    const now = Date.now();
    if (invitation.revokedAt || invitation.acceptedAt || invitation.expiresAt <= now) {
      throw new ConvexError("This invitation is invalid or expired.");
    }

    const patient = await ctx.db.get(invitation.patientId);
    const person = await ctx.db.get(invitation.personId);
    if (!patient || !person || person.patientId !== invitation.patientId || (person.linkedSubject && person.linkedSubject !== identity.subject)) {
      throw new ConvexError("This invitation is invalid or expired.");
    }

    const existingLink = await ctx.db.query("people")
      .withIndex("by_patient_linked_subject", (q) => q.eq("patientId", invitation.patientId).eq("linkedSubject", identity.subject))
      .unique();
    if (existingLink && existingLink._id !== person._id) throw new ConvexError("Your account is already linked to someone in this patient space.");

    const existingMembership = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", invitation.patientId).eq("subject", identity.subject),
    ).unique();
    if (existingMembership?.active) throw new ConvexError("Your account already has access to this patient space.");
    if (existingMembership?.role === "patient") throw new ConvexError("This invitation cannot change the patient account.");

    const profile = await ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", identity.subject)).unique();
    const familyProfileId = profile?._id ?? await ctx.db.insert("familyProfiles", {
      subject: identity.subject,
      name: person.name,
      relationship: person.relationship,
      voiceState: "not_enrolled",
      updatedAt: now,
    });

    const recentVoiceConsents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
      q.eq("patientId", invitation.patientId).eq("subject", identity.subject).eq("purpose", "voice_matching"),
    ).order("desc").take(100);
    const activeVoiceConsents = recentVoiceConsents.filter((consent) => !consent.revokedAt);

    if (existingMembership) {
      await ctx.db.patch(existingMembership._id, { role: "family", capabilities: FAMILY_READ_CAPABILITIES, active: true });
    } else {
      await ctx.db.insert("memberships", {
        patientId: invitation.patientId,
        subject: identity.subject,
        role: "family",
        capabilities: FAMILY_READ_CAPABILITIES,
        active: true,
      });
    }

    await ctx.db.patch(person._id, {
      linkedSubject: identity.subject,
      familyProfileId,
      enrollment: profile?.voiceState === "enrolled" ? "enrolled" : profile?.voiceState === "revoked" ? "revoked" : "not_enrolled",
      voiceConsentAt: useVoiceMatching ? now : undefined,
      voiceConsentPolicy: useVoiceMatching ? VOICE_MATCHING_POLICY : undefined,
    });
    if (useVoiceMatching) {
      if (!activeVoiceConsents.some((consent) => consent.policyVersion === VOICE_MATCHING_POLICY)) {
        for (const consent of activeVoiceConsents) await ctx.db.patch(consent._id, { revokedAt: now });
        await ctx.db.insert("consents", {
          patientId: invitation.patientId,
          subject: identity.subject,
          purpose: "voice_matching",
          policyVersion: VOICE_MATCHING_POLICY,
          grantedAt: now,
        });
      }
    } else {
      for (const consent of activeVoiceConsents) await ctx.db.patch(consent._id, { revokedAt: now });
    }

    await ctx.db.patch(invitation._id, { acceptedBy: identity.subject, acceptedAt: now });
    await ctx.db.insert("auditEvents", {
      patientId: invitation.patientId,
      actor: identity.subject,
      operation: "family.invitation.accepted",
      target: invitation._id,
      timestamp: now,
    });
    return { patientId: invitation.patientId, patientName: patient.name, alreadyAccepted: false };
  },
});
