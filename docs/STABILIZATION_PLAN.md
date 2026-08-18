# Nestory — Stabilization Plan

> 目的：把 2026-08-18 regression audits 轉成可執行修復順序。
> 證據與細節留在 `docs/audits/`；實際改動留在 `docs/CHANGELOG.md`。

更新：2026-08-18
狀態：**第一輪 Audit 已完成；P0-1 / P0-2 / P0-3 都已有獨立修復分支。皆尚未 merge / deploy / 完整 runtime 驗證。**

## P0 — 已實作，待完整驗證/merge

### ✅ P0-1 Variant dimensions / rows atomic confirm
分支：`agent/p0-variant-atomic-confirm`
固定 parent commit：`171bbaa` — `fix(variants): keep axis confirm atomic`

效果：destructive axis change 未確認前不改正式 dimensions；確認後 dimensions + rows 一起套用。

待驗證：
- add/drop axis hand-filled conflict
- drop last active axis + confirm
- confirm timeout 不改正式 state
- `npm run verify:variant-axis-atomic`
- `npm run typecheck`

### ✅ P0-2 Variant duplicate merge-key protection
分支：`agent/p0-variant-duplicate-protection`
canonical：branch HEAD / `fix(variants): protect duplicate option combinations`

效果：
- expand/merge 不再靜默吃 duplicate hand-filled loser
- Workspace pre-submit 擋 duplicate
- shared persistence 在 DB access 前擋 duplicate
- Shopify publish 在 payload/status mutation 前回 409

待驗證：
- duplicate + add/drop axis
- Workspace submit guard
- ResultCard save 保留舊 rows
- legacy duplicate publish 409
- `npm run verify:variant-duplicates`
- `npm run typecheck`

### ✅ P0-3 Mobile ResultCard selectMode expand affordance
來源：`docs/audits/RESULTCARD-B3P02-B3P04-B4P04-B4P06-AUDIT-2026-08-18.md`
分支：`agent/p0-mobile-resultcard-expand`
canonical：branch HEAD / `fix(mobile): restore ResultCard expand affordance`

原問題：mobile selectMode 下 header tap 只 toggle selection；B4-P04 又把包含唯一 ▸/▾ 的 `.rc-quick-row` 隱藏，造成沒有可見 expand/collapse control。

已實作：
- 新增 `src/app/stabilization.css`，只在 `max-width:959px` 生效。
- `.rc-quick-row` 用 `display:contents`，但 `.rc-quick` / `.rc-dismiss-btn` 仍隱藏。
- 只恢復原本 `.rc-toggle`，44×44px；title row 預留右側空間。
- `layout.tsx` 在 `globals.css` 後載入 hotfix。
- 新增 `verify-mobile-resultcard-expand.mjs` 並納入 `verify:all`。

沒有做：
- 沒改 ResultCard handler/業務邏輯
- 沒恢復整條 desktop quick row
- 沒改 long-press/swipe
- 沒改 API/DB/Shopify/Variant

待驗證：
- normal mobile tap
- long-press 進 multi-select
- selectMode 中 ▸/▾ expand/collapse
- 離開 multi-select 後 normal behavior
- 320/375/430 寬度下長標題不壓 toggle
- `npm run verify:mobile-resultcard-expand`
- `npm run typecheck`

## P1 — 接著修

### P1-1 Mobile interactive-target gesture guard
來源：ResultCard audit。

問題：`rc-header` 捕捉 touchstart/move/end；重生、toggle 等 interactive child 只 stop click，touch 仍可能冒泡，觸發 long-press selection / swipe。

修復目標：
- gesture handlers 遇到 `button/input/select/textarea/a/[role=button]` 或 `data-no-card-gesture` 直接退出
- 不靠每顆按鈕散補 touch stop
- card 空白區 gesture 不受影響

驗證：
- 長按重生不進多選
- 在重生/toggle 上水平移動不拖 card
- card 空白區 long-press/swipe 仍正常

### P1-2 P07 Variant desktop picker / hover preview clipping
來源：`docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`

問題：P07 `.workspace-input-panel .panel-body { overflow-x:clip }` 可裁 Variant desktop absolute picker / hover zoom。

修復目標：
- 保留 workbench 防跨欄 containment
- 浮層改 portal / collision-aware positioning / 局部安全策略

驗證：desktop 左/右邊界、160px hover preview、960px 附近、dark/nordic/kitty。

### P1-3 verifier localStorage policy
問題：`verify-no-secrets.mjs` 以檔名 allowlist blanket-ban 多數 localStorage，合法 autosave / gesture hint 會誤報。

修復目標：檢查「secret/token 是否寫 browser storage」，不是 blanket ban `localStorage`；不降低 API key/token 掃描能力。

## P1 — 實機確認後再決定

- Archived mobile unarchive action
- Thumbnail main badge clipping（優先查 `.pthumb-strip` 自己的 `overflow-x:auto`）
- `.vh-more-menu` edge collision

## 已排除／目前不先動

- 不整包 revert P07 / B4-P04
- ResultCard swipe wrapper 的 `overflow:hidden` 是設計本身，不是 P07 主因
- B4-P06 fail reason desktop flex 已有後續 source 修正
- B3-P03 mobile stage filter consolidation 方向正確
- product_variants 不直接加 unique index；需先改 replacement transaction strategy

## 每個修復 commit 必須附

1. root cause
2. 改哪些檔案/function/class
3. scope control
4. verifier/test
5. 手動驗證項目
6. 更新 `CURRENT_STATUS` / 本檔
7. regression 回寫對應 audit
8. append `CHANGELOG`

## 建議 commit 順序

1. `fix(variants): keep dimensions and rows atomic on expand confirm` — 已實作/已 squash
2. `fix(variants): protect duplicate option combinations` — 已實作/已 squash
3. `fix(mobile): restore ResultCard expand affordance` — 已實作，收尾 squash 中
4. `fix(mobile): isolate interactive controls from card gestures`
5. `fix(ui): prevent Variant picker preview clipping without removing workbench containment`
6. `fix(verify): check browser-stored secrets instead of blanket localStorage ban`

## 之後才做

- role / permission model
- production Supabase migration reconcile
- CI gate
- real-product E2E
- Phase E6 / F / G 新功能
