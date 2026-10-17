import { makeFunctionReference } from "convex/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "./functions";

const deliverAlertEmailRef = makeFunctionReference<"action">("care:deliverAlertEmail");
const deliverAlertPushRef = makeFunctionReference<"action">("push:deliverAlert");

type NewCareAlert = {
  patientId: Id<"patients">;
  conversationId?: Id<"conversations">;
  kind: "urgent" | "appointment_reminder";
  priority: "urgent" | "routine";
  title: string;
  body: string;
  turnIds: Id<"transcriptTurns">[];
  sourceKey: string;
};

/** Inserts one idempotent alert and queues generic email delivery in the same transaction. */
export async function insertCareAlert(ctx: MutationCtx, alert: NewCareAlert): Promise<Id<"careAlerts">> {
  const existing = await ctx.db.query("careAlerts").withIndex("by_sourceKey", (q) => q.eq("sourceKey", alert.sourceKey)).unique();
  if (existing) return existing._id;

  const alertId = await ctx.db.insert("careAlerts", {
    ...alert,
    createdAt: Date.now(),
    emailStatus: "pending",
    pushStatus: "pending",
    acknowledged: false,
  });
  const emailJobId = await ctx.scheduler.runAfter(0, deliverAlertEmailRef, { alertId });
  const pushJobId = await ctx.scheduler.runAfter(0, deliverAlertPushRef, { alertId });
  await ctx.db.patch(alertId, { emailJobId, pushJobId });
  return alertId;
}
