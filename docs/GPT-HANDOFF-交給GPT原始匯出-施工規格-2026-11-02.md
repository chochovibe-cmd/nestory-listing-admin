# GPT-HANDOFF：交給 GPT 原始匯出（施工規格，2026-11-02，Claude）

## 0. 目的（老闆定案）
文案線還沒做完前的**過渡上架方式**：外掛抓到的原始資料，不經內建 AI，直接匯出成 CSV 給老闆自己的 ChatGPT。
**所有欄位（標題、描述、標籤、SEO、售價、圖片排序…）都由 GPT 負責**，老闆自己把 GPT 產出的檔案匯入 Shopify。
工具只做三件事：①輸入區可選「交給 GPT」送出（不叫 AI、不算售價）②卡片區新分頁「交給 GPT」列出這些商品 ③批次匯出原始 CSV。**不做貼回工具。**

基準：`origin/handoff/20261008-golive-spec` @ bd7078a，分支 `agent/gpt-raw-export`。

## 1. 資料庫（migration 檔，只產檔，不准執行）
新檔 `supabase/migrations/20261102100000_gpt_handoff.sql`：
```sql
alter table public.product_drafts
  add column if not exists gpt_handoff_at timestamptz,
  add column if not exists gpt_exported_at timestamptz;
```
- 兩欄都可為 null，不加預設值、不回填。`mark_linked_product_draft_dirty` 用的是明確欄位清單，新欄位不會觸發 dirty，不用改觸發器。
- 若 `verify-sql-schema` / `verify-supabase-migration-baseline` 需要登記新 migration，照現有做法登記。
- `src/types/domain.ts` 的 ProductDraft 加 `gpt_handoff_at?: string | null; gpt_exported_at?: string | null;`

狀態規則：交給 GPT 的草稿 **status 維持 `pending_input`、pipeline_stage 維持 `input`、generation_status 不動、不進生成佇列**。
「是不是交給 GPT」只看 `gpt_handoff_at is not null`；「已匯出」看 `gpt_exported_at is not null`。

## 2. 左邊輸入區：生成方式切換
檔案：`src/components/listing/WorkspaceInputPanel.tsx`（手機版若 submit 區在別的元件，一併處理）。

**位置**：緊貼在「✦ 生成」送出按鈕（`btn-gen-short` 那顆）的正上方，同一個容器內；桌面與手機都要有。
**長相**：沿用「一般／二手」那組的寫法：`<div className="pill-group …" role="group" aria-label="生成方式">`，兩顆 `pill-btn`，選中加 `active`：
- `AI 生成`（預設）
- `交給 GPT`

**記憶**：存在這台裝置（沿用 `writeWorkspacePref` / 讀取方式，key 名 `handoffMode`，值 `"ai" | "gpt"`）。不動頂部 `ProviderSwitcher`、不動「🤖 本次」按鈕。

**選「交給 GPT」時**：
- 送出按鈕文字改成 `📤 送出給 GPT`（短版文字也改同一句）。
- 按鈕下方一行 muted 小字：`不會呼叫 AI，也不用填售價；送出後到右邊「交給 GPT」分頁匯出 CSV。`
- 其他欄位、AI 文案設定區**都不改**（不要變灰、不要隱藏）。

**按「📤 送出給 GPT」的行為**（在 `submit` 裡分支，不要複製一份新流程）：
1. 檢查：標題不可空（照舊）、庫存欄位格式（照舊）。**跳過 `validateCostRequirement`**（沒成本也能送）。
2. 照常 persistDraft 存表單欄位與款式，但：
   - `status` 維持／設為 `pending_input`、`pipeline_stage` = `input`；**不寫** `generation_status`。
   - **不寫** `twd_cost`、`twd_price`、`compare_at_price`（保留原值）。
   - 寫 `gpt_handoff_at = 現在`、`gpt_exported_at = null`（重送一次＝回到待匯出）。
3. **不呼叫** `/api/generation-queue`、不發 `GENERATION_QUEUE_KICK_EVENT`。
4. 成功後：跟一般生成成功一樣清空表單、準備下一件；toast（沿用現有 toast）：`已送到「交給 GPT」：<標題前 20 字>`。右邊卡片區**不自動切分頁**，但「交給 GPT」分頁數字要立即 +1、清單出現這件（不用重新整理頁面）。
5. 失敗：沿用現有錯誤顯示，訊息中文：`送出失敗：<原因>`。

