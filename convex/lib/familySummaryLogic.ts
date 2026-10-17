import { localDate, shiftDate } from "@hale/contracts/time";

const SUMMARY_HOUR = 21;

export function localHour(now: number, timezone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, hour: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(now)).find((part) => part.type === "hour")?.value ?? 0);
}

export function summaryDateThrough(now: number, timezone: string): string {
  const today = localDate(now, timezone);
  return localHour(now, timezone) >= SUMMARY_HOUR ? today : shiftDate(today, -1);
}

export function isSummaryWindowOpen(now: number, timezone: string): boolean {
  return localHour(now, timezone) >= SUMMARY_HOUR;
}

export function isSunday(date: string): boolean {
  return new Date(`${date}T12:00:00Z`).getUTCDay() === 0;
}

export function weeklyPeriodStart(sunday: string): string {
  return shiftDate(sunday, -6);
}

export function summaryContentIntro(sourceCount: number): string {
  return sourceCount
    ? `Direct excerpts from ${sourceCount} processed transcript turn${sourceCount === 1 ? "" : "s"}. These are source quotes, not an interpretation.`
    : "No processed, source-backed transcript excerpts were available for this period.";
}

export const MAX_NIGHTLY_SOURCE_TURNS = 12;
export const MAX_WEEKLY_SOURCE_TURNS = 35;
export const MAX_SUMMARY_BACKFILL_DAYS = 1;
