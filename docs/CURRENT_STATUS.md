# Nestory — Current Status

> 新 AI session 先讀本檔；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-20
正式 app 基準分支：`codex/nestory-v0.1-safety-skeleton`
目前 release regression 分支：`agent/release-thumbnail-regression-fix`

## 1. Production / app 狀態切分

### 已真正修改 production

Supabase production reconciliation 已完成。

正式專案：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`。

2026-08-18 經使用者明確授權後執行：

- live precheck：`PRECHECK_OK` ✅
- tracked migration `20260818142712 baseline_existing_schema_20260818` ✅
- tracked migration `20260818142919 production_reconcile_20260818` ✅
- live postcheck：`POSTCHECK_OK` ✅

受保護資料列前後一致：

- product_drafts 32
- product_images 147
- product_variants 143
- profiles 1

### 尚未進 production app

P0/P1 UI、Variant、ResultCard、archive API、目前 mobile release-layout 修復都仍在 GitHub branch stack，**尚未 merge 到正式 app 基準，也沒有 Vercel production deploy**。

所以：「DB repair 已上 production」≠「這輪 app 修復已上線」。

## 2. Stabilization stack

已實作、待最後整合/實機：

- P0-1 Variant destructive axis confirm atomic
- P0-2 duplicate option combination protection
- P0-3 mobile ResultCard compact expand affordance
- P1-1 mobile interactive-target gesture isolation
- P1-2 desktop Variant hover containment
- P1-3 browser-storage secret policy
- P0 batch archive owner authorization / `fdc5527`

Source-contract/verifier 已有；mobile / Variant / role UX 仍需 release runtime gate。

## 3. UIUX collateral audit + runtime state

使用者規則：**不要整包回退 UIUX。先確認原本要改的 A 與實際 diff，只修已證實是 collateral 的 B；證據不足就不動。**

已盤點 ImageUploader / ResultCard / Variant / workbench，並回掃 B2/B3/B4、UX-PKG1～6、AF polish 等高風險 UIUX commits。

證據：

- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`
- `docs/audits/MOBILE-REGRESSION-RESTORE-2026-08-19.md`
- `docs/audits/MOBILE-RUNTIME-VALIDATION-2026-08-19.md`
- `docs/audits/MOBILE-RELEASE-LAYOUT-2026-08-20.md`

### ImageUploader

歷史錨點：

- B17 `4304866`：P10 前正常 geometry，次縮圖 64×64、主圖 96×96、wrap。
- P10 `ed342ce`：改成 nowrap + 96/120。
- P08 `159721e`：修成 72/96，並非原版。
- P09 `8c7db19`：再恢復 P10 geometry。

2026-08-19 iPhone Preview 已確認：舊 P10/P09 水平大圖回歸已消失；手機 delete `×` 改為右上 32×32 並保留 spec badge。

2026-08-20 新 runtime 需求：手機四欄縮圖仍太小。現在採 **mobile-only 三欄等寬正方形 grid**：

- `<=959px`：`repeat(3, minmax(0, 1fr))`；
- main/secondary mobile box 等寬，靠既有「主圖／規格圖」badge 辨識；
- desktop 保留 64/96 anchor；
- spinner、retry、paste、drag/reorder、soft-remove、dual-size upload、spec marking 全保留。

### Results / ResultCard — release blocker

2026-08-19 的 row3/nowrap 窄修在 iPhone 上仍不足。

2026-08-20 重新對照 runtime screenshot 後，根因範圍提升：**不只 ResultCard，stage filter / scope / sort 也可能一起被右側裁切**。因此 mobile results pane 必須先成為硬性寬度邊界，不能再只修卡片內某一列。

目前 release-safe 策略：

- `workbench → active results pane → results panel/body/list → swipe wrapper → card/header` 全鏈 `width:100% + min-width:0 + max-width:100%`；
- results pane 本身阻止 residual horizontal paint；
- stage pills 維持「容器內水平滑動」，不得反向撐寬 results pane；
- ResultCard 保留 title / thumb+chips / regen+price 結構與所有功能；
- chips/meta/failReason/price 全部必須服從卡片寬度；
- `<=639px` 允許 regen / price 上下排列，price/profit/tone 可換行；
- regen、expand、long-press、swipe、multi-select 全保留。

**這不是歷史 revert。** ResultCard 已累積太多功能，release contract 改為：功能保留，但手機任何內容都不能把 results pane / card 撐出可視框。

已查過但沒有足夠現行 bug 證據，因此目前不動：

- Variant P01/P03 shared-tree 歷史；
- B3-P06 Variant B-layout / reorder / picker zoom；
- P07 desktop workbench containment（P1-2 已處理 picker interaction）；
- B2/B3 其他 station/filter/scope chrome；
- UX-PKG1～6 與 AF animation/a11y polish。

## 4. CI gate

`agent/ci-gate` / `b935290` / Draft PR #1。

Canonical：frozen pnpm install → `verify:all` → `typecheck` → `build`。

