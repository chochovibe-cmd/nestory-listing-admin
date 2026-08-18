# Nestory — Stabilization Plan

> 目的：把 regression audits 轉成可執行修復順序。
> 詳細證據看 `docs/audits/`；實際修改看 `docs/CHANGELOG.md`。

更新：2026-08-18
狀態：**P0-1 / P0-2 / P0-3 / P1-1 都已有獨立修復分支；皆尚未完整 runtime 驗證/merge。**

## 已實作，待完整驗證/merge

### ✅ P0-1 Variant dimensions / rows atomic confirm
- branch：`agent/p0-variant-atomic-confirm`
- fixed commit：`171bbaa`
- destructive axis change 未確認前不改正式 state。
- verifier：`verify:variant-axis-atomic`

### ✅ P0-2 Variant duplicate option protection
- branch：`agent/p0-variant-duplicate-protection`
- canonical：branch HEAD / `fix(variants): protect duplicate option combinations`
- protect：expand、Workspace、shared persistence、Shopify publish 409。
- verifier：`verify:variant-duplicates`

### ✅ P0-3 Mobile ResultCard expand affordance
- branch：`agent/p0-mobile-resultcard-expand`
- canonical：branch HEAD / `fix(mobile): restore ResultCard expand affordance`
- mobile 只恢復既有 `.rc-toggle`；quick/dismiss 不恢復。
- isolated hotfix：`src/app/stabilization.css`
- verifier：`verify:mobile-resultcard-expand`

### ✅ P1-1 Mobile interactive-target gesture guard
- branch：`agent/p1-mobile-gesture-guard`
- canonical：branch HEAD / `fix(mobile): isolate ResultCard controls from card gestures`

Root cause：interactive child 的 touch 先冒泡到 `rc-header`，click stopPropagation 來不及阻止 long-press/swipe。

已實作：
- `cardGestureTarget.ts`：closest-based centralized interactive target guard。
- `ResultCard.tsx`：touch start/move/end 在 interactive target 退出；start guard 位於 `onGestureStart` / long-press timer 之前。
- blank card surface gesture 保留。
- `verify-mobile-resultcard-gesture-guard.mjs`：鎖 selector、guard 順序、原本 long-press/swipe contract、ResultCard tab active predicate。
- `package.json` / `verify-all` 已補 verifier wiring（舊 P1 branch 原本漏掉）。

待驗證：
- 長按「重生」不進多選
- 在 toggle/重生上水平移動不拖 card
- 空白卡面 long-press/swipe 正常
- `npm run verify:mobile-resultcard-gesture`
- `npm run typecheck`

## 下一個主線

### P1-2 P07 Variant desktop picker / hover preview clipping
來源：`docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`

已確認：P07 的 ancestor `overflow-x:clip` 會包住 Variant desktop absolute picker / hover preview。mobile portal preview 不在同一裁切路徑。

修復目標：
- 保留雙欄 workbench containment
- 不整包 revert P07
- 讓 picker / hover preview 在左右邊界可見
- 優先局部/Portal/collision-aware 解法，不放寬整個 panel overflow

驗證：
- desktop 左/右邊界 picker
- hover preview
- 960px 附近
- dark/nordic/kitty

### P1-3 verifier localStorage policy
目標：從 blanket ban localStorage 改成禁止 secret/token 寫 browser storage；合法 autosave/gesture hint 要通過。

## 之後

1. role / permission / RLS consistency
2. production Supabase migration reconcile
3. CI gate
4. real-product E2E
5. Phase E6/F/G

## 每個修復 commit 規則

- 一題一 commit
- root cause + scope control
- verifier/test
- 手動驗證清單
- update CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit
- append CHANGELOG
- 不刪歷史證據

## 暫不做

- 不整包 revert B4/P07
- 不大量重寫 `globals.css`
- `stabilization.css` 不擴成第二份 general stylesheet
- 不直接加 product_variants unique constraint（先改 replacement transaction strategy）
- 不先開 E6/F/G
