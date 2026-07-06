import type { DraftStatus, PublishStatus } from "@/types/domain";

const STATUS_LABELS: Record<string, string> = {
  pending_input: "待輸入",
  pending_copy: "待生成",
  processing: "生成中",
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

export function StatusBadge({ status }: { status: DraftStatus | PublishStatus | string }) {
  const className =
    status.includes("ready") || status.includes("published") || status.includes("created")
      ? "ready"
      : status.includes("failed")
        ? "failed"
        : status.includes("pending") || status.includes("processing") || status.includes("publishing")
          ? "processing"
          : "";

  return <span className={`status ${className}`}>{STATUS_LABELS[status] ?? status}</span>;
}
