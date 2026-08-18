# Variant B3-P06 + B4-P03 Audit — 2026-08-18

> 範圍：`e798b5a`（B3-P06 VariantEditor 大改）+ `6af3a25`（B4-P03 auto-expand / duplicate row）。
> 本輪只稽核，不修 `src/`。

## 快速結論

已找到 2 個需要優先修的資料/狀態一致性問題，以及 1 個測試缺口群。

### P0-A — dimensions 先變、rows 等確認，會進入不一致狀態

目前 `addAxisValue` / `dropAxisValue` 的順序：

1. 算 `nextDims`
2. **立即** `onDimensionsChange(nextDims)`
3. 再 `tryAutoExpandFromDimensions(nextDims, rows)`
4. 如果偵測到 `wouldDiscardHandFilled`，只 arm 二次確認並 return，**rows 不更新**

結果：
- 軸值 chip 已新增/刪除
- 但款式 rows 還是舊集合
- 使用者如果不按「重新展開」第二次確認，這個不一致狀態會一直留著
- 3 秒 confirm arm timeout 只會解除確認狀態，不會 rollback dimensions

這與原 helper 的 contract 有衝突：
- `product_variants rows = combo source of truth`
- `dimensions.values = axis order / UI assist only`
- 「conflict 時不要由 values 反推 rows；應由 rows rebuild values」

因此這不是單純 UX 觀感，而是 state consistency regression。

#### 具體例子

原本 rows：
- 小八 / 12cm（有成本、SKU、圖片）
- 烏薩奇 / 12cm（有手填）

dimensions.values：角色=[小八, 烏薩奇]

使用者刪掉「烏薩奇」：
- `dropAxisValue` 先把 dimensions 變成 [小八]
- `expandAndMergeVariantRows` 發現烏薩奇手填列會被丟失
- UI 顯示確認警告並 return
- 但 rows 仍含烏薩奇

此時「軸值 UI」和「實際 row source of truth」已互相矛盾。

### P0-B — duplicate row 同 merge key，手填資料可能在 expand 時無法被保護

`duplicateRow()` 會完整複製原列的：
- optionValues
- cost
- sellPrice / compareAt
- qty / sku
- imageId
- priceLocked

剛複製完成時，新舊兩列具有**相同 optionValues merge key**。

但 `indexRowsByMergeKey()` 的策略是：
- 同 key 只保留 sortOrder 最小的一列
- 後面的 duplicate 不進 map

而 `expandAndMergeVariantRows()` 的 `wouldDiscardHandFilled` 是從這個 map 迭代。

因此：如果 duplicate 尚未改 optionValues、但已經有/保留手填資料，之後觸發 auto-expand，第二列可能完全不進 `wouldDiscardHandFilled` 保護名單。

這違反函式自己宣稱的「never silently discard hand-fill」目標。

#### 另一個延伸風險

`persistVariantsSafe()` 本身不做 option combination 去重；它會把傳入 rows 全部 insert。
所以 duplicate row 若一直保持相同 optionValues，也可能把重複 variant combination 帶到 persistence / publish path。

這一點目前只標為**需要後續驗證**：要再確認 DB constraint / Shopify publish 層是否另有擋重複組合。

## B3-P06 UI 部分與 B4-P03 疊加

### Row reorder
B3-P06 用 index string 當 drag key；B4-P03 duplicate row 會插入 index+1，再重新寫 sortOrder。

目前沒有看到直接資料遺失路徑，但 React row JSX 也使用 `key={index}`。

風險：
- insert/reorder 時 React 可能重用 DOM node
- controlled inputs 的值應會被 React 修正，但 focus / 暫態 UI / popover index 可能跳到另一列

判定：**中風險，需實機驗證，不先宣稱 bug。**

### Picker state (`pickIndex`)
圖片 picker 以 row index 綁定。如果 duplicate / reorder 發生時 picker 正開著，index-based state 可能指到不同 row。

B3-P06 在 drag start 會 `closeAllPops()`，所以 desktop drag 相對有保護；但 duplicate row 按鈕本身目前沒有看到先清 `pickIndex`。

判定：**中風險。**

## verifier 缺口

`verify-b7-variants.mjs` 現在有測：
- merge 保留手填欄位
- clamp 50
- empty axis
- axis order
- remove dimension collision
- rebuild values from rows
- shrink expand 的 wouldDiscard

但沒有測：
1. add/drop axis value 在 confirm pending 時 dimensions / rows 一致性
2. confirm timeout 是否 rollback
3. duplicate rows 同 merge key 的 hand-fill 是否進 wouldDiscard
4. duplicate option combination 是否會進 persistence/publish
5. duplicate / reorder / picker index 的 UI state

另外 source-contract test 目前只是 regex 確認 `tryAutoExpandFromDimensions` / `duplicateRow` 存在，無法驗證上述行為正確。

## 建議修復方向（尚未實作）

### 對 P0-A
優先方案：**把 dimensions + rows 當成同一筆 transaction。**

當 auto-expand 會丟手填時：
- 不要先 commit `onDimensionsChange(nextDims)`；
- 暫存 pending nextDims；
- 使用者第二次確認後再一次 commit dimensions + rows；
- 使用者取消/timeout 則完全不改現況。

另一方案是 dimensions 先變但立即 rollback，不建議，狀態更複雜。

### 對 P0-B
`expandAndMergeVariantRows` 在建立 existing map 前，應先偵測 duplicate merge keys；任何被 map 淘汰但 `isVariantRowHandFilled()` 的 duplicate 都必須加入 discard/duplicate conflict 名單，不能靜默消失。

UI 的「複製」也應考慮：
- 複製後明確標記「請修改軸值」；或
- 在保存/展開前禁止相同 option combination；或
- duplicate 先清掉會造成誤認的 identity/value，視使用流程決定。

## 修復順序

1. P0-A dimensions/rows atomic confirm
2. P0-B duplicate merge-key hand-fill protection
3. 補 verifier tests
4. 再處理 index-based picker/reorder UI state
5. 最後才調 Variant 視覺/欄位 layout

## 下一位 Agent 接手

先讀：
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `docs/REGRESSION_AUDIT.md`
- `docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`
- 本檔

**不要先改 CSS。Variant 現在優先是 state consistency，而不是外觀。**
