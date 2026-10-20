# 1.5a SHOPIFY-RECONCILE 施工規格（2026-10-20，Claude 總指揮）

> 施工者：GPT（GitHub 連接工具，在 `gpt/shopify-reconcile` 分支逐檔 commit → Draft PR → CI）。
> 基準：`handoff/20261008-golive-spec` @ `25cbb05`（正式站同一版）。
> **本規格沒寫到的 UI、欄位、文字、class，一律不准自行新增。有疑問先停下，在 PR 留言回報。**

---

## 0. 老闆已拍板（10-16、10-20）

| 決策 | 結論 |
|---|---|
| 方向（10-16） | 偵測＋逐欄選，不做全自動雙向 |
| 範圍（10-20） | 只做 1.5a。只在一邊的款式逐款選、圖片比對、上架狀態雙向 → 留給 1.5b，**本包不做** |
| 商品類別（10-20） | **只補空的**：Shopify 類別是空的才送工具算出來的類別；Shopify 已有類別一律不動，不放進比對表 |
| 沒有基準點的舊商品（10-20） | **不預選**，每個不同的欄位都要選完才能套用；有「全部用工具／全部用 Shopify」快速鍵 |

## 1. 為什麼要做（現況，Claude 10-20 唯讀查正式資料）

- 正式 DB 有 63 件商品有真的 Shopify ID，**沒有任何一件 `shopify_remote_updated_at` 有值**，也就是完整同步從來沒成功過。
  所以每一件按「同步 Shopify」都會走 `syncShopifyProduct.ts:561-572` 被擋成 `remote_conflict`，畫面只剩「以工具版本覆蓋」（`ShopifySyncControls.tsx:501-512`）。
- 10-19 那 17 筆 `shopify_sync_jobs` 是價格／款式圖重同步（variantResync），不是完整同步。
- 衝突判斷只看 `updatedAt`（`syncShopifyProduct.ts:573-588`），不知道哪一欄被改。
- 同步送出的 `desiredCore()`（`syncShopifyProduct.ts:302-315`）沒帶 `category`，舊商品類別一直是空的（總表第 14 列 ④）。
- 發布成功（`publishDraftSafe.ts` `finishLocalSuccess`）不會記任何同步基準點，所以剛發布的商品第一次同步也一定被擋。

## 2. 本包要做的事（總覽）

| # | 項目 | 檔案 |
|---|---|---|
| R1 | 新增欄位 `product_drafts.shopify_sync_baseline jsonb`（migration 檔，**不要自己套用**） | `supabase/migrations/20261020100000_shopify_sync_baseline.sql` |
| R2 | 純函式模組：欄位清單、正規化、比對狀態、能不能拉回、拉回要寫什麼 | 新檔 `src/lib/shopify/reconcileFields.ts` |
| R3 | 把同步的「組裝工具版本」抽成共用函式，同步和比對都用它 | `src/lib/shopify/syncShopifyProduct.ts` |
| R4 | 同步改用逐欄比對來判斷衝突；成功後寫基準點；類別只補空 | `src/lib/shopify/syncShopifyProduct.ts`、`src/lib/shopify/fullSyncGraphQL.ts`、`scripts/graphql/shopify-full-sync-2026-04.graphql` |
| R5 | 比對 API（唯讀）＋套用 API（拉回工具→整件同步） | 新檔 `src/lib/shopify/shopifyDiff.ts`、新 route `src/app/api/drafts/[id]/shopify-diff/route.ts`、新 route `src/app/api/drafts/[id]/shopify-resolve/route.ts` |
| R6 | 發布成功後順手記基準點（失敗不影響發布） | `src/lib/shopify/publishDraftSafe.ts` |
| R7 | 比對表彈窗取代「以工具版本覆蓋」 | `src/components/listing/ShopifySyncControls.tsx`、`src/app/globals.css`（只加 §8.6 列出的 class） |
| R8 | 型別 | `src/types/domain.ts` |
| R9 | 驗證腳本 | 新檔 `scripts/verify-shopify-reconcile.mjs`、`scripts/verify-all.mjs`、`package.json` |
| R10 | 文件 | `docs/Mockup差異備忘.md`（新增差異 49）、本規格檔一起放進 PR |

**不准動**：`ResultCard.tsx`（不用改）、`variantResync.ts`、`reconcileDraft.ts`、`/api/drafts/[id]/reconcile-shopify`（那是「發布失敗對帳」，名字像但跟本包無關，不要碰也不要改名）、圖片／款式新增刪除邏輯、庫存邏輯、任何其他 migration、`vercel.json`。

---

## 3. R1 migration

新檔 `supabase/migrations/20261020100000_shopify_sync_baseline.sql`，內容**一字不改**：

```sql
-- 1.5a SHOPIFY-RECONCILE: per-field snapshot of what Shopify held right after the
-- last verified full sync or publish. Used to tell "Shopify was edited" apart from
-- "the tool was edited". Additive only; old code ignores it.
alter table public.product_drafts
  add column if not exists shopify_sync_baseline jsonb;

comment on column public.product_drafts.shopify_sync_baseline is
  '1.5a SHOPIFY-RECONCILE baseline: {version:1,capturedAt,remoteUpdatedAt,product:{fieldKey:normalized},variants:{variantGid:{price,compareAtPrice,sku}}}';
```

- 不加 trigger、不改 `mark_linked_product_draft_dirty`（這個欄位不該讓商品變 dirty）。
- 上線順序：**先套 migration，再合併**（§11）。程式不用做「欄位不存在」的相容處理。

## 4. R8 型別（`src/types/domain.ts`）

在 `ProductDraft` 介面裡 `shopify_sync_error?: string | null;`（現在約第 167 行）下一行加：

```ts
  /** 1.5a SHOPIFY-RECONCILE (migration 20261020100000). */
  shopify_sync_baseline?: ShopifySyncBaseline | null;
```

並在檔案內 `ShopifySyncStatus` 型別定義下方加：

```ts
/** 1.5a SHOPIFY-RECONCILE: Shopify values (normalized strings) right after the last verified sync/publish. */
export interface ShopifySyncBaseline {
  version: 1;
  capturedAt: string;
  remoteUpdatedAt: string;
  product: Partial<Record<
    | "title" | "description" | "seoTitle" | "seoDescription" | "why" | "highlights"
    | "faq" | "specs" | "tags" | "vendor" | "productType" | "handle",
    string
  >>;
  variants: Record<string, { price: string; compareAtPrice: string; sku: string }>;
}
```

---

## 5. R2 `src/lib/shopify/reconcileFields.ts`（新檔，純函式，不可 import supabase、不可呼叫網路）

### 5.1 欄位清單（順序＝比對表顯示順序，文字一字不改）

```ts
export const PRODUCT_RECONCILE_FIELDS = [
  { key: "title", label: "標題" },
  { key: "description", label: "商品描述" },
  { key: "seoTitle", label: "SEO 標題" },
  { key: "seoDescription", label: "SEO 描述" },
  { key: "why", label: "為什麼選它" },
  { key: "highlights", label: "商品賣點" },
  { key: "faq", label: "問與答" },
  { key: "specs", label: "商品規格" },
  { key: "tags", label: "標籤" },
  { key: "vendor", label: "廠商" },
  { key: "productType", label: "商品類型" },
  { key: "handle", label: "網址代稱" }
] as const;

export const VARIANT_RECONCILE_FIELDS = [
  { key: "price", label: "售價" },
  { key: "compareAtPrice", label: "原價（劃線價）" },
  { key: "sku", label: "SKU" }
] as const;
```