**一般「AI 生成」送出時**：多寫 `gpt_handoff_at = null`、`gpt_exported_at = null`（從 GPT 分頁叫回來改用 AI 的商品就會離開分頁）。其餘完全照舊。

## 3. 右邊卡片區：「交給 GPT」分頁
檔案：`src/components/drafts/StageFilterPills.tsx`、`src/lib/drafts/stationFilter.ts`、`src/components/listing/DraftResultsPanel.tsx`、資料載入 `src/app/drafts/new/page.tsx`。

**資料**：在 page.tsx 另外查一份「交給 GPT」清單（`gpt_handoff_at is not null` 且 status ≠ `archived`，照 `gpt_handoff_at` 新到舊，最多 200 筆；權限範圍與現有卡片區相同），連同主圖（第一張 main，依 sort_order）、款式數、款式成本最小／最大值、價格提醒（§5 同一個函式）傳給 DraftResultsPanel。不要塞進現有 40 筆工作佇列，也不要讓它們出現在三站。

**分頁鈕**：在 StageFilterPills 最後面加一顆 `pill-btn`，文字 `交給 GPT`，數字＝**待匯出**件數（顯示方式跟其他站的數字一樣）。清單完全沒有（待匯出＋已匯出＝0）時這顆不顯示。新增 filter key `"gpt"`。

**分頁內容**（點了 `交給 GPT` 後，取代卡片列表的位置）：
1. 上方兩顆小篩選，沿用 globals.css 裡現有的小型 chip／pill 樣式（挑一個現成的，回報用了哪個 class）：`待匯出 N`（預設）、`已匯出 N`。
2. 批次列：沿用 `rc-batch-strip`（不加站別修飾）＋ `rc-batch-actions batch-actions`，內容依序：
   - 全選 checkbox（同卡片區寫法）＋ `已選 N 筆`／沒選時 `勾選商品以匯出`
   - 主要按鈕：待匯出時 `⬇ 匯出原始 CSV（N）`，已匯出時 `⬇ 重新匯出（N）`；沒勾選時 disabled；匯出中文字 `匯出中…` 並 disabled。
   - 次要按鈕 `封存`：呼叫現有 `POST /api/drafts/batch/archive`（action archive），沿用卡片區現有的封存確認與「復原」toast 寫法。
3. 清單，每件一列（沿用現有列表／列的 class，不新造樣式）：
   - checkbox｜主圖縮圖 48px（沒圖顯示現有的空圖樣式）｜文字區：
     - 第一行：原始標題（最多兩行，超過截斷）；點標題＝新分頁開 `source_url`（沒有就不是連結）。
     - 第二行 muted：`<來源平台> · <N> 款 · 成本 ¥<min>–¥<max>（同價只顯示一個；全沒成本顯示「成本未抓到」）· 送出 MM/DD HH:mm`；已匯出的再加 `· 已匯出 MM/DD HH:mm`。
     - 有價格提醒時，在第二行後面加現有的警告小標（沿用現有 warning badge class），文字＝提醒內容。
   - 列最右邊一個文字按鈕 `回輸入區` → 前往 `/drafts/new?draft=<id>`（現有的回填路徑；草稿仍是 pending_input 所以可以載入）。
4. 空狀態（沿用現有 empty 樣式）：待匯出空＝`沒有待匯出的商品。左邊選「交給 GPT」再送出，就會出現在這裡。`；已匯出空＝`還沒有匯出過。`

手機版：分頁鈕與清單都要出現，清單列可以換行堆疊，不准水平捲動。

## 4. 匯出 API
新 route：`POST /api/exports/gpt-raw`，body `{ draftIds: string[] }`。
- 驗證、權限、取資料的方式**照 `src/app/api/exports/matrixify/route.ts`**。
- 1～100 筆；超過回 400 `一次最多匯出 100 件`；有封存的、或 `gpt_handoff_at` 是 null 的 → 400 `有商品不在「交給 GPT」清單，請重新整理`。
- 取 draft＋product_images＋product_variants，用 §5 的純函式產 CSV。
- **產檔成功後**才把這些草稿的 `gpt_exported_at` 設為現在；失敗不改任何資料。
- 回傳 `text/csv; charset=utf-8`。前端下載檔名：`交給GPT-原始資料-YYYYMMDD-HHmm-N件.csv`（本地時間），成功 toast：`已匯出 N 件，檔案已下載`，清單更新（移到已匯出）、清空勾選。失敗 toast：`匯出失敗：<中文原因>`。

