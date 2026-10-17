import { ConvexError, v, type GenericId } from "convex/values";
import { getAccountStatus, hashIdentity, requireIdentity } from "./authz";
import { internalMutation, mutation, query, type MutationCtx } from "./lib/functions";
import type { Doc, TableNames } from "./_generated/dataModel";

const MAX_ACCOUNT_DOCUMENTS = 1_000;
const READ_LIMIT = MAX_ACCOUNT_DOCUMENTS + 1;
const resultValidator = v.object({ deletedDocuments: v.number(), deletedFiles: v.number() });
const accountStatusValidator = v.union(v.literal("signedOut"), v.literal("active"), v.literal("deleted"));

type DeletionDocument = { _id: GenericId<TableNames>; storageId?: GenericId<"_storage"> };

async function eraseAccountData(ctx: MutationCtx, subject: string) {
  const documents = new Map<string, DeletionDocument>();
  const relatedDocuments = new Set<string>();
  function trackRelated(rows: { _id: string }[]) {
    for (const row of rows) relatedDocuments.add(row._id);
    if (relatedDocuments.size > MAX_ACCOUNT_DOCUMENTS) {
      throw new ConvexError("This account needs assisted deletion because of its size. No data has been deleted. Contact support.");
    }
  }
  function remove(rows: DeletionDocument[]) {
    trackRelated(rows);
    for (const row of rows) documents.set(row._id, row);
  }

  const patients = await ctx.db.query("patients").withIndex("by_createdBy", (q) => q.eq("createdBy", subject)).take(READ_LIMIT);
  remove(patients);
  const patientIds = new Set(patients.map((patient) => patient._id));
  const profiles = await ctx.db.query("familyProfiles").withIndex("by_subject", (q) => q.eq("subject", subject)).take(READ_LIMIT);
  remove(profiles);
  remove(await ctx.db.query("familyCodes").withIndex("by_subject", (q) => q.eq("subject", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("memberships").withIndex("by_subject", (q) => q.eq("subject", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("consents").withIndex("by_subject", (q) => q.eq("subject", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("auditEvents").withIndex("by_actor", (q) => q.eq("actor", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("patientInvitations").withIndex("by_createdBy", (q) => q.eq("createdBy", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("patientInvitations").withIndex("by_acceptedBy", (q) => q.eq("acceptedBy", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("familySummaryPreferences").withIndex("by_subject", (q) => q.eq("subject", subject)).take(READ_LIMIT));
  remove(await ctx.db.query("familySummaryDeliveries").withIndex("by_recipient_subject", (q) => q.eq("recipientSubject", subject)).take(READ_LIMIT));

  const linkedPeople = new Map<string, Doc<"people">>();
  const people = await ctx.db.query("people").withIndex("by_linkedSubject", (q) => q.eq("linkedSubject", subject)).take(READ_LIMIT);
  remove(people);
  for (const person of people) linkedPeople.set(person._id, person);
  for (const profile of profiles) {
    const matches = await ctx.db.query("people").withIndex("by_familyProfileId", (q) => q.eq("familyProfileId", profile._id)).take(READ_LIMIT);
    remove(matches);
    for (const person of matches) linkedPeople.set(person._id, person);
  }

  for (const patient of patients) {
    const patientId = patient._id;
    remove(await ctx.db.query("memberships").withIndex("by_patient_subject", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("consents").withIndex("by_patient_subject", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("people").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("patientInvitations").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("familyCodes").withIndex("by_patientId", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("recordingSessions").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("audioChunks").withIndex("by_patientId", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("processingJobs").withIndex("by_patientId", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("conversations").withIndex("by_patient_date", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("transcriptTurns").withIndex("by_patientId", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("memories").withIndex("by_patient_date", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("familySummaries").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("familySummaryPreferences").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("familySummaryDeliveries").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
    remove(await ctx.db.query("auditEvents").withIndex("by_patient", (q) => q.eq("patientId", patientId)).take(READ_LIMIT));
  }

  const anonymizeTurns = new Map<string, Doc<"transcriptTurns">>();
  const sharedPatientIds = new Set<GenericId<"patients">>();
  for (const person of linkedPeople.values()) {
    if (patientIds.has(person.patientId)) continue;
    sharedPatientIds.add(person.patientId);
    remove(await ctx.db.query("patientInvitations").withIndex("by_personId", (q) => q.eq("personId", person._id)).take(READ_LIMIT));
    const turns = await ctx.db.query("transcriptTurns").withIndex("by_personId", (q) => q.eq("personId", person._id)).take(READ_LIMIT);
    trackRelated(turns);
    for (const turn of turns) anonymizeTurns.set(turn._id, turn);
  }
  const conversations: Doc<"conversations">[] = [];
  const memories: Doc<"memories">[] = [];
  for (const patientId of sharedPatientIds) {
    const patientConversations = await ctx.db.query("conversations").withIndex("by_patient_date", (q) => q.eq("patientId", patientId)).take(READ_LIMIT);
    const patientMemories = await ctx.db.query("memories").withIndex("by_patient_date", (q) => q.eq("patientId", patientId)).take(READ_LIMIT);
    trackRelated(patientConversations);
    trackRelated(patientMemories);
    conversations.push(...patientConversations.filter((conversation) => conversation.people.some((id) => linkedPeople.has(id))));
    memories.push(...patientMemories.filter((memory) => memory.people.some((id) => linkedPeople.has(id))));
  }

  // Finish the bounded preflight before making any change; oversized accounts roll back intact.
  for (const turn of anonymizeTurns.values()) await ctx.db.patch(turn._id, { personId: undefined, speaker: "Unknown speaker", uncertain: true });
  for (const conversation of conversations) await ctx.db.patch(conversation._id, { people: conversation.people.filter((id) => !linkedPeople.has(id)) });
  for (const memory of memories) await ctx.db.patch(memory._id, { people: memory.people.filter((id) => !linkedPeople.has(id)) });
  const files = new Set([...documents.values()].flatMap((document) => document.storageId ? [document.storageId] : []));
  for (const storageId of files) await ctx.storage.delete(storageId);
  for (const document of documents.values()) await ctx.db.delete(document._id);
  return { deletedDocuments: documents.size, deletedFiles: files.size };
}

export const status = query({
  args: {},
  returns: accountStatusValidator,
  handler: async (ctx) => (await getAccountStatus(ctx)).status,
});

export const deleteMyData = mutation({
  args: { confirmation: v.literal("DELETE") },
  returns: resultValidator,
  handler: async (ctx) => {
    const identity = await requireIdentity(ctx);
    return eraseAccountData(ctx, identity.subject);
  },
});

export const deleteMyAccount = mutation({
  args: { confirmation: v.literal("DELETE") },
  returns: resultValidator,
  handler: async (ctx) => {
    // Retry must work after the tombstone has blocked ordinary account access.
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError("Please sign in.");
    const result = await eraseAccountData(ctx, identity.subject);
    const identityHash = await hashIdentity(identity.tokenIdentifier);
    const deleted = await ctx.db.query("deletedAccounts").withIndex("by_identityHash", (q) => q.eq("identityHash", identityHash)).unique();
    if (!deleted) await ctx.db.insert("deletedAccounts", { identityHash });
    return result;
  },
});

export const deleteDataForSubject = internalMutation({
  args: { subject: v.string(), confirmation: v.literal("DELETE") },
  returns: resultValidator,
  handler: async (ctx, { subject }) => {
    if (!subject.startsWith("user_") || subject.length > 100) throw new ConvexError("Supply an exact Clerk user ID, not a name or email search.");
    return eraseAccountData(ctx, subject);
  },
});