列的 key 格式：商品欄位 `product:<key>`（例 `product:faq`）；款式欄位 `variant:<Shopify 款式 gid>:<key>`（例 `variant:gid://shopify/ProductVariant/123:price`）。

**不在比對表的東西**（寫死，不准加）：上架狀態（沿用 Shopify，現有行為）、庫存（現有行為不變）、圖片／影片（照現有「以工具為準＋移除前確認」）、商品類別（§6.4 只補空）、款式選項名稱、只在一邊的款式（只列名字，§8.3 區塊 D）。

### 5.2 正規化（比對和基準點都用同一套）

```ts
export function normText(value: unknown): string
```
- `null/undefined` → `""`；其他 `String(value)`；`\r\n`、`\r` → `\n`；每一行去掉行尾空白；連續 3 個以上換行壓成 2 個；整段 `trim()`。

```ts
export function normPrice(value: unknown): string
```
- `null/undefined/""` → `""`；`Number(value)` 不是有限數字 → `""`；否則 `String(Math.round(Number(value) * 100) / 100)`（`"2480.00"` → `"2480"`、`2480.5` → `"2480.5"`）。

```ts
export function normCompareAt(value: unknown): string
```
- 先 `normPrice`；結果是 `""` 或數值 `<= 0` → `""`。

```ts
export function normTags(tags: readonly string[] | null | undefined): string
```
- 每個 `trim()`、去掉空字串、去重、用 `localeCompare` 排序、以 `"\u0001"` 串起來。

```ts
export function descriptionCompareText(html: string | null | undefined): string
```
依序：
1. 空 → `""`。
2. 刪掉所有 `<script ...>...</script>`（regex `/<script\b[^>]*>[\s\S]*?<\/script>/gi`）。
3. 如果有 `<!-- nestory-desc-embed -->`，從它開始到結尾全部刪掉。
4. 刪掉站內連結段落：`/<p>更多[^<]*周邊 → <a\b[^>]*>看看還有什麼<\/a><\/p>/g`。
5. `htmlDescriptionToPlainText()`（`src/lib/contentGenerator/htmlFormat.ts` 既有函式，直接 import）。
6. 刪掉「整行（trim 後）完全等於任一句銷售狀態提醒」的行。提醒句來源：`listAllSaleStatusNotices()`（`src/lib/contentGenerator/saleStatusNotice.ts` 既有）取 `.text` 去重。
7. `normText()`。

### 5.3 從兩邊取值

```ts
export type ReconcileValues = {
  product: Partial<Record<ProductFieldKey, string>>;      // 已正規化
  variants: Record<string, { price: string; compareAtPrice: string; sku: string }>; // key = Shopify 款式 gid
};
```

`export function toolValuesFromDesired(input: { core, desiredVariants }): ReconcileValues`
- `core` ＝ §6.1 `buildSyncDesiredState()` 回傳的 `core`（就是送 `productUpdate` 的物件）。
- `title` = `normText(core.title)`；`description` = `descriptionCompareText(core.descriptionHtml)`；`seoTitle` = `normText(core.seo?.title)`；`seoDescription` = `normText(core.seo?.description)`；`vendor`、`productType` 同 `normText`；`tags` = `normTags(core.tags)`。
- `handle`：**只有 `core.handle` 有值時才放**（工具沒管網址代稱就不比）。
- `why/highlights/faq/specs`：在 `core.metafields` 找 `namespace === "custom"` 且 key 分別為 `why_nestory_pick / product_highlights / product_faq / product_specs` 的 `value`，`normText`；找不到 → `""`。
- 款式：每個 `desiredVariants` 裡 **有 `remote` 的**，用 `remote.id` 當 key：`price = normPrice(seed.price)`、`compareAtPrice = normCompareAt(seed.compareAtPrice)`、`sku = normText(seed.sku)`。

`export function shopifyValuesFromSnapshot(snapshot: ShopifySyncSnapshot): ReconcileValues`
- 對應欄位：`title`、`descriptionHtml`（用 `descriptionCompareText`）、`seo.title`、`seo.description`、`vendor`、`productType`、`tags`（`normTags`）、`handle`（一律放）。
- 4 個中繼欄位：`snapshot.metafields.nodes` 裡 `namespace === "custom"` 同上 4 個 key 的 `value`，沒有 → `""`。
- 款式：每個 `snapshot.variants.nodes`：key = `id`，`price = normPrice(price)`、`compareAtPrice = normCompareAt(compareAtPrice)`、`sku = normText(sku)`。

`export function buildBaselineFromSnapshot(snapshot, capturedAt: string): ShopifySyncBaseline`
- `{ version: 1, capturedAt, remoteUpdatedAt: snapshot.updatedAt, product: shopifyValuesFromSnapshot(snapshot).product, variants: shopifyValuesFromSnapshot(snapshot).variants }`。

### 5.4 比對列與狀態

```ts
export type ReconcileState = "tool" | "shopify" | "both" | "unknown";
export type ReconcileChoice = "tool" | "shopify";
export type ReconcileRow = {
  key: string;                 // §5.1 key 格式
  group: "product" | "variant";
  field: string;               // ProductFieldKey 或 "price"|"compareAtPrice"|"sku"
  label: string;               // §5.1 label
  variantId?: string;          // 款式列才有
  variantLabel?: string;       // 款式列才有：工具款式的選項值以「 / 」串起；沒有選項值 → "單一款式"
  state: ReconcileState;
  tool: string;                // 正規化值
  shopify: string;             // 正規化值
  pullable: boolean;           // 能不能選「用 Shopify」
  pullBlockedReason: string | null;
  preselect: ReconcileChoice | null;
};
```

`export function computeReconcileRows(input: { tool: ReconcileValues; shopify: ReconcileValues; baseline: ShopifySyncBaseline | null; legacyUnchanged: boolean; variantLabels: Record<string, string>; pullability: Record<string, { pullable: boolean; reason: string | null }> }): ReconcileRow[]`

- 只產生「兩邊都有這個 key 且 `tool !== shopify`」的列。商品欄位：`tool.product[key]` 是 `undefined`（例如工具沒管 handle）→ 不產生列。款式：只比兩邊都有的款式 gid。
- 狀態（B = 基準點值）：
  - `baseline` 有值、且 B 存在：
    - `shopify === B` → `"tool"`（工具有改）
    - `tool === B` → `"shopify"`（Shopify 有改）
    - 其他 → `"both"`
  - `baseline` 有值但這個 key 的 B 不存在（例：新款式）→ `"unknown"`
  - `baseline` 是 null 且 `legacyUnchanged === true` → `"tool"`（舊版完整同步成功過〔有 `shopify_sync_hash`〕且 Shopify 之後沒更新，見 §6.2；比對 API 也用同一個算法）
  - 其他 → `"unknown"`
