import {
  buildSchedulePreview,
  type SchedulePreview
} from "@/lib/drafts/publishSchedulePreview";

export const SCHEDULE_MIGRATION_HINT =
  "排程資料表尚未建立。此功能目前只能在 Preview 看介面；Production migration 需要 Owner 另外批准。";

export type ScheduleItemState =
  | "queued"
  | "claimed"
  | "blocked"
  | "completed"
  | "failed"
  | "canceled";

export type ScheduleCreateInput = {
  draftIds: string[];
  startDate: string;
  dailyLimit: number;
  activeWeekdays: number[];
};

export function normalizeScheduleDraftIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.trim().length > 0))];
}

export function buildScheduleAssignments(input: ScheduleCreateInput): {
  preview: SchedulePreview;
  assignments: Array<{ draftId: string; scheduledFor: string; position: number }>;
} {
  const draftIds = normalizeScheduleDraftIds(input.draftIds);
  const preview = buildSchedulePreview({
    total: draftIds.length,
    dailyLimit: input.dailyLimit,
    startDate: input.startDate,
    activeWeekdays: input.activeWeekdays
  });

  const assignments: Array<{ draftId: string; scheduledFor: string; position: number }> = [];
  let cursor = 0;
  for (const day of preview.days) {
    for (let index = 0; index < day.count; index += 1) {
      const draftId = draftIds[cursor];
      if (!draftId) break;
      assignments.push({
        draftId,
        scheduledFor: day.date,
        position: cursor + 1
      });
      cursor += 1;
    }
  }

  return { preview, assignments };
}

export function isMissingScheduleTablesError(message: string | null | undefined): boolean {
  const text = (message ?? "").toLowerCase();
  return (
    text.includes("publish_schedule_groups") ||
    text.includes("publish_schedule_items") ||
    text.includes("claim_due_publish_schedule_items") ||
    text.includes("schema cache")
  );
}

export function scheduleExecutionEnabled(): boolean {
  return process.env.PUBLISH_SCHEDULE_EXECUTION_ENABLED === "true";
}

export function scheduleStagingEnabled(): boolean {
  return process.env.PUBLISH_SCHEDULE_STAGING_ENABLED === "true";
}

export function taipeiDateOnly(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) throw new Error("Unable to resolve Asia/Taipei date");
  return `${y}-${m}-${d}`;
}
