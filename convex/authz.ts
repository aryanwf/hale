import { ConvexError, type GenericId } from "convex/values";
import type { Capability } from "@hale/contracts";
import type { QueryCtx } from "./lib/functions";

const DELETED_ACCOUNT_MESSAGE = "Your Hale account was deleted. Finish deleting your sign-in account or create a new account.";
export const EXTERNAL_AI_POLICY_VERSION = "2026-10-17-external-ai-v1";

export async function hashIdentity(tokenIdentifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(tokenIdentifier));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getAccountStatus(ctx: Pick<QueryCtx, "auth" | "db">) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return { status: "signedOut" as const };
  const identityHash = await hashIdentity(identity.tokenIdentifier);
  const deleted = await ctx.db.query("deletedAccounts").withIndex("by_identityHash", (q) => q.eq("identityHash", identityHash)).unique();
  if (deleted) return { status: "deleted" as const };
  return { status: "active" as const, identity };
}

export async function requireIdentity(ctx: Pick<QueryCtx, "auth" | "db">) {
  const account = await getAccountStatus(ctx);
  if (account.status === "signedOut") throw new ConvexError("Please sign in.");
  if (account.status === "deleted") throw new ConvexError(DELETED_ACCOUNT_MESSAGE);
  return account.identity;
}

export async function requireMember(ctx: QueryCtx, patientId: GenericId<"patients">, capability: Capability) {
  const identity = await requireIdentity(ctx);
  const membership = await ctx.db.query("memberships").withIndex("by_patient_subject", (q) =>
    q.eq("patientId", patientId).eq("subject", identity.subject),
  ).unique();
  if (!membership?.active || !membership.capabilities.includes(capability)) {
    throw new ConvexError("You don’t have permission to access this patient space.");
  }
  const patient = await ctx.db.get(patientId);
  if (!patient) throw new ConvexError("Patient space unavailable.");
  return { identity, membership, patient };
}

export async function requireRecordingConsent(ctx: QueryCtx, patientId: GenericId<"patients">, subject: string, sessionConsentAt?: number) {
  const consents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
    q.eq("patientId", patientId).eq("subject", subject).eq("purpose", "recording"),
  ).order("desc").take(100);
  if (!consents.some((consent) => !consent.revokedAt && (sessionConsentAt === undefined || consent.grantedAt <= sessionConsentAt))) {
    throw new ConvexError("Recording consent is required.");
  }
}

export async function hasActiveConsent(
  ctx: QueryCtx,
  patientId: GenericId<"patients">,
  subject: string,
  purpose: string,
): Promise<boolean> {
  const consents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
    q.eq("patientId", patientId).eq("subject", subject).eq("purpose", purpose),
  ).order("desc").take(100);
  return consents.some((consent) => !consent.revokedAt);
}

export async function hasExternalAIConsent(ctx: QueryCtx, patientId: GenericId<"patients">): Promise<boolean> {
  const patient = await ctx.db.get(patientId);
  if (!patient) return false;
  const consents = await ctx.db.query("consents").withIndex("by_patient_subject_purpose", (q) =>
    q.eq("patientId", patientId).eq("subject", patient.createdBy).eq("purpose", "external_ai"),
  ).order("desc").take(100);
  return consents.some((consent) => !consent.revokedAt && consent.policyVersion === EXTERNAL_AI_POLICY_VERSION);
}