- `pullable`／`pullBlockedReason` 從 `input.pullability[key]` 帶入（§5.5 算）。
- `preselect`：`"tool"` 狀態 → `"tool"`；`"shopify"` 狀態且 `pullable` → `"shopify"`；其他一律 `null`（**不預選**，老闆 10-20 拍板）。
- 回傳順序：先商品列（§5.1 順序），再款式列（依 `desiredVariants` 順序，每款內依 price → compareAtPrice → sku）。

`export function blockingRows(rows: ReconcileRow[]): ReconcileRow[]` → `rows.filter(r => r.state !== "tool")`。

### 5.5 能不能「用 Shopify」（模擬法，必做）

**放哪裡**：`localPatchForChoice`、`isBlockedAutoSku` 放 `reconcileFields.ts`（純函式）；需要重組工具版本的 `computePullability()` 放 `src/lib/shopify/shopifyDiff.ts`（因為它要呼叫 `syncShopifyProduct.ts` 的 `buildSyncDesiredState`，而那個檔 import 了 `node:crypto`）。`computePullability` 也必須是純函式（不讀 DB、不打網路），並 export 給驗證腳本用：

```ts
export function computePullability(input: {
  draft: any; variantRows: ProductVariantRow[]; internalLinkMap: InternalLinkMap;
  before: ShopifySyncSnapshot; productId: string; rows: ReconcileRow[];
}): Record<string, { pullable: boolean; reason: string | null }>
```

`localPatchForChoice` 簽名（寫死）：

```ts
export function localPatchForChoice(input: {
  row: ReconcileRow;
  snapshot: ShopifySyncSnapshot;
  draftId: string;
  planMode: "multi" | "single";
  variantRowId: string | null;   // 多款時該 Shopify 款式對應的工具款式列 id；單一款式為 null
}): { table: "product_drafts" | "product_variants"; id: string; patch: Record<string, unknown> }
```
`table === "product_drafts"` 時 `id = draftId`；`product_variants` 時 `id = variantRowId`。多款但 `variantRowId` 為 null（不應發生）→ 丟錯，由呼叫端轉成 `pullable=false`。

原則：把 Shopify 的值套進「一份複製的工具資料」，重新跑一次 §6.1 `buildSyncDesiredState()` 的純組裝部分（不讀 DB、不打 Shopify，用已載入的 `internalLinkMap` 與 `before` snapshot），再用 `toolValuesFromDesired()` 取同一個 key：**等於 Shopify 值才 `pullable = true`**，否則 `false`。每一列各模擬一次。

`export function localPatchForChoice(row, shopifyRaw, context)` 回傳要寫回工具的內容（模擬與真正寫入都用它，**同一個函式**）：

| 欄位 | 寫到哪 | 值 |
|---|---|---|
| title | `product_drafts.title_zh` | Shopify `title` 原字串 trim |
| description | `product_drafts.description_html` | `descriptionCompareText(Shopify descriptionHtml)`（純文字，跟 ResultCard 存檔格式一樣） |
| seoTitle | `product_drafts.seo_title` | Shopify `seo.title` trim，空 → `null` |
| seoDescription | `product_drafts.seo_description` | Shopify `seo.description` trim，空 → `null` |
| why | `product_drafts.why_we_chose_it` | metafield 值 trim，空 → `null` |
| highlights | `product_drafts.product_highlights` | metafield 值依 `\n` 拆行，每行去掉開頭 `/^[・･•➼]\s*/`、trim、去空行 → `string[]`（空 → `[]`） |
| faq | `product_drafts.generated_faq_html` | `normalizeFaqOutput(metafield 值)`（`copyFormatRepair.ts` 既有），空 → `null` |
| specs | `product_drafts.spec_text` | metafield 值 trim，空 → `null` |
| tags | `product_drafts.shopify_tags` | Shopify `tags` 陣列原樣（trim、去空） |
| vendor | `product_drafts.vendor` | Shopify `vendor` trim |
| productType | `product_drafts.product_type` | Shopify `productType` trim，空 → `null` |
| handle | `product_drafts.shopify_handle` | Shopify `handle` trim |
| 款式 price（多款） | `product_variants.twd_price`＋`sell_price_locked = true` | `Number(remote.price)` |
| 款式 compareAtPrice（多款） | `product_variants.compare_at_price`＋`compare_at_locked = true` | `remote.compareAtPrice` 有值且 > 0 → `Number(...)`，否則 `null` |
| 款式 sku（多款） | `product_variants.sku` | `remote.sku` trim |
| 單一款式 price | `product_drafts.twd_price` | `Number(remote.price)` |
| 單一款式 compareAtPrice | `product_drafts.compare_at_price` | 同上規則 |
| 單一款式 sku | `product_drafts.sku` | `remote.sku` trim |

「多款」＝`buildVariantPublishPlan()` 回 `mode === "multi"`，該列對應的工具款式列 `row` 有值；「單一款式」＝`mode === "single"`。

**額外硬性擋（模擬前先判斷，命中就 `pullable=false` 不必模擬）**：
- SKU：`isAutoSku(Shopify 值)`（`src/lib/variants/variantSku.ts` 既有）為 true，且不是「本商品自己的 NS 編號」（`/^NS-([0-9A-F]{6})-\d{2,}$/` 且前綴 = `skuPrefix(draft.id)`）→ reason `這是淘寶／系統編號，工具固定使用 NS 編號`。

**擋下原因文字（一字不改）**：
- SKU 規則 → `這是淘寶／系統編號，工具固定使用 NS 編號`
- `description` 模擬不相等 → `這件的描述拉回後格式會跑掉，請用工具版本，或之後到工具裡手動改`
- 其他任何欄位模擬不相等 → `工具的規則會改寫這一欄，存回去也留不住，只能用工具版本`

---

## 6. R3／R4 同步引擎（`src/lib/shopify/syncShopifyProduct.ts`）

### 6.1 抽出共用組裝

把現在第 590–689 行「讀 internal link 設定 → 篩圖片 → `buildShopifyProductPayload` → `desiredCore` → 款式 plan/seeds → `matchVariants` → `variantRemovals` → 圖片 media inputs」整段，抽成同檔 export：

```ts
export async function loadSyncInputs(serviceSupabase, draftId): Promise<
  | { ok: true; draft: any; variantRows: ProductVariantRow[]; internalLinkMap: InternalLinkMap }
  | { ok: false; status: number; error: string; code?: string }
>
export function buildSyncDesiredState(input: {
  draft: any; variantRows: ProductVariantRow[]; internalLinkMap: InternalLinkMap; before: ShopifySyncSnapshot; productId: string;
}): {
  built: any; core: Record<string, any>; rows: ProductVariantRow[]; plan: VariantPublishPlan; seeds: ShopifyVariantSeed[];
  desiredVariants: DesiredVariant[]; variantRemovals: ShopifySyncSnapshot["variants"]["nodes"];
  images: ProductImage[]; imageMediaInputs: ...; desiredVideoInputs: ...;
}
```
- `loadSyncInputs` 做現在 489–526 行（讀草稿＋圖片、讀款式、重複款式檢查）與 590–597 行（internal link map）的 DB 讀取；錯誤碼、訊息、狀態碼**照原樣**。
- `buildSyncDesiredState` **必須是純函式**（不讀 DB、不打網路），§5.5 模擬就是重複呼叫它。
- 執行順序（寫死）：live test guard → `loadSyncInputs`（只讀 DB：草稿、真 Shopify ID 檢查、款式、重複款式檢查、link map）→ **mock 判斷**（回傳內容與現在 506–514 行完全一樣；mock 時不可有任何 Shopify 呼叫、不可寫 DB）→ `loadSnapshot` → live-test DRAFT 檢查 → `buildSyncDesiredState` → §6.2 衝突判斷 → ACTIVE 確認 → 圖片數量檢查（現 651–658）→ 圖片 identity → 移除確認 → claim → job → 寫入（後面全部照舊）。
- `syncShopifyProduct` 改成呼叫這兩個；現有其他行為（mock 判斷、live test guard、`remote_deleted`、ACTIVE 確認、圖片 identity、移除確認、寫入順序、回讀驗證、identity 保存、稽核 job）**全部不變**。`DesiredVariant` 型別改成 `export type`。

