# RECORDS-CSV 施工規格（2026-10-22，老闆插隊）

> 寫規格：Claude。施工：由**指揮**發包（本檔不指定施工者、不改 CURRENT_STATUS §2）。
> 基準：`origin/handoff/20261008-golive-spec` @ `041ea68`（STOCK #63 已合）。
> 驗收：`npm run verify:records-csv`（`scripts/verify-records-csv.mjs`，RC01–RC28）。Claude 已用拋棄式參考實作跑過：邏輯 RC01–RC23 全過；RC24/26/27/28 是接線檢查，施工完才會過。**不可刪改或放寬任何檢查。**

## 0. 老闆要什麼（10-22 原話整理）

- 「發布紀錄」頁要能**再下載 CSV**，**至少要 Shopify 格式**。
- 要看得到**同一個商品的下載紀錄**（Showmore 下載過幾次、Shopify 發布過幾次）。
- 插隊，**今天就要能用**。
- 老闆提議：既然有 Shopify API，可以從 Shopify 上直接拿資料。→ **採用**：Shopify CSV 一律從 Shopify 讀回現在店上的樣子，不從工具資料庫拼。

## 1. 現況（查證）

| 項目 | 現況 | 位置 |
|---|---|---|
| CSV 下載 | 只在「完成待發布」能下載（Showmore／Matrixify） | `DraftResultsPanel.tsx`、`ResultCard.tsx` → `/api/exports/showmore`、`/api/exports/matrixify` |
| 舊下載 API | 只收 ready／approved／api_failed／csv_ready 的草稿，**而且會把狀態改成 csv_ready** → 已發布的商品不能拿來重下，拿了會把狀態改壞 | `src/app/api/exports/*/route.ts:39-99` |
| 下載有沒有留紀錄 | 有。P1-69 起每次 CSV 匯出都寫進 `publish_batches`（kind=showmore／matrixify）＋`publish_batch_items` | `src/lib/drafts/recordCsvExportBatch.ts` |
| 紀錄頁 | 五分頁：批次／失敗重試／Shopify 草稿／已發布封存／價格重新同步；**沒有任何下載按鈕** | `src/components/records/PublishRecordsPanel.tsx` |
| 小 bug | CSV 匯出的批次卡標題寫成 Shopify 發布的標題、圖示固定 🛍（`batchCardTitle` 不看 kind） | `src/lib/drafts/publishRecords.ts:157-161` |
| 讀 Shopify 商品 | 已有驗證過的唯讀查詢 `PRODUCT_SYNC_SNAPSHOT_QUERY`、`PRODUCT_SYNC_INVENTORY_QUERY` | `src/lib/shopify/fullSyncGraphQL.ts` |

## 2. 範圍

**R1（本包，今天）**
1. 新純函式：Shopify 官方商品 CSV 產生器。
2. 新 API：`POST /api/exports/shopify-csv`，唯讀，從 Shopify 讀商品產 CSV。
3. 紀錄頁「Shopify 草稿」「已發布封存」兩分頁：勾選商品 → 下載 Shopify CSV。
4. 紀錄頁「批次」分頁每張批次卡：⬇ Shopify CSV（下載這批商品）。
5. 每個商品列顯示下載／發布紀錄一行。
6. 批次卡標題、圖示依種類顯示；篩選加「Shopify CSV」。
7. migration：`publish_batches.kind` 加 `shopify_csv`（已寫好，見 §7）。

**不在本包（排 R2，寫進總表）**：Showmore CSV 從紀錄頁重新下載（要另寫唯讀 API，不能動舊 API）、商品庫搜尋結果的勾選、款式圖／重量／條碼欄位。

**禁止**：改舊的 `/api/exports/showmore`、`/api/exports/matrixify` 行為；寫任何 Shopify mutation；改 `product_drafts` 任何欄位；新增 `!important`。

## 3. 純函式（檔名、函式名照寫，測試會 import）

### 3.1 `src/lib/csv/shopifyProductCsv.ts`

- `SHOPIFY_CSV_COLUMNS`：35 欄，順序照測試 RC01（Shopify 官方範本）。
- `buildShopifyProductCsv(items: { product; availableByVariantId?: Record<string, number> | null }[]): string`
  - `product` = `PRODUCT_SYNC_SNAPSHOT_QUERY` 回傳的 `data.product` 原樣。
  - 開頭 `﻿`；表頭不加引號；值一律加雙引號（空值也是 `""`），內部 `"` 變 `""`；換行用 `\n`。
  - 一款一列，每列都有 Handle。**商品層欄位只寫在第一列**：Title、Body (HTML)、Vendor、Product Category、Type、Tags（`, ` 串）、Published（ACTIVE→TRUE 其餘 FALSE）、Option1–3 Name（取第一款 selectedOptions 的 name）、Gift Card（FALSE）、SEO Title、SEO Description、Status（小寫）。
  - Product Category：`category.id` 是 `gid://shopify/TaxonomyCategory/xxx` → 輸出 `xxx`；否則空。
  - 款式欄：Option1–3 Value、Variant SKU、Inventory Tracker（tracked→`shopify` 否則空）、Inventory Qty（map 有該款 id 才填，0 要印 0）、Inventory Policy（小寫）、Fulfillment Service `manual`、Price、Compare At Price、Requires Shipping `TRUE`、Taxable `TRUE`、Cost per item（unitCost.amount）。Grams、Barcode、Variant Image、Weight Unit 留空。
  - 圖片：只取 `mediaContentType === "IMAGE"` 且有 url；第 k 張放第 k 列（Image Src／Position=k+1／Alt Text）；圖比款多 → 多出來的開「只有 Handle＋三個圖片欄」的列。
  - 沒有款式的商品仍輸出一列（只有商品層欄位＋Handle，款式預設值也留空）。
