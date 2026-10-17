import { describe, expect, test } from "bun:test";
import { defineTestApp } from "convex-test";
import schema from "./schema";
import * as families from "./families";
import * as patients from "./patients";
import * as people from "./people";
import * as recordings from "./recordings";
import * as conversations from "./conversations";

const app = defineTestApp({ schema }).defineModules({ families, patients, people, recordings, conversations });

async function setup() {
  const t = app.createTest();
  const patient = t.withIdentity({ subject: "patient" });
  const family = t.withIdentity({ subject: "family" });
  const patientId = await patient.mutation(app.api.patients.create, { name: "Margaret", timezone: "UTC", recordingConsent: true });
  const invitation = await family.mutation(app.api.families.createCode, {});
  return { t, patient, family, patientId, invitation };
}

describe("family dashboard to Android bridge", () => {
  test("signup gets a private code without creating a patient space", async () => {
    const { family } = await setup();
    expect(await family.query(app.api.patients.list)).toEqual([]);
  });

  test("repeated generation keeps an unused code stable", async () => {
    const { family, invitation } = await setup();
    expect(await family.mutation(app.api.families.createCode, {})).toEqual(invitation);
  });

  test("other accounts cannot read a family code", async () => {
    const { t } = await setup();
    expect(await t.withIdentity({ subject: "outsider" }).query(app.api.families.code, {})).toBeNull();
  });

  test("patient enters a formatted code to grant shared-memory access without recording privileges", async () => {
    const { patient, family, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: ` ${invitation.code.match(/.{1,4}/g)?.join("-").toLowerCase()} ` });
    expect(await family.query(app.api.patients.listForRole, { role: "family" })).toMatchObject([{ id: patientId, capabilities: ["memories:read"] }]);
    expect((await patient.query(app.api.people.list, { patientId })).find((person) => person.linked && !person.isPatient)?.careAccess).toBe(false);
  });

  test("patient can separately enable and revoke family Care controls", async () => {
    const { t, patient, family, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: invitation.code });
    const person = (await patient.query(app.api.people.list, { patientId })).find((item) => item.linked && !item.isPatient)!;
    expect(person.careAccess).toBe(false);
    await expect(t.withIdentity({ subject: "outsider" }).mutation(app.api.families.setCareAccess, {
      patientId, personId: person.id, enabled: true,
    })).rejects.toThrow("permission");

    await patient.mutation(app.api.families.setCareAccess, { patientId, personId: person.id, enabled: true });
    expect((await patient.query(app.api.people.list, { patientId })).find((item) => item.id === person.id)?.careAccess).toBe(true);
    expect(await family.query(app.api.patients.listForRole, { role: "family" })).toMatchObject([
      { id: patientId, capabilities: ["memories:read", "care:manage"] },
    ]);

    await patient.mutation(app.api.families.setCareAccess, { patientId, personId: person.id, enabled: false });
    expect((await patient.query(app.api.people.list, { patientId })).find((item) => item.id === person.id)?.careAccess).toBe(false);
    expect(await family.query(app.api.patients.listForRole, { role: "family" })).toMatchObject([
      { id: patientId, capabilities: ["memories:read"] },
    ]);
  });

  test("patient memberships never appear as family dashboard spaces", async () => {
    const { patient } = await setup();
    expect(await patient.query(app.api.patients.listForRole, { role: "family" })).toEqual([]);
  });

  test("the linked family dashboard can read the patient's actual space", async () => {
    const { patient, family, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: invitation.code });
    expect(await family.query(app.api.conversations.space, { patientId })).toMatchObject({ id: patientId, name: "Margaret" });
  });

  test("a family code alone cannot read any patient data", async () => {
    const { family, patientId } = await setup();
    await expect(family.query(app.api.conversations.space, { patientId })).rejects.toThrow("permission");
  });

  test("revoking the family link blocks patient data immediately", async () => {
    const { patient, family, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: invitation.code });
    const directory = await patient.query(app.api.people.list, { patientId });
    const member = directory.find((person) => person.linked && !person.isPatient)!;
    await patient.mutation(app.api.people.unlinkFamilyMember, { patientId, personId: member.id });
    await expect(family.query(app.api.conversations.space, { patientId })).rejects.toThrow("permission");
  });

  test("a code can only be used once", async () => {
    const { patient, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: invitation.code });
    await expect(patient.mutation(app.api.families.link, { patientId, code: invitation.code })).rejects.toThrow("already used");
  });

  test("an expired code is rejected", async () => {
    const { t, patient, patientId, invitation } = await setup();
    await t.run(async (ctx) => {
      const code = await ctx.db.query("familyCodes").withIndex("by_code", (q) => q.eq("code", invitation.code)).unique();
      await ctx.db.patch(code!._id, { expiresAt: 0 });
    });
    await expect(patient.mutation(app.api.families.link, { patientId, code: invitation.code })).rejects.toThrow("expired");
  });

  test("a non-member cannot link a code to another patient's space", async () => {
    const { t, patientId, invitation } = await setup();
    await expect(t.withIdentity({ subject: "outsider" }).mutation(app.api.families.link, { patientId, code: invitation.code })).rejects.toThrow("permission");
  });

  test("a patient cannot link their own family code", async () => {
    const { patient, patientId } = await setup();
    const invitation = await patient.mutation(app.api.families.createCode, {});
    await expect(patient.mutation(app.api.families.link, { patientId, code: invitation.code })).rejects.toThrow("different account");
  });

  test("family access cannot start recordings", async () => {
    const { patient, family, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: invitation.code });
    await expect(family.mutation(app.api.recordings.start, { patientId, participantsConsented: true })).rejects.toThrow("permission");
  });

  test("patient can revoke the linked dashboard's access", async () => {
    const { patient, family, patientId, invitation } = await setup();
    await patient.mutation(app.api.families.link, { patientId, code: invitation.code });
    const directory = await patient.query(app.api.people.list, { patientId });
    const member = directory.find((person) => person.linked && !person.isPatient)!;
    await patient.mutation(app.api.people.unlinkFamilyMember, { patientId, personId: member.id });
    expect(await family.query(app.api.patients.listForRole, { role: "family" })).toEqual([]);
  });

  test("unauthenticated users cannot generate codes", async () => {
    const t = app.createTest();
    await expect(t.mutation(app.api.families.createCode, {})).rejects.toThrow("sign in");
  });
});
