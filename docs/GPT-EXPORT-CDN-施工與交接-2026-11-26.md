# GPT-EXPORT-CDN — GPT 原始匯出改用 Shopify CDN

日期：2026-11-26（台灣）｜Owner 授權直接施工，要求跨 AI 的 repo 歷史交接。
狀態：source 已寫入 feature branch；CI、真實測試、Owner 驗收、merge／Production 均須另行核對，不能把本文件視為 PASS。

## 歷史脈絡與權威
- 2026-11-02 原始規格：`docs/GPT-HANDOFF-交給GPT原始匯出-施工規格-2026-11-02.md`，擷取草稿不經內建 AI，交給 GPT 後輸出原始 CSV。
- 2026-11-26 實查 GitHub 主線 `handoff/20261008-golive-spec` 與 Vercel Production alias 同為 `0e252ba792661f4e9373c47eaebcc7b108ecb799`；PR #92 已合併（批次交給 GPT）。Production deployment `dpl_GUpxhPhpEGfxuXu7zFiZfi9JiuDs` READY。GitHub default branch 是舊線，禁止拿它當基準。
- 原始 CSV 依 `processed_file_url || original_file_url` 輸出 main/detail 及款式引用圖，未強制 CDN。既有 D1 finalize 會更新 image processing 狀態並清暫存、限制圖片類型，因此本包**不直接调用 D1 finalize**。
- Shopify Files 2026-04 Admin GraphQL API 可用 filename + duplicateResolutionMode RAISE_ERROR；Files query 可按 filename 查詢。官方： https://shopify.dev/docs/api/admin-graphql/2026-04/input-objects/FileCreateInput 、https://shopify.dev/docs/api/admin-graphql/2026-04/queries/files 。

## 六項施工契約
1. Authority：上述 Production 基準，開始前再查遠端。
2. Allowed：只改 GPT CSV 圖片準備、重用 CDN、批次失敗防護。
3. Forbidden：不改 CSV 表頭／文字欄位／排序／文案生成／外掛／正式商品 publish sync／其他匯出；不改資料庫 schema，不刪 Supabase 原檔、不寫實際 Shopify 來測。
4. Acceptance：原 CSV 保留同一表頭、順序、資料；每個有網址的主圖、詳情圖、實際被款式引用的圖均為有效 CDN；失敗不更新 gpt_exported_at，不下載不完整 CSV；重新匯出不建立重複圖片。
5. Diff gate：`src/app/api/exports/gpt-raw/route.ts`、`src/lib/csv/gptExportCdn.ts`、`src/components/listing/GptRawList.tsx`、`src/lib/shopify/filesUpload.ts`（僅 opt-in duplicate mode，預設不變）、`scripts/verify-gpt-handoff.mjs`、本文件、`docs/WORK_HISTORY.md`。
6. Publication：`gpt/gpt-export-cdn-20261126` → `handoff/20261008-golive-spec`；Draft PR，CI／Owner gate；未授權 merge 或 Production。PR #86 正在修改 CURRENT_STATUS 與發包總表，本包避免衝突，不改這兩份；由下一次 Commander checkpoint 統一索引。

## 實作決策
- API plan 回傳待搬圖的 draft/image IDs，prepare 每次最多 4 張（只由 DB 選圖，session role 不變），瀏覽器逐批準備並顯示圖片進度，最後 export 一次輸出全部原始 CSV（上限仍 100 件）。
- 已有 Shopify CDN 網址直接沿用。非 CDN 圖透過既有安全下載器驗 MIME / bytes / SSRF，再用既有 staged uploader。檔名依 SHA-256 內容決定，先查同名 Files，create 使用 RAISE_ERROR，禁止 replace／blind retry；最後讀回 READY 且檔名與 CDN host 相符。
- 不將 CDN 寫回 product_images，避免影響原有 processing、dirty triggers 及後續商品同步。跨匯出重用透過 Shopify deterministic filename；再次匯出仍會讀原始來源 bytes 驗內容，但不重傳同內容。同一次匯出 proof 綁定 user/draft/image/source/CDN/有效期限，server 驗簽，不信任瀏覽器提供的網址。原始 CSV serializer 完全不改。
- 非正式環境／mock 模式不得寫真實正式 Shopify Files；保留 existing environment fence。這不是商品建立、同步或發布。
- 失敗回中文提示，不更新匯出時間；先前成功的 Shopify Files 不回刪，下次可重用。若 Shopify READY 慢或索引尚未可見，重新匯出；若同名檔 FAILED 或永久不存在需人工調查，禁止自動刪除。

## 驗證與剩餘 gate
- 新增 focused verifier：圖片類型／款式引用、其他欄位等價、proof 防偽／到期、內容去重、READY readback、模擬上傳失敗與不明結果復原、批次接線、沒有圖片 DB 寫入或刪除。已接進既有 verify:gpt-handoff（原本在 verify:all 中）。
- 需核對實際 CI verify:all/typecheck/build；雲端容器無 GitHub DNS，未執行完整本機 build，不能宣稱本機 PASS。
- 需在 staging 店驗證 read_files/write_files、Shopify 對 deterministic filename 的實際回傳、JPEG/WebP/長詳情圖與大量批次。只用非正式店，或另外取得 Owner 明確批准的單件真實 Files smoke；不建立商品。若無適合 staging env，標記 E2E HOLD。
- Owner 驗收：一件含主圖、詳情圖、款式圖；重匯出確認 CDN URL 不變且無新增重複 Files；多件一份 CSV；故障後保留待匯出。確認後另行批准 merge/deploy。
- 這次不會釋放已存在 Supabase 儲存空間，只讓 GPT 後續讀 CDN；Supabase 清理另開包，先備份、引用稽核（包括 GPT 尚未發布的草稿），不得沿用 4e-B/C 的已上架清理範圍直接刪。
- Source code 最後已確認寫入的 commit（文件前）：`ea38daeaccc0fc6ac7b69c0bbe320aa9740db240`。最終 HEAD / PR / CI / Preview 用 GitHub、Vercel 現查；PR conversation 記錄驗收證據。
