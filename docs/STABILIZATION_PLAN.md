# Nestory — Stabilization Plan

> 目的：把 regression audits 轉成可執行修復順序。
> 詳細證據看 `docs/audits/`；實際修改看 `docs/CHANGELOG.md`。

更新：2026-08-18
狀態：**P0-1 / P0-2 / P0-3 / P1-1 / P1-2 都已有獨立修復分支；皆尚未完整 runtime 驗證/merge。**

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
- centralized closest-based interactive target guard。
- ResultCard touch start/move/end 在 interactive target 退出。
- blank card surface gesture 保留。
- verifier 鎖 selector、guard 順序、原本 long-press/swipe contract、tab active predicate。
- package / verify-all wiring 已補齊。

待驗證：
- 長按「重生」不進多選
- 在 toggle/重生上水平移動不拖 card
- 空白卡面 long-press/swipe 正常
- `npm run verify:mobile-resultcard-gesture`
- `npm run typecheck`

### ✅ P1-2 P07 Variant desktop picker / hover preview clipping
來源：`docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`
分支：`agent/p1-variant-picker-clipping`
canonical：branch HEAD / `fix(ui): keep Variant hover preview inside picker`

Root cause：
- P07 的 WorkspaceInputPanel `overflow-x:clip` 是必要 containment，不能直接移除。
- Variant picker：260px。
- `.pick-grid`：72px tile + 8px gap + wrap，現況形成三欄。
- hover preview：160px，原本每格 `left:50%; transform:translateX(-50%)`。
- 第一/第三欄的 preview 會超出 picker 水平邊界，之後被 P07 clipping ancestor 裁掉。

已實作：
- **保留 P07 containment，不改 `globals.css`。**
- **不改 `VariantEditor.tsx`。**
- `stabilization.css` 只在 desktop + fine pointer：
  - 第 1 欄 `nth-child(3n + 1)` preview 改 `left:0; transform:none`。
  - 第 3 欄 `nth-child(3n)` preview 改 `right:0; transform:none`。
  - 中間欄仍置中。
- 新增 `verify-variant-picker-containment.mjs`：
  - 要求 P07 `overflow-x:clip` 仍存在。
  - 鎖定 picker 260 / tile 72 / gap 8 / preview 160 幾何 contract。
  - 鎖定 edge alignment rules。
  - 禁止 hotfix 加 `!important`。
- package 新增 `verify:variant-picker-containment`，並納入 `verify:all`。

目前 code/verifier diff 相對 P1-1 只含 4 檔：
- `src/app/stabilization.css`
- `scripts/verify-variant-picker-containment.mjs`
- `package.json`
- `scripts/verify-all.mjs`

待驗證：
- desktop 第一/中間/第三欄 hover preview
- 960px 附近
- dark / nordic / kitty
- picker shell 本身是否始終維持 panel 內；如果實機仍有 shell clipping，另做獨立 follow-up，不放寬 P07 containment
- `npm run verify:variant-picker-containment`
- `npm run typecheck`

## 下一個主線

### P1-3 verifier localStorage policy
目標：從 blanket ban localStorage 改成禁止 secret/token 寫 browser storage；合法 autosave/gesture hint 要通過。

驗證：
- 合法 UI preference/autosave localStorage 通過
- 明顯 API key/token/secret 寫 localStorage 必須失敗
- 不降低現有 env/server-secret 掃描能力

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
