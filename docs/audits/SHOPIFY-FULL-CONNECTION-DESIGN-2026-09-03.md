# Nestory — Shopify 完整連線設計與 G4 加速方案（2026-09-03）

## 1. Commander 結論

現況已證明「新建商品」正常，但尚未達到 owner 所要求的完整連線。不能把一次 mock `productCreate` 成功當成正式可用。

正式可用的最低定義：

1. 工具建立商品後，Shopify 後台得到同一筆 `DRAFT`；
2. 工具修改標題、描述、tags、metafields、價格、款式、庫存與圖片後，能更新同一個 Shopify product，不重複建立；
3. 工具端可以明確執行下架、封存、還原與永久刪除，且每個動作的 Shopify 影響都寫清楚；
4. 每次外部 mutation 後都回讀 Shopify，確認實際值與本機一致；
5. Shopify 被人在後台改過時，不靜默覆蓋，顯示衝突並由 owner 選擇方向；
6. 所有操作都有狀態、錯誤、重試與 audit ledger；手機與桌機都能清楚操作。

G4 只允許一筆真實 Shopify `DRAFT`，不得轉 `ACTIVE`。

## 2. 現有能力矩陣

| 能力 | 現況 | 主要證據 | 判定 |
|---|---|---|---|
| 建立 Shopify DRAFT | `productCreate` 強制先建 DRAFT，先保存 product ID，再同步款式／價格／庫存 | `publishDraftSafe.ts` | 已有 |
| 轉 ACTIVE | 所有 follow-up 成功後才 `productChangeStatus(ACTIVE)`；API 要 `confirmActive=true` | publish route + lifecycle | 已有，但 G4 禁用 |
| 多款式／價格／庫存首次同步 | `productVariantsBulkUpdate/Create`，有限庫存需要 location | `publishDraftSafe.ts` | 已有首次建立路徑 |
| 圖片／影片／metafields 首次同步 | 隨 `productCreate` payload 建立 | `payload.ts` | 已有首次建立路徑 |
| ACTIVE 下架成 DRAFT | `productChangeStatus(DRAFT)`，保留同一 product ID | unpublish route | 已有，但 G4 不需 ACTIVE |
| DRAFT 重新上架 | 只變更 status，不重送商品內容 | `republishExistingDraft()` | 有生命週期，沒有內容同步 |
| 工具修改後更新 Shopify | ResultCard `save()` 只寫 Supabase | `ResultCard.tsx` | **缺少** |
| 已存在商品的款式／價格／庫存同步 | 沒有 post-create update API；DB 也沒保存 variant ID | repo inventory | **缺少** |
| 已存在商品的圖片／metafields 同步 | 沒有 post-create media/metafield diff | repo inventory | **缺少** |
| 工具端封存 | 只 soft-archive 本機資料，不動 Shopify | batch archive route | 本機功能，不是 Shopify sync |
| 使用者永久刪除 Shopify 商品 | `productDelete` 只用於補償／retry cleanup，沒有 UI/API | `productLifecycle.ts` | **缺少** |
| Shopify → 工具回讀／webhook | 沒有 webhook 或 remote reconciliation | repo inventory | **缺少** |

## 3. 風險優先序

### P0 — 防止誤寫與重複商品

- 新增 server-side live-test guard：`SHOPIFY_LIVE_TEST_DRAFT_ID`。
- 只要 live-test guard 存在：
  - 只有完全相同的 draft ID 可做 Shopify live mutation；
  - publish mode 只能是 `draft`；
  - batch 必須只有 1 件；
  - ACTIVE、其他 draft、mock ID 一律拒絕；
  - update／archive／delete 也沿用同一 allowlist。
- Production 保持 mock；只在 owner 核准的 branch Preview 設定 live test。

### P0 — 更新必須重用同一 product ID

- 新增 `syncShopifyProduct()`，禁止已有 real `shopify_product_id` 再走 `productCreate`。
- 每次 mutation 前查 remote product status／`updatedAt`；mutation 後回讀 title、status、variants、media、metafields 與 inventory evidence。
- remote 內容在上次同步後被改過時，標記 `conflict`，禁止靜默覆蓋。

