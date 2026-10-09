## 2026-10-09 — SHOPIFY-DAILY-DRAFT merged / handoff checkpoint

- Owner explicitly approved PR #34 merge after source/CI/Preview PASS.
- PR #34 merged successfully; new authority: `5fc18fb02741cca1b5c1c912e1ff668b7a410180`.
- Production remained unchanged after merge; latest known Production deployment remains `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / `cb4b4d122398e765aa8c2375568756978c649334`.
- Source contract now safely supports normal live DRAFT publishing without a single-draft allowlist while keeping ACTIVE blocked unless an explicit ACTIVE enable flag is true.
- Next write boundary requires separate Owner approval: Production DRAFT transition, followed by exactly one fresh full-flow DRAFT smoke.
- After that PASS, next package is `SHOPIFY-ACTIVE-GO-LIVE` + one real ACTIVE smoke before broad ACTIVE freedom.
- UI-FLOW + SHOPIFY-DAILY-DRAFT are two completed packages; repo handoff checkpoint created per Owner cadence.

## 2026-10-09 — SHOPIFY-DAILY-DRAFT source gate

- Opened Draft PR #34 from authority `102565df789a035e6b8ae415ce7b694b919d927f`; head `5cfcc2b0dc492cdde52c5a798369e243cd193919`.
- Investigation found the old live-test guard returned unrestricted access when `SHOPIFY_LIVE_TEST_DRAFT_ID` was absent, so merely deleting the VICTOR allowlist could have allowed ACTIVE. Package changed that contract instead of touching Shopify payload/lifecycle code.
- New default: live + no single-draft allowlist = DRAFT-only; ACTIVE requires explicit `SHOPIFY_ACTIVE_PUBLISH_ENABLED=true`. Existing single-draft allowlist stays stricter and DRAFT-only.
- Diff gate: exactly 3 files (`liveTestGuard.ts`, its existing verifier, `.env.example`).
- GitHub CI verify/typecheck/build PASS. Vercel Preview `dpl_7ozjq7iJHnr74GwWqfYfWBzvATfD` READY; `/api/status` reports `shopifyMock=true`, so no real Shopify write occurred during source validation.
- Status: **SOURCE PASS / MERGE HOLD / PRODUCTION HOLD**. Production unchanged.
- Owner decision recorded: after daily DRAFT + fresh smoke, immediately do `SHOPIFY-ACTIVE-GO-LIVE` + one real ACTIVE smoke; only then unlock free ACTIVE daily use.

## 2026-10-09 — UI-FLOW-STABILIZE / PR #33 PASS

- PR #33 `UI-FLOW: stabilize modals and single-card success feedback` 經 Owner Preview 實測通過後獲准 merge。
- Merge commit / new authority：`102565df789a035e6b8ae415ce7b694b919d927f`。
- 完成：Station3 Publish Modal + Export Preflight Modal 使用 body portal，避免收合 ResultCard transform / overflow 裁切；單卡文案核准、標圖分流與 publish/export 成功時重用既有 leaving transition，再 refresh。
- Diff 僅 4 個既定 runtime 檔；未改 CSS architecture、API / Shopify publish semantics、DB / Supabase。CI / Preview PASS。
- Production 未部署本包，仍為 `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / `cb4b4d122398e765aa8c2375568756978c649334`。
- Owner 新提案：成功後流程可更順。Commander 決策是不立刻擴 scope，將「最後一張完成時自動接到下一站、仍有工作就留站、failure/batch/sequential 不亂跳」記入 `UIUX-FLOW-STATE` 的 Smart Station Handoff，排在 GO DAILY 後。
- Next blocker：`SHOPIFY-DAILY-DRAFT`。

## 2026-10-09 — PR #31 merged / full roadmap reconciliation

