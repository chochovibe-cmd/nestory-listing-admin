# PUBLISH-LITE 施工規格（2026-10-19，取代 PUBLISH-RUNTHROUGH R2–R5）

分支：`gpt/publish-lite`（從 R1 `273e586` 開，R1「同批有 processing 就等、不跳件」已含）。
R2–R5（`.tmp/publish-runthrough-r2..r5`）**全部不用、不得複製任何 code 或 migration**：它們在 product_drafts / product_images / product_variants 掛全域觸發器，發布完成後永不解鎖（刪圖、刪款式、存檔都會壞）。

## 目標（老闆白話）
批次上架不再「剩幾件、要按好幾次」：一件跑太久被切斷時，系統自己從中斷處接著跑（最多 3 次），不跳件、不漏件；圖片 Shopify 編號都記下來。

## 不准做
- 不加任何 trigger / RPC / lease / phase 表；不改 RLS。
- 不動 publishDraft 內部發布順序（準備圖→建商品→款式→圖片→綁圖→管道）。
- 不新增 CSS class / token / 顏色；不改 R1 的 claimNextQueuedItem 邏輯（只加欄位寫入）。
- 不改 one-shot `/api/drafts/batch/publish` 非 stepwise 路徑的行為。

## 1. Migration（唯一一個）
新檔 `supabase/migrations/20261019100000_publish_item_attempts.sql`：
```sql
alter table public.publish_batch_items
  add column if not exists attempt_count integer not null default 0,
  add column if not exists started_at timestamptz;
```
`scripts/verify-supabase-migration-baseline.mjs` 清單第 15 行後加這個檔名（同 HOTFIX-1 前例）。

## 2. 時間上限
- `src/app/api/publish-batches/[batchId]/step/route.ts` 與 `src/app/api/drafts/[id]/publish/route.ts`：`export const maxDuration = 300;`（Next 要求字面值，不可 import 常數）。
- `src/lib/drafts/publishBatch.ts`：新增 `export const PUBLISH_STEP_MAX_SECONDS = 300;`；`PUBLISH_STALE_ITEM_MS = (PUBLISH_STEP_MAX_SECONDS + 90) * 1000`（6.5 分）；`PUBLISH_IDLE_BATCH_MS = 20 * 60_000`；新增 `export const PUBLISH_MAX_ATTEMPTS = 3;`。
- verify 腳本檢查：兩個 route 檔的 maxDuration 字面值 === PUBLISH_STEP_MAX_SECONDS，且 STALE > MAX_SECONDS*1000。
- 若 Vercel build 回報 maxDuration 超過方案上限：**不要自己改**，停下回報。

## 3. 領件寫入次數（publishBatchStepwise.ts `claimNextQueuedItem`）
- candidates select 加 `attempt_count`。
- 領件 update 改為 `{ item_status: "processing", attempt_count: candidate.attempt_count + 1, started_at: now ISO }`，條件 `.eq("item_status","queued").eq("attempt_count", candidate.attempt_count)`（CAS）。其餘不變。

## 4. 卡住自動續跑（recoverStalePublishBatches.ts）
- items select 加 `attempt_count, started_at`。
- 「卡住」判斷改為逐件：`item_status === "processing"` 且 `now - (started_at ?? batch.updated_at ?? batch.created_at) > staleItemMs`（取代現在用整批 idleMs 判斷 processing 的那段）。
- `recoverStaleItem` 順序：
  1. 現有 ACTIVE 對帳邏輯原樣保留（對帳成功 → done，return）。
  2. **新增**：若 `attempt_count < PUBLISH_MAX_ATTEMPTS` → item 改回 `{ item_status: "queued", error_message: "上次發布逾時，系統自動續跑（第 N 次）", started_at: null }`，條件 `.eq("id").eq("item_status","processing").eq("attempt_count", 原值)`；draft 若仍 `publishing` 且屬於本批 → 同現在改成 `api_failed`（這樣下次領件走既有 resume 路徑，從 Shopify 已有的進度接續）。計數 `out.itemsRequeued += 1`（新增欄位）。return。
  3. 否則（已試 3 次）→ 現有 failed 邏輯，error_message 改為 `已自動續跑 3 次仍逾時，請到發布紀錄按「重送失敗件」`。
- 第 2 段「整批閒置 > idleBatchMs → queued 改 skipped」保留，閾值用新的 20 分。