- `normalizeShopifyProductGid(raw)`：純數字→`gid://shopify/Product/N`；已是 Product gid（去空白）→原樣；其他→`null`。
- `sumAvailableByVariant(inventoryProduct)`：`PRODUCT_SYNC_INVENTORY_QUERY` 的 `data.product`；每款加總各倉 `available`；有 inventoryItem 但沒倉＝0；沒 inventoryItem 不放。
- `shopifyCsvFilename(now: Date)`：台北時間 `nestory-shopify-YYYYMMDD-HHmm.csv`。

### 3.2 `src/lib/csv/shopifyCsvExport.ts`

- `collectShopifyCsvProducts(drafts: { draftId; title; shopifyProductId }[], caller)`
  - `caller` 簽名同 `callShopifyAdminGraphQL`（route 傳它本人進來）。
  - 最多同時 4 件；輸出順序＝輸入順序。
  - 每件：沒 id → 略過「還沒在 Shopify 上」（不打 API）；snapshot 回 non-ok／errors／throw → 略過「Shopify 讀取失敗」；product 為 null → 略過「Shopify 找不到這個商品」。
  - snapshot 成功再打 inventory；errors／throw → 該件 `availableByVariantId: null`，整批 `inventoryNote = "庫存欄留空（Shopify 權限不足或讀取失敗）"`，商品照樣匯出。
  - 只准用上面兩個查詢字串原樣，不准自己寫新查詢。
  - 回傳 `{ items, exported: {draftId,title}[], skipped: {draftId,title,reason}[], inventoryNote }`。
- `shopifyCsvExportNote(res)`：`已下載 N 件`＋（有略過）`；略過 M 件（原因A 數量、原因B 數量）`＋（有庫存問題）`；庫存欄留空（…）`。原因依第一次出現的順序。

### 3.3 `src/lib/drafts/publishRecords.ts`（加，不改既有行為）

- `BATCH_KIND_FILTERS` 最後加 `{ key: "shopify_csv", label: "Shopify CSV" }`。
- `batchKindLabel(kind)`：shopify_api→Shopify 發布、showmore→Showmore CSV、matrixify→Matrixify CSV、shopify_csv→Shopify CSV、其他→原字串。
- `batchKindIcon(kind)`：shopify_api→🛍，其他→⬇。
- `batchCardTitle`：showmore→「匯出 Showmore CSV」、matrixify→「匯出 Matrixify CSV」、shopify_csv→「下載 Shopify CSV」；shopify_api 維持原本 `publishBatchTitle(mode)`。
- `formatExportHistory(entries: {kind, at}[])`：空→`null`；新到舊、最多 3 筆、台北 `MM/DD HH:mm`、` · ` 串、前綴「紀錄：」；超過 3 筆尾巴加「（共 N 次）」。

### 3.4 `src/lib/drafts/recordCsvExportBatch.ts`

- `CsvExportBatchKind` 加 `"shopify_csv"`。
- 參數加 `pointDrafts?: boolean`（預設 `true`＝舊行為）。`false` 時**完全不碰 `product_drafts`**（不改 `current_publish_batch_id`，避免影響續跑發布）。

### 3.5 `src/types/domain.ts`

- `PublishBatchKind` 加 `"shopify_csv"`（字串照 RC26）。

## 4. API：`src/app/api/exports/shopify-csv/route.ts`

- `export const maxDuration = 60;`、`export async function POST(request)`。
- 登入；`profiles.role` 必須 `["admin", "reviewer"].includes(...)`，否則 403。
- body 二選一：`{ draftIds: string[] }` 或 `{ batchId: string }`。batchId → 用 service client 讀 `publish_batch_items` 的 `draft_id`。去重；0 件 → 400「沒有選取商品」；超過 50 → 400「一次最多 50 件」。
- service client 讀 `product_drafts`：`id, title_zh, taobao_title, original_title, shopify_product_id`，不篩狀態；title 用 `csvExportDraftTitle`。
- `collectShopifyCsvProducts(drafts, callShopifyAdminGraphQL)`。
- 0 件可匯出 → 422 JSON `{ error: "選取的商品都還沒在 Shopify 上，無法下載 Shopify CSV", skipped }`。
- 有可匯出 → `buildShopifyProductCsv(items)`；best-effort 記帳 `recordCsvExportBatch({ kind: "shopify_csv", drafts: exported, createdBy: user.id, pointDrafts: false })`（失敗不擋下載；migration 未跑時會失敗，正常）。
- 回應 headers：`Content-Type: text/csv; charset=utf-8`、`Content-Disposition: attachment; filename="${shopifyCsvFilename(new Date())}"`、`X-Export-Note: encodeURIComponent(shopifyCsvExportNote(res))`、`Access-Control-Expose-Headers` 不需要（同源）。
- 檔內不准出現 `.update(`／`.upsert(`／`.delete(`／`.rpc(`／`mutation`／`notifyMake`（RC24 靜態檢查）。

