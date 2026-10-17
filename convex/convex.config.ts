import { defineApp } from "convex/server";
import { v } from "convex/values";

export default defineApp({
  env: {
    APP_ORIGIN: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
    EMAIL_FROM: v.optional(v.string()),
    SARVAM_API_KEY: v.optional(v.string()),
    VAPID_PUBLIC_KEY: v.optional(v.string()),
    VAPID_PRIVATE_KEY: v.optional(v.string()),
    VAPID_SUBJECT: v.optional(v.string()),
    FAMILY_SUMMARIES_ENABLED: v.optional(v.string()),
    FAMILY_SUMMARIES_EMAIL_MODE: v.optional(v.string()),
    FAMILY_SUMMARIES_TEST_EMAIL: v.optional(v.string()),
    FAMILY_SUMMARIES_FROM_EMAIL: v.optional(v.string()),
  },
});