## 5. 發布前預檢（createStepwisePublishBatch）
- 在 `createPublishBatchRecords` 成功後、回傳前：用 HOTFIX-2 的分頁 helper（`src/lib/supabase/fetchAllRows.ts`）讀本批全部 draft 與 product_variants，每件呼叫 `checkPublishReadiness(draft, variants, { confirmVariantPrices: false })`（publishReadiness.ts，純函式）。
- `blocked` 的件：item 改 `{ item_status: "failed", error_message: "發布前檢查擋下：" + formatPublishBlockMessage(blockers), completed_at: now }`（條件 eq queued）；不碰 draft 狀態、不叫 Shopify。
- 回傳多 `preflightBlocked: Array<{ draftId, title, error }>`。
- 注意：已在 raw_capture 確認過價格的草稿，readiness 本來就會放行，不要另加 bypass。

## 6. 前端（publishBatchClient.ts）
- `formatStepwiseProgressText` → `` `發布中 ${n}/${total}…（請勿關閉此頁）` ``。
- 把 step 迴圈抽成內部 `stepUntilDone(batchId, total, createdItems, …)`；`runStepwisePublishBatch` 建批後呼叫它；新增 `export async function continueStepwisePublishBatch({ batchId, total, draftIds, onProgress, fetchImpl?, sleep? })` 直接呼叫它（不建批）。
- 建批回傳的 `preflightBlocked` 先寫進 results（ok:false, itemStatus:"failed", error）。
- 迴圈上限改用時間：拿掉 `maxIterations` 的次數限制，改成「連續沒有進度（counts 沒變且 processed 為 null）超過 `PUBLISH_STALE_ITEM_MS + 120_000`」才停；`waitingGapMs` 預設 1500 → 5000。`consecutiveFailedSteps >= 3` 中止邏輯保留。
- 迴圈期間 `window.addEventListener("beforeunload", h)`，h 內 `e.preventDefault(); e.returnValue = "";`，finally 移除；`typeof window === "undefined"` 時跳過。

## 7. 發布紀錄「繼續發布」鈕（PublishRecordsPanel.tsx）
- 位置：批次卡片 header，`showRetry` 那顆 `↻ 重送失敗件` Button 的**前面**。
- 顯示條件：`row.status === "processing"`。
- 外觀完全照抄重送鈕：`<Button size="sm" type="button" className="rec-retry" loading={retryBusyId === row.id} disabled={!!retryBusyId} onClick={(e)=>{e.stopPropagation(); void continueBatch(row);}}>▶ 繼續發布</Button>`。
- `continueBatch`：`setRetryBusyId(row.id)`；呼叫 `continueStepwisePublishBatch`（total = row.total_count ?? items.length，onProgress → `setNotice(progress.text)`）；結束 toast 文案同 `runRetryPublish`（成功 success／失敗 error），`setNotice(null)`、`await loadBatches()`，finally `setRetryBusyId(null)`。
- 同一張卡同時符合重送條件時兩顆都顯示。

## 8. 圖片 Shopify 編號寫回（publishDraftSafe.ts）
- 現在只有多款商品的 `bindVariantMedia` 會寫 `shopify_media_id`，所以正式已上架商品幾乎都沒記到。
- media 步驟成功後（`mediaResult` 拿到 product.media.nodes），對 `mediaInputs` 與回傳 IMAGE 節點**依順序**一一對應（數量不同就整段略過並加 warning `圖片編號未寫回：數量不一致`），對每張 main/variant 本地圖寫 `{ shopify_media_id, shopify_source_hash: hashSource(originalSource) }`；已相同就跳過；單張寫失敗只加 warning，不讓發布失敗。
- `hashSource` 從 syncShopifyProduct.ts 改成 export 共用（同一函式，不複製）。
- resume 路徑若有同樣的 media 步驟，套用同一個 helper。

## 9. 驗收（全部在 scripts/verify-publish-batch.mjs 新增，沿用現有 fake 寫法）
L1 領件 attempt_count+1 與 started_at 寫入；CAS 輸家不改。
L2 processing 6.5 分內不動；超過且 attempt<3 → 回 queued、draft api_failed；第 3 次 → failed＋新文案。
L3 ACTIVE 對帳成功仍優先 done。
L4 預檢擋下的件直接 failed、不呼叫 publishOne、其他件照跑；preflightBlocked 回傳正確。
L5 client：killed step（504）後等待，item 回 queued 後繼續同一件，不跳下一件；無進度超時才停。
L6 continueStepwisePublishBatch 不呼叫建批 API。
L7 maxDuration 字面值 300 ＝ 常數；STALE > 300s。
L8 media 編號依序寫回；數量不一致只 warning。
另跑：`pnpm typecheck`、`pnpm verify:publish-guard`、`pnpm verify:publish-batch`、`pnpm verify:all`、`pnpm build`，全部要過。

## 10. 上線順序
套 migration（Claude 經老闆同意）→ 部署 → 用 2–3 件圖多的商品實測一批。
