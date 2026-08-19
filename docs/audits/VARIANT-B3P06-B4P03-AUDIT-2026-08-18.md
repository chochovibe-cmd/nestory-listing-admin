# Variant B3-P06 + B4-P03 Audit — 2026-08-18

> 範圍：`e798b5a`（B3-P06 VariantEditor 大改）+ `6af3a25`（B4-P03 auto-expand / duplicate row）。
> Audit 已完成；P0-A / P0-B 都已有獨立修復分支，尚未 merge / deploy / runtime 驗證。

## 修復狀態更新

### P0-A — dimensions / rows atomic confirm
狀態：**已實作於 `agent/p0-variant-atomic-confirm`，單一 commit `171bbaa`；尚未 runtime 驗證/merge/deploy。**

實作內容：
- 新增 `src/lib/variants/variantAxisChange.ts` 的 `planVariantAxisChange()`。
- add/drop axis 先做 plan；若會丟 hand-filled rows，只保存 pending `nextDimensions`，不先改正式 dimensions。
- 第二次確認才一起套用 target dimensions + rows。
- 若移除最後一個有效軸值導致 cartesian=0，確認後會一起套用 dimensions 並清空 rows。
- 新增 `scripts/verify-variant-axis-atomic.mjs`，並納入 `verify:all`。

### P0-B — duplicate row 同 merge key
狀態：**已實作於 `agent/p0-variant-duplicate-protection`；尚未 runtime 驗證/merge/deploy。**

實作內容：
- `findDuplicateVariantMergeKeyRows()` / `findDuplicateHandFilledVariantRows()`：辨識同 normalized option key 的後續 duplicate。
- `expandAndMergeVariantRows()`：duplicate hand-filled losers 先進 `wouldDiscardHandFilled`，不能再靜默消失。
- Workspace pre-submit：既有 `validateCostRequirement()` 先擋 duplicate option combination，再進 `persistDraft()`。
- ResultCard/shared persistence：`persistVariantsSafe()` 在任何 DB read/write 前以 `phase: validate` 阻擋 duplicate inserts。
- Shopify publish：`publishDraft()` 在 payload 與 `status: publishing` 前檢查 legacy/manual duplicate DB rows；重複回 409，mock/live 都不會誤報成功。
- 新增 `verify-variant-duplicate-protection.mjs` 並納入 `verify:all`。
- 沒有直接加 DB unique index，因為目前 insert-first → delete-old replacement 會和 unique constraint 衝突。

詳細實際變更：`docs/CHANGELOG.md`。

---

## Root cause A — dimensions 先變、rows 等確認

修復前 `addAxisValue` / `dropAxisValue`：
1. 算 `nextDims`
2. 立即 `onDimensionsChange(nextDims)`
3. 再 `tryAutoExpandFromDimensions(nextDims, rows)`
4. 如果 `wouldDiscardHandFilled`，只 arm 二次確認並 return，rows 不更新

因此軸值 UI 已變、rows 還是舊集合；confirm timeout 也不 rollback dimensions。這與原 helper「product_variants rows = combo source of truth」的 contract 衝突。

現在 P0-A 已改成 pending plan，未確認前 dimensions / rows 都不 commit。

## Root cause B — duplicate merge key 的後列原本會被 map 吃掉

`duplicateRow()` 會複製：
- optionValues
- cost
- sellPrice / compareAt
- qty / sku
- imageId
- priceLocked

剛複製時，新舊兩列有相同 option merge key。原 `indexRowsByMergeKey()` 同 key 只保留 sortOrder 最小的一列，而 `wouldDiscardHandFilled` 又只遍歷這個 map，所以第二列即使有手填資料也可能完全不被列為「會丟失」。

P0-B 現在先獨立蒐集 duplicate losers；其中 hand-filled duplicate 一定加入 `wouldDiscardHandFilled`。

## Persistence / publish 延伸風險

Audit 時確認：
- `product_variants` 初始 schema 沒有 option combination unique constraint。
- `formRowsToDbInserts()` 可映射所有 filled rows。
- Shopify `buildVariantPublishPlan()` 也會把所有 valid DB rows 建成 seeds。

因此只修 auto-expand 不夠；P0-B 已另外補：
- Workspace pre-submit guard
- shared ResultCard persistence guard
- Shopify publish server-side 409 guard

### 為什麼這輪不加 DB unique constraint
product_variants 現在用安全 overwrite：**先 insert 新 rows，成功後再刪 old rows**。直接對 `(draft_id + option values)` 加 unique，正常 replacement 會先和仍存在的 old rows 撞 unique。若未來要 DB 層唯一性，先改 transaction/upsert/staging 策略，再加 constraint。

## 仍屬中風險、尚未處理的 UI state

### Row reorder
B3-P06 用 index string 當 drag key；B4-P03 duplicate row 插入 index+1 並重寫 sortOrder。React row JSX 也使用 `key={index}`。

可能影響 focus / 暫態 UI / popover index，但目前沒有直接資料遺失證據，先不列 P0。

### Picker state (`pickIndex`)
圖片 picker 綁 row index。desktop drag start 會 `closeAllPops()`，有部分保護；duplicate row 本身沒有先清 `pickIndex`。

判定：中風險，等實機驗證後再決定是否修。

## verifier 狀態

已新增：
- `scripts/verify-variant-axis-atomic.mjs`
- `scripts/verify-variant-duplicate-protection.mjs`

後者鎖住四條 source contract：
1. expand/merge duplicate hand-filled protection
2. Workspace pre-submit duplicate validation
3. shared persistence DB access 前 validate
4. Shopify publish payload/status 前 409 guard

**但目前 ChatGPT GitHub connector 沒有本機執行環境，所以這些 verifier 尚未實際執行，typecheck/build 也未跑。**

## 修復順序更新

1. ~~P0-A dimensions/rows atomic confirm~~ — 已實作，待 runtime 驗證/merge
2. ~~P0-B duplicate merge-key hand-fill + save/publish guard~~ — 已實作，待 squash/runtime 驗證/merge
3. 下一個全專案 P0：Mobile ResultCard selectMode expand affordance
4. Variant index-based picker/reorder 留待實機驗證
5. 最後才調 Variant 視覺/欄位 layout

## 下一位 Agent 接手

先讀：
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `docs/STABILIZATION_PLAN.md`
- `docs/CHANGELOG.md`
- 本檔

Variant 兩個已知 P0 都已有修復分支；**不要再從 audit root cause 重做一次，也不要先改 CSS。** 下一個主線修復是 Mobile ResultCard P0-3。