- PR #31 checks 全綠後，Owner 已批准並完成 merge。
- New authority merge commit：`9eff0659f4a2c936b550ea5bc72ba69aa1a0567a`。
- Production alias 重新查證仍指向 `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / `cb4b4d122398e765aa8c2375568756978c649334`；docs merge 沒有改 runtime。
- 完整重讀 Fable 規劃後，確認前一版不只漏 PB2 + UIUX 兩條顯眼主線；還需在 roadmap 明確保留 Pricing DB、Shopify ACTIVE/publication、data reliability、browser E2E/ops hardening、accessibility/focus、offline/scouting 等後段項目。
- 這些後段項目不是 GO DAILY blocker；Fable 原則仍是先完成最短上線路徑，避免「全部都做」拖住正式使用。


## 2026-10-09 — PR #30 merged / roadmap addendum

- Owner 明確批准 PR #30；CI / Vercel checks 全綠後已 merge。
- Merge commit：`8ac0f2f3a9558c847b5169d60316069a980cede5`。
- Owner 補充新協作節奏：每完成 1–2 個 package 就換新 Commander 對話，換前做 repo handoff。
- 重新對照 Fable 交接與 UIUX audits，確認前一版 active roadmap 過度壓縮：
  - 文案後續除了 COPY-SAFE，另有獨立 PB2-COPY-STRATEGY。
  - UIUX 後續另有規格 / Variant、ResultCard / Workbench、流程狀態 / Dashboard 三條主線。
  - 目前已知的 Station3 / Export modal 裁切與成功後卡片離場延遲，列為 GO DAILY 前的 UI-FLOW-STABILIZE。
# Nestory — Work History

本檔記 milestone / package checkpoint；不是每個小 commit 都記。

## 2026-10-08 — Shopify V1 release / real DRAFT stabilization

- Production Supabase required gates 已套用並驗證。
- Shopify resumable publish / SKU authority / media source filter 已完成。
- Controlled recovery + fresh DRAFT E2E 已成功；Pingu fresh DRAFT 曾抓到 detail media 混入問題，PR #23 修正為 Shopify product media 只收 main + variant。

## 2026-10-08 — V1.1 generation pipeline

- PR #24：generation progress 綁 draftId。
- PR #26：persistent generation queue + runner，DB-backed、refresh 可恢復、失敗可重試、local concurrency 2。
- PR #27：capture / images 背景補抓，輸入流程不再被圖片 hydrate 長時間卡住。
- PR #28：完整／單欄 regeneration 改非阻塞 queue。
- 結論：V1.1 core PASS；後續 OBS-QUEUE 只補「看得到整條排隊清單」的 UI，不重做 runner。

## 2026-10-09 — Capture / Modal

- PR #18 Capture 1.2 已 merge（merge commit `62e1a412…`）：圖片 fetch 並行、extension 重複點擊防護、擷取 toast。
- PR #29 Regen Modal Portal 已 merge（merge commit `cb4b4d122…`）；Owner 實機測「收合卡 / 展開卡」皆正常，PASS。

## 2026-10-09 — VICTOR Shopify DRAFT E2E

- Draft：`71672805-47c4-405c-af69-ab967ff13b4d`
- Publish batch：`0a1819e9-25cc-4938-b4fc-740068605162`
- Batch result：completed，1 done / 0 failed。
- Shopify Product：`gid://shopify/Product/15422035853497`，status DRAFT。
- 2 variants：
  - `GC513DBZ E(水仙黃)` / SKU `6131444709110` / NT$449
  - `GC512DBZ I (布偶粉)` / SKU `6131444709111` / NT$499
- Nestory current images：16 = 5 main + 9 detail + 2 variant。原始擷取曾有 22；Owner 確認 6 detail 是人工刪除淘寶廣告／錯誤圖。
- `sale_status=海外代購（約14天）` + Shopify tag `銷售_海外現貨`：Product Assistant 歷史資料有大量同樣組合，沿用既有 catalog authority。
- 結論：controlled true DRAFT E2E PASS。下一個 blocker 不是再跑 V1.1，而是把 single-draft live-test gate 提升成 safe daily DRAFT-only gate。

## 2026-10-09 — DOC-CHECKPOINT

- 建立 `gpt/docs-checkpoint-20261009`，base Expected HEAD `cb4b4d122398e765aa8c2375568756978c649334`。
- 更新 current authority / active roadmap / active tasks / work history。
- 本包不改 product code、DB、Vercel env、Shopify；不 deploy Production；merge HOLD。
