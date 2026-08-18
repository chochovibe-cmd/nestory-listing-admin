# Nestory — Current Status

> 給新 AI session 的短版現況；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-19
正式 app 基準分支：`codex/nestory-v0.1-safety-skeleton`
目前 release regression 分支：`agent/release-thumbnail-regression-fix`

## 1. 最重要的現況切分

### 已真正修改 production 的部分

**Supabase production reconciliation 已成功完成。**

正式專案：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`。

2026-08-18 使用者明確授權 production DB repair；執行結果：

- live precheck：`PRECHECK_OK` ✅
- tracked migration `20260818142712 baseline_existing_schema_20260818` ✅
- tracked migration `20260818142919 production_reconcile_20260818` ✅
- live postcheck：`POSTCHECK_OK` ✅

受保護資料列前後一致：
- product_drafts 32
- product_images 147
- product_variants 143
- profiles 1

### 尚未進 production app 的部分

P0/P1 UI、Variant、ResultCard、archive API 等 stabilization 修復仍在 GitHub branch stack，**尚未 merge 到正式 app 基準，也沒有 Vercel production deploy**。

所以：「DB security repair 已上 production」≠「這輪所有前台/功能修復已上線」。

## 2. Stabilization stack — 已實作，待最後整合/實機

- P0-1 Variant destructive axis confirm atomic
- P0-2 duplicate option combination protection
- P0-3 mobile ResultCard compact expand affordance
- P1-1 mobile interactive-target gesture isolation
- P1-2 desktop Variant hover containment
- P1-3 browser-storage secret policy
- P0 batch archive owner authorization / `fdc5527`

Source-contract/verifier已有；mobile/Variant/role UX仍要按 `docs/RELEASE_READINESS.md` 做實機 cases。

### 2026-08-19 UIUX collateral-regression audit + mobile restore

使用者最後確認的修復規則：**不要整包回退 UIUX。先對照「原本要改的 A」與實際 diff／現況，只修已證實是 collateral 的 B；證據不足就不動程式碼。**

本輪已完整盤點 ImageUploader / ResultCard / Variant / workbench，並回掃 B2/B3/B4、UX-PKG1～6、AF polish 等高風險 UIUX commits。完整矩陣見：

- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`
- `docs/audits/MOBILE-REGRESSION-RESTORE-2026-08-19.md`

目前只有兩個效果通過「可修改」證據門檻：

1. **ImageUploader geometry**
   - B17 `4304866` 是 P10 前最後一個有意識的正常比例：次縮圖 64×64、主圖 96×96、wrap。
   - P10 `ed342ce` 後變成 nowrap + 96/120；P08 `159721e` 曾修成 72/96；P09 `8c7db19` 又恢復 P10 geometry。
   - 現在只恢復 **wrap + 64/96**。
   - P10/P09 的「規格圖右上角標＋刪除 × 左上」有明確歷史紀錄，尚無證據屬於誤傷，因此**不回退位置**；等 Preview 若實際壞掉再處理。
   - spinner、retry、paste、drag/reorder、soft-remove、dual-size upload 全保留。

2. **ResultCard P04 row-3 track coupling**
   - B4-P04 `47a96c` 的三排本身是明確 A：`title` / `thumb+chips` / `regen+price`，不能回退成舊卡。
   - 真正 B 是實作把第 3 排重生按鈕塞進第 2 排縮圖共用的 64px 欄，但重生按鈕最小 72px，會侵入價格區；price nowrap + P07 clip 讓問題在窄手機變成右側裁切。
   - 修法只把第 3 排改成自己的 `max-content + minmax(0,1fr)` 內層 grid；**仍然是左重生、右價格的第 3 排**。
   - long-press、swipe、multi-select、gesture hint、explicit expand 全保留。

已查過但**沒有足夠現行 bug 證據，因此不動**：

- Variant P01/P03 混在同一 tree 的歷史；
- B3-P06 Variant B-layout / reorder / picker zoom；
- P07 workbench `overflow-x:clip` containment（P1-2 已處理 picker interaction）；
- B2/B3 station/filter/scope chrome；
- UX-PKG1～6 與 AF 動畫／a11y polish。

這一包仍未 merge / production deploy。Vercel Hobby 目前因前面 branch deployment 過多觸發 `api-deployments-free-per-day`，不要把 Preview quota error 當 code failure。

## 3. CI gate

`agent/ci-gate` / `b935290` / Draft PR #1。

Canonical：frozen pnpm install → `verify:all` → `typecheck` → `build`。

Vercel recent preview failure曾是 `build-rate-limit / upgradeToPro`；GitHub CI可成功 production build，不要把 Preview quota failure當 code compile failure。

## 4. Role / RLS canonical model

- operator：建立/操作自己的商品；不審核、不發布。
- reviewer：全隊讀取、審核、發布。
- admin：reviewer + profiles / 成員角色 / 敏感設定。
- viewer：不存在 TS/DB role；目前不要新增。

任何角色改動要 helper + UI + API + DB/RLS + tests 一起對齊。

## 5. Production Supabase reconciliation — COMPLETE

