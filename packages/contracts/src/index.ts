export const CONTRACT_VERSION = 1 as const;

export type Capability =
  | "memories:read"
  | "recordings:create"
  | "evidence:delete"
  | "people:manage"
  | "sharing:manage"
  | "rides:prepare"
  | "appointments:book"
  | "medications:read"
  | "medications:record";

export type MemoryKind = "reported_activity" | "plan" | "personal_fact" | "conversation_topic";
export type ProcessingState = "queued" | "processing" | "ready" | "failed";

export interface Person {
  id: string;
  name: string;
  relationship: string;
  initials: string;
  enrollment: "not_enrolled" | "enrolled" | "revoked";
  voiceMatchingAvailable: boolean;
  color: "green" | "blue" | "sand";
}

export interface TranscriptTurn {
  id: string;
  speaker: string;
  personId?: string;
  start: number;
  end: number;
  text: string;
  uncertain?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  startedAt: string;
  duration: number;
  people: string[];
  state: ProcessingState;
  turns: TranscriptTurn[];
  synthetic: boolean;
  recordingSessionId?: string;
  sequence?: number;
}

export interface ConversationGroup {
  key: string;
  recordingSessionId?: string;
  conversations: Conversation[];
}

/** Group related recording clips for display without merging their transcripts or source IDs. */
export function groupConversationsBySession(conversations: readonly Conversation[]): ConversationGroup[] {
  const grouped = new Map<string, ConversationGroup>();
  for (const conversation of conversations) {
    const recordingSessionId = conversation.recordingSessionId;
    const key = recordingSessionId ? `session:${recordingSessionId}` : `conversation:${conversation.id}`;
    const group = grouped.get(key) ?? { key, recordingSessionId, conversations: [] };
    group.conversations.push(conversation);
    grouped.set(key, group);
  }

  const groups = [...grouped.values()];
  for (const group of groups) {
    group.conversations.sort((a, b) => {
      if (a.sequence !== undefined && b.sequence === undefined) return -1;
      if (a.sequence === undefined && b.sequence !== undefined) return 1;
      if (a.sequence !== undefined && b.sequence !== undefined && a.sequence !== b.sequence) return a.sequence - b.sequence;
      return a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id);
    });
  }
  const latestStart = (group: ConversationGroup) => group.conversations.reduce((latest, conversation) => conversation.startedAt > latest ? conversation.startedAt : latest, "");
  return groups.sort((a, b) => latestStart(b).localeCompare(latestStart(a)) || a.key.localeCompare(b.key));
}

export interface Memory {
  id: string;
  kind: MemoryKind;
  title: string;
  text: string;
  localDate: string;
  occurredAt?: string;
  plannedFor?: string;
  conversationId: string;
  turnIds: string[];
  people: string[];
}

export interface Citation {
  conversationId: string;
  turnId: string;
  timestamp: number;
  label: string;
  excerpt: string;
}

export interface RecallAnswer {
  text: string;
  citations: Citation[];
  insufficient: boolean;
}

export interface PatientSpace {
  id: string;
  name: string;
  timezone: string;
  capabilities: Capability[];
  people: Person[];
  conversations: Conversation[];
  memories: Memory[];
}

export const memoryLabels: Record<MemoryKind, string> = {
  reported_activity: "Reported activity",
  plan: "Future plan",
  personal_fact: "Personal detail",
  conversation_topic: "Conversation topic",
};

export const PATIENT_CAPABILITIES: Capability[] = [
  "memories:read", "recordings:create", "evidence:delete", "people:manage",
  "sharing:manage", "rides:prepare", "appointments:book", "medications:read", "medications:record",
];
