# Nestory — Stabilization Plan

> 目的：把 regression / authorization / production / CI audits 轉成可執行施工順序。
> 詳細證據看 `docs/audits/`；release gate 看 `docs/RELEASE_READINESS.md`。

更新：2026-08-18

## A. 已實作、尚待最後 app 整合/實機驗證

1. P0-1 Variant axis atomic confirm — `verify:variant-axis-atomic`
2. P0-2 Variant duplicate option protection — `verify:variant-duplicates`
3. P0-3 Mobile ResultCard expand affordance — `verify:mobile-resultcard-expand`
4. P1-1 Mobile interactive-target gesture guard — `verify:mobile-resultcard-gesture`
5. P1-2 P07 Variant hover containment — `verify:variant-picker-containment`
6. P1-3 Browser-storage secret policy — `verify:browser-storage-secrets`
7. P0 Batch archive owner authorization — `fdc5527` / `verify:batch-archive-auth`

這些 app/UI 修復仍在 branch stack，尚未 merge / Vercel production deploy；CI green不等於 UX實機全驗。

## B. Source CI — COMPLETE

`agent/ci-gate` / `b935290` / Draft PR #1。

Pipeline：frozen pnpm install → `verify:all` → `typecheck` → `build`。

Vercel Preview曾因 `build-rate-limit / upgradeToPro` failure；GitHub production build可通過。

## C. Production Supabase audit + free runtime proof — COMPLETE

Canonical role model：
- operator：own drafts / no review / no publish
- reviewer：team read/review/publish
- admin：reviewer + profiles/settings administration
- no viewer role

Free runtime：GitHub Actions + Docker + Supabase CLI + Postgres 17；**不使用付費 Supabase Development Branch**。

已驗：catalog RLS、draft owner boundary、reviewer/admin cross-team、new-user/sensitive-field triggers、batch recursion、archive auth、timestamp/function hardening、reversible package cycle。

Historical local reconstruction：
- archived 001–039
- 032 transaction modeling
- 033 local-only legacy parent fixture

## D. Production Supabase reconcile — COMPLETE / LIVE

使用者已明確授權並已成功套用到：
`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`。

Live results：
- precheck `PRECHECK_OK` ✅
- baseline migration `20260818142712` ✅
- reconcile migration `20260818142919` ✅
- postcheck `POSTCHECK_OK` ✅

Protected counts unchanged：32 drafts / 147 images / 143 variants / 1 profile。

Applied：
- restore 8 migration-004 catalog/rule RLS policies；
- pin 3 timestamp helper `search_path=pg_catalog`；
- remove direct client EXECUTE from `handle_new_user()` / sensitive-field guard；
- keep service_role + authenticated RLS helper contracts；
- leave hosted-only `rls_auto_enable()` unchanged。

Security Advisor target findings resolved：4 no-policy findings + targeted 3 timestamp search-path findings。

Residual warnings需獨立 scope：RLS/security-definer RPC surface、`current_user_role` search_path、Auth leaked-password protection / anonymous-sign-in config。

## E. Migration tracking baseline — CURRENT WORK

Branch：`agent/supabase-migration-baseline`。

Production tracking正式從 2026-08-18 audited state開始；不偽造歷史、不 replay 001–039。

### Active migration queue

`supabase/migrations/`
- `20260818142712_baseline_existing_schema_20260818.sql`
- `20260818142919_production_reconcile_20260818.sql`
- future tracked migrations append here

### Historical archive

`supabase/history/pre_tracking_migrations/`
- byte-for-byte保留 001–039
- history / local bootstrap only
- 禁止 production replay / 禁止回 active queue

### CI guard

`verify:supabase-migration-baseline` / `scripts/verify-supabase-migration-baseline.mjs`

必須驗：
- active queue與production ledger版本對齊；
- archive完整 001–039；
- local workflow從 archive bootstrap；
- `rls_auto_enable()`不被塞進已驗證 minimal reconcile。

### Rollback新規則

production reconcile已 tracked；舊 review `rollback.sql`只作 inverse reference。

若未來真要回復：建立**新的 tracked revert migration**，不可只手動逆 SQL、不可刪/偽造 ledger。

## F. 下一個施工順序

1. **收尾 migration-baseline branch**
   - standard CI green
   - free local Supabase gate green
   - production `list_migrations` 再核對兩版本
   - squash單一 commit / Draft PR
   - 不 merge，除非使用者另行授權
2. **Residual Supabase security hardening audit**
   - `current_user_role` search_path
   - RLS helper / SECURITY DEFINER exposed RPC surface
   - hosted-only helpers另行評估
   - Auth leaked-password protection decision
   - 一律先local/source proof，再決定 production DDL
3. **Production config audit**
   - Vercel production env
   - Shopify production config / publish safety
4. **Manual UX + controlled E2E**
   - mobile ResultCard
   - Variant desktop/mobile
   - role flows
   - controlled real-product Shopify E2E
5. **整合 stabilization stack**
   - 決定 branch merge順序
   - final CI / release readiness
   - 使用者明確授權後才 Vercel production deploy
6. 再進 E6/F/G。

## G. 不要做

- 不 replay archived `001–039` 到 production。
- 不把 historical 001–039 搬回 active migration queue。
- 不手動偽造/刪除 Supabase migration ledger。
- 不手動跑舊 rollback造成 schema/ledger drift；要 tracked revert。
- 不為了 advisor綠燈一刀切 SECURITY DEFINER/RLS helper EXECUTE。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 不 disable RLS。
- 不直接把 operator加進 publish。
- 不把 local-only baseline fixture套 production。
- 不建立付費 Supabase branch。
- 不信任前端 IDs 後直接 service-role mutation。
- 不為了 CI green 關掉 verifier。
- 不 merge / 不 production deploy，除非使用者明確同意。
