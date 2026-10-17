import { isLocalDate } from "@hale/contracts/time";

export function calendarDays(day: string): (string | null)[] {
  if (!isLocalDate(day)) return [];
  const date = new Date(`${day}T12:00:00Z`);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const firstWeekday = new Date(Date.UTC(year, month, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0, 12)).getUTCDate();
  const prefix = day.slice(0, 7);
  return Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const dateNumber = index - firstWeekday + 1;
    return dateNumber > 0 && dateNumber <= daysInMonth ? `${prefix}-${String(dateNumber).padStart(2, "0")}` : null;
  });
}

export function shiftMonth(day: string, months: number): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}
