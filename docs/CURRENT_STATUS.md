# Nestory — 現況（CURRENT_STATUS）

> 更新：2026-10-22（Claude）。本檔只放「現在成立」的事，上限約 6KB。
> **寫新進度＝改掉舊句子，不要在最上面再疊一個「最新」區塊。** 包做完就把它從「進行中」刪掉，細節寫進總表那一列。
> 發包順序與每包內容：`docs/發包總表-2026-10-14.md`（唯一來源）。
> 10-07～10-18 的舊紀錄原文（含 Codex PUBLISH-RUNTHROUGH R1–R5）：`docs/archive/STATUS-HISTORY-2026-10-21.md`，需要查歷史才讀。

## 1. 線上狀態
- 主線：`origin/handoff/20261008-golive-spec` @ `9167892`（10-22 合併 #61 CAPTURE-FIX＋#62 STAGING 程式）。
- 正式站：`dpl_EGT4Pvjt5GdABetHkoYYmc3tmaa9`（10-22，9167892；Claude 唯讀驗 `/login` 200、`/api/status` environment=production、problems=[]）；回退點 `dpl_8tMjz6RyLWFMMS1rkvLJ3Ns1sny2`（34399a1）。
- 外掛：老闆 Chrome 載入的 `C:/Users/s2491/Documents/Nestory外掛-0.2.0` 已換成 0.2.1（＝9167892 的 `extension/`；舊版備份 `Nestory外掛-0.2.0-備份`）。
- 本機這個資料夾停在舊分支 `codex/nestory-v0.1-safety-skeleton`（GitHub 預設分支也還是它）→ 看程式先 `git fetch`，一律以 origin/handoff 為準。網址、專案代號、環境變數名稱見 `AI_START_HERE.md` §3。

## 2. 進行中
| 包 | 狀態 | 下一步 |
|---|---|---|
| 1.6 STAGING（帳號） | 程式已上線（#62）。等老闆照 `docs/STAGING-施工規格-2026-10-21.md` §2 建測試場帳號 | 老闆建好 → Claude 照 §4 驗收（`.env.local` 到時才改名成 `.env.prod-readonly.local`） |
| 4b STOCK | Claude 寫規格中（分支 `docs/stock-spec`） | 規格＋`scripts/verify-stock.mjs` 推上 → 交 GPT 施工 `gpt/stock`；**開工前老闆在 Shopify App 加 read_inventory／write_inventory／read_locations** |

之後：4a 問大家＋評價（外掛線，可與後台包並行）→ 5 PRICING → 6 STATUS-SEMANTICS＋OBS-QUEUE → 7 COPY-A → 8 COPY-B → 9–11 UIUX → 12 THEME-SHIP → 13 COPY-C → 14 PERF（細節見總表）。

## 3. 現役風險
- **抓取**：CAPTURE-FIX 10-22 上線、實機驗收通過（天貓 1c89667a 重抓補齊 15 款成本＋3 款來源售完；淘寶 6232c6b0 已上架只更新庫存）。剩 7 筆舊草稿等老闆有空重抓：1b42068e 5a48fe8a 42279f35 b677bf2d a9f82c5f 2cb43ea3 f1e97850。
- **Shopify 權限**：App「Nestory 上架工具」沒有 read_inventory／write_inventory／read_locations → 同步讀不到庫存（#59 已繞開）；做 STOCK 前要老闆補權限。
- **完整同步**：10-21 #59 上線後，第一次真的同步成功還沒親眼確認（之前 63 件全部沒成功過）。
- 已上架商品身上還有假款式（10-13 那批）。
- 本機 `.env.local` 連的是**正式資料庫**（tbgtqwvuohmdxnxisrgr）→ 本機不可跑會寫資料的測試；只能唯讀查。STAGING 建好就解決。

## 4. 不要做
- 不要套用 Codex PUBLISH-RUNTHROUGH R2–R5（`.tmp/publish-runthrough-*`、`codex/publish-runthrough-*`，5 個 migration）：全域觸發器會在發布完成後鎖死已上架商品。10-19 審查後凍結。
- 不要執行「14 件商品整批覆寫 Shopify」：會把 8 個假款式寫回去。
- 不要用 Vercel Promote API（會 422）；上線方式見第 6 節。

## 5. 等老闆
- 照 STAGING 規格 §2 建測試場帳號（約 30 分鐘，有空時做）。
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
