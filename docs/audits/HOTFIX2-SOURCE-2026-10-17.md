# HOTFIX-2 source 驗收紀錄 — 2026-10-17

- **基準**：`8d882042`；分支 `codex/hotfix-2-pagination-20261017`。
- **問題**：工作台沿用最多 40 件非封存＋最多 50 件封存草稿的載入上限；本次實際查得 67 件、1,264 張圖、420 款。Supabase REST 單次最多回傳 1,000 列會截斷完整商品圖片清單。
- **source 範圍**：新增共用 `fetchAllRows`，以固定 1,000 筆 inclusive range、每頁新 query、穩定 ID 排序抓完整結果；任一頁失敗回傳 `data: null`。套用於核准的 11 處查詢模組與 single seed、刪圖綁定查詢；3 處匯出及批次建立加上錯誤 guard。零 CSS、markup、業務規則改動。
- **分頁語義**：Supabase `.range(from, to)` 的 `to` 為 inclusive；需明確排序。參考[官方 range 文件](https://supabase.com/docs/reference/javascript/range)。Offset 分頁不提供跨請求資料 snapshot；並行資料變動時頁面間仍可能移動。
- **驗收結論：SOURCE PASS／Preview 與實機 HOLD**。目標驗證器涵蓋 0／999／1,000／1,001／2,001 列、整頁邊界、第二頁失敗不回傳部分結果，以及核准流程不因此寫入；AST 確認 14 處批次 SELECT 分頁及穩定排序、4 處匯出／批次建立在讀取失敗時先停止。`typecheck`、全套 `pnpm run verify:all`、`pnpm run build` 及 `git diff --check` 均通過。最後全套紀錄為 `verification-hotfix2-complete.log`，建置為 `verification-hotfix2-build-final.log`（本機忽略檔，不進版控）。
- **既有測試相容調整**：`verify-image-integrity` 載入真實分頁函式；該檔、`verify-publish-batch`、`verify-publish-guard`、`verify-variant-clean` 的假資料庫補上排序與 inclusive range，原安全斷言保留。產品沒有為舊字串斷言新增繞路。
- **建置環境**：套件重用主工作區既有 `node_modules`；未讀取或複製 `.env`。第一次建置受 sandbox 輸出寫入／字型下載限制影響；改用允許的本機執行通道後建置成功。Next.js 提示巢狀工作副本有兩份 lockfile，沒有修改框架設定或 lockfile。
- **人工 Preview 待驗 3 項**：①工作台卡片確認已知草稿 `46b677b1` 第 12–22 款圖片及圖審全圖均載入；②CSV 匯出款式齊全；③分頁失敗時不開始匯出／批次。工作台草稿數與載入上限仍維持現有設定。
- **驗收邊界**：source 檢查不等於 browser 或 Production 驗收。本包不做真 Shopify 操作；不 push、deploy 或寫入正式資料。
