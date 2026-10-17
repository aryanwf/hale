export type AppMode = "demo" | "live" | "invalid";

export function parseAppMode(value: string | undefined): AppMode {
  if (value === undefined || value === "demo") return "demo";
  return value === "live" ? "live" : "invalid";
}

export const config = {
  mode: parseAppMode(process.env.EXPO_PUBLIC_APP_MODE),
  clerkKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL,
  siteUrl: process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  webUrl: process.env.EXPO_PUBLIC_WEB_URL,
};
