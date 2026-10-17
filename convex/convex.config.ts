import { defineApp } from "convex/server";
import { v } from "convex/values";

// Optional and off by default: none of these values are changed on any deployment here.
export default defineApp({
  env: {
    FAMILY_SUMMARIES_ENABLED: v.optional(v.string()),
    FAMILY_SUMMARIES_EMAIL_MODE: v.optional(v.string()),
    FAMILY_SUMMARIES_TEST_EMAIL: v.optional(v.string()),
    FAMILY_SUMMARIES_FROM_EMAIL: v.optional(v.string()),
    RESEND_API_KEY: v.optional(v.string()),
  },
});
