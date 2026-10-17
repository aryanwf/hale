import { describe, expect, test } from "bun:test";
import { parseAppMode } from "./config";

describe("mobile data source selection", () => {
  test("an unconfigured build uses an explicitly labeled demo", () => { expect(parseAppMode(undefined)).toBe("demo"); });
  test("live mode never falls back to demo", () => { expect(parseAppMode("live")).toBe("live"); });
  test("unknown configuration fails closed", () => { expect(parseAppMode("production")).toBe("invalid"); });
});
