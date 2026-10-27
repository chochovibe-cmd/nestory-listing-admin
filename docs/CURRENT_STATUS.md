# Nestory — 現況（CURRENT_STATUS）

> 更新：2026-10-27（Claude）。本檔只放「現在成立」的事，上限約 6KB。
> **寫新進度＝改掉舊句子，不要在最上面再疊一個「最新」區塊。** 包做完就把它從「進行中」刪掉，細節寫進總表那一列。
> 發包順序與每包內容：`docs/發包總表-2026-10-14.md`（唯一來源）。
> 10-07～10-18 的舊紀錄原文（含 Codex PUBLISH-RUNTHROUGH R1–R5）：`docs/archive/STATUS-HISTORY-2026-10-21.md`，需要查歷史才讀。

## 1. 線上狀態
- 主線：`origin/handoff/20261008-golive-spec` @ `d8e5723`（10-25：#75 文件、#76 4a CAPTURE-REVIEWS＋FILTER、#77 4a-2 CAPTURE-SCROLL；之前 #61–#74 見總表）。
- 正式站：`dpl_4BxsSapWJbtwpdtUByaTjW7sEsMJ`（d8e5723；GPT 驗 `/login` 200＋githubCommitSha）；回退點 `dpl_4BQKHnrzhbL117Dp93uPq8gcbeXX`（81df9ca，4a）→ `dpl_6SQ4EZBRd2WDu2dDZv95HqGcy3BX`（247cdcb）→ `dpl_2W3xMYEd1WbEPc1yQfaULVKdYEVn`（ab5db34）→ `dpl_9N1U7ZGqFBsmsewJ72jNCpvrVpna`（bd8a594）→ `dpl_2PQ67RPqAX5w83YBGhz4MMbohhxz`（eb1520e）→ `dpl_2iwmmT2kWjYVapqGB4HbhvDsYTky`（041ea68）→ `dpl_EGT4Pvjt5GdABetHkoYYmc3tmaa9`（9167892）。Vercel Production 已設 `SHOPIFY_LOCATION_ID`＝`gid://shopify/Location/87881679033`（忠義路61號3樓，唯一出貨地點）；Shopify App 已有 read_inventory／write_inventory／read_locations。
- 外掛：老闆 Chrome 載入的 `C:/Users/s2491/Documents/Nestory外掛-0.2.0` 資料夾＝0.2.3（＝d8e5723 的 `extension/`，build `capture-20261025-scroll`；舊版備份 `Nestory外掛-0.2.2-備份`、`-0.2.1-備份`）。
- 本機這個資料夾停在舊分支 `codex/nestory-v0.1-safety-skeleton`（GitHub 預設分支也還是它）→ 看程式先 `git fetch`，一律以 origin/handoff 為準。網址、專案代號、環境變數名稱見 `AI_START_HERE.md` §3。

## 2. 進行中
| 包 | 狀態 | 下一步 |
|---|---|---|
| 4a CAPTURE-REVIEWS＋FILTER／4a-2 CAPTURE-SCROLL（GPT） | ✅ 10-25 上線（#76、#77）。實機：天貓新抓 799eaec6 → 自動捲動 24 步 6.5 秒（頁面 2.6 萬像素、推薦區無限長，到 6 秒上限停）、19 張詳情圖、排除 2 張 HOLLY 共用宣傳圖、評價摘要（dom）；卡片兩個新區塊 Claude 實看正常。Shopify 66 件已上架商品唯讀掃描：沒有掛宣傳圖 | 測試 A 原因已查（10-26）：862841d8 那次重抓在 10-25 17:18，4a 新版 17:35 才上線（dpl_4BQKHnrz… ready 09:35 UTC），舊伺服器只更新了 4 款庫存。待老闆用外掛 0.2.3 重抓一次，Claude 查資料庫確認 `source_reviews` 寫入 |
| 4a-3 小修合集-1（GPT，`gpt/4a3-small-fixes`） | 10-26 規格完成：`docs/4A3-小修合集-1-施工規格-2026-10-26.md`＋`scripts/verify-4a3.mjs`（**縮小版 8 項**：只剩搜尋全形＋429 中文；詳情圖移到 4e、文案參考圖移到 4f；Claude 參考實作 8/8＋verify:all＋tsc 綠，patch 在指揮 session scratchpad `ref-4a3-v3.patch`）。分支 `...[truncated]