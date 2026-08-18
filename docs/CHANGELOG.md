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

## 2026-08-18 — P0-3 Mobile ResultCard expand affordance

狀態：**已實作在 `agent/p0-mobile-resultcard-expand`，尚未 merge / deploy；仍需手機實機驗證。**

### Root cause
B3-P04 在 `selectMode=true` 時把 mobile header tap 改成「切換選取」，並明確保留 `rc-toggle`（▸/▾）作為唯一展開入口；但 B4-P04 的 mobile CSS 隱藏整個 `.rc-quick-row`，因此連 `rc-toggle` 一起消失，手機多選模式沒有可見 expand/collapse control。

### 實際修改
- 新增 `src/app/stabilization.css`
  - 只在 `max-width:959px` 生效。
  - `.rc-quick-row` 改 `display:contents`，但 `.rc-quick` 與 `.rc-dismiss-btn` 仍保持隱藏。
  - 只恢復原本已存在的 `.rc-toggle`，做成 44×44px compact control。
  - title row 預留右側 48px，避免長標題與 toggle 重疊。
- `src/app/layout.tsx`
  - 在 `globals.css` 後載入 `stabilization.css`，讓 scoped regression override 生效。
- 新增 `scripts/verify-mobile-resultcard-expand.mjs`
  - 鎖定 CSS 載入順序、mobile scope、quick/dismiss 仍隱藏、toggle 44px，以及 ResultCard 原本 `stopPropagation + tryToggleExpand()` contract。
- `package.json` 新增 `verify:mobile-resultcard-expand`；`verify:all` 納入此 guard。

### 為什麼不直接改 ResultCard / globals.css
- `ResultCard.tsx` 的 toggle 邏輯本來就是正確的：selectMode header tap 切選取，而 toggle 自己 stop propagation 後 expand/collapse，所以不需要改業務/互動邏輯。
- `globals.css` 體積很大；本輪只修單一 regression，先用明確註解、mobile-scoped 的 `stabilization.css` 降低 connector 整檔誤改風險。
- `stabilization.css` 明確標註不得長成第二份 general stylesheet；實機驗證穩定後再決定是否整併回主 CSS 架構。

### 變更範圍控制
本修復沒有修改：
- ResultCard TSX 邏輯
- desktop quick actions
- API / Supabase / Shopify
- VariantEditor
- 原本 long-press / swipe gesture 行為

### 尚未聲稱完成的驗證
- 已確認 P0-3 code-only diff 相對 P0-2 剛好 1 commit / 5 files。
- `verify:mobile-resultcard-expand` 尚未在本機 Node 環境實際跑。
- 手機 normal tap、long-press 進 multi-select、selectMode expand/collapse、退出 selectMode 後 normal behavior 仍需實機驗證。

## 2026-08-18 — P1-1 Mobile ResultCard interactive gesture guard

狀態：**已實作在 `agent/p1-mobile-gesture-guard`，尚未 merge / deploy；仍需手機實機與 verifier/typecheck 驗證。**

### Root cause
ResultCard 的 mobile `rc-header` 在 touch boundary 直接接收 `touchstart/move/end`。子控制項（例如重生、P0-3 恢復的 expand toggle）即使在 click 階段 stopPropagation，touch 事件仍先冒泡到 header，因此長按可能啟動 500ms multi-select timer，水平移動也可能進入 swipe 判斷。

### 實際修改
- 新增 `src/components/listing/result-card/cardGestureTarget.ts`
  - `isCardGestureInteractiveTarget()` 用 `closest()` 集中辨識 button/input/select/textarea/a、role=button/link、contenteditable 與 `data-no-card-gesture`。
  - 未來新增控制項不需要每顆散補 touch stop。
- 更新 `ResultCard.tsx`
  - `handleHeaderTouchStart()` 在 `onGestureStart` 與 long-press timer **之前**先做 interactive guard。
  - interactive touch start 會清 timer / reset swipe axis，不接管卡片 gesture。
  - `handleHeaderTouchMove()` / `handleHeaderTouchEnd(event)` 也在 interactive target 直接退出。
  - blank card surface 原有 long-press、swipe、selectMode 行為保留。
