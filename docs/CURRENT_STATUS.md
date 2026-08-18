# Nestory — Current Status

> 給新 AI session 的短版現況；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-18
正式 app 基準分支：`codex/nestory-v0.1-safety-skeleton`
目前安全工作分支：`agent/supabase-security-definer-audit`

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

Source-contract/verifier 已有；mobile/Variant/role UX仍要按 `docs/RELEASE_READINESS.md` 做實機 cases。

## 3. CI / migration-baseline gate

CI canonical：frozen pnpm install → `verify:all` → `typecheck` → `build`。

`agent/supabase-migration-baseline` 最終 head：`92c5869c9470adc8d4547417a5da157b849f0802`，Draft PR #6，未 merge。

Final PR validation：
- standard CI run #160：verify ✅ / typecheck ✅ / build ✅
- Supabase Local Reconcile run #38：historical rebuild ✅ / role+RLS ✅ / function hardening ✅ / precheck-apply-rollback-postcheck ✅

舊 PR #5 因 squash/force-push 後無法 reopen，保持 closed / unmerged；PR #6 是乾淨 final validation PR。

通知策略：中間施工不開 PR；整理完才開 Draft PR 跑一次 final CI，避免每個小 commit 都寄 Actions email。

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

## 6. Migration tracking — 從 2026-08-18 正式開始

Production在本次以前完全沒有 Supabase migration tracking，但 live schema/data已反映歷史 repo SQL `001–039` 大部分最終狀態。

因此沒有 replay / 沒有偽造歷史 ledger，而是從 audited live state建立新 tracking boundary。

Production migration list canonical：
1. `20260818142712 baseline_existing_schema_20260818`
2. `20260818142919 production_reconcile_20260818`

Active `supabase/migrations/` 只保留上述兩個 tracked versions + future tracked migrations。

舊 `001–039` 已 byte-for-byte archive 到：
`supabase/history/pre_tracking_migrations/`

不可 production replay，也不可搬回 active queue。

`scripts/verify-supabase-migration-baseline.mjs` 已接入 `verify:all`；舊 verifier 對 migration 001 / 036 的硬編碼路徑也已改讀 historical archive。

## 7. Free local Supabase runtime proof

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

## 8. SECURITY DEFINER / RPC hardening audit — READ ONLY

Current branch：`agent/supabase-security-definer-audit`。

詳見：`docs/audits/SUPABASE-SECURITY-DEFINER-AUDIT-2026-08-18.md`。

Production唯讀確認：
- 主要 app tables 對 `anon` 沒有 SELECT / INSERT grant；
- `current_user_role` / `is_admin` / `is_reviewer` 與 4 個 batch ownership helpers 是 RLS 核心 helper，不能直接 revoke authenticated EXECUTE；
- Supabase官方建議 RLS SECURITY DEFINER helper 不必留在 exposed schema；長期較乾淨方案是移到 non-exposed `private` schema，再讓 policies明確呼叫 `private.*`；
- `requeue_revision_for_generation` 是具 auth/ownership/status 檢查的 privileged business function，是否仍需要 direct RPC尚待 source usage裁決，不先改；
- `rls_auto_enable` 真正掛在 hosted event trigger `ensure_rls`，且 local stack無法重現，現在不碰；
- Auth leaked-password protection 是 Supabase Pro+ 功能；本專案維持 Free，因此只記錄、不要求升級。

**本 audit 尚未對 production做任何新 DDL / Auth 設定變更。**

下一個安全實作候選：在免費 local DB 做 SD-1 private-schema RLS helper prototype，完整跑 role/RLS matrix後再決定是否產生 production migration。

## 9. Rollback semantics after tracking

舊 `supabase/reconcile/2026-08-18_production_rollback.sql` 現在只是 inverse SQL reference。

因 production reconcile 已 tracked，如果需要回復：
- 不要只手動跑 rollback.sql；
- 不要刪/偽造 migration ledger；
- 應建立新的 timestamped **tracked revert migration**，使用已測過的 inverse operations，再 postcheck。

否則會產生 schema狀態和 ledger不一致。

## 10. GitHub branch / PR 狀態

- Draft PR #1：CI gate
- Draft PR #2：production reconcile planning
- Draft PR #3：free local runtime gate
- Draft PR #4：reversible production package
- PR #5：closed / unmerged（被 final squashed PR取代）
- Draft PR #6：migration baseline final validation，green / unmerged
- current branch：`agent/supabase-security-definer-audit`，目前**不開 PR**以避免中間 CI/email spam

Production DB repair是透過明確授權後的 Supabase tracked migrations完成，並不代表 GitHub app branches已 merge。

## 11. 下一步順序

1. SD-1：在免費 local Supabase prototype `private` RLS helpers + policy rewrite；先測、不碰 production。
2. 裁決 `requeue_revision_for_generation` 是否仍為 intentional direct RPC。
3. 若 SD-1 全綠，才準備 tracked forward migration + pre/postcheck + revert；production apply 需再次明確授權。
4. Vercel production env + Shopify production config audit。
5. manual mobile/Variant/role UX + controlled real-product E2E。
6. 最後整理 stabilization branch stack，決定 merge / Vercel production deploy。
7. 再進 E6/F/G。

## 12. 文件 source of truth

- 本檔：current state
- `AI_START_HERE.md`：新 session入口
- `docs/STABILIZATION_PLAN.md`：施工順序
- `docs/RELEASE_READINESS.md`：release gate
- `docs/audits/CI-GATE-2026-08-18.md`
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`
- `docs/audits/SUPABASE-SECURITY-DEFINER-AUDIT-2026-08-18.md`

新 agent不要再從歷史文件推論「production DB尚未修改」；那已經是舊狀態。