### P0 — 款式與媒體需要遠端 identity

- `product_variants` 新增 `shopify_variant_id`、`shopify_inventory_item_id`。
- `product_images` 新增 `shopify_media_id`、`shopify_file_id`。
- 首次建立與 legacy reconciliation 都要把 remote IDs 回填；否則無法可靠更新／刪除個別款式與媒體。

### P1 — 同步狀態與 ledger

- `product_drafts` 新增：
  - `shopify_sync_status`: `never | synced | dirty | syncing | partial | error | conflict | remote_deleted`；
  - `shopify_synced_at`；
  - `shopify_remote_updated_at`；
  - `shopify_sync_hash`；
  - `shopify_sync_error`。
- 新增 `shopify_sync_jobs`，記錄 `create | update | verify | archive | restore | delete`、結果、錯誤、遠端 ID、時間與操作者。
- schema／RLS 走新的 tracked migration，不重播歷史 `001–039`。
- `product_images` 另存 `shopify_source_hash`，用來判斷同一列圖片是否真的換檔；只靠 remote ID 無法安全識別替換。
- 每件商品用 atomic `syncing` claim 防止兩個同步請求同時執行；任何遠端步驟完成後才失敗，狀態必須是 `partial`，不能偽裝成全有或全無。

## 4. 更新同步引擎

### Core product

使用 `productUpdate` 更新同一 product ID：標題、描述、vendor、product type、tags、status 與 metafields。所有 userErrors 必須逐項顯示，不得只回「同步失敗」。

### Variants / prices / inventory

1. 先讀遠端 variants 與 IDs；
2. 用 option identity／SKU 對應本機 rows；
3. existing rows → `productVariantsBulkUpdate`；
4. new rows → `productVariantsBulkCreate`；
5. removed rows → 明確列出後才 `productVariantsBulkDelete`；
6. 有限庫存必須使用已確認的 location；未設定時阻擋，不任選未知 location；
7. mutation 後回讀價格、SKU、庫存 policy／quantity。

### Media

以 `shopify_media_id` 做 diff：保留未變、建立新增、更新 ALT、移除明確刪除的 product media。Shopify Files 是否刪除要獨立判斷，避免刪到其他商品共用檔案。

### Metafields

沿用目前 canonical namespace/key；update 時 upsert，並回讀四個核心 metafields。不得把畫面空白誤當刪除，清空需顯式操作。

## 5. 刪除／封存語意

預設採可恢復設計：

1. `移出工作佇列`：只隱藏工具內卡片，Shopify 不變；
2. `Shopify 下架保留草稿`：ACTIVE → DRAFT；
3. `Shopify 封存`：remote → ARCHIVED，可再還原為 DRAFT；
4. `永久刪除 Shopify 商品`：使用 `productDelete`，不可恢復；要輸入商品標題確認；
5. 永久刪除後本機不 hard-delete，保留 audit row 並標示 `remote_deleted`，避免證據消失。

G4 測試順序只用 DRAFT：建立 → 更新 → 封存 → 還原 DRAFT。永久刪除唯一測試品必須在執行當下再取得 owner 確認。

## 6. Shopify 後台被人工修改時

Launch minimum 採「工具為主要編輯端、Shopify 需衝突偵測」：

- 每次同步前 read-before-write；
- remote `updatedAt` 晚於 `shopify_remote_updated_at` 時標 `conflict`；
- UX 提供：`查看差異`、`以工具版本覆蓋`、`重新載入 Shopify`；
- 不做 last-write-wins。

正式上線後再接 `products/update`／`products/delete` webhook，以 HMAC 驗證後只更新 sync 狀態與快照，不直接覆寫文案。

## 7. UX 設計方案（待 owner 確認後才動前台）

### ① 照現有流程新增