### 6.2 新的衝突判斷（取代第 560–588 行兩段）

位置：照 §6.1 執行順序——`buildSyncDesiredState` 之後、**ACTIVE 確認（現 551–558 行）之前**（讓比對表先出現，ACTIVE 確認在比對表內一起處理）。`SHOPIFY_LIVE_TEST_DRAFT_ID` 那段（543–550）內容不動，位置在 `loadSnapshot` 之後。

```ts
if (!forceRemoteOverwrite) {
  const baseline = (draft.shopify_sync_baseline ?? null) as ShopifySyncBaseline | null;
  const previousRemoteUpdatedAt = draft.shopify_remote_updated_at as string | null;
  // Only a full sync writes shopify_sync_hash. Archive/restore also set
  // shopify_remote_updated_at without syncing content, so that alone proves nothing.
  const legacyFullSync = !baseline && Boolean(draft.shopify_sync_hash) && Boolean(previousRemoteUpdatedAt);
  const legacyUnchanged = legacyFullSync &&
    Date.parse(before.updatedAt) <= Date.parse(previousRemoteUpdatedAt!) + 1000;
  const rowsNow = computeReconcileRows({ tool: toolValuesFromDesired(desired), shopify: shopifyValuesFromSnapshot(before),
    baseline, legacyUnchanged, variantLabels: {}, pullability: {} });
  const blocking = blockingRows(rowsNow);
  if (blocking.length > 0) { ...回 409（下面） }
}
```
（這裡只需要判斷有沒有 blocking，不用算 pullability，傳空物件即可；`pullable` 預設當 false 不影響判斷。）

409 回應與狀態寫入（字串**一字不改**，舊測試 `verify-hotfix-1.mjs` S3 依賴第一組）：
- `!baseline && !legacyFullSync` →
  `markSyncState(..., { shopify_sync_status: "conflict", shopify_sync_error: "Never synced; remote baseline unknown" })`，
  回 `{ ok:false, status:409, code:"remote_conflict", error:"這件商品還沒有同步紀錄，無法確認 Shopify 後台是否被手動修改過；已停止覆蓋，請先比對差異", conflictCount: blocking.length }`
- 其他 →
  `shopify_sync_error: "Shopify was updated after the last successful sync"`，
  `error: "Shopify 後台在上次同步後有新修改；已停止覆蓋，請先查看差異"`，同樣帶 `conflictCount`。

`SyncShopifyProductResult` 失敗型別加 `conflictCount?: number`；`shopify-sync/route.ts` 失敗回應多回 `conflictCount: result.conflictCount ?? null`。

**沒有任何 blocking 列**（全部一樣，或只有「工具有改」）→ 直接往下同步，不再因為「從沒同步過」擋下。

### 6.3 成功後寫基準點

在最後 `markSyncState(... shopify_sync_status: "synced" ...)`（現 1016–1022 行）同一個 patch 裡加：
```ts
shopify_sync_baseline: buildBaselineFromSnapshot(after, nowIso()),
```
其他欄位不變。

### 6.4 類別只補空

- `fullSyncGraphQL.ts` 的 `PRODUCT_SYNC_SNAPSHOT_QUERY`：在 `seo { title description }` 下一行加 `category { id name }`；`ShopifySyncSnapshot` 型別加 `category?: { id: string; name: string } | null;`。
- `scripts/graphql/shopify-full-sync-2026-04.graphql` 的 `ProductSyncSnapshot` 同位置加同樣一行（兩邊必須一致）。
- `desiredCore(productId, product, status, remoteCategoryId: string | null)`：在 `status` 之後加
  `...(product.category && !remoteCategoryId ? { category: product.category } : {})`。
  呼叫處傳 `before.category?.id ?? null`。**絕對不送 `category: null`**。
- `verifyReadback`：若 `core.category` 有值，`remote.category?.id !== core.category` → 推 `"product.category"`。

### 6.5 稽核

`SyncShopifyProductInput` 加 `reconcileAudit?: { choices: Record<string, "tool" | "shopify">; pulledKeys: string[] }`；有值時放進 `requestSummary.reconcile`。其他不變。

### 6.6 route 時間上限

`src/app/api/drafts/[id]/shopify-sync/route.ts`：`maxDuration = 60` → `300`。其他不變（`forceRemoteOverwrite: body.forceRemoteOverwrite === true` 這三行原樣保留，舊驗證腳本會檢查）。

---

## 7. R5 比對與套用

### 7.1 `src/lib/shopify/shopifyDiff.ts`（新檔）

```ts
export async function loadShopifyDiff(input: { serviceSupabase; draftId: string; deps?: { callGraphQL? } }): Promise<ShopifyDiffResult>
export async function resolveShopifyDiff(input: { serviceSupabase; draftId: string; createdBy: string | null; body: unknown; deps?: { callGraphQL? } }): Promise<ShopifyResolveResult>
```

`loadShopifyDiff` 步驟：
1. `checkLiveTestGuard({ draftIds: [draftId], operation: "sync" })` → 有錯回 `{ ok:false, status:403, code:"live_test_guard", error }`。
2. `loadSyncInputs`；草稿沒有真 Shopify ID → `{ ok:false, status:409, code:"missing_product_id", error:"這件商品還沒有建立到 Shopify" }`。
3. `process.env.SHOPIFY_PUBLISH_MOCK !== "false" && !deps.callGraphQL` → `{ ok:false, status:409, code:"mock_mode", error:"安全模式不會讀取 Shopify，無法比對" }`。
4. `loadSnapshot`；讀失敗 → `{ ok:false, status:502, code:"readback_failed", error: 原訊息 }`；商品不存在 → `{ ok:false, status:410, code:"remote_deleted", error:"Shopify 上已經找不到這件商品" }`（**不寫 DB**，這支 API 全程唯讀）。
5. `buildSyncDesiredState` → 算 pullability（§5.5）→ `computeReconcileRows`（`legacyUnchanged` 同 §6.2 算法、`variantLabels` 用 desiredVariants 的選項值）。
6. 回（型別 `ShopifyDiffPayload` 定義在 `reconcileFields.ts` 並 export；**前端只能 `import type`**，不可 import `shopifyDiff.ts`／`syncShopifyProduct.ts`）：
```ts
export type ReconcileDisplayRow = ReconcileRow & { toolDisplay: string; shopifyDisplay: string };
export type ShopifyDiffPayload = {
  ok: true;
  productStatus: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNLISTED";
  remoteUpdatedAt: string;                // before.updatedAt
  draftUpdatedAt: string;                 // draft.updated_at
  hasBaseline: boolean;                   // Boolean(draft.shopify_sync_baseline)
  rows: ReconcileDisplayRow[];            // toolDisplay / shopifyDisplay 依 §8.4 顯示格式，伺服器端算好
  variantTotal: number;                   // 有 remote 的款式數 + toolOnlyVariants.length
  toolOnlyVariants: string[];             // desiredVariants 沒有 remote 的 variantLabel
  shopifyOnlyVariants: string[];          // variantRemovals 的 title
};
```

