# Nestory — 現況（CURRENT_STATUS）

> 更新：2026-10-22（Claude）。本檔只放「現在成立」的事，上限約 6KB。
> **寫新進度＝改掉舊句子，不要在最上面再疊一個「最新」區塊。** 包做完就把它從「進行中」刪掉，細節寫進總表那一列。
> 發包順序與每包內容：`docs/發包總表-2026-10-14.md`（唯一來源）。
> 10-07～10-18 的舊紀錄原文（含 Codex PUBLISH-RUNTHROUGH R1–R5）：`docs/archive/STATUS-HISTORY-2026-10-21.md`，需要查歷史才讀。

## 1. 線上狀態
- 主線：`origin/handoff/20261008-golive-spec` @ `eb1520e`（10-22：#61 CAPTURE-FIX、#62 STAGING 程式、#63 STOCK、#64 STOCK SKU 對應）。PR #65（/drafts/[id] 卡片載入款式）CI 綠，待 GPT 合併上線。
- 正式站：`dpl_2PQ67RPqAX5w83YBGhz4MMbohhxz`（eb1520e；Claude 唯讀驗 `/login` 200、`/api/status` production、problems=[]）；回退點 `dpl_2iwmmT2kWjYVapqGB4HbhvDsYTky`（041ea68）→ `dpl_EGT4Pvjt5GdABetHkoYYmc3tmaa9`（9167892）。Vercel Production 已設 `SHOPIFY_LOCATION_ID`＝`gid://shopify/Location/87881679033`（忠義路61號3樓，唯一出貨地點）；Shopify App 已有 read_inventory／write_inventory／read_locations。
- 外掛：老闆 Chrome 載入的 `C:/Users/s2491/Documents/Nestory外掛-0.2.0` 已換成 0.2.1（＝9167892 的 `extension/`；舊版備份 `Nestory外掛-0.2.0-備份`）。
- 本機這個資料夾停在舊分支 `codex/nestory-v0.1-safety-skeleton`（GitHub 預設分支也還是它）→ 看程式先 `git fetch`，一律以 origin/handoff 為準。網址、專案代號、環境變數名稱見 `AI_START_HERE.md` §3。

## 2. 進行中
| 包 | 狀態 | 下一步 |
|---|---|---|
| 4b STOCK 收尾 | 已上線並實測：Claude 用老闆登入的內建瀏覽器把 6232c6b0 貝吉塔設售完（Shopify 驗證 DENY／追蹤／0，標記已記錄）。所有已上架商品的 `shopify_variant_id` 都是空的（從沒完整同步過）→ #64 改用唯一 SKU 對應 | #65 上線後確認商品庫「編輯文案」頁出現「來源售完 N 款」；老闆重抓已上架的 8b3a323e（淘寶 1078633351499），Claude 確認同步狀態維持 `never`（驗 migration）|

下一包候選（指揮下一個對話決定）：**SYNC-FIX**（見 §3 完整同步，影響全部已上架商品，建議優先）→ 4a 問大家＋評價（外掛線，可並行）→ 5 PRICING → 6 STATUS-SEMANTICS＋OBS-QUEUE → 7 COPY-A → 8 COPY-B → 9–11 UIUX → 12 THEME-SHIP → 13 COPY-C → 14 PERF。小修合集待收：商品庫搜尋打全形「｜」找不到標題裡的半形「 | 」。

## 3. 現役風險
- **抓取**：CAPTURE-FIX 10-22 上線、實機驗收通過（天貓 1c89667a 重抓補齊 15 款成本＋3 款來源售完；淘寶 6232c6b0 已上架只更新庫存）。剩 7 筆舊草稿等老闆有空重抓：1b42068e 5a48fe8a 42279f35 b677bf2d a9f82c5f 2cb43ea3 f1e97850。
- **款式連結**：66 件已上架商品的 `product_variants.shopify_variant_id` 全空；STOCK 用 SKU 補位，完整同步成功一次就會寫回。
- **完整同步（新發現，10-22）**：6232c6b0 實測同步在第 2 步中斷成 partial：`verifyReadback`（syncShopifyProduct.ts）用字串完全相等比 `descriptionHtml`，Shopify 會正規化 HTML → 永遠不相等。Shopify 端前後完全沒變（描述／價格／圖／tags／SEO／metafields 都一樣，貝吉塔仍售完）。極可能就是 66 件從沒同步成功的根因 → SYNC-FIX：readback 改比正規化後的 HTML（或比寫入前讀到的 Shopify 值），附測試。6232c6b0 目前顯示「部分同步・需對帳」，無害。
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
- 上線：合併到 handoff → 等預覽 READY → 以該部署「Redeploy 成 Production」一次 → 驗 `/login` 200＋SHA。
- SQL 只產 migration 檔，由老闆在 Supabase 貼上執行；需要時在合併**前**套。

## 7. 真店測試規則（10-22 老闆定案：STAGING 暫緩，優先「快又安全」推進）
- STAGING 程式已上線（#62），測試場帳號暫不建；高風險包（整批改價、動發布流程、大量改資料）再由指揮提出。
- **畫面驗收由 Claude 自己做**（10-22 老闆）：老闆在 Claude 桌面版內建瀏覽器登入一次，Claude 自己點、自己截圖驗收；寫入真店前仍先問。
- 實機測試用 Shopify **草稿狀態**的專用商品「【測試勿買】Nestory 測試商品」（STOCK 驗收時建立）。正在賣的商品只唯讀查；例外只有「本來就該做」的動作（例：來源售完 → 設售完）。
- 寫入真店／正式資料庫前先問老闆（說清楚改什麼、怎麼改回）。老闆可接受客人端短暫出錯，但**出錯要馬上講並附改回方式**。
- **改之前先備份**：(1) 每次 migration 或大量寫入前，在專案根目錄跑 `node C:/Users/s2491/Documents/Nestory備份/_工具/全部備份.mjs <事由>`（自動存 `Nestory備份/<日期>-<事由>`＋壓縮＋複製到 Google 雲端硬碟 `G:/我的雲端硬碟/Nestory備份/`）（唯讀匯出全部資料表成 JSON，約 12MB；system_prompt_versions／publish_schedule_* 三張表 service role 讀不到，會跳過）；(2) 只改幾筆時，先把那幾筆＋對應 Shopify 商品唯讀存一份到同資料夾。備份留 30 天，刪舊備份要老闆同意。第一份全備：`Nestory備份/2026-10-22-全部`。
