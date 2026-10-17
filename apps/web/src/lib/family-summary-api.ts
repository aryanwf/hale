import { makeFunctionReference } from "convex/server";

export type FamilySummaryEntry = {
  date: string;
  recordedAt: number;
  excerpt: string;
  truncated: boolean;
  conversationId: string;
  turnId: string;
};

export type FamilySummaryCard = {
  id: string;
  kind: "nightly" | "weekly";
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: number;
  intro: string;
  entries: FamilySummaryEntry[];
  deliveryState: "queued" | "sending" | "sent" | "failed" | "skipped" | null;
  deliveredAt: number | null;
};

export type FamilySummaryRead = {
  enabled: boolean;
  notificationDeliveryConfigured: boolean;
  testEmailAvailable: boolean;
  verifiedEmailAvailable: boolean;
  preferences: { nightly: boolean; weekly: boolean };
  summaries: FamilySummaryCard[];
};

export const familySummaryApi = {
  read: makeFunctionReference<"query", { patientId: string }, FamilySummaryRead>("familySummaries:read"),
  setPreferences: makeFunctionReference<"mutation", { patientId: string; nightly: boolean; weekly: boolean }, null>("familySummaries:setPreferences"),
  sendTestEmail: makeFunctionReference<"action", { patientId: string }, { sent: boolean }>("familySummaries:sendTestEmail"),
};