詳見：
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`

### 已套用 scope

1. migration 004 遺失的 8 條 RLS policies已補回：
   - ip_catalog select/write
   - ip_characters select/write
   - tag_rules select/write
   - collection_rules select/write
2. `set_updated_at()` / `touch_image_batches_updated_at()` / `touch_publish_batches_updated_at()` → `search_path=pg_catalog`。
3. `handle_new_user()` / `guard_sensitive_product_draft_fields()` 移除 PUBLIC/anon/authenticated direct EXECUTE，保留 service_role。
4. authenticated RLS helpers保持可執行。
5. hosted-only `rls_auto_enable()` 未修改。
6. role/business rows/Shopify/Vercel config未改。

### Security Advisor after apply

這次目標已解掉：
- 4 張 catalog/rule table 的 `RLS enabled but no policy` findings；
- 3 個 timestamp helper 的目標 mutable-search-path findings。

仍存在、要獨立設計/測試：
- `current_user_role` mutable search_path；
- SECURITY DEFINER / RPC surface findings（RLS helpers、batch ownership helpers等）；
- hosted/platform helper findings；
- Auth leaked-password protection disabled；
- anonymous-sign-in advisory/info。

**不要為了 advisor 變綠就一刀切 revoke authenticated RLS helpers。**

## 6. Migration tracking — 從 2026-08-18 正式開始

Production在本次以前完全沒有 Supabase migration tracking，但 live schema/data已反映歷史 repo SQL `001–039` 大部分最終狀態。

因此沒有 replay / 沒有偽造歷史 ledger，而是從 audited live state建立新 tracking boundary。

Production migration list目前 canonical：

1. `20260818142712 baseline_existing_schema_20260818`
2. `20260818142919 production_reconcile_20260818`

### Active queue

`supabase/migrations/`
- `20260818142712_baseline_existing_schema_20260818.sql`
- `20260818142919_production_reconcile_20260818.sql`
- future tracked migrations append here。

### Historical archive

`supabase/history/pre_tracking_migrations/`
- 完整保留舊 `001–039`；Git blob/tree直接搬移，內容不改。
- 用於歷史證據 / controlled local reconstruction。
- **不可 production replay，不可搬回 active queue。**

Baseline marker是 state assertion，不是完整 blank-DB schema dump；free local historical reconstruction仍使用 archived SQL + documented 032/033 conditions。

`scripts/verify-supabase-migration-baseline.mjs` 已接入 `verify:all`，鎖住 active queue / archive / local bootstrap contract。

## 7. Free local Supabase runtime proof

`agent/supabase-local-ci` / `f017765` / Draft PR #3。

使用免費 GitHub runner + Docker + Supabase CLI + Postgres 17；使用者要求**不要付費 Supabase Development Branch**。

已 runtime 驗：
- historical production-like reconstruction；
- 8-policy drift/reconcile；
- operator/admin catalog RLS；
- operator owner boundary；
- reviewer/admin cross-team；
- new-user / sensitive-field triggers；
- batch ownership helper no `42P17`；
- archive auth scope；
- timestamp/function hardening；
- precheck/apply/postcheck/rollback/re-apply cycle。

Historical local-only conditions：
- 032 staged copy需要單一 transaction（`pg_temp ... ON COMMIT DROP`）；
- 033需要 local-only legacy `吉伊卡哇` parent fixture。

這些是 reconstruction debt，不表示 production缺 032/033。

## 8. Rollback semantics after tracking

舊 `supabase/reconcile/2026-08-18_production_rollback.sql` 現在只是**inverse SQL reference**。

因 production reconcile 已 tracked，如果需要回復：
- 不要只手動跑 rollback.sql；
- 不要刪/偽造 migration ledger；
- 應建立新的 timestamped **tracked revert migration**，使用已測過的 inverse operations，再 postcheck。

否則會產生 schema狀態和 ledger不一致。

## 9. GitHub branch / PR 狀態

- Draft PR #1：CI gate
- Draft PR #2：production reconcile planning
- Draft PR #3：free local runtime gate
- Draft PR #4：reversible production package
- migration baseline：`agent/supabase-migration-baseline`
- current release regression restore：`agent/release-thumbnail-regression-fix`

以上 app-related branches仍未 merge；production DB repair是透過明確授權後的 Supabase tracked migrations完成，並不代表 GitHub app branches已 merge。

## 10. 下一步順序

1. 完成 `agent/release-thumbnail-regression-fix` collateral-only source verifier / scope review。
2. Vercel Preview capacity恢復後只產生一次新的 Release Preview。
3. 手機實測 ImageUploader：64/96 wrap、規格角標/×、spinner/retry/drag；ResultCard：P04 三排仍在、row3 不裁切、expand/gesture；Variant picker/zoom。
4. final Release Candidate跑一次 GitHub CI：`verify:all` → `typecheck` → `build`。
5. 實測＋CI 綠後再決定 merge / Vercel production deploy。
6. SECURITY DEFINER private-helper hardening先停，不列為目前 release blocker。
7. 再進 E6/F/G。

## 11. 文件 source of truth

- 本檔：current state
- `AI_START_HERE.md`：新 session入口
- `docs/STABILIZATION_PLAN.md`：施工順序
- `docs/RELEASE_READINESS.md`：release gate
- `docs/audits/CI-GATE-2026-08-18.md`
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`
- `docs/audits/MOBILE-REGRESSION-RESTORE-2026-08-19.md`
- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`

新 agent不要再從歷史文件推論「production DB尚未修改」；那已經是舊狀態。
