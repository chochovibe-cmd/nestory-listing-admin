# Nestory — Stabilization Plan

> 目的：把 2026-08-18 regression audits 轉成可執行修復順序。
> 這是「下一步做什麼」的短清單；證據與細節留在 `docs/audits/`。

更新：2026-08-18
狀態：**Audit 完成第一輪，尚未開始修改功能 code。**

## P0 — 先修，且一題一 commit

### P0-1 Variant dimensions / rows atomic confirm
來源：`docs/audits/VARIANT-B3P06-B4P03-AUDIT-2026-08-18.md`

問題：B4-P03 add/drop axis value 會先 commit dimensions；若 hand-filled rows 需要二次確認，rows 留舊狀態，造成 dimensions 與 rows 不一致。

修復目標：
- dimensions + rows 必須視為同一 transaction
- confirm pending 時不改正式 state
- timeout / cancel 不留下半套 state

驗證：
- add axis value + hand-filled conflict
- drop axis value + hand-filled conflict
- confirm / timeout / cancel
- rows 與 dimensions 永遠一致

### P0-2 Variant duplicate merge-key protection
來源：同上。

問題：duplicate row 初始具有相同 optionValues；`indexRowsByMergeKey` 只保留第一列，後列 hand-fill 可能不進 `wouldDiscardHandFilled`。

修復目標：
- duplicate merge key 不可靜默丟 hand-filled row
- expand 前能偵測 duplicate identity conflict
- save/publish 前確認是否允許相同 option combination

驗證：
- duplicate 後不改 axis value
- duplicate 後改成本/SKU/圖片
- 再 add/drop axis value
- hand-fill 不得無警告消失

### P0-3 Mobile ResultCard selectMode expand affordance
來源：`docs/audits/RESULTCARD-B3P02-B3P04-B4P04-B4P06-AUDIT-2026-08-18.md`

問題：selectMode 下 tap card 只 toggle；code 說只有 ▸ 可 expand，但 B4-P04 mobile CSS 把含 ▸ 的 `.rc-quick-row` 隱藏。

修復目標：
- mobile multi-select 時仍有清楚、可觸控的 expand/collapse 入口
- 不恢復整條 desktop quick-row

驗證：
- normal tap
- long-press 進 multi-select
- selectMode 中 expand/collapse
- 取消多選後回 normal behavior

## P1 — 接著修

### P1-1 Mobile interactive-target gesture guard
來源：ResultCard audit。

問題：mobile `rc-header` 捕捉 touchstart/move/end；重生等 interactive child 只 stop click，touch 仍會冒泡，可能觸發 long-press selection / swipe。

修復目標：
- gesture handler 對 button/input/select/textarea/a/[role=button] 或 `data-no-card-gesture` 直接退出
- 不靠每顆按鈕散補 stopPropagation

驗證：
- 長按重生不進多選
- 在重生按鈕上水平滑不移動 card
- card 空白區 long-press/swipe 仍正常

### P1-2 P07 Variant desktop picker / hover preview clipping
來源：`docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`

問題：P07 `.workspace-input-panel .panel-body { overflow-x:clip }` 可裁掉 Variant desktop absolute picker / hover zoom。

修復目標：
- 保留 workbench 防跨欄 containment
- 浮層改 portal / collision-aware positioning / 局部安全策略

驗證：
- desktop 左/右邊界 picker
- hover 160px preview
- 960px 附近
- dark / nordic / kitty

### P1-3 verifier localStorage policy
來源：ResultCard audit + 既有 verifier audit。

問題：合法 UI preference/autosave localStorage 被 `verify-no-secrets.mjs` 以檔名 allowlist 方式阻擋；B4-P04 `DraftResultsPanel` 也會命中。

修復目標：
- 檢查「secret/token 是否寫 browser storage」，不是 blanket ban `localStorage`
- 不降低 API key / token 掃描能力

驗證：
- 合法 UI localStorage 通過
- 模擬 API key/token 存 localStorage 必須失敗

## P1 — 實機確認後再決定是否修

### Archived mobile unarchive action
- mobile hides `.rc-quick-row`
- swipe disabled for archived
- 要確認 expanded body 是否另有「解除封存」入口

### Thumbnail main badge clipping
- 優先查 `.pthumb-strip` 自己的 `overflow-x:auto`
- 不先歸咎 P07

### `.vh-more-menu` edge collision
- 一般位置應可用
- 960px 附近 / toolbar 擁擠需實機測

## 已排除／目前不先動

- P07 不先整包 revert
- ResultCard swipe wrapper 的 `overflow:hidden` 是設計本身，不是 P07 主因
- vertical sticky 目前沒有 P07 直接破壞證據
- B4-P06 fail reason desktop flex 撐版已有後續 source 修正
- B3-P03 mobile stage filter CSS consolidation 方向正確

## 每個修復 commit 必須附

1. 問題與 root cause
2. 改哪些檔案 / class / function
3. 為什麼不會影響其他 station / desktop / mobile
4. 新增或更新 verifier/test
5. 手動驗證項目
6. 更新 `docs/CURRENT_STATUS.md` 或本檔狀態
7. 若屬 regression，再回寫對應 `docs/audits/*`

## 建議 commit 順序

1. `fix(variants): keep dimensions and rows atomic on expand confirm`
2. `fix(variants): protect duplicate merge-key hand-filled rows`
3. `test(variants): cover pending-confirm and duplicate-key regressions`
4. `fix(mobile): restore ResultCard expand affordance in select mode`
5. `fix(mobile): isolate interactive controls from card gestures`
6. `fix(ui): prevent Variant picker preview clipping without removing workbench containment`
7. `fix(verify): check browser-stored secrets instead of blanket localStorage ban`

## 之後才做

完成上述穩定化後，再處理：
- role / permission model
- production Supabase migration reconcile
- CI gate
- real-product E2E
- Phase E6 / F / G 新功能
