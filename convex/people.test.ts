import { describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import { VOICE_MATCHING_POLICY } from "@hale/contracts/voice";
import schema from "./schema";
import * as patients from "./patients";
import * as people from "./people";
import * as conversations from "./conversations";

const app = defineTestApp({ schema }).defineModules({ patients, people, conversations });

async function setup() {
  const t = app.createTest();
  const owner = t.withIdentity({ subject: "patient-owner" });
  const patientId = await owner.mutation(app.api.patients.create, {
    name: "Margaret Okafor", timezone: "UTC", recordingConsent: true,
  });
  return { t, owner, patientId };
}

describe("patient family invitations and voice consent", () => {
  test("acceptance links one family account and grants shared-memory access without recording or deletion capabilities", async () => {
    const { t, owner, patientId } = await setup();
    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Daniel Okafor", relationship: "Son",
    });

    expect(invitation.token).toMatch(/^[\da-f]{64}$/);
    expect(invitation.expiresAt).toBeGreaterThan(Date.now());
    const stored = await t.run((ctx) => ctx.db.get(invitation.invitationId));
    expect(stored?.tokenHash).not.toBe(invitation.token);
    const invitationList = await owner.query(app.api.people.listInvitations, { patientId });
    expect(invitationList).toMatchObject([{ personName: "Daniel Okafor", relationship: "Son", status: "pending" }]);
    expect(JSON.stringify(invitationList)).not.toContain(invitation.token);

    const family = t.withIdentity({ subject: "daniel-account" });
    const accepted = await family.mutation(app.api.people.acceptInvitation, {
      token: invitation.token, useVoiceMatching: true,
    });
    expect(accepted).toMatchObject({ patientId, patientName: "Margaret Okafor", alreadyAccepted: false });
    expect(await family.query(app.api.patients.list)).toHaveLength(1);

    const membership = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "daniel-account"),
    ).unique());
    expect(membership).toMatchObject({ role: "family", active: true, capabilities: ["memories:read"] });

    const directory = await family.query(app.api.people.list, { patientId });
    const daniel = directory.find((person) => person.name === "Daniel Okafor");
    expect(daniel).toMatchObject({ linked: true, isMe: true, voiceState: "not_enrolled" });
    expect(daniel?.voiceConsentAt).toBeGreaterThan(0);
    expect(JSON.stringify(directory)).not.toContain("voiceprint");

    const consent = await t.run((ctx) => ctx.db.query("consents").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "daniel-account"),
    ).collect());
    expect(consent.some((item) => item.purpose === "voice_matching" && item.policyVersion === "voice-matching-2026-10-17-v1")).toBe(true);

    await expect(family.mutation(app.api.people.acceptInvitation, {
      token: invitation.token, useVoiceMatching: true,
    })).resolves.toMatchObject({ alreadyAccepted: true });
    await expect(t.withIdentity({ subject: "another-account" }).mutation(app.api.people.acceptInvitation, {
      token: invitation.token, useVoiceMatching: false,
    })).rejects.toThrow("invalid or expired");
  });

  test("voice matching consent is optional and never implied by joining", async () => {
    const { t, owner, patientId } = await setup();
    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Grace Okafor", relationship: "Sister",
    });
    const family = t.withIdentity({ subject: "grace-account" });
    await family.mutation(app.api.people.acceptInvitation, { token: invitation.token, useVoiceMatching: false });

    const person = (await family.query(app.api.people.list, { patientId })).find((entry) => entry.name === "Grace Okafor");
    expect(person).toMatchObject({ linked: true, voiceConsentAt: null });
    const consents = await t.run((ctx) => ctx.db.query("consents").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "grace-account"),
    ).collect());
    expect(consents.some((item) => item.purpose === "voice_matching")).toBe(false);
  });

  test("a patient can enroll as their own patient person and consent without changing membership", async () => {
    const { t, owner, patientId } = await setup();
    const before = await owner.query(app.api.people.list, { patientId });
    expect(before).toMatchObject([{ name: "Margaret Okafor", relationship: "You · patient", linked: true, isMe: true, voiceState: null }]);

    await owner.mutation(app.api.people.setVoiceMatchingConsent, { patientId, enabled: true });
    const after = await owner.query(app.api.people.list, { patientId });
    expect(after[0]?.voiceConsentAt).toBeGreaterThan(0);

    const membership = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "patient-owner"),
    ).unique());
    expect(membership).toMatchObject({ role: "patient", active: true });
  });

  test("the Android speaker picker exposes the patient only after enrollment and matching consent", async () => {
    const { t, owner, patientId } = await setup();
    await owner.mutation(app.api.people.setVoiceMatchingConsent, { patientId, enabled: true });
    await t.run(async (ctx) => {
      const now = Date.now();
      await ctx.db.insert("familyProfiles", {
        subject: "patient-owner", name: "Margaret Okafor", relationship: "You · patient",
        voiceState: "enrolled", consentAt: now, policyVersion: "test-enrollment-policy",
        voiceprint: "synthetic-test-voiceprint", enrollmentVersion: 1, updatedAt: now,
      });
    });

    const space = await owner.query(app.api.conversations.space, { patientId });
    expect(space.people[0]).toMatchObject({ isMe: true, voiceMatchingConsent: true, voiceMatchingAvailable: true });
  });

  test("a family-entered relationship cannot masquerade as the patient person", async () => {
    const { owner, patientId } = await setup();
    await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Another Person", relationship: "You · patient",
    });
    const directory = await owner.query(app.api.people.list, { patientId });
    expect(directory.filter((person) => person.isPatient)).toHaveLength(1);
    expect(directory.find((person) => person.name === "Another Person")).toMatchObject({ isPatient: false, isMe: false, linked: false, voiceState: null });
  });

  test("the linked family member can withdraw only their own patient-scoped voice consent", async () => {
    const { t, owner, patientId } = await setup();
    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Daniel Okafor", relationship: "Son",
    });
    const family = t.withIdentity({ subject: "daniel-account" });
    await family.mutation(app.api.people.acceptInvitation, { token: invitation.token, useVoiceMatching: true });

    await family.mutation(app.api.people.setVoiceMatchingConsent, { patientId, enabled: false });
    const person = (await family.query(app.api.people.list, { patientId })).find((entry) => entry.name === "Daniel Okafor");
    expect(person?.voiceConsentAt).toBeNull();
    const consent = await t.run((ctx) => ctx.db.query("consents").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "daniel-account"),
    ).collect());
    expect(consent.find((item) => item.purpose === "voice_matching")?.revokedAt).toBeGreaterThan(0);

    await expect(t.withIdentity({ subject: "outsider" }).mutation(app.api.people.setVoiceMatchingConsent, {
      patientId, enabled: true,
    })).rejects.toThrow("permission");
  });

  test("a patient administrator can unlink a family member and revoke only patient-scoped access and consent", async () => {
    const { t, owner, patientId } = await setup();
    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Daniel Okafor", relationship: "Son",
    });
    const family = t.withIdentity({ subject: "daniel-account" });
    await family.mutation(app.api.people.acceptInvitation, { token: invitation.token, useVoiceMatching: true });
    await t.run((ctx) => ctx.db.insert("webNotificationSubscriptions", {
      patientId, subject: "daniel-account", endpoint: "https://fcm.googleapis.com/fcm/send/daniel-device",
      p256dh: "A".repeat(87), auth: "B".repeat(22), createdAt: Date.now(), updatedAt: Date.now(),
    }));
    const contactId = await t.run((ctx) => ctx.db.insert("emergencyContacts", {
      patientId, createdBy: "daniel-account", name: "Daniel's contact", email: "daniel-contact@example.com",
      enabled: true, createdAt: Date.now(),
    }));

    await owner.mutation(app.api.people.unlinkFamilyMember, { patientId, personId: invitation.personId });
    expect(await family.query(app.api.patients.list)).toEqual([]);
    await expect(family.query(app.api.people.list, { patientId })).rejects.toThrow("permission");
    expect(await owner.query(app.api.people.list, { patientId })).toMatchObject([
      { name: "Margaret Okafor", relationship: "You · patient", linked: true, isMe: true },
      { name: "Daniel Okafor", linked: false, voiceConsentAt: null, voiceState: null },
    ]);

    const membership = await t.run((ctx) => ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "daniel-account"),
    ).unique());
    expect(membership).toMatchObject({ role: "family", active: false });
    const consent = await t.run((ctx) => ctx.db.query("consents").withIndex("by_patient_subject", (q) =>
      q.eq("patientId", patientId).eq("subject", "daniel-account"),
    ).collect());
    expect(consent.find((item) => item.purpose === "voice_matching")?.revokedAt).toBeGreaterThan(0);
    expect(await t.run((ctx) => ctx.db.query("webNotificationSubscriptions")
      .withIndex("by_patient_subject", (q) => q.eq("patientId", patientId).eq("subject", "daniel-account")).take(10))).toEqual([]);
    expect(await t.run((ctx) => ctx.db.get(contactId))).toBeNull();
    expect(await t.run((ctx) => ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", "daniel-account")).unique())).not.toBeNull();
    expect(await t.run((ctx) => ctx.db.query("auditEvents").withIndex("by_patient", (q) => q.eq("patientId", patientId)).collect()))
      .toContainEqual(expect.objectContaining({ operation: "family.member.unlinked", target: invitation.personId }));
  });

  test("only a sharing administrator can create or revoke an invitation", async () => {
    const { t, owner, patientId } = await setup();
    await t.run((ctx) => ctx.db.insert("memberships", {
      patientId, subject: "reader-account", role: "family", capabilities: ["memories:read"], active: true,
    }));
    const reader = t.withIdentity({ subject: "reader-account" });
    await expect(reader.mutation(app.api.people.createInvitation, {
      patientId, name: "Someone Else", relationship: "Friend",
    })).rejects.toThrow("permission");
    await expect(reader.query(app.api.people.listInvitations, { patientId })).rejects.toThrow("permission");

    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Ravi Okafor", relationship: "Friend",
    });
    await expect(reader.mutation(app.api.people.unlinkFamilyMember, { patientId, personId: invitation.personId })).rejects.toThrow("permission");
    await expect(reader.mutation(app.api.people.revokeInvitation, { invitationId: invitation.invitationId })).rejects.toThrow("permission");
    await owner.mutation(app.api.people.revokeInvitation, { invitationId: invitation.invitationId });
    expect(await owner.query(app.api.people.listInvitations, { patientId })).toMatchObject([
      { personName: "Ravi Okafor", status: "revoked" },
    ]);
    await expect(t.withIdentity({ subject: "ravi-account" }).mutation(app.api.people.acceptInvitation, {
      token: invitation.token, useVoiceMatching: false,
    })).rejects.toThrow("invalid or expired");
  });

  test("expired invitations and malformed tokens fail closed", async () => {
    const { t, owner, patientId } = await setup();
    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Expired Invitee", relationship: "Friend",
    });
    await t.run((ctx) => ctx.db.patch(invitation.invitationId, { expiresAt: Date.now() - 1 }));
    const family = t.withIdentity({ subject: "expired-account" });
    await expect(family.mutation(app.api.people.acceptInvitation, {
      token: invitation.token, useVoiceMatching: false,
    })).rejects.toThrow("invalid or expired");
    await expect(family.mutation(app.api.people.acceptInvitation, {
      token: "not-a-valid-token", useVoiceMatching: false,
    })).rejects.toThrow("invalid or expired");
    expect(await family.query(app.api.patients.list)).toEqual([]);
  });

  test("a patient person cannot be linked to two family accounts", async () => {
    const { owner, patientId } = await setup();
    const invitation = await owner.mutation(app.api.people.createInvitation, {
      patientId, name: "Shared Person", relationship: "Friend",
    });
    await expect(owner.mutation(app.api.people.acceptInvitation, {
      token: invitation.token, useVoiceMatching: false,
    })).rejects.toThrow("already has access");
  });
});
