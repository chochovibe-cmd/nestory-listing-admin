# Nestory — 現況（CURRENT_STATUS）

> 更新：2026-10-25 晚（Claude）。本檔只放「現在成立」的事，上限約 6KB。
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
| 4a-3 小修合集-1（GPT，`gpt/4a3-small-fixes`） | 10-26 規格完成：`docs/4A3-小修合集-1-施工規格-2026-10-26.md`＋`scripts/verify-4a3.mjs`（24 項；10-26 依老闆回覆把「詳情圖開關」改成「商品描述放哪幾張詳情圖（可多選）」；Claude 參考實作 24/24＋verify:all＋tsc 綠，patch 在指揮 session scratchpad `ref-4a3-v2.patch`）。分支 `docs/4a3-spec`（含 docs/commander-20261025） | GPT 先合併 docs/4a3-spec → 施工 → Draft PR → Claude 審 |
| 4e STORAGE-SLIM（排在 4a-3 後、5 PRICING 前） | Supabase 免費 1GB：已用 450MB，10 月 +330MB，約 12 月上旬滿；放進描述的詳情圖要先搬 Shopify Files 才能清；見總表 4e | 4a-3 上線後 Claude 寫規格 |

下一包候選（指揮決定）：**4a-3 小修合集-1（施工中）** → 4e STORAGE-SLIM → 5 PRICING → 6 STATUS-SEMANTICS＋OBS-QUEUE → 7 COPY-A → 8 COPY-B → 9–11 UIUX → 12 THEME-SHIP → 13 COPY-C → 14 PERF。10-25 老闆定案（4a-3／COPY-A 用）：①詳情圖「一鍵」做成**全部不上架（保留在工具給 AI 讀字）**，不是刪除，單張 ✕ 刪除照舊（**10-26 老闆改：要能挑多張放進描述**，見 4a-3 規格 §2）；②COPY-A「文案參考圖」：AI 先自動挑字最多的圖，老闆可勾選覆蓋（新勾選，不沿用「規格圖」標記＝去簡體字處理）；③舊商品描述內嵌的 Supabase 圖**不搬**，只查容量，快滿或特別佔空間才處理；④可順手評估：自動捲動在推薦區無限長的頁面會跑滿 6 秒，可改成捲過「图文详情／用户评价」區就停。漏項歸屬見總表第六節。

## 3. 現役風險
- **抓取**：CAPTURE-FIX 10-22 上線、實機驗收通過（天貓 1c89667a 重抓補齊 15 款成本＋3 款來源售完；淘寶 6232c6b0 已上架只更新庫存）。剩 7 筆舊草稿等老闆有空重抓：1b42068e 5a48fe8a 42279f35 b677bf2d a9f82c5f 2cb43ea3 f1e97850。
- **STOCK 已收尾（10-24）**：migration 實測通過——老闆重抓已上架的 f2809032（天貓 1030718943524），7 款來源庫存寫入、價格未動，同步狀態維持 `never`（沒被誤標髒）。
- **款式連結**：已上架商品的 `product_variants.shopify_variant_id` 只有同步過的 6 件有值；其餘 STOCK 用 SKU 補位，完整同步成功一次就會寫回。
- **完整同步**：SYNC-FIX（#68）10-24 上線並實測：老闆同意後 Claude 先備份（`Nestory備份/2026-10-24-SYNC-FIX-6232c6b0-同步前／同步後`），再重新同步 6232c6b0 → 「已同步」、基準點建立、4/4 款式連上、9 張上架圖連上，Shopify 內容與修改時間前後完全相同（貝吉塔仍售完）。SYNC-ROLLOUT 第 1 批 10-24 再同步 5 件。Shopify 上 66 件中還有 60 件沒有基準點；19 件 FAQ 仍是「Q：問題」壞格式、10 件規格有「項目:」→ 第 2 批。
- 已上架商品身上還有假款式（10-13 那批）。
- 本機 `.env.local` 連的是**正式資料庫**（tbgtqwvuohmdxnxisrgr）→ 本機不可跑會寫資料的測試；只能唯讀查。

## 4. 不要做
- 不要套用 Codex PUBLISH-RUNTHROUGH R2–R5（`.tmp/publish-runthrough-*`、`codex/publish-runthrough-*`，5 個 migration）：全域觸發器會在發布完成後鎖死已上架商品。10-19 審查後凍結。
- 不要執行「14 件商品整批覆寫 Shopify」：會把 8 個假款式寫回去。
- 不要用 Vercel Promote API（會 422）；上線方式見第 6 節。

## 5. 等老闆
- （以下截至 10-20）5 筆 ⛔ 草稿：三麗鷗類按「重算 tags」；波加曼、波克比各按一次「一鍵新增」；1b42068e 要先在設定新增 IP「元氣少女緣結神」。
- 58f00e61 萌圓歡「端盒【6款不重複】」改成本後再發布。
- 瀏覽器「設定」裡的 AI 供應商改回 GPT。
- GitHub 預設分支改成 handoff。

