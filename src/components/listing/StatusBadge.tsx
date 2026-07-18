import type { DraftStatus, PublishStatus } from "@/types/domain";

const STATUS_LABELS: Record<string, string> = {
  pending_input: "待輸入",
  pending_copy: "待生成",
  pending: "待處理",
  processing: "生成中",
  completed: "已完成",
  ready_for_review: "待審核",
  needs_revision: "需修改",
  approved: "已核准",
  publishing: "上架中",
  active_published: "已上架",
  draft_created: "已建草稿",
  api_failed: "生成失敗",
  csv_ready: "CSV已備妥",
  failed: "失敗",
  archived: "已封存"
};

/** Explicit tone map — no string includes (UX-H T41). */
type StatusTone = "ready" | "failed" | "processing" | "archived" | "neutral";

const STATUS_TONE: Record<string, StatusTone> = {
  // ready 系：已完成／已上架／已建草稿
  completed: "ready",
  approved: "ready",
  active_published: "ready",
  draft_created: "ready",
  // processing 系：進行中佇列（含待審核，不得誤成 ready 綠）
  pending_input: "processing",
  pending_copy: "processing",
  pending: "processing",
  processing: "processing",
  publishing: "processing",
  ready_for_review: "processing",
  // failed 系
  failed: "failed",
  api_failed: "failed",
  needs_revision: "failed",
  // 特殊
  csv_ready: "neutral",
  archived: "archived"
};

function resolveTone(status: string): StatusTone {
  return STATUS_TONE[status] ?? "neutral";
}

export function StatusBadge({ status }: { status: DraftStatus | PublishStatus | string }) {
  const tone = resolveTone(status);
  return <span className={`status ${tone}`}>{STATUS_LABELS[status] ?? status}</span>;
}
