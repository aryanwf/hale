import { makeFunctionReference } from "convex/server";
import type { Capability, Conversation, Memory, PatientSpace, RecallAnswer, TranscriptTurn } from "@hale/contracts";
import type { VoiceState } from "@hale/contracts/voice";

export interface PatientInfo { id: string; name: string; timezone: string; capabilities: Capability[] }
export interface FamilyProfile { name: string; relationship: string; voiceState: VoiceState; message?: string }
export interface FamilyCode { code: string; expiresAt: number; linked: boolean }
export interface LiveTranscript {
  conversationId: string | null;
  pending: number;
  failed: number;
  turns: Pick<TranscriptTurn, "id" | "start" | "end" | "text" | "speaker" | "uncertain">[];
}
export const api = {
  accountStatus: makeFunctionReference<"query", Record<string, never>, "signedOut" | "active" | "deleted">("accounts:status"),
  deleteMyData: makeFunctionReference<"mutation", { confirmation: "DELETE" }, { deletedDocuments: number; deletedFiles: number }>("accounts:deleteMyData"),
  deleteMyAccount: makeFunctionReference<"mutation", { confirmation: "DELETE" }, { deletedDocuments: number; deletedFiles: number }>("accounts:deleteMyAccount"),
  familyCode: makeFunctionReference<"query", Record<string, never>, FamilyCode | null>("families:code"),
  createFamilyCode: makeFunctionReference<"mutation", Record<string, never>, FamilyCode>("families:createCode"),
  linkFamily: makeFunctionReference<"mutation", { patientId: string; code: string }, null>("families:link"),
  linkedPeople: makeFunctionReference<"query", { patientId: string }, { id: string; name: string; linked: boolean; isPatient: boolean }[]>("people:list"),
  unlinkFamily: makeFunctionReference<"mutation", { patientId: string; personId: string }, null>("people:unlinkFamilyMember"),
  voiceProfile: makeFunctionReference<"query", Record<string, never>, { configured: boolean; profile: FamilyProfile | null }>("voices:me"),
  saveFamilyProfile: makeFunctionReference<"mutation", { name: string; relationship: string }, null>("voices:saveProfile"),
  skipVoice: makeFunctionReference<"mutation", Record<string, never>, null>("voices:skip"),
  revokeVoice: makeFunctionReference<"mutation", Record<string, never>, null>("voices:revoke"),
  patients: makeFunctionReference<"query", { role: "patient" | "family" }, PatientInfo[]>("patients:listForRole"),
  createPatient: makeFunctionReference<"mutation", { name: string; timezone: string; recordingConsent: boolean }, string>("patients:create"),
  space: makeFunctionReference<"query", { patientId: string }, PatientSpace>("conversations:space"),
  searchConversations: makeFunctionReference<"query", { patientId: string; text: string; day?: string; personId?: string }, { conversations: Conversation[]; limited: boolean }>("conversations:search"),
  recall: makeFunctionReference<"query", { patientId: string; question: string; day?: string }, RecallAnswer>("assistant:recall"),
  detail: makeFunctionReference<"query", { conversationId: string; includeTurns?: boolean }, { patientId: string; conversation: Conversation; memories: Memory[]; turns: TranscriptTurn[] }>("conversations:detail"),
  transcriptPage: makeFunctionReference<"query", { conversationId: string; paginationOpts: { numItems: number; cursor: string | null } }, { page: TranscriptTurn[]; isDone: boolean; continueCursor: string }>("conversations:transcriptPage"),
  deleteConversation: makeFunctionReference<"mutation", { conversationId: string }, null>("privacy:deleteConversation"),
  startRecording: makeFunctionReference<"mutation", { patientId: string; participantsConsented: boolean; captureMode?: "native" | "web"; expectedPeople?: string[]; continuous?: boolean }, string>("recordings:start"),
  liveTranscript: makeFunctionReference<"query", { sessionId: string }, LiveTranscript | null>("recordings:live"),
  recordingState: makeFunctionReference<"mutation", { sessionId: string; state: "recording" | "paused" | "interrupted" | "stopped" }, null>("recordings:setState"),
};