## 6. 分工與流程（10-21 起，老闆授權 Claude 判斷）
- **防撞三規則**（10-21：CAPTURE-FIX 被兩個對話各自發包，重複做了一次）：
  1. 只有一個「指揮」對話能決定誰做哪一包，其他對話、GPT、小弟只做被分配的那一包。
  2. 一包只給一個施工者，誰在做寫在本檔 §2；§2 沒寫的不准開工。
  3. 對話做完自己那包、收尾後就結束，不要再在那裡發新包或叫 GPT 開工。
- **施工預設交給 GPT**（10-21 老闆：省 Claude 額度；Pro 方案，當天週額度已用 79%）。Claude 只做規格、審查、驗收。規格要寫死 UI 位置／class／文案／狀態，邏輯部分附驗收測試，讓 GPT 能自己用 CI 驗證。
  - Sonnet 小弟施工只在兩種情況使用：GPT 不能用，或老闆指定。（10-21 的 #61、#62 是 Sonnet 做的，屬於例外。）
  - 合併、上線一律由 GPT 做（Claude 的 `gh pr merge` 會被擋）。
- **GPT 包的兩條提速規則**（10-21）：
  1. **一張開工單包到底**：開工指令一次寫完「施工 → Draft PR → 等老闆貼『Claude 審查 PASS』→ 合併 → Redeploy → 驗收 → 回報」，不再另外寫合併指令。老闆中間只需要貼「PASS」或 Claude 的一張修正清單（修正要合併成一次給）。
  2. **測試先行、規格變薄（設計不放手）**：Claude 先寫好該包的驗收測試腳本（`scripts/verify-<包名>.mjs`，推在規格分支），GPT 用 CI 自己跑到全綠再交件。**照舊寫死**：UI（位置／文案／狀態／手機）、使用者流程與邊界情況、做法（改哪些檔案／函式、沿用哪些現有元件、禁止清單），以及跟錢、發布、寫資料有關的邏輯（照舊附程式碼）。**只有簡單的內部程式**改用測試規定，不再整段附程式碼。Claude 照舊逐行審 diff，做法不好就退回。
- **插隊門檻**：只有「會賣錯價、上架失敗、弄壞資料」可以插隊；其他問題寫進總表對應的包，或每週一包「小修合集」。
- **並行**：檔案不重疊的兩包可以同時做（例如外掛／抓取線＋後台網站線）。
- GPT 路線：規格先推 `docs/**` 分支（GPT 只看得到 GitHub）→ GPT 在 `gpt/**` 分支逐檔 commit → Draft PR → CI（verify:all → typecheck → build）→ Claude 本機驗收。
- `gpt/** feat/** docs/** agent/**` 分支不觸發 Vercel 部署（省額度）。
- 上線：合併到 handoff → 等預覽 READY → 以該部署「Redeploy 成 Production」一次 → 驗 `/login` 200，SHA 看 Vercel 部署紀錄的 githubCommitSha（`/api/status` 沒有 SHA 欄位）。
- SQL 只產 migration 檔，由老闆在 Supabase 貼上執行；需要時在合併**前**套。

## 7. 真店測試規則（10-22 老闆定案：STAGING 暫緩，優先「快又安全」推進）
- STAGING 程式已上線（#62），測試場帳號暫不建；高風險包（整批改價、動發布流程、大量改資料）再由指揮提出。
- **畫面驗收由 Claude 自己做**（10-22 老闆）：老闆在 Claude 桌面版內建瀏覽器登入一次，Claude 自己點、自己截圖驗收；寫入真店前仍先問。
- 實機測試用 Shopify **草稿狀態**的專用商品「【測試勿買】Nestory 測試商品」（STOCK 驗收時建立）。正在賣的商品只唯讀查；例外只有「本來就該做」的動作（例：來源售完 → 設售完）。
- 寫入真店／正式資料庫前先問老闆（說清楚改什麼、怎麼改回）。老闆可接受客人端短暫出錯，但**出錯要馬上講並附改回方式**。
- **改之前先備份**：(1) 每次 migration 或大量寫入前，在專案根目錄跑 `node C:/Users/s2491/Documents/Nestory備份/_工具/全部備份.mjs <事由>`（自動存 `Nestory備份/<日期>-<事由>`＋壓縮＋複製到 Google 雲端硬碟 `G:/我的雲端硬碟/Nestory備份/`）（唯讀匯出全部資料表成 JSON，約 12MB；system_prompt_versions／publish_schedule_* 三張表 service role 讀不到，會跳過）；(2) 只改幾筆時，先把那幾筆＋對應 Shopify 商品唯讀存一份到同資料夾。備份留 30 天，刪舊備份要老闆同意。第一份全備：`Nestory備份/2026-10-22-全部`。
