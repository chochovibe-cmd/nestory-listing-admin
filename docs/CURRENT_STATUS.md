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

### 尚未進 production app / production SD-1 的部分

P0/P1 UI、Variant、ResultCard、archive API 等 stabilization 修復仍在 GitHub branch stack，**尚未 merge 到正式 app 基準，也沒有 Vercel production deploy**。

新的 SD-1 private-schema RLS helper hardening 目前也仍是**本機驗證 / production-candidate package**，尚未套 production。

所以：「第一輪 DB security repair 已上 production」≠「所有前台修復或 SD-1 已上線」。

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

通知策略：**中間施工不開 PR；整理 / squash 完才開一次 Draft PR 做 final CI。** 已用這個方式避免每個小 commit 都寄 Actions email。

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

已套用 scope：
1. migration 004 遺失的 8 條 RLS policies已補回。
2. 3 個 timestamp helper → `search_path=pg_catalog`。
3. `handle_new_user()` / `guard_sensitive_product_draft_fields()` 移除 PUBLIC/anon/authenticated direct EXECUTE，保留 service_role。
4. hosted-only `rls_auto_enable()` 未修改。
5. role/business rows/Shopify/Vercel config未改。

## 6. Migration tracking — 從 2026-08-18 正式開始

Production migration list canonical：
1. `20260818142712 baseline_existing_schema_20260818`
2. `20260818142919 production_reconcile_20260818`

Production在這兩筆以前沒有 Supabase migration tracking；沒有 replay / 偽造 `001–039` ledger。

Active `supabase/migrations/` 只保留上述 tracked versions + future tracked migrations。

舊 `001–039` 已 byte-for-byte archive 到：
`supabase/history/pre_tracking_migrations/`

不可 production replay，也不可搬回 active queue。

`scripts/verify-supabase-migration-baseline.mjs` 已接入 `verify:all`；migration 001 / 036 的舊 verifier 路徑也已改讀 archive。

## 7. Free local Supabase runtime proof

使用免費 GitHub runner + Docker + Supabase CLI + Postgres 17；**不使用付費 Supabase Development Branch**。

第一輪 DB repair 已 runtime 驗：historical reconstruction、8-policy reconcile、角色/RLS、batch recursion、archive scope、trigger hardening、pre/apply/post/rollback/re-apply。

Historical local-only conditions：
- 032 staged copy需要單一 transaction（`pg_temp ... ON COMMIT DROP`）；
- 033需要 local-only legacy `吉伊卡哇` parent fixture。

這些是 reconstruction debt，不表示 production缺 032/033。

## 8. SECURITY DEFINER / RPC audit + SD-1 — PROTOTYPE GREEN

詳見：`docs/audits/SUPABASE-SECURITY-DEFINER-AUDIT-2026-08-18.md`。

Production唯讀確認：
- 主要 app tables 對 `anon` 沒有 SELECT / INSERT grant；
- 7 個純 RLS helper 被 35 條 policies / 19 張 tables使用；
- `requeue_revision_for_generation` 是獨立 privileged business function，**不納入 SD-1**；
- `rls_auto_enable` 真正掛在 hosted event trigger `ensure_rls`，local 無法重現，**不碰**；
- leaked-password protection 是 Supabase Pro+，本專案維持 Free，不為了 advisor 升級。

### SD-1 chosen design

- 建立 non-exposed `private` schema。
- 建立 3 個 role helpers + 4 個 batch ownership helpers 的 `private.*` SECURITY DEFINER 版本，固定 `search_path=pg_catalog`。
- 35 條 RLS policies 全部改呼叫 `private.*`。
- policy 改完後才撤掉 anon/authenticated 對 legacy public helper 的 direct EXECUTE。
- 舊 public functions暫時保留，因 `guard_sensitive_product_draft_fields` / `requeue_revision_for_generation` 仍會在內部呼叫 role helper。
- operator/reviewer/admin semantics不改。

### SD-1 prototype runtime result

測試 head：`bec490463f48cfeeb8b4c5edda60463313e02a25`。

Draft PR #7（之後為減少通知已 closed / unmerged）：
- standard CI #168 ✅ verify / typecheck / build
- Supabase Local #39 ✅
- private-schema helper step ✅

實際證明：35 policy private rewrite、7 helper、role matrix、catalog admin/operator、batch ownership、archive scope、敏感欄位 guard 都正常；無 `42P17`。

## 9. SD-1 reversible production-candidate package — PREPARED, FINAL PACKAGE GATE NEXT

Canonical apply body（已在 prototype 全綠）：
- `supabase/verification/private-rls-helper-prototype.sql`

Production-candidate safety files：
- `supabase/reconcile/2026-08-18_sd1_private_helpers_precheck.sql`
- `supabase/reconcile/2026-08-18_sd1_private_helpers_postcheck.sql`
- `supabase/reconcile/2026-08-18_sd1_private_helpers_revert.sql`
- `scripts/test-supabase-private-rls-package-local.sh`

Package cycle：
`revert-to-preSD1 → precheck → exact apply → postcheck → role/RLS matrix → revert → verify revert → exact re-apply → postcheck`。

Protected product/image/variant/profile row counts會在循環前後比較。

Production precheck要求最新 tracked version仍是 `20260818142919`。目前 production唯讀查詢仍精確只有兩筆 migration。

**SD-1 package 尚未套 production；production apply 仍需新的明確授權。**

## 10. Rollback semantics after tracking

任何已 tracked DB migration 若需要回復：
- 不要直接手動跑 inverse SQL；
- 不要刪 / 偽造 migration ledger；
- 應建立新的 timestamped tracked revert migration，再 postcheck。

`*_revert.sql` 是 inverse reference + local test asset，不是 production SQL Editor 快捷鍵。

## 11. GitHub branch / PR 狀態

- Draft PR #1：CI gate
- Draft PR #2：production reconcile planning
- Draft PR #3：free local runtime gate
- Draft PR #4：reversible production package
- PR #5：closed / unmerged（被 final squashed PR取代）
- Draft PR #6：migration baseline final validation，green / unmerged
- PR #7：SD-1 prototype final validation，green、closed / unmerged（為後續施工避免通知）
- current branch：`agent/supabase-security-definer-audit`，目前**不開 PR**直到 SD-1 reversible package整理 / squash完

Production DB第一輪 repair已透過明確授權後的 tracked migrations完成；GitHub app branches仍未 merge。

## 12. 下一步順序

1. 跑 SD-1 reversible package final free-local gate；中間不開 PR。
2. 若全綠，再用唯讀 production precheck確認 live state沒 drift。
3. 到這一步才詢問是否授權建立 / 套用下一筆 production tracked migration；**不可自行 apply**。
4. SD-1 production後再重新跑 Security Advisor；`requeue_revision_for_generation` / `rls_auto_enable`分開處理。
5. Vercel production env + Shopify production config audit。
6. manual mobile/Variant/role UX + controlled real-product E2E。
7. 最後整理 stabilization branch stack，決定 merge / Vercel production deploy。
8. 再進 E6/F/G。

## 13. 文件 source of truth

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

新 agent不要再從歷史文件推論「production DB尚未修改」；那已經是舊狀態。但也不要誤以為 SD-1 已上 production；目前只有第一輪 reconciliation 已正式套用。
