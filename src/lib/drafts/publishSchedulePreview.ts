export type SchedulePreviewDay = {
  date: string;
  count: number;
  startIndex: number;
  endIndex: number;
};

export type SchedulePreview = {
  total: number;
  dailyLimit: number;
  startDate: string;
  finishDate: string | null;
  days: SchedulePreviewDay[];
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

export function parseDateOnly(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateOnly(date);
}

export function weekdayForDate(value: string): number | null {
  const date = parseDateOnly(value);
  return date ? date.getUTCDay() : null;
}

export function taipeiTodayDate(): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());
    const year = parts.find((part) => part.type === "year")?.value;
    const month = parts.find((part) => part.type === "month")?.value;
    const day = parts.find((part) => part.type === "day")?.value;
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    // Browser fallback below.
  }
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function defaultScheduleStartDate(): string {
  return addCalendarDays(taipeiTodayDate(), 1);
}

export function buildSchedulePreview(input: {
  total: number;
  dailyLimit: number;
  startDate: string;
  activeWeekdays: readonly number[];
}): SchedulePreview {
  const total = Math.max(0, Math.floor(input.total));
  const dailyLimit = Math.max(1, Math.floor(input.dailyLimit));
  const startDate = parseDateOnly(input.startDate)
    ? input.startDate
    : defaultScheduleStartDate();
  const active = new Set(
    input.activeWeekdays.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
  );

  if (total === 0 || active.size === 0) {
    return {
      total,
      dailyLimit,
      startDate,
      finishDate: null,
      days: []
    };
  }

  const days: SchedulePreviewDay[] = [];
  let remaining = total;
  let cursor = startDate;
  let itemIndex = 0;

  // Hard stop protects preview UI from invalid inputs.
  for (let guard = 0; guard < 730 && remaining > 0; guard += 1) {
    const weekday = weekdayForDate(cursor);
    if (weekday != null && active.has(weekday)) {
      const count = Math.min(dailyLimit, remaining);
      days.push({
        date: cursor,
        count,
        startIndex: itemIndex + 1,
        endIndex: itemIndex + count
      });
      remaining -= count;
      itemIndex += count;
    }
    cursor = addCalendarDays(cursor, 1);
  }

  return {
    total,
    dailyLimit,
    startDate,
    finishDate: remaining === 0 && days.length ? days[days.length - 1].date : null,
    days
  };
}

export function shortScheduleDate(value: string): string {
  const parsed = parseDateOnly(value);
  if (!parsed) return value;
  return `${pad(parsed.getUTCMonth() + 1)}/${pad(parsed.getUTCDate())}`;
}
