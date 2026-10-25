import { spawnSync } from "node:child_process";

const scripts = [
  "scripts/verify-hotfix-1.mjs",
  "scripts/verify-hotfix-2.mjs",
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
  "scripts/verify-gen-progress-card.mjs",
  "scripts/verify-v11-generation-queue.mjs",
  "scripts/verify-v11-image-background.mjs",
  "scripts/verify-v11-nonblocking-regen.mjs",
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
  "scripts/verify-resultcard-uiux-d311.mjs",
  "scripts/verify-variant-picker-containment.mjs",
  // CAP-1 / CAP-2 / CAP-2.5
  "scripts/verify-cap1.mjs",
  "scripts/verify-cap2.mjs",
  "scripts/verify-cap25.mjs",
  // SYN-1 detail compose + to_trad + P4 regression
  "scripts/verify-syn1.mjs",
  "scripts/verify-p4-source-and-seller.mjs",
  // COPY C3 title authority / recovery composition guard
  "scripts/verify-title-sync.mjs",
  // COPY C1 — seventh manual sales-copy tone; no production network writes.
  "scripts/verify-copy-c1-chaonest-sales-tone.mjs",
  "scripts/verify-chaochao-copy-rewrite-2026-09-23.mjs",
  "scripts/verify-copy-product-brief.mjs",
  // Shopify Lifecycle Safety A1 — mock/injected only, never real network.
  "scripts/verify-shopify-lifecycle-safety.mjs",
  // G4 live-test allowlist + full-sync source/contract guards.
  "scripts/verify-shopify-live-test-guard.mjs",
  "scripts/verify-shopify-full-sync.mjs",
  "scripts/verify-shopify-sync-ux.mjs",
  "scripts/verify-websearch-copy-path.mjs",
  // IMAGE-INTEGRITY: unbind -> DB delete -> Storage; no UI path deletes Storage first.
  "scripts/verify-image-integrity.mjs",
  // PUBLISH-GUARD: mock mode = dry run (zero writes) + pre-publish blockers.
  "scripts/verify-publish-guard.mjs",
  // PRICE-GUARD: hidden per-variant prices → server flag, inherited cost survives load/save, publish backstop.
  "scripts/verify-price-guard.mjs",
  "scripts/verify-capture-interact.mjs",
  // PUBLISH-BATCH: stepwise batch (1 item/request), stale-batch recovery, reconcile, Google channel.
  "scripts/verify-publish-batch.mjs",
  // REVIEW-FLOW: transition guard, batch return, no-blink leave, approve triage, ⛔ batch, 逐件 skip.
  "scripts/verify-review-flow.mjs",
  // Pre-publish image prep: >12 image rows are chunked, detail rows untouched.
  "scripts/verify-prepare-images.mjs",
  // Per-variant selling price: each variant priced from its own cost (fine ladder), locks kept.
  "scripts/verify-variant-pricing.mjs",
  // MOBILE-VARIANT-LAYOUT: Workspace accordion grid must not blow out the variant table.
  "scripts/verify-mobile-variant-workspace.mjs",
  // VARIANT-CLEAN: fake options excluded at import, rule + AI-validated names, NS- SKU, variant image bind, resync.
  "scripts/verify-variant-clean.mjs",
  // SHOP-LISTING: Shopify category, blur-extend square images, 2048 WebP shrink + concurrent upload.
  "scripts/verify-shop-listing.mjs",
  // WORKBENCH-UX: role tags, sequential review, Shopify main image, workspace defaults.
  "scripts/verify-workbench-ux.mjs",
  // 1.5a SHOPIFY-RECONCILE: per-field compare table, baseline, category fill-only.
  "scripts/verify-shopify-reconcile.mjs",
  // HOTFIX-PROVIDER: no Claude key → GPT; retry follows current model.
  "scripts/verify-hotfix-provider.mjs",
  // CAPTURE-FIX: vid matching, dom_mismatch, source stock, sold-out exclusion, refresh.
  "scripts/verify-capture-fix.mjs",
  // STAGING 1.6: environment fence (prod/staging identity), banner, staging scripts. No network, no DB.
  "scripts/verify-staging-fence.mjs",
  // STOCK 4b: source stock planning, guarded Shopify inventory sync, UI wiring.
  "scripts/verify-stock.mjs",
  "scripts/verify-sync-fix.mjs",
  "scripts/verify-sync-keep-media.mjs",
  "scripts/verify-capture-4a.mjs"
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