- 新增 `scripts/verify-mobile-resultcard-gesture-guard.mjs`
  - 鎖定 interactive selector、start/move/end guard 順序、原本 long-press/swipe contract。
  - 額外鎖定 ResultCard tab active predicate，因舊分支整檔替換時曾意外把 `activeTab === tab.id` 改成不存在/錯誤的 `active`，後續已修正；乾淨重疊時保留正確 predicate。
- 補上舊 P1 分支漏掉的 verifier wiring：
  - `package.json` 新增 `verify:mobile-resultcard-gesture`
  - `scripts/verify-all.mjs` 納入 gesture guard verifier

### 變更範圍控制
本修復目前相對 P0-3 的 code/verifier diff 只有：
- `ResultCard.tsx`
- `cardGestureTarget.ts`
- `verify-mobile-resultcard-gesture-guard.mjs`
- `package.json`
- `verify-all.mjs`

沒有修改 CSS、API、DB、Shopify、VariantEditor，也沒有移除 long-press/swipe 功能。

### 尚未聲稱完成的驗證
- 靜態 diff 已確認只含上述 5 個檔案。
- 專用 verifier / typecheck 尚未在可執行 Node repo 環境實跑。
- 手機需實測：長按重生不進多選、在 toggle/重生上水平移動不拖卡、空白卡面 long-press/swipe 仍正常。

### 下一步
1. 同步 `CURRENT_STATUS` / `STABILIZATION_PLAN` / ResultCard audit / AI entry。
2. squash 成相對 P0-3 單一 P1-1 commit。
3. 下一個主線：P1-2 P07 Variant desktop picker/hover preview clipping。

## 2026-08-18 — P1-2 P07 Variant desktop hover preview containment

狀態：**已實作在 `agent/p1-variant-picker-clipping`，尚未 merge / deploy；仍需 desktop 960px / 三主題實機與 verifier/typecheck 驗證。**

### Root cause
P07 為了阻止左側 WorkspaceInputPanel 與右側 ResultsPanel 互相覆蓋，刻意加入 `overflow-x:clip`。這個 containment 本身不能直接撤掉。

Variant 圖片 picker 現況是：
- `.v-pop-pick` width 260px
- `.pick-grid` flex + 8px gap + wrap
- `.pk` 72px，因此正常是三欄
- `.pk-zoom-preview` 160px，原本每格用 `left:50%` + `translateX(-50%)` 置中

第 1 / 第 3 欄的 160px preview 會超出 picker 水平邊界；由於仍在 WorkspaceInputPanel DOM tree 內，最終會被 P07 clipping ancestor 裁掉。

### 實際修改
- `src/app/stabilization.css`
  - 只在 `min-width:960px` + fine pointer + hover 生效。
  - 第 1 欄 `nth-child(3n + 1)` preview 改成 `left:0; right:auto; transform:none`。
  - 第 3 欄 `nth-child(3n)` preview 改成 `left:auto; right:0; transform:none`。
  - 中間欄維持原本 centered preview。
- 新增 `scripts/verify-variant-picker-containment.mjs`
  - 鎖定 P07 `overflow-x:clip` 仍存在。
  - 鎖定 picker 260 / tile 72 / gap 8 / preview 160 的幾何 contract。
  - 鎖定 desktop edge-alignment selectors。
  - hotfix 不可新增 `!important`。
- `package.json` 新增 `verify:variant-picker-containment`。
- `scripts/verify-all.mjs` 納入此 verifier。

### 變更範圍控制
相對 P1-1 的 code/verifier diff 只有 4 檔：
- `src/app/stabilization.css`
- `scripts/verify-variant-picker-containment.mjs`
- `package.json`
- `scripts/verify-all.mjs`

本修復**沒有**修改：
- `globals.css`
- `VariantEditor.tsx`
- ResultCard
- API / DB / Shopify
- P07 workbench containment

### 尚未聲稱完成的驗證
- 靜態 diff 已確認只含上述 4 個檔案。
- 專用 verifier / typecheck 尚未在可執行 Node repo 環境實跑。
- desktop 需實測：第一/中間/第三欄 hover、960px 附近、dark/nordic/kitty。
- picker shell 本身若在極端寬度仍被裁，另開獨立 positioning follow-up；不要放寬 P07 containment。

### 下一步
1. 同步 P07 audit / CURRENT_STATUS / STABILIZATION_PLAN / AI entry。
2. squash 成相對 P1-1 單一 P1-2 commit。
3. 下一個主線：P1-3 `verify-no-secrets.mjs` localStorage policy。
