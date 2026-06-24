import type { DraftStatus, PublishStatus } from "@/types/domain";

export function StatusBadge({ status }: { status: DraftStatus | PublishStatus | string }) {
  const className =
    status.includes("ready") || status.includes("published") || status.includes("created")
      ? "ready"
      : status.includes("failed")
        ? "failed"
        : status.includes("pending") || status.includes("processing") || status.includes("publishing")
          ? "processing"
          : "";

  return <span className={`status ${className}`}>{status}</span>;
}
