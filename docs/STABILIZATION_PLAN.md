# Nestory — Stabilization Plan

> 目的：把 regression / authorization / production / CI audits 轉成可執行施工順序。
> 詳細證據看 `docs/audits/`；release gate 看 `docs/RELEASE_READINESS.md`。

更新：2026-08-18

## 已實作，待最終整合/實機驗證

1. **P0-1 Variant axis atomic confirm** — `agent/p0-variant-atomic-confirm` / `verify:variant-axis-atomic`
2. **P0-2 Variant duplicate option protection** — `agent/p0-variant-duplicate-protection` / `verify:variant-duplicates`
3. **P0-3 Mobile ResultCard expand affordance** — `agent/p0-mobile-resultcard-expand` / `verify:mobile-resultcard-expand`
4. **P1-1 Mobile interactive-target gesture guard** — `agent/p1-mobile-gesture-guard` / `verify:mobile-resultcard-gesture`
5. **P1-2 P07 Variant hover containment** — `agent/p1-variant-picker-clipping` / `verify:variant-picker-containment`
6. **P1-3 Browser-storage secret policy** — `agent/p1-localstorage-secret-policy` / `verify:browser-storage-secrets`
7. **P0 Batch archive owner authorization** — `agent/p0-archive-owner-authorization` / `fdc5527` / `verify:batch-archive-auth`

功能修復已有 source-contract verifier；mobile/Variant/role runtime cases 仍要按 `docs/RELEASE_READINESS.md` 實測。

## Source CI gate — complete / green

專項：`docs/audits/CI-GATE-2026-08-18.md`
分支：`agent/ci-gate` / `b935290`
Draft PR：#1

Canonical pipeline：frozen pnpm install → `verify:all` → `typecheck` → `build`。
Final squashed-head run `32132941280` / job `95697924316`：✅。

Recent Vercel preview check target = `build-rate-limit / upgradeToPro`；GitHub CI 已成功 `next build`，不把 Vercel quota failure 當 code build failure。

## Role / RLS canonical model — audit complete

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

- **operator**：自己的商品；不審核、不發布。
- **reviewer**：全隊讀取/審核/發布。
- **admin**：reviewer + profiles / 成員角色 / 敏感設定。
- **viewer**：目前沒有 TS/DB role；不要新增。

## Production Supabase truth — audit complete / production unchanged

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
production：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
Draft PR：#2

- migration ledger 空白，但 live schema/data final state 幾乎完整。
- **不可 replay `001–039`。**
- 唯一明確 migration-level drift：migration `004` 的 4 張 catalog/rule table policies 0/8。
- 3 個 timestamp helper 原本缺 explicit search_path。
- repo-owned trigger-only SECURITY DEFINER functions有 direct client EXECUTE exposure。
- hosted-only `rls_auto_enable()` 另有 advisor surface，但 free local stack無法重現。
- production DB 尚未修改。

## Free local Supabase runtime gate — complete / green

專項：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
分支：`agent/supabase-local-ci` / `f017765`
Draft PR：#3

使用者明確要求免費方案：GitHub Actions + Docker + Supabase CLI local Postgres 17；**不建立付費 Supabase Development Branch、不 link production、不讀 production secrets**。

Final squashed-head proof：
- Standard CI `32140954043` / `95723352624` ✅
- Supabase Local `32140953894` / `95723233923` ✅

已 runtime 證明：
- controlled production-like 001–039 reconstruction；
- 8-policy drift + restore；
- operator/admin catalog RLS；
- operator owner boundary / reviewer-admin cross-team；
- new-user + sensitive-field triggers；
- image/publish batch helpers no `42P17`；
- archive authorization DB scope；
- timestamp search_path hardening；
- client direct EXECUTE 可從 `handle_new_user` / sensitive guard 移除而不破壞 trigger runtime；
- RLS helpers 保留 authenticated EXECUTE。

Historical reconstruction debt：
- 033 需要 legacy `吉伊卡哇` parent；local-only baseline fixture，禁止 production apply。
- staged 032 manual replay 必須以單一 transaction 模擬 temp-table migration semantics。

`rls_auto_enable()` 是 hosted-only，minimal reconcile **不改它**。

## Reversible production reconcile package — prepared / local cycle green / NOT applied

專項：`docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
分支：`agent/supabase-production-package`
Draft PR：#4

Package：
- `supabase/reconcile/2026-08-18_production_precheck.sql`
- `supabase/reconcile/2026-08-18_production_apply.sql`
- `supabase/reconcile/2026-08-18_production_rollback.sql`
- `supabase/reconcile/2026-08-18_production_postcheck.sql`

第一輪 package-cycle proof：
- Supabase Local `32141584338` / `95725267127` ✅
- Standard CI `32141584347` / `95725266572` ✅

Test cycle：
`rollback to audited pre-state → precheck → apply → postcheck → rollback → verify rollback → precheck → re-apply → postcheck` ✅

Protected business row counts在完整 cycle 前後不變 ✅。

### Package contract

**Precheck**
- production 若已偏離 audit assumption 就 fail；不可強套。

**Apply**
- restore 8 policies；
- 3 timestamp helpers → `search_path=pg_catalog`；
- revoke direct client EXECUTE from `handle_new_user` / sensitive guard；
- preserve RLS helpers；
- leave `rls_auto_enable` unchanged；
- no data/role/history changes。

**Rollback**
- 只逆轉這次 package，回到 audited pre-state；不改 business rows。

**Postcheck**
- 驗 policy/RLS/search_path/ACL/trigger wiring/role enum。

## 下一個施工 gate

### 1. 收尾 production package branch

- 更新 AI handoff / Current / audit / plan。
- squash connector 碎 commits。
- final squashed head 重跑 standard CI + Supabase Local。
- Draft PR #4 保持未 merge。

### 2. Production approval gate — 下一個真正需要使用者決定的點

**沒有明確授權前，production DB 繼續完全不動。**

若使用者明確同意 production DB 修改：
1. live run `production_precheck.sql`（先檢查，不套變更）；
2. precheck fail → STOP + re-audit；
3. precheck pass → exact `production_apply.sql`；
4. immediately run `production_postcheck.sql`；
5. rerun Supabase Security Advisor；
6. validation fail 時依狀況使用 reviewed rollback。

### 3. Future migration discipline

Production reconcile 成功後才設計「從現在開始」的 tracked migration baseline。

鐵則：
- 不 replay `001–039`
- 不手動偽造 migration ledger
- 不把 local baseline 套 production
- 不因 advisor warning 猜測修改 hosted-only function

### 4. Production config / E2E

DB reconcile 後：
- Auth leaked-password protection decision
- Vercel production env audit
- Shopify production config audit
- manual mobile/Variant/role cases
- controlled real-product E2E
- 再往 E6/F/G

## 不要做

- 不 replay `001–039`。
- 不手動偽造 Supabase migration history。
- 不為了 catalog 可讀而 disable RLS。
- 不直接把 operator 加進 publish。
- 不把所有 SECURITY DEFINER EXECUTE 一刀切掉。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 不把 reconcile SQL 當一般 migration 直接 `db push`。
- 不把 local production baseline 套 production。
- 不建立付費 Supabase branch。
- 不信任前端 IDs 後直接用 service role 改資料。
- 不為了 CI green 關掉 verifier。
- 不整包 revert B4/P07。
- 不大量重寫 `globals.css`。
- 不先開 E6/F/G。