`resolveShopifyDiff` 步驟（body 型別：`{ remoteUpdatedAt: string; draftUpdatedAt: string; choices: Record<string,"tool"|"shopify">; confirmActiveUpdate: boolean; confirmRemovals: boolean }`）：
1. 重做 `loadShopifyDiff` 的 1–5（重新讀 DB 與 Shopify）。
2. `before.updatedAt !== body.remoteUpdatedAt` 或 `draft.updated_at !== body.draftUpdatedAt` → `{ ok:false, status:409, code:"diff_stale", error:"比對後 Shopify 或工具又有變動，請重新比對" }`。
3. 重算出的 rows 的 key 集合 ≠ `Object.keys(body.choices)` → `{ ok:false, status:409, code:"diff_changed", error:"差異清單已經變了，請重新比對" }`。
4. 任何 choice 不是 `"tool"`/`"shopify"`，或選了 `"shopify"` 但該列 `pullable === false` → `{ ok:false, status:400, code:"invalid_choice", error:"有欄位的選擇不合法，請重新比對" }`。
5. 選 `"shopify"` 的列：用 `localPatchForChoice` 組出 `product_drafts` 一個合併 patch（一次 update）＋每個款式列一個 update（`.eq("id", row.id)`），用 service client 寫入。任何一筆錯 → `{ ok:false, status:500, code:"local_write_failed", error:"存回工具失敗，Shopify 沒有被改動：" + 原訊息 }`（此時還沒呼叫 Shopify 寫入）。
6. 呼叫 `syncShopifyProduct({ serviceSupabase, draftId, createdBy, forceRemoteOverwrite: true, confirmActiveUpdate: body.confirmActiveUpdate === true, confirmRemovals: body.confirmRemovals === true, reconcileAudit: { choices: body.choices, pulledKeys }, deps })`。
7. 回 `{ ...syncResult, pulledCount: pulledKeys.length }`（失敗時也帶 `pulledCount`，讓前端知道工具已經存回）。

### 7.2 routes（只能 export HTTP method，helper 一律放 `src/lib/`）

`src/app/api/drafts/[id]/shopify-diff/route.ts`：
- `export const runtime = "nodejs"; export const maxDuration = 60;`
- `export async function GET(...)`：登入與 `canPublish` 檢查**照抄** `shopify-sync/route.ts` 第 20–36 行（403 訊息 `Reviewer role is required to sync Shopify`）。
- 呼叫 `loadShopifyDiff`，`ok` → 200 JSON；否則 `{ ok:false, error, code }` 用對應 status。

`src/app/api/drafts/[id]/shopify-resolve/route.ts`：
- `export const runtime = "nodejs"; export const maxDuration = 300;`
- `export async function POST(...)`：同樣的登入／權限檢查；`body = await request.json().catch(() => ({}))`；呼叫 `resolveShopifyDiff`。
- 成功 → 200 `result`；失敗 → `{ ok:false, error, code, removals, pulledCount }` 用 `result.status`。

---

## 8. R7 比對表 UI（`ShopifySyncControls.tsx`）

### 8.1 觸發與狀態機

- `ModalKind` 把 `"conflict"` **換成** `"compare"`。
- `requestSync` 收到 `code === "remote_conflict"` → `onStatusChange("conflict", error)`、`setModal("compare")`、呼叫 `loadDiff()`。
- 新 state：
```ts
const [diff, setDiff] = useState<ShopifyDiffPayload | null>(null);
const [diffLoading, setDiffLoading] = useState(false);
const [diffError, setDiffError] = useState("");
const [choices, setChoices] = useState<Record<string, "tool" | "shopify">>({});
```
- `loadDiff()`：`setDiffLoading(true)`、`setDiffError("")`、`setDiff(null)`；`fetch(\`/api/drafts/${draftId}/shopify-diff\`)`；成功 → `setDiff(payload)`、`setChoices(` 每列 `preselect` 非 null 的 `{[key]: preselect}` `)`；失敗 → `setDiffError(payload.error || "比對失敗，請稍後再試")`。`finally` → `setDiffLoading(false)`。
- 刪除：舊的 conflict 文字（現 421–425 行）與「以工具版本覆蓋」按鈕（現 501–512 行）。整個檔案不得再出現 `以工具版本覆蓋` 字樣。
- `modalTitle`：`modal === "compare"` → `diff ? \`Shopify 和工具有 ${diff.rows.length} 欄不一樣\` : "比對 Shopify 和工具"`。
- 彈窗 box className：`modal === "compare"` 時用 `"modal-box approve-summary-modal vc-modal rcx-modal"`，其他維持 `"modal-box approve-summary-modal"`。

### 8.2 套用

```ts
async function applyReconcile() {
  if (!diff) return;
  setBusy(true);
  onStatusChange("syncing", null);
  const confirmActiveUpdate = diff.productStatus === "ACTIVE";
  try {
    const response = await fetch(`/api/drafts/${draftId}/shopify-resolve`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ remoteUpdatedAt: diff.remoteUpdatedAt, draftUpdatedAt: diff.draftUpdatedAt, choices, confirmActiveUpdate, confirmRemovals: false }) });
    const payload = await response.json().catch(() => ({}));
    ...
  } finally { setBusy(false); }
}
```
結果處理（照順序判斷）：
| 回應 | 行為 |
|---|---|
| `ok` 且 `mock === true` | 同 `requestSync` 現有 mock 分支 |
| `ok` | `onStatusChange("synced", null)`、`setModal(null)`、`showToast("已依你的選擇同步，並完成回讀核對", "success")`、`onRefresh()` |
| `code === "diff_stale"` 或 `"diff_changed"` | `onStatusChange("conflict", error)`、`showToast(error, "warn")`、保持 compare 彈窗、呼叫 `loadDiff()` |
| `code === "removal_confirmation_required"` | `setPendingSync({ forceRemoteOverwrite: true, confirmActiveUpdate })`、`setRemovals(...)`、`onStatusChange("dirty", null)`、`setModal("removals")`；若 `pulledCount > 0` 再 `onRefresh()`（工具已存回） |
| 其他失敗 | 同 `requestSync` 現有 error 分支（`setModalError`、`setModal("error")`、`showToast(error,"error")`）；若 `pulledCount > 0` 再 `onRefresh()` |
| 連線例外 | `onStatusChange("error","Shopify 同步連線失敗")`、`setModal("error")` |

（removals 彈窗的「確認移除並同步」現有程式會送 `{ ...pendingSync, confirmRemovals: true }` 到 `/shopify-sync`——工具已經存回，所以 force 是正確的；不用改。）

### 8.3 版面（ASCII，桌機；手機見 §8.5）

