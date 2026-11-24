請執行以下施工

Repo：chochovibe-cmd/nestory-listing-admin
基底分支：handoff/20261008-golive-spec（最新 ff31c4f）
新分支：gpt/publish-speed
包名：14 PERF 的一部分「PUBLISH-SPEED 發布加速」（規格：Claude；施工：你；驗收：Claude）

先讀：AI_START_HERE.md、AGENTS.md（施工鐵則）。不要通讀 docs/。
本指令就是規格：請原文存成 docs/PUBLISH-SPEED-發布加速-施工規格-2026-11-24.md 一起 commit。
設計已定，照做；有更好的想法寫在回報「更好的想法」，不要自己先做。

## 0. 背景（已查證，不用再查）
- 發布一件約 37–45 秒。src/lib/shopify/publishDraftSafe.ts 約 602 行呼叫 prepareImagesForPublish()（src/lib/images/prepareImagesForPublish.ts），它把主圖／款式圖分批（每批最多 SHARP_BATCH_MAX_IMAGES 張）交給：
  - runSharpBatchForDraft()（src/lib/images/runSharpBatch.ts）：for 迴圈「逐張」下載 → sharp 轉 WebP（main/variant 模糊延伸正方形）→ 上傳 Supabase storage → 更新 product_images。
  - runFinalizeForDraft()（src/lib/images/runFinalize.ts）：for 迴圈「逐張」下載 → 上傳 Shopify Files → 更新 product_images → 刪 Supabase 暫存檔。
  兩個迴圈都是串行，這是主要瓶頸。
- 詳情圖（uploadDescriptionImages.ts）已經是並行 4 張＋120 秒預算，本包不動。
- 「已處理過就跳過」已存在：sharp 跳過 processing_status=done 且有 processed_file_url 的列；finalize 跳過已在 Shopify CDN 的列。本包不新增跳過機制、不新增欄位。
- 正式庫目前 image_type='spec' 的列是 0 筆。
- 已有並行工具 src/lib/images/runWithConcurrency.ts（結果順序＝輸入順序，單項失敗不影響其他項）。

## 1. 要做的事（只有這 4 件）
A. runSharpBatchForDraft 的輸入加兩個選填欄位：
   - concurrency?: number，預設 1（其他呼叫者：api/images/sharp-batch、sendImagesAutoChain、runAiProcess 行為完全不變）。
   - deps?: { fetchBytes?: (url) => Promise<Buffer>; processImage?: typeof processImageBuffer }，預設用現在的函式（只為了測試注入）。
   把 `for (const img of images)` 迴圈改成 runWithConcurrency(images, concurrency, 單張處理函式)。單張處理內容（含 skip 判斷、processing→done/failed 的 DB 更新、錯誤訊息截 500 字）一行邏輯都不改，只是搬進函式。
   results 陣列必須維持原本 images 的順序；processed/skipped/failed 計數與現在相同；迴圈前的 image_status="processing" 和迴圈後的 aggregateImageStatusAfterSharp 照舊各只寫一次。
B. runFinalizeForDraft 同樣做法：加 concurrency?（預設 1）與 deps?: { fetchBytes?; upload?: typeof uploadProcessedImageToShopifyFilesWithRetry }，for 迴圈改 runWithConcurrency，單張邏輯（含 already_cdn 跳過、NO_SOURCE、DB_ERROR、暫存檔刪除）不改，結果順序與計數不變。
C. prepareImagesForPublish.ts：
   - 新增並 export 常數 PUBLISH_IMAGE_CONCURRENCY = 4。
   - 分批呼叫 runSharp／runFinalize 時傳入 concurrency: PUBLISH_IMAGE_CONCURRENCY（批與批之間照舊一批跑完才下一批）。
   - isSharpEligible() 開頭加：image_type === "spec" → false（規格圖不再於發布時轉檔）。
   - PrepareImagesForPublishResult 加 timingsMs: { sharp: number; finalize: number }（各階段實際花的毫秒；沒跑就是 0）。用可注入的 now（deps.now，預設 Date.now）計時。
D. publishDraftSafe.ts publishDraft()：
   - 用已有的 clock 計時：prepareImagesForPublish 的結果 timingsMs、詳情圖上傳那段的毫秒數。
   - 成功那筆 insertPublishJob（finalStatus 那個，約 1230 行）的 response_payload 物件一律加一個 key：
     timings_ms: { prepare_sharp, prepare_finalize, description_upload, total }
     total＝startedAt 到寫入這筆之前；mock 模式或沒跑的階段填 null。
     寫法：{ ...(原本要寫的物件), timings_ms }，原本的 key 一個都不能少、不能改名。
   - 失敗路徑不用加。

## 2. 驗收腳本（你寫）scripts/verify-publish-speed.mjs，加進 scripts/verify-all.mjs
照 scripts/verify-pricing.mjs 的寫法（publish-guard-loader 載入 TS、純函式＋假 supabase，不連網路、不連資料庫、不連 Shopify）。至少要有：
1. sharp：10 張 main/variant＋2 張 detail，concurrency=4 → 同時進行中的 processImage 最多 4、至少到 2；results 順序＝輸入順序；計數正確。
2. sharp：concurrency 不傳 → 同時最多 1（舊行為）。
3. sharp：第 3 張 fetch 丟錯 → 只有那張 failed、processing_error 有寫、其他照常 done。
4. finalize：同樣測 1–3，另加 already_cdn 列被跳過、不會呼叫 upload。
5. finalize：同一張圖不會被 upload 兩次（重跑一次，已在 CDN 的全部跳過）。
6. prepareImagesForPublish：spec 列不會出現在 runSharp 的 imageIds；main/variant 帶 concurrency=4；timingsMs 有數字。
7. 原始碼檢查：publishDraftSafe 成功 insertPublishJob 帶 timings_ms；processImageBuffer 的 squareMode 規則（main/variant→blur-extend）原樣存在。

## 3. 不准做
- 不改發布的狀態流程、重試／續跑、預檢規則、payload 內容、圖片順序、alt、款式綁圖、價格、庫存、標籤。不加 UI、不加按鈕、不加功能、不加 migration、不加資料表欄位。
- 不改 uploadDescriptionImages.ts 的並行數與預算；不把 prepare 和詳情圖上傳改成同時跑。
- 不碰文案線檔案：src/app/api/generate/route.ts、src/lib/contentGenerator/**、src/lib/copyPipeline/**、src/lib/providers/**、src/lib/ai/aiCost.ts、src/lib/images/copyReference.ts。
- 不碰定價檔案：src/lib/pricing*.ts、src/app/api/settings/pricing/**、src/lib/shopify/publishReadiness.ts、src/lib/import/captureHealth.ts。
- 不發布任何商品、不對 Shopify 做真實寫入、不寫正式資料庫、不合併、不 Vercel 部署、不刪資料。預覽站連的是正式資料庫和正式 Shopify，不准在預覽站按發布。

## 4. 完成標準
- pnpm install 後 npm run verify:all、npm run typecheck、npm run build 全部通過；PR 的 CI 全綠。
- 開 Draft PR：base handoff/20261008-golive-spec，標題「14 PERF：發布加速（主圖／款式圖並行 4 張＋發布計時）」。PR 說明寫：改了什麼、驗證結果、上線後老闆照常發布 1 件即可由 Claude 查 publish_jobs.response_payload.timings_ms 量測。
- 停在 Draft PR，等 Claude 審查。

## 5. 回報
最後用 10 行內回報（繁體中文）：分支與 PR 連結、改了哪些檔案、跑了什麼驗證與結果、未解決的問題、更好的想法（只提出不要做；沒有就寫無）。
