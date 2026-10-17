import { describe, expect, test } from "bun:test";
import { calendarDays, shiftMonth } from "./calendar";

describe("patient calendar", () => {
  test("leap February includes 29 dates", () => { expect(calendarDays("2024-02-10").filter(Boolean)).toHaveLength(29); });
  test("ordinary February includes 28 dates", () => { expect(calendarDays("2026-02-10").filter(Boolean)).toHaveLength(28); });
  test("a Sunday-start month has no leading blank", () => { expect(calendarDays("2026-02-10")[0]).toBe("2026-02-01"); });
  test("a partial final week is padded", () => { expect(calendarDays("2026-10-16").length % 7).toBe(0); });
  test("invalid dates produce no selectable days", () => { expect(calendarDays("2026-02-30")).toEqual([]); });
  test("month navigation safely crosses year boundaries", () => { expect(shiftMonth("2026-12-31", 1)).toBe("2027-01-01"); });
  test("month navigation never overflows from January into March", () => { expect(shiftMonth("2026-01-31", 1)).toBe("2026-02-01"); });
});
