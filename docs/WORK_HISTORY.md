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
