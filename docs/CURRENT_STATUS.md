# Nestory — Current Status

> 這是給新 AI session 的「唯一短版現況」。
> 只放現在還成立的資訊；歷史細節看 `docs/CHANGELOG.md` / audits。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → **P1-1**
目前工作分支：`agent/p1-mobile-gesture-guard`

## 1. 專案狀態

Nestory 核心商品上架、AI 文案、圖片/規格、審核、Shopify publish 架構已相當完整。現在主要工作是**穩定化與正式環境一致性**，不是擴新功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 70–75%

## 2. 已實作的穩定化修復（皆尚未完整 runtime 驗證/merge）

### P0-1 Variant axis atomic confirm
分支：`agent/p0-variant-atomic-confirm`
固定 commit：`171bbaa`

Destructive axis change 未確認前不再先改 dimensions；確認後 dimensions + rows 一起套用。

### P0-2 Variant duplicate option protection
分支：`agent/p0-variant-duplicate-protection`
canonical：branch HEAD / `fix(variants): protect duplicate option combinations`

四層 guard：expand/merge、Workspace pre-submit、shared persistence、Shopify publish 409。

### P0-3 Mobile ResultCard expand affordance
分支：`agent/p0-mobile-resultcard-expand`
canonical：branch HEAD / `fix(mobile): restore ResultCard expand affordance`

只在 mobile 恢復既有 `.rc-toggle`（44×44），不恢復 desktop quick actions；使用 isolated `stabilization.css` hotfix。

### P1-1 Mobile interactive-target gesture guard
分支：`agent/p1-mobile-gesture-guard`
canonical：branch HEAD / `fix(mobile): isolate ResultCard controls from card gestures`

已改：
- 新增 `cardGestureTarget.ts`，集中辨識 interactive controls。
- `handleHeaderTouchStart/Move/End` 在 interactive target 退出，避免重生/toggle 等觸發 card long-press/swipe。
- blank card surface 的 long-press/swipe 保留。
- 新增 `verify-mobile-resultcard-gesture-guard.mjs`。
- 已補 `verify:mobile-resultcard-gesture` 與 `verify:all` wiring（舊 P1 分支原本漏掉）。
- 舊分支 whole-file replacement 曾意外破壞 ResultCard tab active predicate；目前乾淨版本保留 `activeTab === tab.id`，verifier 也鎖住此 regression。

目前 code/verifier diff 相對 P0-3 已確認只含 5 個檔案：ResultCard、gesture helper、gesture verifier、package、verify-all。

**下一個主線：P1-2 P07 Variant desktop picker / hover preview clipping。**

## 3. 仍待處理的高優先事項

### P1-2 P07 Variant desktop picker clipping
P07 ancestor `overflow-x:clip` 已確認會包住 Variant desktop absolute picker / hover zoom。mobile long-press preview 使用 Portal，比較安全。

目標：保留 workbench 防跨欄 containment，但讓 picker/hover preview 不被裁。

### P1-3 verifier localStorage policy
`verify-no-secrets.mjs` blanket-ban 多數 localStorage，合法 autosave / gesture hint 會誤報。應改成檢查「secret/token 是否寫 browser storage」。

### P0 role / permission model
實際角色 `admin | operator | reviewer`；部分文件曾寫 viewer。operator 預設不能 publish，牽涉前端 + RLS/DB guard，不能只改 `canPublish()`。

### P0 migration verification drift
migrations 已到 039，但 SQL verifier 主要驗早期 schema；需對 production Supabase 做 reconcile。

### CI
目前沒有正式 GitHub Actions CI gate。未來建議：install → verify → typecheck → build。

## 4. 重要 UIUX regression 結論

- B4-P06 fail reason desktop flex 曾回歸，後續 source 已修。
- P08 image thumb 方案後來被 P09 還原到 B2-P10。
- P07 broad `overflow-x:clip` 對 Variant desktop picker/hover 有已確認 selector 路徑風險。
- B3-P04 + B4-P04 mobile selectMode expand 缺口已做 P0-3 hotfix。
- interactive child touch 與 card gesture 衝突已做 P1-1 guard，待實機驗證。
- 過去 commit scope 混雜；現在一題一 commit。

## 5. 功能階段摘要

- Phase A/B：核心後端與 listing UI 大致完成。
- Phase C：shell/settings/library/FX 完成；member management 未完成；records 部分。
- Phase D：Shopify/image chain/Sharp/image review 大致完成；Showmore/preview/YouTube 有殘留驗證。
- Phase E：E1–E5 大致完成；E6 未完成。
- Phase F/G：大多未開始，**現在不優先**。

## 6. 正式環境尚未確認

仍需：
- Vercel production env
- Supabase migration / RLS 實際狀態
- Shopify production mode / credentials
- real-product E2E

## 7. 下一步順序

1. 收尾/squash P1-1；實機留待可執行環境驗證
2. P1-2 P07 Variant desktop picker clipping
3. P1-3 localStorage verifier policy
4. role/RLS consistency
5. production Supabase migration reconcile
6. CI
7. real-product E2E
8. 再往 E6/F/G

## 8. 文件讀取順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. 對應 audit
6. `docs/CHANGELOG.md`
7. 歷史施工文件（按需）

不要要求新 session 一開始全文讀 `施工清單.md` 或全部 dated docs。
