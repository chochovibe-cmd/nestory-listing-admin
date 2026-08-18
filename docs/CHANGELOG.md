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
