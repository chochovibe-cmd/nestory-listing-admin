# Nestory — Change Log

> Append-only stabilization / maintenance log for AI agents and humans.
> 只記「實際已改了什麼」；目前狀態看 `docs/CURRENT_STATUS.md`，待辦順序看 `docs/STABILIZATION_PLAN.md`。

## 2026-08-18 — P0-1 Variant axis atomic confirm

狀態：**已實作在 `agent/p0-variant-atomic-confirm`，尚未 merge / deploy；仍需實機與 typecheck 驗證。**

### Root cause
B4-P03 的 `addAxisValue` / `dropAxisValue` 先呼叫 `onDimensionsChange(nextDims)`，再檢查 cartesian expand 是否會丟手填 rows。遇到二次確認時 rows 不更新，造成 dimensions / rows 半套 state。

### 實際修改
- 新增 `src/lib/variants/variantAxisChange.ts`
  - `planVariantAxisChange()` 先計畫軸值變更。
  - 無資料遺失風險才回傳 dimensions + rows 一起 apply。
  - 會丟 hand-filled rows 時回傳 confirm plan，不先改正式 state。
- 更新 `src/components/listing/VariantEditor.tsx`
  - `ConfirmArm.expand` 可暫存 `nextDimensions`。
  - add/drop axis 不再先 commit dimensions。
  - 第二次確認使用 pending dimensions，再一起更新 dimensions + rows。
  - 移除最後一個有效軸值時，即使 target cartesian 為 0，確認 CTA 仍可完成清空。
- 更新 `src/lib/variants/index.ts` 匯出 planner。
- 新增 `scripts/verify-variant-axis-atomic.mjs` source-contract guard。
- `package.json` 新增 `verify:variant-axis-atomic`。
- `scripts/verify-all.mjs` 納入 atomic verifier。

### 變更範圍控制
本修復沒有修改：
- `globals.css`
- ResultCard / mobile gesture
- API routes
- Supabase migrations / RLS
- Shopify publish flow

### 尚未聲稱完成的驗證
目前 ChatGPT GitHub connector 無法在 repo 本機執行 Node/typecheck/build，因此本次**沒有聲稱 runtime checks 已通過**。
此外既有 `verify:no-secrets` 已知會因合法 localStorage 使用而誤報，完整 `verify:all` 在修 verifier drift 前本來就不是可靠綠燈。

### 下一步
1. 核對本分支 diff 只含 P0-1 + verifier + docs。
2. 下一個獨立修復：P0-2 duplicate merge-key hand-fill protection。
3. 有可執行環境後跑 `npm run verify:variant-axis-atomic`、`npm run typecheck`，再做 Variant 實機案例。

## 2026-08-18 — P0-2 Variant duplicate option protection

狀態：**已實作在 `agent/p0-variant-duplicate-protection`，尚未 merge / deploy；仍需 runtime/typecheck 驗證。**

### Root cause
B4-P03 的 duplicate row 會先產生與原列相同的 option merge key；`indexRowsByMergeKey()` 只保留 sortOrder 最小的一列，因此第二筆 duplicate 即使帶成本、SKU、圖片或售價，也可能完全不進原本的 `wouldDiscardHandFilled`，重新展開時被靜默吃掉。DB schema 也沒有 option combination unique constraint，而 Shopify publish plan 會照 DB rows 建 seeds，因此舊的重複資料也需要發布端防線。

### 實際修改
- `src/lib/variants/variantCrossExpand.ts`
  - 新增 `findDuplicateVariantMergeKeyRows()`。
  - 新增 `findDuplicateHandFilledVariantRows()`。
  - `expandAndMergeVariantRows()` 先把 duplicate hand-filled losers 納入 `wouldDiscardHandFilled`，重新展開必須明確確認，不再靜默丟資料。
- `src/lib/variants/variantPricing.ts`
  - 利用 Workspace 已存在的 `validateCostRequirement()` pre-submit 驗證，在 `persistDraft()` 前阻擋重複款式組合。
- `src/lib/variants/variantPersist.ts`
  - 新增 insert payload duplicate detector。
  - `persistVariantsSafe()` 在任何 DB read/write 前以 `phase: "validate"` 拒絕重複組合，保護 ResultCard 儲存路徑與舊 rows。
- `src/lib/variants/shopifyVariants.ts`
  - 新增 `findDuplicateProductVariantRows()`，使用與 Variant merge 相同的 normalized identity。
- `src/lib/shopify/publishDraft.ts`
  - payload 建立與 `status: publishing` 之前檢查 legacy/manual duplicate DB rows。
  - 重複時回 `409`，mock/live 都不能誤報發布成功。
- 新增 `scripts/verify-variant-duplicate-protection.mjs`。
- `package.json` 新增 `verify:variant-duplicates`；`verify:all` 納入此 guard。

### 為什麼沒有加 DB unique index
目前 product_variants 的安全覆寫策略是「先 insert 新 rows，成功後才 delete old rows」。直接加 `(draft_id, option values...)` unique constraint 會讓正常 replacement 在舊 rows 尚未刪除時先撞 unique，因此本輪不以 migration 當 quick fix；先在 form/persistence/publish 三層阻擋重複。

### 變更範圍控制
本修復沒有修改：
- `globals.css`
- VariantEditor DOM / CSS
- ResultCard DOM / gesture
- Supabase migration / RLS
- Shopify GraphQL mutation 本身

### 尚未聲稱完成的驗證
- Git diff 已做範圍核對。
- 目前沒有可執行 repo 環境，因此**沒有聲稱** `verify:variant-duplicates`、typecheck、build 或實機流程已通過。
- `verify:all` 仍受既有 localStorage verifier drift 影響，不能當整體綠燈。

### 下一步
1. squash 本分支為單一 P0-2 commit。
2. 下一個獨立修復：P0-3 mobile ResultCard selectMode expand affordance。
3. 有執行環境後跑 `npm run verify:variant-duplicates`、`npm run verify:variant-axis-atomic`、`npm run typecheck`，並實測 duplicate → add/drop axis → save → publish guard。

## 2026-08-18 — P0-2 squash / remote build status update

- P0-2 已 squash 為單一 commit；canonical reference 是 `agent/p0-variant-duplicate-protection` 的 branch HEAD，commit message 為 `fix(variants): protect duplicate option combinations`。
- 先前中間狀態曾記錄過 `0131b7f`，但後續為了把最新 handoff 文件一起收進同一個 squash commit，SHA 會因內容改變而更新；**不要把中間 SHA 當最終 canonical reference**。
- 相對 P0-1 branch 僅保留 1 個 P0-2 commit，不保留 Contents API 的碎 commit。
- Vercel commit status 曾回 `success`；這只代表遠端 build/deploy 未直接失敗。
- 專案自己的 `verify:variant-duplicates`、`verify:variant-axis-atomic`、`typecheck` 與實機案例仍待可執行環境正式跑，因此狀態仍是「已實作，待完整驗證/merge」，不是「正式完成」。
- 下一個主線修復：P0-3 Mobile ResultCard selectMode expand affordance。