```
┌ Shopify 和工具有 6 欄不一樣 ─────────────────────────────── × ┐
│ A 說明  vc-note                                                  │
│ ┌ B ACTIVE 提醒（只有 productStatus==="ACTIVE"）price-soft-warn ┐│
│ C 工具列 vc-toolbar：[全部用工具] [全部用 Shopify]   已選 2／6 欄 │
│ ── 商品內容（4 欄）  rcx-section-title ─────────────────────── │
│ rcx-row                                                          │
│  標題  [沒有比對紀錄 schip]                       rcx-row-head    │
│  ┌ 工具版本 ───────────────┐ ┌ Shopify 版本 ──────────────┐     │
│  │ 三麗鷗 × emie | …        │ │ 三麗鷗 × emie｜…           │ rcx-picks │
│  └─────────────────────────┘ └─────────────────────────────┘     │
│  （擋下時）vc-warn-text：這是淘寶／系統編號…                     │
│ ── 款式價格與 SKU（7 款，3 款有差異） ──────────────────────── │
│  M8大耳狗拍立得【32G卡+聯名禮袋】 rcx-variant-name               │
│   rcx-row（售價）…  rcx-row（SKU）…                              │
│ ── D 不在這張表的東西  vr-notes(details) ──────────────────── │
│ [取消]                         [套用選擇並同步（6 欄）]           │
└─────────────────────────────────────────────────────────────────┘
```

**A 說明**（`<p className="vc-note">`，一字不改）：
`每一欄選要留哪一邊。選「Shopify」的會先存回工具，再把整件同步上 Shopify。`
`diff.hasBaseline === false` 時，後面接第二句（同一個 `<p>` 內，前面一個全形空格）：`這件還沒有比對紀錄，不一樣的欄位都要自己選。`

**B ACTIVE 提醒**（`<p className="price-soft-warn" role="note">`）：`這是公開中的商品，套用後顧客會立刻看到新的內容。`

**C 工具列**（`<div className="vc-toolbar">`）：
- `<Button size="sm" type="button" disabled={busy}>全部用工具</Button>`：每列設 `"tool"`。
- `<Button size="sm" type="button" disabled={busy}>全部用 Shopify</Button>`：每個 `pullable` 的列設 `"shopify"`；不能拉回的列**不改動**。
- `<span className="vc-orig">已選 {已選數}／{總列數} 欄</span>`。

**商品內容區**：`<h3 className="rcx-section-title">商品內容（{n} 欄）</h3>`，n = 商品列數；0 列就整區不顯示。

**款式區**：`<h3 className="rcx-section-title">款式價格與 SKU（{總款數} 款，{有差異款數} 款有差異）</h3>`；總款數 = `diff.variantTotal`；有差異款數 = 款式列裡不同 `variantId` 的數量。0 列就整區不顯示。
每一款：`<p className="rcx-variant-name">{variantLabel}</p>`，下面接該款的列。
有差異款數 ≥ 2 時，標題下方加 `<div className="vc-toolbar">`，內含 `<Button size="sm">這區全用工具</Button>`、`<Button size="sm">這區全用 Shopify</Button>`（規則同 C，只作用在款式列）。

**每一列 rcx-row**：
```tsx
<div className="rcx-row" key={row.key}>
  <div className="rcx-row-head">
    <span className="rcx-row-label">{row.label}</span>
    <span className={STATE_CHIP[row.state].className}>{STATE_CHIP[row.state].label}</span>
  </div>
  <div className="rcx-picks" role="radiogroup" aria-label={row.label}>
    <button type="button" role="radio" aria-checked={choices[row.key] === "tool"} disabled={busy}
      className={`rcx-pick${choices[row.key] === "tool" ? " sel--tint" : ""}`} onClick={...set "tool"}>
      <span className="rcx-pick-label">工具版本</span>
      <span className="rcx-pick-value">{row.toolDisplay}</span>
    </button>
    <button ... 同上但 "shopify"，disabled={busy || !row.pullable}>
      <span className="rcx-pick-label">Shopify 版本</span>
      <span className="rcx-pick-value">{row.shopifyDisplay}</span>
    </button>
  </div>
  {!row.pullable && row.pullBlockedReason ? <p className="vc-warn-text">{row.pullBlockedReason}</p> : null}
</div>
```
`STATE_CHIP`（一字不改）：
| state | className | label |
|---|---|---|
| tool | `schip schip--ok` | 工具有改 |
| shopify | `schip schip--warn` | Shopify 有改 |
| both | `schip schip--error` | 兩邊都改 |
| unknown | `schip schip--idle` | 沒有比對紀錄 |

**D 不在這張表的東西**（`<details className="vr-notes">`，`<summary>不在這張表的東西</summary>`，內含 `<ul>`）：
- `toolOnlyVariants.length > 0` → `<li>只在工具的款式 {n} 個：{名稱以「、」串}。同步後會新增到 Shopify。</li>`
- `shopifyOnlyVariants.length > 0` → `<li>只在 Shopify 的款式 {n} 個：{名稱以「、」串}。同步時會再請你確認是否刪除。</li>`
- 固定一行：`<li>上架狀態和庫存以 Shopify 為準；圖片以工具為準（要移除會另外確認）；商品類別只會補空的。</li>`
- 有任何只在一邊的款式時，`<details>` 加 `open`。

**按鈕列**（`<div className="approve-sum-actions">`，沿用現有）：
- 取消：沿用現有 cancel 按鈕（文字「取消」）。
- 套用：`<button className="approve-sum-btn primary" type="button" disabled={busy || !diff || 已選數 !== diff.rows.length} onClick={() => void applyReconcile()}>`，文字：`busy ? "同步中…" : \`套用選擇並同步（${diff.rows.length} 欄）\``。

### 8.4 狀態畫面（compare 彈窗內，取代上面 A–D）

| 狀態 | 顯示 |
|---|---|
| 載入中（`diffLoading`） | `<p className="vc-note">正在比對 Shopify 和工具…</p>`；按鈕列只有「取消」 |
| 錯誤（`diffError`） | `<p className="price-soft-warn" role="alert">{diffError}</p>`；按鈕列：「關閉」（cancel 按鈕）＋ `<button className="approve-sum-btn primary" type="button" onClick={() => void loadDiff()}>重新比對</button>` |
| 0 列（`diff.rows.length === 0`） | `<p className="vc-note">現在兩邊內容一樣，可以直接同步。</p>`；按鈕列：「取消」＋ `<button className="approve-sum-btn primary" type="button" disabled={busy} onClick={() => void requestSync({ ...pendingSync, forceRemoteOverwrite: true })}>{busy ? "同步中…" : "直接同步"}</button>` |

顯示值格式（伺服器端在 `loadShopifyDiff` 算 `toolDisplay`／`shopifyDisplay`，前端只顯示）：
- 空字串 → `（空白）`
- `price`／`compareAtPrice` → `NT$` + `Number(v).toLocaleString("en-US")`（例 `NT$2,480`）
- `tags` → 用 `"\u0001"` 拆開後以 `、` 串起
- 其他 → 正規化後的文字原樣（含換行）

### 8.5 手機（<960px）

- 彈窗沿用現有底部抽屜（`.modal-box` 既有 media query，不用改）。
- `.rcx-picks` 改單欄（工具版本在上、Shopify 版本在下）。
- `.rcx-pick` 最小高度 44px（桌機也是）。
- 不得出現橫向捲軸。

