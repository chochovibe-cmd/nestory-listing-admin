# Nestory — Current Status

> 新 AI session 先讀本檔；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-20
正式 app 基準分支：`codex/nestory-v0.1-safety-skeleton`
正式 app 基準 HEAD：`6ff020dd1d68152b6688c9695f8f96188b7862be`
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

### Production app baseline 已部署；目前 mobile polish 尚未進 production

Vercel 目前可確認有一筆 **production deployment**：

- target：production
- Git commit：`6ff020dd1d68152b6688c9695f8f96188b7862be`
- commit message：`release: merge Nestory stabilization and tracked Supabase baseline (#6)`

GitHub 正式 app 基準分支 `codex/nestory-v0.1-safety-skeleton` 目前 HEAD 也正是 `6ff020dd`。

因此要明確切分：

- baseline stabilization / migration-baseline release：**已在 production**；
- 之後的 ImageUploader / ResultCard mobile runtime 修復與本輪 polish：仍在 `agent/release-thumbnail-regression-fix`，**尚未 merge / 尚未 production deploy**。

不要再寫「目前完全沒有 Vercel production deploy」；那已是過時資訊。

## 2. Stabilization stack

已實作、待目前 mobile polish 最後實機：

- P0-1 Variant destructive axis confirm atomic
- P0-2 duplicate option combination protection
- P0-3 mobile ResultCard explicit expand affordance：歷史修復已實作；**2026-08-20 owner runtime review 明確改為手機正常模式以整卡點按展開，不再顯示大型 rc-toggle**。原 handler 保留，這是 owner supersede，不是遺失修復。
- P1-1 mobile interactive-target gesture isolation
- P1-2 desktop Variant hover containment
- P1-3 browser-storage secret policy
- P0 batch archive owner authorization / `fdc5527`

目前 production baseline 已包含先前 merge 的 stabilization 組；本輪 mobile runtime/polish 分支仍要通過 release runtime gate 才能再整合。

## 3. UIUX collateral audit + runtime state

使用者規則：**不要整包回退 UIUX。先確認原本要改的 A 與實際 diff，只修已證實是 collateral 的 B；證據不足就不動。後續 polish 也必須避免改 A 時動到無關 C。**

已盤點 ImageUploader / ResultCard / Variant / workbench，並回掃 B2/B3/B4、UX-PKG1～6、AF polish 等高風險 UIUX commits。

證據：

- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`
- `docs/audits/MOBILE-REGRESSION-RESTORE-2026-08-19.md`
- `docs/audits/MOBILE-RUNTIME-VALIDATION-2026-08-19.md`
- `docs/audits/MOBILE-RELEASE-LAYOUT-2026-08-20.md`
- `docs/audits/RESULTCARD-MOBILE-POLISH-2026-08-20.md`

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

2026-08-20 owner 最新 iPhone 截圖顯示三欄縮圖可接受；本輪 ResultCard polish **不再修改 ImageUploader**。

### Results / ResultCard — containment 已通過，進入窄範圍 polish

2026-08-19 的 row3/nowrap 窄修在 iPhone 上仍不足。

2026-08-20 release-layout 改成：`workbench → active results pane → results panel/body/list → swipe wrapper → card/header` 全鏈寬度 containment，並讓 stage pills 只在自己的容器內水平滑動。

**最新 iPhone 實測已確認：ResultCard 不再凸出手機可視框。** 因此 width containment 不再重做。

Owner 接著要求的只是一輪手機 presentation polish；不改 ResultCard 行為程式：

- 商品標題保持主視覺；`文案待審核` / station label + 日期放在標題同一列右側；
- `海外現貨` / sale-status badge 移到縮圖 summary row；
- 手機正常模式隱藏大型 rc-toggle，整卡點按仍走原 `handleHeaderClick → tryToggleExpand`；
- collapsed card 內不再顯示獨立 `重生`，重生保留在 swipe action；
- 售價 / 原價 / 利潤資料保留，但移除厚重外框；
- `長按卡片可多選；左滑可快捷` 改為小字 helper，不用大 notice 框；
- swipe 核准 / 重生（或各 station 對應 action）只美化成較短、圓角的 action buttons，handler / API / disabled rules 不動。

這一輪使用 **CSS-only mobile presentation override**；`ResultCard.tsx` 不修改。

明確 C guard（本輪不動）：

- ImageUploader / upload pipeline；
- VariantEditor / variant persistence；
- long-press / swipe gesture math；
- multi-select state；
- review / approve / revision / archive / publish APIs；
- Shopify config；
- Supabase schema/data/RLS；
- roles/auth；
- desktop ResultCard quick actions。

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

## 10. GitHub / deployment 狀態

- 正式 app 基準：`codex/nestory-v0.1-safety-skeleton` @ `6ff020dd`
- Vercel production：已有 `6ff020dd` production deployment
- Draft PR #1：CI gate
- Draft PR #2：production reconcile planning
- Draft PR #3：free local runtime gate
- Draft PR #4：reversible production package
- migration baseline：`agent/supabase-migration-baseline`
- current release regression：`agent/release-thumbnail-regression-fix`

目前 mobile runtime / polish branch尚未 merge到 `6ff020dd` production baseline。

## 11. 下一步 — 以最快正式可用為目標

1. 產生本輪 ResultCard mobile polish 的單一 clean commit / Preview。
2. iPhone 只驗這一輪指定項目：
   - containment 不得回歸；
   - title + station/date 視覺順序正確；
   - sale-status badge 在 summary row；
   - mobile 不顯示大型 expand toggle，但正常點卡仍可展開；
   - collapsed price 無大外框；
   - collapsed card 無 inline `重生`；
   - swipe action 仍可用且視覺較精簡；
   - long-press multi-select 正常；
   - uploader 三欄保持不變。
3. 上述通過後，**停止 ResultCard/mobile layout 施工**。
4. final Release Candidate 跑一次 GitHub CI：`verify:all` → `typecheck` → `build`。
5. 再做最短 production env / Shopify config preflight。
6. 實測 + CI + production config preflight 綠後，由使用者明確同意把本輪 release 整合進 production baseline / Vercel production deploy。
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
- `docs/audits/RESULTCARD-MOBILE-POLISH-2026-08-20.md`
- `docs/audits/CI-GATE-2026-08-18.md`
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`

`docs/CHANGELOG.md` 是 append-only；若 connector 無安全 append primitive，不要為了補一筆紀錄而整檔覆寫/截斷。本輪已完整記錄於本檔 + dedicated audit。
