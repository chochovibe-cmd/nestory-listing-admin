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
分支：`agent/ci-gate`
final squashed commit：`b935290`
Draft PR：#1

Canonical pipeline：frozen pnpm install → `verify:all` → `typecheck` → `build`。

Final squashed-head run `32132941280` / job `95697924316`：全部成功。

Recent Vercel preview check target = `build-rate-limit / upgradeToPro`；GitHub CI 已成功 `next build`，因此 Vercel preview failure 不應被解讀成 code build failure。

## Role / RLS canonical model — audit complete

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- **viewer**：目前沒有 TS/DB role；不要新增。

不要只把 operator 加進 `canPublish()`。

## Production Supabase reconcile — live matrix complete / production unchanged

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
分支：`agent/supabase-reconcile-plan`
Draft PR：#2
production：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
狀態：**live DB 尚未修改。**

Matrix conclusion：
- migration ledger 空白，但 schema/data final state 幾乎完整。
- 不可 replay `001–039`。
- `009 → 010`、`019 → 030`、`025/027 policies → 028` 是正常 supersede chain。
- late catalog/tag/knowledge seeds `032/033/037/038` 有 strong live evidence。
- `039` dual-size image URL fields 存在。
- 唯一明確 migration-level drift：migration `004` 的 4 張 catalog/rule table policies 0/8。

## Production reconcile review draft — locally proven, NOT applied

Path：`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

Active SQL scope：
1. restore 8 migration-004 catalog/rule policies；
2. pin 3 timestamp trigger helpers to `search_path = pg_catalog`；
3. revoke direct PUBLIC/anon/authenticated EXECUTE from repo-owned trigger-only:
   - `handle_new_user()`
   - `guard_sensitive_product_draft_fields()`
   and keep service_role explicit；
4. leave authenticated RLS helper execution intact；
5. leave hosted-only `rls_auto_enable()` unchanged；
6. no role/data/history changes。

它刻意不在 `supabase/migrations/`：production ledger 空白時，不能讓 CLI 把歷史 migration 當成待執行 queue。

## Free local Supabase runtime gate — full current matrix green

專項：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
分支：`agent/supabase-local-ci`
Draft PR：#3

使用者明確要求免費方案，因此：
- **不建立付費 Supabase Development Branch**
- GitHub Actions + Docker + Supabase CLI local Postgres 17
- 不 link hosted Supabase project
- 不需要 production Supabase secrets

Latest proof after current active draft：
- Supabase Local run `32140335899` / job `95721221385` ✅
- Standard CI run `32140335793` / job `95721221015` ✅

### Runtime matrix 已綠

- controlled production-like historical SQL reconstruction ✅
- 8-policy drift simulation + restore ✅
- operator active-only catalog read ✅
- admin active+inactive catalog read ✅
- operator catalog write denied / admin allowed ✅
- timestamp trigger search_path hardening + real transaction behavior ✅
- new-user trigger creates operator ✅
- operator own draft read/update ✅
- operator cross-owner read/update denied ✅
- reviewer/admin cross-team read ✅
- reviewer privileged update ✅
- sensitive-field guard blocks operator escalation ✅
- image/publish batch helper paths no `42P17` ✅
- archive authorization DB scope aligns with route ✅
- revoke client direct EXECUTE from `handle_new_user` / sensitive guard keeps triggers working ✅
- authenticated RLS helpers stay executable ✅

### Historical bootstrap debt captured

- migration 033 depends on legacy `吉伊卡哇` parent data; local CI uses `supabase/reconcile/local-production-baseline.sql` before 033.
- migration 032 depends on migration transaction semantics for `pg_temp ... ON COMMIT DROP`; CI wraps only the staged 032 copy in one transaction.
- these are test reconstruction conditions, not evidence production lacks 032/033.

### Hosted-only `rls_auto_enable()`

Production has this event-trigger helper, free local Supabase does not. No honest local runtime proof exists, so **do not change its production ACL** in this minimal reconcile.

## 下一個施工 gate

### 1. 收尾 free local branch

- 更新 AI handoff / Current / audit / plan。
- squash connector 產生的碎 commits。
- final squashed head 重新跑 standard CI + Supabase Local Reconcile。
- Draft PR #3 保持未 merge。

### 2. 準備 production-safe SQL package（仍不執行）

建立獨立 review branch，放在 `supabase/reconcile/`：
- `precheck.sql`：確認 production 仍符合 audit 假設，若 drift 改變就停止。
- `apply.sql`：只做已 local-proven narrow reconcile。
- `rollback.sql`：能恢復這次 apply 前的 ACL/search_path/policy 狀態，不動商品資料。
- `postcheck.sql`：確認 8 policies、function ACL/search_path、核心 role/RLS contract。

### 3. Free local 驗證 apply / rollback / re-apply

- clean production-like baseline → apply → postcheck ✅
- rollback → verify rollback state ✅
- apply again → postcheck ✅
- standard source CI 也要綠。

### 4. Baseline / tracked migration strategy

只有以上綠後，才設計「從現在開始」的 migration discipline。

鐵則：
- 不把 `001–039` 重播到 production
- 不手動插假 migration rows
- 不直接把 reconcile review SQL 搬進 `supabase/migrations/` 就 `db push`
- `local-production-baseline.sql` 不可 production apply

### 5. Production apply gate

**需要使用者再次明確授權 production DB 修改。**

得到授權後才可：
- 先跑 live precheck（read-only）
- apply narrow reconcile
- 立即跑 postcheck + Supabase Security Advisor
- 若 postcheck fail，按 rollback plan 處理

### 6. Production config / E2E

DB reconcile 完成後：
- Supabase Auth leaked-password protection decision
- Vercel production env audit
- Shopify production config audit
- manual mobile/Variant/role cases
- controlled real-product E2E

## 不要做

- 不 replay `001–039`。
- 不手動偽造 Supabase migration history。
- 不為了 catalog 可讀而 disable RLS。
- 不直接把 operator 加進 publish。
- 不把所有 SECURITY DEFINER authenticated EXECUTE 一刀切掉。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 不把 reconcile review draft 當正式 migration 直接 push。
- 不把 local production baseline 套到 production。
- 不建立付費 Supabase branch；目前採免費 local CI。
- 不信任前端 IDs 後直接用 service role 改資料。
- 不為了 CI green 關掉 verifier；先修 verifier/source drift。
- 不整包 revert B4/P07。
- 不大量重寫 `globals.css`。
- 不先開 E6/F/G。
