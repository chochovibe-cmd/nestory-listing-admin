import { spawnSync } from "node:child_process";

const scripts = [
  "scripts/verify-static.mjs",
  "scripts/verify-requirements.mjs",
  "scripts/verify-contracts.mjs",
  "scripts/verify-sql-schema.mjs",
  "scripts/verify-mock-flow.mjs",
  "scripts/verify-no-secrets.mjs",
  "scripts/verify-browser-storage-secret-policy.mjs",
  "scripts/verify-client-secret-reference-policy.mjs",
  "scripts/verify-secure-server-image-fetch.mjs",
  "scripts/verify-service-role-request-authorization.mjs",
  "scripts/verify-batch-archive-authorization.mjs",
  "scripts/verify-supabase-migration-baseline.mjs",
  "scripts/verify-variant-axis-atomic.mjs",
  "scripts/verify-variant-duplicate-protection.mjs",
  "scripts/verify-mobile-resultcard-expand.mjs",
  "scripts/verify-mobile-resultcard-gesture-guard.mjs",
  "scripts/verify-mobile-layout-regression-restore.mjs",
  "scripts/verify-mobile-resultcard-owner-refine.mjs",
  "scripts/verify-resultcard-uiux-d2.mjs",
  "scripts/verify-resultcard-uiux-d3.mjs",
  "scripts/verify-resultcard-uiux-d33.mjs",
  "scripts/verify-resultcard-uiux-d34b.mjs",
  "scripts/verify-resultcard-uiux-d35.mjs",
  "scripts/verify-resultcard-uiux-d36.mjs",
  "scripts/verify-resultcard-uiux-d37.mjs",
  "scripts/verify-resultcard-uiux-d38.mjs",
  "scripts/verify-resultcard-uiux-d39a.mjs",
  "scripts/verify-resultcard-uiux-d39b.mjs",
  "scripts/verify-resultcard-uiux-d310a.mjs",
  "scripts/verify-resultcard-uiux-d310b.mjs",
  "scripts/verify-resultcard-uiux-d310c.mjs",
  "scripts/verify-resultcard-uiux-d310d.mjs",
  "scripts/verify-resultcard-uiux-d310d1.mjs",
  "scripts/verify-resultcard-uiux-d310d2.mjs",
  "scripts/verify-resultcard-uiux-d310d3.mjs",
  "scripts/verify-variant-picker-containment.mjs",
  // CAP-1 / CAP-2 / CAP-2.5
  "scripts/verify-cap1.mjs",
  "scripts/verify-cap2.mjs",
  "scripts/verify-cap25.mjs",
  // SYN-1 detail compose + to_trad + P4 regression
  "scripts/verify-syn1.mjs",
  "scripts/verify-p4-source-and-seller.mjs",
  // Shopify Lifecycle Safety A1 — mock/injected only, never real network.
  "scripts/verify-shopify-lifecycle-safety.mjs"
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("All no-dependency checks passed");
