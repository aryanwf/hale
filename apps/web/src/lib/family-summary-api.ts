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
};

export type FamilySummaryRead = {
  enabled: boolean;
  summaries: FamilySummaryCard[];
};

export const familySummaryApi = {
  read: makeFunctionReference<"query", { patientId: string }, FamilySummaryRead>("familySummaries:read"),
};
