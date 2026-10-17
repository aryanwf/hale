import { describe, expect, test } from "bun:test";
import { isSunday, summaryContentIntro, summaryDateThrough, weeklyPeriodStart } from "./familySummaryLogic";

describe("family summary calendar logic", () => {
  test("waits until 9pm in each patient's timezone and then selects that local date", () => {
    expect(summaryDateThrough(Date.parse("2026-10-19T03:59:00Z"), "America/Los_Angeles")).toBe("2026-10-17");
    expect(summaryDateThrough(Date.parse("2026-10-19T04:00:00Z"), "America/Los_Angeles")).toBe("2026-10-18");
    expect(summaryDateThrough(Date.parse("2026-10-19T05:00:00Z"), "America/Los_Angeles")).toBe("2026-10-18");
    expect(summaryDateThrough(Date.parse("2026-10-19T14:00:00Z"), "Asia/Kolkata")).toBe("2026-10-18");
  });

  test("handles Sunday and local DST transitions without UTC weekday assumptions", () => {
    expect(summaryDateThrough(Date.parse("2026-11-02T02:00:00Z"), "America/New_York")).toBe("2026-11-01");
    expect(isSunday("2026-11-01")).toBe(true);
    expect(weeklyPeriodStart("2026-11-01")).toBe("2026-10-26");
    expect(isSunday("2026-11-02")).toBe(false);
  });

  test("describes only available source excerpts and never invents content", () => {
    expect(summaryContentIntro(2)).toContain("Direct excerpts from 2 processed transcript turns");
    expect(summaryContentIntro(0)).toContain("No processed, source-backed");
  });
});
