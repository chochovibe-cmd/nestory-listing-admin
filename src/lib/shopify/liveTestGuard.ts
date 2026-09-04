import type { PublishMode } from "@/types/domain";

export type LiveTestGuardInput = {
  draftIds: string[];
  operation?: "publish" | "sync" | "archive" | "restore" | "delete";
  publishMode?: PublishMode;
};

/** Restrict live Shopify writes to one owner-approved DRAFT test when configured. */
export function checkLiveTestGuard(input: LiveTestGuardInput): string | null {
  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false") return null;
  const allowedDraftId = process.env.SHOPIFY_LIVE_TEST_DRAFT_ID?.trim();
  if (!allowedDraftId) return null;
  if (input.draftIds.length !== 1) return "Live test allowlist only permits a single draft";
  if (input.draftIds[0] !== allowedDraftId) return "Draft is not on the live test allowlist";
  if ((input.operation ?? "publish") === "publish" && input.publishMode !== "draft") {
    return "Live test allowlist only permits DRAFT publishing";
  }
  return null;
}
