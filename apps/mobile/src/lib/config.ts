export type AppMode = "demo" | "live" | "invalid";

export function parseAppMode(value: string | undefined): AppMode {
  if (value === undefined || value === "demo") return "demo";
  return value === "live" ? "live" : "invalid";
}

export function familyDashboardDemoUrl(webUrl: string | undefined, platform: string): string | undefined {
  if (!webUrl) return undefined;
  try {
    const url = new URL("/family/overview", webUrl);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (platform === "android" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      url.hostname = "10.0.2.2";
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

export const config = {
  mode: parseAppMode(process.env.EXPO_PUBLIC_APP_MODE),
  clerkKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
  convexUrl: process.env.EXPO_PUBLIC_CONVEX_URL,
  siteUrl: process.env.EXPO_PUBLIC_CONVEX_SITE_URL,
  webUrl: process.env.EXPO_PUBLIC_WEB_URL,
};