### 8.6 CSS（`src/app/globals.css`，**檔案最後面**新增一個區塊；只能用現有 token；不准 `!important`；不准新顏色／圓角／陰影值）

```css
/* 1.5a SHOPIFY-RECONCILE: 逐欄比對表 — layout only, tokens only.
   Reuses .modal-box.vc-modal, .vc-note, .vc-toolbar, .vc-orig, .vc-warn-text, .vr-notes,
   .schip, .sel--tint, .approve-sum-actions; no new colors, radii or shadows. */
.modal-box.rcx-modal {
  width: min(880px, 96vw);
}
.rcx-section-title {
  margin: var(--sp-4) 0 var(--sp-2);
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.rcx-variant-name {
  margin: var(--sp-3) 0 var(--sp-1);
  font-size: 12.5px;
  font-weight: 700;
  color: var(--text-dim);
  word-break: break-word;
}
.rcx-row {
  display: flex;
  flex-direction: column;
  gap: var(--sp-2);
  padding: var(--sp-2) 0 var(--sp-3);
  border-bottom: 1px solid var(--border-soft);
}
.rcx-row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
}
.rcx-row-label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.rcx-picks {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--sp-2);
}
.rcx-pick {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: var(--sp-1);
  min-height: 44px;
  min-width: 0;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-s);
  background: var(--surface);
  color: var(--text);
  text-align: left;
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.rcx-pick:hover:not(:disabled) {
  border-color: var(--accent);
}
.rcx-pick:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.rcx-pick-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-muted);
}
.rcx-pick-value {
  font-size: 12.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 160px;
  overflow-y: auto;
}
@media (max-width: 959px) {
  .rcx-picks {
    grid-template-columns: minmax(0, 1fr);
  }
}
```
- 選取狀態**只靠** `.sel--tint`（現有共用類），不准另寫 `.rcx-pick.selected` 之類。
- 若 `.sel--tint` 在 nordic／kitty 主題被 `.rcx-pick` 的 border 蓋掉：只准把這段 CSS 移到 `.sel--tint` 定義**之前**（調整 source order），不准加 `!important`、不准新增選取樣式。若仍無法解決，停下回報。

---

## 9. R6 發布後記基準點（`publishDraftSafe.ts`）

- 在 `src/lib/shopify/shopifyDiff.ts` 加 `export async function captureShopifySyncBaseline(serviceSupabase, draftId: string, productId: string, caller): Promise<void>`：
  `loadSnapshot`（從 `syncShopifyProduct.ts` export 出來共用）→ 讀到商品才 `update product_drafts set shopify_sync_baseline = buildBaselineFromSnapshot(snapshot, nowIso()), shopify_remote_updated_at = snapshot.updatedAt, shopify_sync_status = 'synced', shopify_synced_at = nowIso(), shopify_sync_error = null where id = draftId`。讀不到就什麼都不做。
- 在 `publishDraft()` 主流程 `finishLocalSuccess` 成功之後（現 1222–1232 行 `if (!finalPersist.ok) {...}` 之後、`notifyMake(finalStatus, ...)` 之前）加：
```ts
  // 1.5a SHOPIFY-RECONCILE: remember what Shopify holds right after publish so the first
  // sync only stops when someone actually edits Shopify. Best-effort: never fails a publish.
  if (!mockMode) {
    try {
      await captureShopifySyncBaseline(serviceSupabase, id, productId, caller);
    } catch {
      // baseline is optional; the first sync falls back to the per-field compare table
    }
  }
```
- `republishExistingDraft`（DRAFT→ACTIVE 不改內容）**不加**。

---

## 10. R9 驗證腳本 `scripts/verify-shopify-reconcile.mjs`

寫法照 `scripts/verify-workbench-ux.mjs`（`register(publish-guard-loader)` 匯入 TS、`check(name, fn)`、最後失敗就 `process.exit(1)`）。加進 `scripts/verify-all.mjs` 陣列最後（註解 `// 1.5a SHOPIFY-RECONCILE: per-field compare table, baseline, category fill-only.`），`package.json` 加 `"verify:shopify-reconcile": "node scripts/verify-shopify-reconcile.mjs"`。

必含檢查（名稱前綴照寫）：

**N 正規化**
- N1 `normPrice("2480.00") === "2480"`、`normCompareAt(null) === ""`、`normCompareAt("0") === ""`、`normTags([" b","a","a",""]) === "a\u0001b"`。
- N2 `descriptionCompareText` 對下列 fixture 輸出**完全等於**期望值：
  輸入：`<h2>商品介紹</h2><p>此為海外代購商品，預估約 14 天。</p><p>第一段。</p><h2>收藏亮點</h2><ul>\n<li>亮點一</li>\n</ul><p>更多三麗鷗周邊 → <a href="https://x.test">看看還有什麼</a></p><!-- nestory-desc-embed --><p><img src="https://x.test/a.webp"></p><script type="application/ld+json">{"a":1}</script>`
  期望：`商品介紹\n\n第一段。\n\n收藏亮點\n\n・亮點一`
- N3 `descriptionCompareText("")===""`、`(null)===""`。