- 商品卡加入 Shopify 狀態 chip：`尚未建立`／`已同步`／`有未同步修改`／`同步中`／`同步失敗`／`Shopify 有外部變更`／`Shopify 已刪除`。
- 已有 Shopify ID 的商品，主操作改為 `儲存並同步 Shopify`；另保留 `只儲存工具`。
- 同步完成顯示時間、Shopify 後台連結與逐欄結果。
- Lifecycle actions 進 `⋯ Shopify 操作` bottom sheet／dialog：下架、封存、還原、永久刪除。

### ② 保留現狀

- 保留既有三站工作流、發布／匯出 modal、角色權限、文案鎖定、soft archive、三主題與 mobile bottom-sheet 語言。
- `移出工作佇列` 維持本機 soft archive，不偷偷改 Shopify。
- ACTIVE 繼續需要明確確認；G4 live-test guard 直接禁止 ACTIVE。

### ③ 衝突與 Commander 裁決

- 「刪除」拆成工具移除／Shopify 封存／永久刪除，不再用一個模糊按鈕。
- 預設推薦 Shopify 封存；永久刪除放進進階區並要求輸入標題。
- Shopify 後台人工修改不自動覆蓋工具，也不自動覆蓋 Shopify；先顯示差異。
- 已發布商品按一般 `儲存` 不可再只寫本機卻顯示像全部完成；必須明確呈現 `工具已儲存，Shopify 尚未同步`。
- 更新 `ACTIVE` 商品需要額外明確確認；G4 allowlist 則無條件拒絕任何非 `DRAFT` remote status。

## 7.1 2026-09-03 source 進度

- G4-A live-test allowlist 已接入單筆 route、batch route、batch runner 與 publish core；設定 allowlist 時只允許同一 draft 的單筆 DRAFT publish。
- G4-B additive migration、sync engine、readback/conflict、variant/price/inventory/media/metafield diff、remote identity 與 audit ledger 已完成第一版。
- G4-C remote archive/restore/permanent-delete API 已完成第一版；永久刪除要求明確布林確認與完整商品標題，且不刪本機 audit row。
- status mutation 已從 deprecated `productChangeStatus` 改為 `productUpdate(status)`；媒體新增用 `productUpdate(media)`，ALT／解除商品關聯用 `fileUpdate`。
- 官方 Shopify Admin GraphQL 2026-04 schema validator 通過；本機 typecheck、guard/full-sync/lifecycle verifiers 通過。
- 尚未完成：owner UX 確認與前端施工、migration apply、Preview env、runtime partial failure、唯一真 DRAFT E2E、webhook 註冊與 production release。

## 8. G4 唯一真實 DRAFT 驗收矩陣

同一 product ID 依序驗證：

1. create DRAFT；
2. 後台核對 title、description、vendor、status、tags、metafields、media；
3. 核對單／多款式、price、compare-at、SKU、cost、inventory policy／quantity／location；
4. 工具修改上述欄位並 sync；確認沒有第二個 product；
5. 刪除／新增一張圖與一個 variant，再 sync diff；
6. remote readback 與本機 hash 一致；
7. 在 Shopify 後台改一個低風險欄位，工具偵測 conflict；
8. remote ARCHIVED → 還原 DRAFT；
9. 模擬 partial-create/retry，確認不重複建立；
10. owner 若當下批准，永久刪除這一筆測試 DRAFT；否則保留並清楚標示測試品。

任一步失敗立即停止後續 mutation，保留 remote ID、錯誤與恢復說明。

## 9. 加速施工順序

1. **G4-A** live-test allowlist + source tests；
2. **G4-B** sync schema + update/readback engine；
3. **G4-C** archive/restore/delete + conflict engine；
4. **G4-D** UX 實作與 desktop/mobile QA；
5. **G4-E** branch Preview 單筆真 DRAFT E2E；
6. 通過後再規劃 PR merge、tracked migrations、production deploy；ACTIVE 是獨立 G5。

不先 merge／deploy 現有 PR #10，因為完整 sync 缺口尚未補完；先在 PR #10 head 的隔離分支完成並驗證，能少一次 production 來回。
