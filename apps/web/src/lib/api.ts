import { makeFunctionReference } from "convex/server";
import type { Capability, Conversation, Memory, PatientSpace, RecallAnswer, TranscriptTurn } from "@hale/contracts";
import type { VoiceState } from "@hale/contracts/voice";

export interface PatientInfo { id: string; name: string; timezone: string; capabilities: Capability[] }
export interface FamilyProfile { name: string; relationship: string; voiceState: VoiceState; message?: string }
export interface PatientPerson {
  id: string;
  name: string;
  relationship: string;
  isPatient: boolean;
  enrollment: "not_enrolled" | "enrolled" | "revoked";
  linked: boolean;
  isMe: boolean;
  voiceState: VoiceState | null;
  voiceConsentAt: number | null;
}
export interface InvitationPreview { patientName: string; personName: string; relationship: string; expiresAt: number }
export interface PatientInvitation {
  id: string;
  personName: string;
  relationship: string;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "accepted" | "expired" | "revoked";
}
export const api = {
  voiceProfile: makeFunctionReference<"query", Record<string, never>, { configured: boolean; profile: FamilyProfile | null }>("voices:me"),
  saveFamilyProfile: makeFunctionReference<"mutation", { name: string; relationship: string }, null>("voices:saveProfile"),
  skipVoice: makeFunctionReference<"mutation", Record<string, never>, null>("voices:skip"),
  revokeVoice: makeFunctionReference<"mutation", Record<string, never>, null>("voices:revoke"),
  patients: makeFunctionReference<"query", Record<string, never>, PatientInfo[]>("patients:list"),
  createPatient: makeFunctionReference<"mutation", { name: string; timezone: string; recordingConsent: boolean }, string>("patients:create"),
  space: makeFunctionReference<"query", { patientId: string }, PatientSpace>("conversations:space"),
  searchConversations: makeFunctionReference<"query", { patientId: string; text: string; day?: string; personId?: string }, { conversations: Conversation[]; limited: boolean }>("conversations:search"),
  recall: makeFunctionReference<"query", { patientId: string; question: string; day?: string }, RecallAnswer>("assistant:recall"),
  speakAnswer: makeFunctionReference<"action", { patientId: string; question: string; day?: string; languageCode: string }, { url: string; expiresAt: number }>("assistant:speakAnswer"),
  detail: makeFunctionReference<"query", { conversationId: string }, { patientId: string; conversation: Conversation; memories: Memory[]; turns: TranscriptTurn[]; audioUrl: string | null }>("conversations:detail"),
  deleteConversation: makeFunctionReference<"mutation", { conversationId: string }, null>("privacy:deleteConversation"),
  retryTranscription: makeFunctionReference<"mutation", { conversationId: string }, null>("transcriptions:retry"),
  startRecording: makeFunctionReference<"mutation", { patientId: string; participantsConsented: boolean }, string>("recordings:start"),
  recordingState: makeFunctionReference<"mutation", { sessionId: string; state: "recording" | "paused" | "interrupted" | "stopped" }, null>("recordings:setState"),
  patientPeople: makeFunctionReference<"query", { patientId: string }, PatientPerson[]>("people:list"),
  createPatientInvitation: makeFunctionReference<"mutation", { patientId: string; name: string; relationship: string }, { invitationId: string; personId: string; patientName: string; token: string; expiresAt: number }>("people:createInvitation"),
  patientInvitations: makeFunctionReference<"query", { patientId: string }, PatientInvitation[]>("people:listInvitations"),
  revokePatientInvitation: makeFunctionReference<"mutation", { invitationId: string }, null>("people:revokeInvitation"),
  unlinkPatientPerson: makeFunctionReference<"mutation", { patientId: string; personId: string }, null>("people:unlinkFamilyMember"),
  previewPatientInvitation: makeFunctionReference<"query", { token: string }, InvitationPreview | null>("people:previewInvitation"),
  acceptPatientInvitation: makeFunctionReference<"mutation", { token: string; useVoiceMatching: boolean }, { patientId: string; patientName?: string; alreadyAccepted: boolean }>("people:acceptInvitation"),
  setVoiceMatchingConsent: makeFunctionReference<"mutation", { patientId: string; enabled: boolean }, null>("people:setVoiceMatchingConsent"),
};