Vercel 曾因 Hobby deployment quota / build-rate-limit 失敗；不要把 quota error 當 code compile failure。

目前 runtime branch 盡量以單一 clean commit 產生單一 Preview，避免再次大量觸發部署。

## 5. Role / RLS canonical model

- operator：建立/操作自己的商品；不審核、不發布。
- reviewer：全隊讀取、審核、發布。
- admin：reviewer + profiles / 成員角色 / 敏感設定。
- viewer：不存在，目前不要新增。

任何角色改動要 helper + UI + API + DB/RLS + tests 一起對齊。

## 6. Production Supabase reconciliation — COMPLETE

已套用：

1. 補回 migration 004 遺失的 8 條 catalog/rule RLS policies。
2. 3 個 timestamp helpers pin `search_path=pg_catalog`。
3. `handle_new_user()` / `guard_sensitive_product_draft_fields()` 移除 PUBLIC/anon/authenticated direct EXECUTE，保留 service_role。
4. authenticated RLS helpers保持可執行。
5. hosted-only `rls_auto_enable()` 未修改。
6. role/business rows/Shopify/Vercel config未改。

仍存在、需獨立設計但**不是目前 release blocker**：

- `current_user_role` mutable search_path；
- SECURITY DEFINER / RPC surface findings；
- hosted/platform helper findings；
- Auth leaked-password protection disabled（免費方案限制）；
- anonymous-sign-in advisory/info。

不要為了 Advisor 全綠就一刀切 revoke authenticated RLS helpers。

## 7. Migration tracking — 2026-08-18 起

Production migration list canonical：

1. `20260818142712 baseline_existing_schema_20260818`
2. `20260818142919 production_reconcile_20260818`

Active queue：`supabase/migrations/` 只放上述兩筆 + future tracked migrations。

舊 `001–039` 完整保留在 `supabase/history/pre_tracking_migrations/`，只作歷史證據 / controlled local reconstruction；**不可 production replay、不可搬回 active queue**。

Baseline marker 是 state assertion，不是 blank-DB schema dump。

## 8. Free local Supabase runtime proof

`agent/supabase-local-ci` / `f017765` / Draft PR #3。

已 runtime 驗：historical reconstruction、8-policy reconcile、role/RLS matrix、new-user/sensitive-field triggers、batch ownership、archive auth、timestamp hardening、precheck/apply/postcheck/rollback/re-apply。

Historical local-only conditions：032 需要單 transaction；033 需要 local-only legacy `吉伊卡哇` fixture。這不是 production drift。

## 9. Rollback semantics

Production reconcile 已 tracked。若未來要回復：

- 不要手動跑舊 rollback 後留下不一致 ledger；
- 不要刪/偽造 migration ledger；
- 建立新的 timestamped tracked revert migration，再 postcheck。

## 10. GitHub / PR 狀態

- Draft PR #1：CI gate
- Draft PR #2：production reconcile planning
- Draft PR #3：free local runtime gate
- Draft PR #4：reversible production package
- migration baseline：`agent/supabase-migration-baseline`
- current release regression：`agent/release-thumbnail-regression-fix`

以上 app-related branches仍未 merge；production DB repair已完成不代表 app branch已上線。

## 11. 下一步 — 以最快正式可用為目標

1. 產生本輪 mobile release-layout 單一 clean commit / Preview。
2. iPhone 只驗 release blockers：
   - uploader 一排 3 張、正方形、`×` / spec badge正常；
   - stage filters / scope / sort 不超出螢幕；
   - ResultCard border、chips、price/profit 全部不凸出；
   - regen / expand / long-press / swipe / multi-select 正常；
   - Variant picker/zoom 快速 sanity check。
3. 上述通過後，**停止 mobile layout 施工**。
4. final Release Candidate 跑一次 GitHub CI：`verify:all` → `typecheck` → `build`。
5. 再做最短 production env / Shopify config preflight。
6. 實測 + CI + production config preflight 綠後，由使用者明確同意 merge / Vercel production deploy。
7. SECURITY DEFINER private-helper hardening留到 release 後，不列目前 blocker。

## 12. Source of truth

- 本檔：current state
- `AI_START_HERE.md`：新 session入口
- `docs/STABILIZATION_PLAN.md`：施工順序
- `docs/RELEASE_READINESS.md`：release gate
- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`
- `docs/audits/MOBILE-REGRESSION-RESTORE-2026-08-19.md`
- `docs/audits/MOBILE-RUNTIME-VALIDATION-2026-08-19.md`
- `docs/audits/MOBILE-RELEASE-LAYOUT-2026-08-20.md`
- `docs/audits/CI-GATE-2026-08-18.md`
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`

`docs/CHANGELOG.md` 是 append-only；若 connector 無安全 append primitive，不要為了補一筆紀錄而整檔覆寫/截斷。這次 mobile release-layout change 已完整記錄於本檔 + dedicated audit。