## 5. CSV 格式（純函式 `src/lib/csv/gptRawExport.ts`，不碰網路／資料庫）
匯出：`buildGptRawCsv(products)`、`gptPriceWarnings(product)`（第 3 節清單也用它）。
- 開頭 UTF-8 BOM（`﻿`），換行 `\r\n`，**每格都用雙引號包**，內容的 `"` 變 `""`，格內換行保留。
- 欄位（順序固定，表頭就是這些中文）：
  `商品編號, 來源平台, 來源連結, 原始標題, 品牌, IP, 角色, 規格參數, 備註, 影片連結, 主圖, 詳情圖, 價格提醒, 選項1名稱, 選項1, 選項2名稱, 選項2, 選項3名稱, 選項3, SKU, 成本（人民幣）, 促銷價（人民幣）, 來源庫存, 來源狀態, 款式圖`
- **列**：有款式＝每款一列（依 sort_order）；沒款式＝一列（選項欄空白，SKU／成本取商品本身）。
- `商品編號`（草稿 id 前 8 碼）與 `原始標題` **每列都填**；`來源平台`～`價格提醒` 只填在該商品**第一列**，其他列空白。
- 原始標題：左邊表單「標題」實際存的那個欄位優先，沒有再用 `taobao_title`、`original_title`。
- 影片連結：多個用換行分隔。
- 主圖／詳情圖：只取 `image_type` = `main`／`detail`，各自依 sort_order；網址 `processed_file_url || original_file_url`，空的跳過；每張一行，格式 `主圖1 <網址>`、`詳情圖1 <網址>`（編號從 1 連續）。其他類型圖片不放。
- 成本：數字照原樣（不換算台幣）；null、≤ 0.01（佔位值）→ 空白。促銷價：從款式（或商品）抓到的促銷價，沒有就空白。
- 來源庫存：`source_quantity`，沒有＝空白。來源狀態：`in_stock`→`有貨`、`sold_out`→`售完`、其他／沒有→`不明`。
- 款式圖：款式 `image_id` 對到的圖片網址；沒有空白。
- 價格提醒（多個用 `；` 連接，沒有＝空白）：
  - 抓取價格可信度是 `needs_confirmation`、`conflict`、`display_only`、`unknown` → `來源價格需確認`
  - 有款式但部分款式成本空白 → `部分款式沒抓到成本`；全部沒成本（或沒款式且商品成本空白）→ `沒抓到成本`

## 6. 不准做
- 不准動：`extension/`、`src/lib/import/**`、`/api/generate`、生成佇列邏輯（除了 GPT 模式不 enqueue）、發布／同步、現有 Matrixify／Showmore 匯出、`ProviderSwitcher`、「🤖 本次」按鈕。
- 不准新增顏色、圓角、陰影、字級值，不准新增 `!important`；只用 globals.css 既有 class／tokens（真的需要新 class，只能組合既有 tokens，並在回報列出）。
- 不准加規格以外的按鈕、欄位、說明文字、動畫、自動切分頁。
- 不准執行 migration、不准跑會寫資料庫的指令（`.env.local` 連的是正式資料庫）、不准 push、不准 deploy。

## 7. 驗收（完成標準）
新增 `scripts/verify-gpt-handoff.mjs`（寫法照 `scripts/verify-4f.mjs`，無網路無資料庫），加進 `scripts/verify-all.mjs` 與 package.json `verify:gpt-handoff`。至少測：
1. BOM、`\r\n`、表頭字串完全相符、引號跳脫、格內換行。
2. 3 款商品 → 3 列；編號／標題每列都有；平台～價格提醒只在第一列。
3. 沒款式商品 → 1 列，成本取商品。
4. 圖片：main／detail 分開、依 sort_order 編號、其他類型與空網址不出現。
5. 成本 0.01 → 空白且提醒含 `沒抓到成本`；部分款式沒成本 → `部分款式沒抓到成本`；可信度 needs_confirmation → `來源價格需確認`。
6. 來源狀態對照三種。
7. 靜態：migration 檔含兩欄；`/api/exports/gpt-raw/route.ts` 存在且會設 `gpt_exported_at`；StageFilterPills 有 `交給 GPT`；WorkspaceInputPanel 有 `送出給 GPT` 且 GPT 分支不呼叫 generation-queue；globals.css 的 `!important` 數量沒增加。

全部要過：`pnpm verify:gpt-handoff`、`pnpm verify:all`、`pnpm typecheck`、`pnpm build`。
完成後在分支上 commit（訊息 `GPT-HANDOFF: hand-off mode + 交給 GPT tab + raw CSV export`），不要 push。
