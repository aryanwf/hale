import { describe, expect, test } from "bun:test";
import { familyDashboardDemoUrl, parseAppMode } from "./config";

describe("mobile data source selection", () => {
  test("an unconfigured build uses an explicitly labeled demo", () => { expect(parseAppMode(undefined)).toBe("demo"); });
  test("live mode never falls back to demo", () => { expect(parseAppMode("live")).toBe("live"); });
  test("unknown configuration fails closed", () => { expect(parseAppMode("production")).toBe("invalid"); });
});

describe("family dashboard demo URL", () => {
  test("opens the dashboard through the Android emulator host bridge", () => {
    expect(familyDashboardDemoUrl("http://localhost:3000", "android")).toBe("http://10.0.2.2:3000/family/overview");
  });

  test("preserves a reachable host URL for physical devices and other platforms", () => {
    expect(familyDashboardDemoUrl("http://192.168.1.20:3000", "android")).toBe("http://192.168.1.20:3000/family/overview");
    expect(familyDashboardDemoUrl("http://localhost:3000", "ios")).toBe("http://localhost:3000/family/overview");
  });

  test("fails closed when the web URL is absent or invalid", () => {
    expect(familyDashboardDemoUrl(undefined, "android")).toBeUndefined();
    expect(familyDashboardDemoUrl("not a URL", "android")).toBeUndefined();
    expect(familyDashboardDemoUrl("file:///demo", "android")).toBeUndefined();
  });
});
