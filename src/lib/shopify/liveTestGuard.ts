import type { PublishMode } from "@/types/domain";

export type LiveTestGuardInput = {
  draftIds: string[];
  operation?: "publish" | "sync" | "archive" | "restore" | "delete";
  publishMode?: PublishMode;
};

/**
 * Live Shopify write gate.
 *
 * - mock mode: unrestricted simulation
 * - configured single-draft allowlist: owner-approved DRAFT-only test
 * - no allowlist: normal daily live mode is DRAFT-only by default
 * - ACTIVE: requires the separate explicit go-live flag
 */
export function checkLiveTestGuard(input: LiveTestGuardInput): string | null {
  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false") return null;

  const operation = input.operation ?? "publish";
  const allowedDraftId = process.env.SHOPIFY_LIVE_TEST_DRAFT_ID?.trim();

  // Single-draft live test is intentionally stricter than normal daily mode.
  if (allowedDraftId) {
    if (input.draftIds.length !== 1) return "Live test allowlist only permits a single draft";
    if (input.draftIds[0] !== allowedDraftId) return "Draft is not on the live test allowlist";
    if (operation === "publish" && input.publishMode !== "draft") {
      return "Live test allowlist only permits DRAFT publishing";
    }
    return null;
  }

  // Daily live publishing defaults to DRAFT-only. ACTIVE stays server-blocked
  // until the separate Shopify ACTIVE go-live package explicitly enables it.
  if (operation === "publish" && input.publishMode !== "draft") {
    const activeEnabled = process.env.SHOPIFY_ACTIVE_PUBLISH_ENABLED === "true";
    if (input.publishMode === "active" && activeEnabled) return null;
    return "Live Shopify publishing is DRAFT-only; ACTIVE publishing is not enabled";
  }

  return null;
}