**D 往返（描述拉回後重組要一樣）**
- D1 草稿 A：`generation_tone: "潮巢導購版"`、`sale_status: "海外代購（約14天）"`、`description_html` 為四段式純文字（商品介紹／收藏亮點／適合誰／商品資訊，各 1–2 行）。`html1 = buildShopifyProductPayload(A).product.descriptionHtml`；`text = descriptionCompareText(html1)`；草稿 A' = A 但 `description_html = text`；`descriptionCompareText(build(A').descriptionHtml) === text`。
- D2 同 D1，但 tone 為 `"小編聊天口吻"`、`description_html: "第一行\n第二行\n\n第二段"`。
- D3 §5.5 模擬：對 D1 的 Shopify 值算 description 的 pullability → `pullable === true`。

**S 狀態**
- S1 baseline 有值：shopify===B → `tool`；tool===B → `shopify`；三者都不同 → `both`；B 不存在 → `unknown`。
- S2 baseline null、legacyUnchanged true → `tool`；false → `unknown`。
- S3 `preselect`：tool→"tool"；shopify＋pullable→"shopify"；shopify＋不可拉→null；both→null；unknown→null。
- S4 兩邊相同不產生列；工具沒有 handle 時不產生 handle 列。

**P 拉回**
- P1 SKU：Shopify `"5184548069544"` → `pullable false`、reason `這是淘寶／系統編號，工具固定使用 NS 編號`；Shopify `"MY-CUSTOM-01"` → `pullable true`。
- P2 `price_mode: "single"` 的多款商品，Shopify 款式 `compareAtPrice: "3000"` → compareAtPrice 列 `pullable false`、reason `工具的規則會改寫這一欄，存回去也留不住，只能用工具版本`。
- P3 `localPatchForChoice`：highlights `"・甲\n・乙\n\n"` → `["甲","乙"]`；faq `"Q：問\nA：答"` → 含 `<h3>` 的 HTML 且 `htmlFaqToPlainText(結果) === "Q：問\nA：答"`；多款 price → `{ twd_price: 2480, sell_price_locked: true }`。

**E 同步引擎（用 fake DB＋fake Shopify，寫法照 `verify-hotfix-1.mjs` 的 `fakeDb`／`shopifyFake`，可直接複製到新檔再擴充；`verify-hotfix-1.mjs` 只准做本節末尾那一行 fixture 改動）**
- E1 baseline null、`shopify_remote_updated_at` null、title 不同 → 409 `remote_conflict`、error 為「這件商品還沒有同步紀錄…」、`conflictCount === 1`、除了 `ProductSyncSnapshot` 沒有任何 Shopify 呼叫。
- E2 baseline null、`shopify_remote_updated_at` null、**所有欄位一樣** → `ok: true`（不再被「從沒同步過」擋）。
- E3 baseline 有值且 Shopify title ≠ baseline、工具 title = baseline → 409、error 為「Shopify 後台在上次同步後有新修改…」。
- E4 baseline 有值、只有工具改 title → `ok: true`，且成功後 DB `shopify_sync_baseline.product.title === 新標題`、`version === 1`。
- E5 fake snapshot `category: null`、草稿 `shopify_tags: ["類型_公仔模型"]` → `SyncProductCore` 的 `variables.product.category === "gid://shopify/TaxonomyCategory/tg-5-8-1-1"`（fake 的 `SyncProductCore` 要把 `category` 寫回 state 成 `{ id, name: "x" }`，否則回讀會報 `product.category`）；fake snapshot `category: { id: "gid://shopify/TaxonomyCategory/xx", name: "x" }` → `variables.product` **沒有** `category` key。
- E6 `forceRemoteOverwrite: true` 時 E1 情境也會同步（`ok: true`）。

**R resolve**
- R1 `resolveShopifyDiff`：body 的 `remoteUpdatedAt` 不符 → 409 `diff_stale`，DB 沒有任何寫入、Shopify 只有讀取。
- R2 choices 少一個 key → 409 `diff_changed`。
- R3 對 `pullable false` 的列選 shopify → 400 `invalid_choice`。
- R4 title 選 shopify、faq 選 tool → DB `title_zh` 變成 Shopify 標題，接著 `SyncProductCore` 送出的 `title` = Shopify 標題、FAQ metafield = 工具版本；`shopify_sync_jobs` 最新一筆 `request_payload.reconcile.pulledKeys` 含 `product:title`。

**C 原始碼契約**
- C1 `ShopifySyncControls.tsx` 不含 `以工具版本覆蓋`；含 `/api/drafts/${draftId}/shopify-diff`、`/api/drafts/${draftId}/shopify-resolve`、`全部用工具`、`全部用 Shopify`、`套用選擇並同步`、`沒有比對紀錄`、`sel--tint`、`rcx-pick`。
- C2 兩個新 route 檔只 export `runtime`、`maxDuration`、HTTP method（regex 檢查 `export (async )?function (?!GET|POST)` 與 `export const (?!runtime|maxDuration)` 都不存在）；`shopify-resolve` `maxDuration = 300`；`shopify-sync` `maxDuration = 300`；`shopify-diff` `maxDuration = 60`。
- C3 `fullSyncGraphQL.ts` 與 `scripts/graphql/shopify-full-sync-2026-04.graphql` 都含 `category { id name }`。
- C4 `publishDraftSafe.ts` 含 `captureShopifySyncBaseline(` 且位於 `try {` 區塊內、在 `finishLocalSuccess(` 之後。
- C5 migration 檔存在且含 `add column if not exists shopify_sync_baseline jsonb`。
- C6 `globals.css` 的 rcx 區塊沒有 `!important`、沒有 `#` 色碼、沒有 `rgb(`。

**既有驗證全部要綠**：`verify:all`、`typecheck`、`build`。`verify-hotfix-1.mjs` S3 的字串不可改（§6.2 已保留）。
**`verify-hotfix-1.mjs` 唯一允許的改動**：`testDraft` 物件（約第 120–140 行）在 `shopify_remote_updated_at: "2026-10-15T00:00:00.000Z",` 下一行加 `shopify_sync_hash: "legacy-full-sync",`——代表「舊版完整同步成功過」，讓 C1–C5、S1 照舊走 legacyUnchanged 路徑；S3 覆寫 `shopify_remote_updated_at: null` 後仍會得到「這件商品還沒有同步紀錄…」。除此之外不准改那個檔。
E1／E2 的 fixture 不放 `shopify_sync_hash`；另加 **E7**：baseline null、`shopify_sync_hash` null、`shopify_remote_updated_at` 有值（模擬封存過）、title 不同 → 409 且 error 為「這件商品還沒有同步紀錄…」。若既有腳本因本包合理改動而失敗（例：斷言 `以工具版本覆蓋` 存在），**只准**把那條斷言改成本規格的新行為，並在 PR 說明逐條列出；不准刪除或放寬其他斷言。

---

## 11. 上線順序（給 GPT 的合併指令會再寫一次，這裡是規格面）

1. GPT 套 migration `20261020100000_shopify_sync_baseline.sql` 到正式 DB → Claude 唯讀確認欄位存在。
2. 合併 PR → 等預覽 READY → Redeploy 成 Production 一次 → 驗 `/login` 200＋SHA。
3. 老闆照常操作：任一件已上架商品按「同步 Shopify」→ 出現比對表 → 選完套用。

## 12. Claude 驗收清單（施工者不用做，列出來讓你知道會被怎麼驗）

- 本機 `verify:all`／`typecheck`／`build`；逐檔對照本規格。
- 用唯讀腳本對正式 DB＋Shopify 跑 `loadShopifyDiff`（只讀不寫）抽 3 件：兒童相機 8af27d57（FAQ 壞、7 款同價、SKU 是淘寶編號）、羽毛球拍 b4ac2e78（35 款）、一件單一款式；檢查列數、狀態、擋下原因、顯示值合理。
- 三主題＋手機寬度截圖比對表（用假資料 harness 或 preview）。

## 13. PR 要求

- 分支 `gpt/shopify-reconcile`，base `handoff/20261008-golive-spec`，Draft PR 標題 `feat(shopify): 1.5a SHOPIFY-RECONCILE 逐欄比對表＋同步基準點`。
- PR 說明列：改了哪些檔、新增哪些 class、沿用哪些既有元件樣式（AGENTS.md 鐵則 6）、改了哪些既有斷言（若有，逐條）、本規格哪一條沒做到或有疑問。
- 把本規格檔一起放進 PR（`docs/SHOPIFY-RECONCILE-施工規格-2026-10-20.md`）。
- `docs/Mockup差異備忘.md` 在最前面差異 48 之上新增：
  ```
  ### 差異 49：Shopify 同步衝突改為逐欄比對表（取代「以工具版本覆蓋」）
  - **日期**：2026-10-20（1.5a SHOPIFY-RECONCILE）
  - **內容**：同步遇到 Shopify 與工具內容不同時，跳出逐欄比對表（商品 12 欄＋每款售價／原價／SKU），每欄選「工具版本」或「Shopify 版本」；選 Shopify 的先存回工具再整件同步。上架狀態、庫存、圖片、類別不在表內（類別只補空）。成功同步或發布後記下基準點，之後只有 Shopify 真的被改才跳表。
  - **為什麼**：老闆 10-16 定案「偵測＋逐欄選，不做全自動雙向」；原本只有一顆覆蓋按鈕，會把老闆在 Shopify 手改的內容蓋掉。
  ```
