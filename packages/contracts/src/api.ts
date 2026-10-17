import { makeFunctionReference } from "convex/server";
import type { Capability, Conversation, Memory, PatientSpace, RecallAnswer, TranscriptTurn } from "@hale/contracts";
import type { VoiceState } from "@hale/contracts/voice";

export interface PatientInfo { id: string; name: string; timezone: string; capabilities: Capability[] }
export interface FamilyProfile { name: string; relationship: string; voiceState: VoiceState; message?: string }
export interface FamilyCode { code: string; expiresAt: number; linked: boolean }
export interface CareProposal {
  id: string;
  kind: "appointment" | "urgent";
  priority: "routine" | "urgent";
  status: "needs_review" | "confirmed" | "dismissed" | "resolved";
  title: string;
  summary: string;
  proposedAt: number | null;
  scheduledAt: number | null;
  createdAt: number;
  conversationId: string;
  turnIds: string[];
  sourceText: string;
}
export interface CareContact { id: string; name: string; email: string; enabled: boolean }
export interface CareAlert {
  id: string;
  kind: "urgent" | "appointment_reminder";
  priority: "routine" | "urgent";
  title: string;
  body: string;
  createdAt: number;
  emailStatus: "pending" | "sent" | "skipped" | "failed";
  pushStatus: "pending" | "sent" | "skipped" | "failed";
  acknowledged: boolean;
  conversationId: string | null;
  turnIds: string[];
}
export interface CareDashboard {
  canManage: boolean;
  proposals: CareProposal[];
  appointments: CareProposal[];
  contacts: CareContact[];
  alerts: CareAlert[];
}
export interface PrivacyCenter {
  patient: { id: string; name: string; timezone: string };
  viewer: { role: "patient" | "family"; name: string };
  permissions: { canManagePrivacy: boolean; canManageFamily: boolean; canDeleteRecords: boolean };
  settings: { recordingEnabled: boolean; externalAIEnabled: boolean; retentionDays: 7 | 30 | null; updatedAt: number | null };
  family: { id: string; name: string; relationship: string; role: "patient" | "family"; permissions: string[]; active: boolean }[];
  accessHistory: { id: string; actor: string; operation: string; targetLabel: string; timestamp: number }[];
  recentConversations: { id: string; title: string; startedAt: number; state: "queued" | "processing" | "ready" | "failed" }[];
}
export interface PrivacyExportConversation {
  id: string;
  title: string;
  summary: string;
  startedAt: number;
  duration: number;
  localDate: string;
  people: string[];
  state: "queued" | "processing" | "ready" | "failed";
}
export interface PrivacyExportPage<T> { page: T[]; isDone: boolean; continueCursor: string }
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
  setFamilyCareAccess: makeFunctionReference<"mutation", { patientId: string; personId: string; enabled: boolean }, null>("families:setCareAccess"),
  linkedPeople: makeFunctionReference<"query", { patientId: string }, { id: string; name: string; linked: boolean; isPatient: boolean; careAccess: boolean }[]>("people:list"),
  unlinkFamily: makeFunctionReference<"mutation", { patientId: string; personId: string }, null>("people:unlinkFamilyMember"),
  voiceProfile: makeFunctionReference<"query", Record<string, never>, { configured: boolean; profile: FamilyProfile | null }>("voices:me"),
  saveFamilyProfile: makeFunctionReference<"mutation", { name: string; relationship: string }, null>("voices:saveProfile"),
  skipVoice: makeFunctionReference<"mutation", Record<string, never>, null>("voices:skip"),
  revokeVoice: makeFunctionReference<"mutation", Record<string, never>, null>("voices:revoke"),
  patientSpaces: makeFunctionReference<"query", Record<string, never>, PatientInfo[]>("patients:list"),
  patients: makeFunctionReference<"query", { role: "patient" | "family" }, PatientInfo[]>("patients:listForRole"),
  createPatient: makeFunctionReference<"mutation", { name: string; timezone: string; recordingConsent: boolean; externalAIConsent?: boolean }, string>("patients:create"),
  space: makeFunctionReference<"query", { patientId: string }, PatientSpace>("conversations:space"),
  searchConversations: makeFunctionReference<"query", { patientId: string; text: string; day?: string; personId?: string }, { conversations: Conversation[]; limited: boolean }>("conversations:search"),
  recall: makeFunctionReference<"query", { patientId: string; question: string; day?: string }, RecallAnswer>("assistant:recall"),
  detail: makeFunctionReference<"query", { conversationId: string; includeTurns?: boolean }, { patientId: string; conversation: Conversation; memories: Memory[]; turns: TranscriptTurn[] }>("conversations:detail"),
  transcriptPage: makeFunctionReference<"query", { conversationId: string; paginationOpts: { numItems: number; cursor: string | null } }, { page: TranscriptTurn[]; isDone: boolean; continueCursor: string }>("conversations:transcriptPage"),
  deleteConversation: makeFunctionReference<"mutation", { conversationId: string }, null>("privacy:deleteConversation"),
  startRecording: makeFunctionReference<"mutation", { patientId: string; participantsConsented: boolean; captureMode?: "native" | "web"; expectedPeople?: string[]; continuous?: boolean }, string>("recordings:start"),
  liveTranscript: makeFunctionReference<"query", { sessionId: string }, LiveTranscript | null>("recordings:live"),
  recordingState: makeFunctionReference<"mutation", { sessionId: string; state: "recording" | "paused" | "interrupted" | "stopped" }, null>("recordings:setState"),
  care: {
    dashboard: makeFunctionReference<"query", { patientId: string }, CareDashboard>("care:dashboard"),
    addContact: makeFunctionReference<"mutation", { patientId: string; name: string; email: string }, string>("care:addContact"),
    removeContact: makeFunctionReference<"mutation", { patientId: string; contactId: string }, null>("care:removeContact"),
    reviewProposal: makeFunctionReference<"mutation", { proposalId: string; decision: "confirm" | "dismiss"; scheduledAt?: number }, null>("care:reviewProposal"),
    acknowledgeAlert: makeFunctionReference<"mutation", { alertId: string }, null>("care:acknowledgeAlert"),
    pushConfig: makeFunctionReference<"query", { patientId: string }, { publicKey: string | null; subscribed: boolean }>("care:pushConfig"),
    savePushSubscription: makeFunctionReference<"mutation", { patientId: string; endpoint: string; p256dh: string; auth: string }, null>("care:savePushSubscription"),
    removePushSubscription: makeFunctionReference<"mutation", { patientId: string }, null>("care:removePushSubscription"),
  },
  privacy: {
    center: makeFunctionReference<"query", { patientId: string }, PrivacyCenter>("privacy:center"),
    recordAccess: makeFunctionReference<"mutation", { patientId: string; resource: "privacy_center" | "overview" | "conversations" | "conversation" | "memories" | "family_access" | "care" | "settings"; conversationId?: string }, null>("privacy:recordAccess"),
    setRecordingConsent: makeFunctionReference<"mutation", { patientId: string; enabled: boolean }, null>("privacy:setRecordingConsent"),
    setExternalAIConsent: makeFunctionReference<"mutation", { patientId: string; enabled: boolean }, null>("privacy:setExternalAIConsent"),
    setRetention: makeFunctionReference<"mutation", { patientId: string; retentionDays: 7 | 30 | null }, null>("privacy:setRetention"),
    requestExport: makeFunctionReference<"mutation", { patientId: string }, null>("privacy:requestExport"),
    exportIndex: makeFunctionReference<"query", { patientId: string; paginationOpts: { numItems: number; cursor: string | null } }, { patient: { id: string; name: string; timezone: string }; page: PrivacyExportConversation[]; isDone: boolean; continueCursor: string }>("privacy:exportIndex"),
    exportConversationPage: makeFunctionReference<"query", { conversationId: string; turnsPaginationOpts: { numItems: number; cursor: string | null }; memoriesPaginationOpts: { numItems: number; cursor: string | null } }, {
      conversation: PrivacyExportConversation;
      turns: PrivacyExportPage<{ id: string; speaker: string; personId?: string; start: number; end: number; text: string; uncertain: boolean }>;
      memories: PrivacyExportPage<{ id: string; kind: string; title: string; text: string; localDate: string; plannedFor?: string; occurredAt?: string; turnIds: string[]; people: string[] }>;
    }>("privacy:exportConversationPage"),
  },
};