## 5. UI（`PublishRecordsPanel.tsx`；只用既有 class，不新增 CSS）

角色閘：以下所有下載 UI 只在 `role === "admin" || role === "reviewer"` 時出現（operator 看不到）。

### 5.1 「Shopify 草稿」「已發布封存」分頁（`ProductListSection`）

- 列表上方（`rec-limit-hint` 之後、`<ul>` 之前）加工具列，**照抄失敗件工具列的結構**：
  ```
  <div className="results-batch-toolbar" role="toolbar" aria-label="下載 Shopify CSV">
    <label className="check-row results-batch-check"><input type="checkbox" …/>全選</label>
    <span className="batch-selected-count">{n>0 ? `已選 ${n} 筆` : "勾選商品下載 Shopify CSV"}</span>
    <button type="button" className="button primary" disabled={busy || n===0}>{busy ? "下載中…" : "⬇ 下載 Shopify CSV"}</button>
  </div>
  ```
  「全選」只選有 `shopify_product_id` 的列。切分頁時清空勾選。
- 每列 `<li className="rec-item rec-product-card">` 最前面加 `<label className="check-row results-batch-check"><input type="checkbox" aria-label={`選取 ${title}`} /></label>`；沒 `shopify_product_id` → `disabled` 且 `title="還沒在 Shopify 上"`。
- 每列 `rec-item-text` 裡、狀態那行 muted 後面：`formatExportHistory(...)` 不是 null 時加 `<br /><span className="muted rec-export-history">{line}</span>`。
- 紀錄資料：`loadProducts` 成功後，用瀏覽器 client 查兩次（不靠 FK 嵌套）：
  1. `publish_batch_items`：`select("draft_id, batch_id, item_status")`、`.in("draft_id", rowIds)`、只留 `item_status === "done"`；
  2. `publish_batches`：`select("id, kind, created_at, completed_at")`、`.in("id", batchIds)`；
  `at = completed_at || created_at`。查失敗 → 不顯示紀錄行，不跳錯。

### 5.2 「批次」分頁批次卡

- `rec-icon` 改顯示 `batchKindIcon(row.kind)`；標題已由 `batchCardTitle` 處理。
- `rec-head` 內、既有「繼續發布」「重跑」按鈕旁：`row.done_count > 0 && row.status !== "processing"` 時顯示
  `<Button size="sm" type="button" className="rec-retry" …>⬇ Shopify CSV</Button>`，`e.stopPropagation()`，送 `{ batchId: row.id }`。

### 5.3 下載動作（兩處共用一個函式）

- `fetch("/api/exports/shopify-csv", { method: "POST", body: JSON.stringify(body) })`。
- 失敗：讀 JSON `error` → `showToast(error, "error")`。
- 成功：blob → 建 `<a download>` 觸發下載（檔名取 `Content-Disposition`，取不到用 `shopifyCsvFilename(new Date())`）；`showToast(decodeURIComponent(res.headers.get("X-Export-Note") ?? ""), "success")`；然後重新載入批次列表與紀錄行。

## 6. 驗收

1. `npm run verify:records-csv` 28/28；`npm run typecheck`、`npm run build` 過；既有 verify 不退步。
2. Claude 審 PR（重點：舊匯出 API 零改動、route 唯讀、`pointDrafts:false`）。
3. 上線後老闆實測（測試商品優先，見 feedback：先用 DRAFT 測試商品）：
   - 「已發布封存」勾 1 件 → 下載 → 用 Excel 開，中文不亂碼、款式／價格／圖片網址正確。
   - 勾 1 件沒上 Shopify 的 → 按鈕不能勾。
   - 批次卡 ⬇ Shopify CSV → 下載整批；toast 顯示略過件數。
   - 商品列出現「紀錄：…」。
   - 跑完 migration 後再下載一次 → 批次分頁多一張「下載 Shopify CSV」卡、篩選「Shopify CSV」看得到。
4. 確認下載前後該商品狀態沒變（仍是已發布／Shopify 草稿）。

## 7. 老闆要貼的 SQL

`supabase/migrations/20261022160000_publish_batches_shopify_csv_kind.sql`（可重跑）。沒貼之前功能照用，只是「Shopify CSV 下載」不會留紀錄。
