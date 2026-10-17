"use node";

import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import * as webPush from "web-push";
import type { Id } from "./_generated/dataModel";
import { env } from "./_generated/server";
import { internalAction } from "./lib/functions";

const pushPayloadRef = makeFunctionReference<"query">("care:pushPayload");
const removeSubscriptionRef = makeFunctionReference<"mutation">("care:removePushSubscriptionRecord");
const setPushStatusRef = makeFunctionReference<"mutation">("care:setPushStatus");

type PushPayload = {
  priority: "routine" | "urgent";
  notification: { title: string; body: string; path: string; tag: string };
  subscriptions: { id: Id<"webNotificationSubscriptions">; endpoint: string; p256dh: string; auth: string }[];
};

export const deliverAlert = internalAction({
  args: { alertId: v.id("careAlerts") },
  handler: async (ctx, { alertId }) => {
    const payload: PushPayload | null = await ctx.runQuery(pushPayloadRef, { alertId });
    if (!payload) return null;
    if (!payload.subscriptions.length || !env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) {
      await ctx.runMutation(setPushStatusRef, { alertId, status: "skipped" });
      return null;
    }

    try {
      webPush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    } catch {
      await ctx.runMutation(setPushStatusRef, { alertId, status: "failed" });
      return null;
    }

    let delivered = 0;
    await Promise.all(payload.subscriptions.map(async (subscription) => {
      try {
        await webPush.sendNotification({
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        }, JSON.stringify({ ...payload.notification, priority: payload.priority }), {
          TTL: 60 * 60,
          urgency: payload.priority === "urgent" ? "high" : "normal",
        });
        delivered++;
      } catch (error) {
        if (hasStatusCode(error) && (error.statusCode === 404 || error.statusCode === 410)) {
          await ctx.runMutation(removeSubscriptionRef, { subscriptionId: subscription.id });
        }
      }
    }));

    await ctx.runMutation(setPushStatusRef, { alertId, status: delivered ? "sent" : "failed" });
    return null;
  },
});

function hasStatusCode(error: unknown): error is { statusCode: number } {
  return Boolean(error && typeof error === "object" && "statusCode" in error && typeof error.statusCode === "number");
}
