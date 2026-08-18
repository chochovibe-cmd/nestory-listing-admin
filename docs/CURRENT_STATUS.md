# Nestory — Current Status

> 給新 AI session 的短版現況；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 → role audit → P0 archive auth → production Supabase audit → CI gate → Supabase 001–039 reconcile plan → free local Supabase runtime gate → **reversible production Supabase package**
目前工作分支：`agent/supabase-production-package`
目前 Draft PR：#1 CI gate、#2 production reconcile plan、#3 free local runtime gate、#4 production package；全部未 merge。

## 1. 專案狀態

Nestory 核心商品上架、AI 文案、圖片/規格、審核、Shopify publish 架構已相當完整；目前主線是**穩定化與正式環境一致性**，不是擴新功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 80–85%（source CI、free local DB runtime、production apply/rollback package 都已有隔離驗證；正式 DB 尚未套用，前台實機 UX / production config / real-product E2E 仍未完成）

## 2. 已實作的 stabilization stack

- **P0-1** `agent/p0-variant-atomic-confirm` / `171bbaa`：Variant destructive axis confirm atomic。
- **P0-2** `agent/p0-variant-duplicate-protection`：duplicate option protection，涵蓋 expand / Workspace / persistence / Shopify 409。
- **P0-3** `agent/p0-mobile-resultcard-expand`：mobile selectMode 恢復既有 compact expand toggle。
- **P1-1** `agent/p1-mobile-gesture-guard`：interactive child touch 不再被 ResultCard long-press/swipe 接管。
- **P1-2** `agent/p1-variant-picker-clipping`：保留 P07 containment，局部修 desktop Variant hover preview clipping。
- **P1-3** `agent/p1-localstorage-secret-policy`：no-secrets 改成檢查 credential-like browser-storage writes，不 blanket-ban localStorage。
- **P0 archive auth** `agent/p0-archive-owner-authorization` / `fdc5527`：batch archive authorization read 先走 authenticated RLS，再 service-role mutation。

以上 UI/功能修復仍需要對應手機/Variant/角色實機 cases；不要只因 CI compile green 就宣稱所有 UX runtime 已驗證。

## 3. Source CI gate — complete / green

專項：`docs/audits/CI-GATE-2026-08-18.md`
分支：`agent/ci-gate`
final head：`b935290`
Draft PR：#1

Workflow：`pnpm install --frozen-lockfile` → `verify:all` → `typecheck` → `build`。

Final squashed-head green run：`32132941280` / job `95697924316`。

Vercel recent preview failure target 是 `build-rate-limit / upgradeToPro`；GitHub CI 已成功 `next build`，不要把 Vercel preview quota failure 當成 code compile failure。

## 4. Role / RLS canonical model

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- `viewer` 沒有進 TS/DB enum；目前不要新增。

不要只把 operator 加進 `canPublish()`；未來若改角色，必須 helper + API + UI + DB/RLS + tests 一次對齊。

## 5. Production Supabase truth — audited / production unchanged

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
實際 Supabase：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
Draft PR：#2
production DB：**尚未修改**。

`001–039` 已逐份和 live end-state 對照：
- migration ledger 空白，但 live schema/data 幾乎完整反映歷史 SQL 最終效果；
- **不要 replay `001–039`**；
- `009→010`、`019→030`、`025/027 policies→028` 是 intentional supersede；
- `032/033/037/038` 有 strong live seed evidence；
- `039` fields 存在；
- 唯一明確 migration-level drift：migration `004` 的 4 張 catalog/rule table RLS enabled + grants present，但 **8 條 policy 全缺**。

其他 security debt：3 個 timestamp helper mutable search_path、部分 SECURITY DEFINER direct EXECUTE、Auth leaked-password protection disabled。

## 6. Reconcile scope — local runtime proven, production NOT applied

目前 narrow reconcile scope：
1. restore 8 migration-004 catalog/rule policies；
2. `set_updated_at / touch_image_batches_updated_at / touch_publish_batches_updated_at` → `search_path=pg_catalog`；
3. remove PUBLIC/anon/authenticated direct EXECUTE from repo-owned trigger-only:
   - `handle_new_user()`
   - `guard_sensitive_product_draft_fields()`
   while keeping service_role；
4. preserve authenticated RLS helper execution；
5. leave hosted-only `rls_auto_enable()` unchanged；
6. no role/data/migration-history changes。

`supabase/reconcile/2026-08-18_production_reconcile_draft.sql` remains a review artifact, not a tracked migration.

## 7. Free local Supabase runtime gate — complete / green

專項：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
分支：`agent/supabase-local-ci`
final commit：`f017765`
Draft PR：#3

使用者明確要求**只用免費方案**：GitHub-hosted Ubuntu + Docker + Supabase CLI + local Postgres 17；不建立付費 Supabase Development Branch、不 link production、不讀 production secrets。

Final squashed-head proof：
- Standard CI `32140954043` / job `95723352624` ✅
- Supabase Local `32140953894` / job `95723233923` ✅

Runtime 已證明：
- controlled production-like historical SQL reconstruction；
- 8-policy drift reproduce + restore；
- operator/admin catalog RLS；
- operator own-vs-other draft / reviewer-admin cross-team access；
- sensitive-field guard / new-user trigger；
- image/publish batch helpers no `42P17`；
- archive authorization DB scope；
- timestamp search_path hardening；
- two repo trigger direct-EXECUTE revokes keep runtime behavior；
- RLS helper authenticated execution preserved。

Historical reconstruction rules：
- migration 033 依賴 legacy `吉伊卡哇` parent；local CI fixture `supabase/reconcile/local-production-baseline.sql` 只供 local/CI，禁止 production apply。
- migration 032 的 staged copy要以單一 transaction 模擬 `pg_temp ... ON COMMIT DROP` migration semantics；原始 migration 不改。

Hosted-only `rls_auto_enable()` 在 free local stack 不存在，因此 minimal reconcile **不改它**。

## 8. Reversible production SQL package — prepared / locally proven / NOT applied

專項：`docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
分支：`agent/supabase-production-package`
Draft PR：#4

Package：
- `supabase/reconcile/2026-08-18_production_precheck.sql`
- `supabase/reconcile/2026-08-18_production_apply.sql`
- `supabase/reconcile/2026-08-18_production_rollback.sql`
- `supabase/reconcile/2026-08-18_production_postcheck.sql`

第一輪 local package-cycle proof：
- Supabase Local run `32141584338` / job `95725267127` ✅
- Standard CI run `32141584347` / job `95725266572` ✅

Local cycle 已跑：
`rollback to audited pre-state → precheck → apply → postcheck → rollback → verify rollback → precheck again → re-apply → postcheck` ✅

同時比對 protected row counts（product_drafts / product_images / product_variants / profiles）前後不變 ✅。

### Package semantics

- **precheck**：若 production 不再符合 audit 假設就直接 fail，要求 re-audit。
- **apply**：只做已 local-proven narrow reconcile。
- **rollback**：只逆轉這次 package，回到 audited pre-state；不碰商品資料。
- **postcheck**：驗 8 policies、RLS、search_path、function ACL、trigger wiring、role model。

## 9. 現在真正的下一個 gate

1. 收尾 `agent/supabase-production-package`：更新 handoff、squash、final head 重跑 standard CI + Supabase Local。
2. **Production 仍然不要動。**
3. final package green 後，下一步需要使用者**明確同意 production DB 修改**。
4. 若使用者同意：
   - 先跑 live `production_precheck.sql`；
   - precheck fail → STOP / re-audit；
   - precheck pass → exact `production_apply.sql`；
   - 立即 `production_postcheck.sql` + Supabase Security Advisor；
   - 若驗證失敗，按情況使用 reviewed rollback。
5. DB reconcile 完成後再做 Vercel production env / Shopify production config audit。
6. 再做 manual mobile/Variant/role cases + controlled real-product E2E。
7. 最後才往 E6/F/G。

## 10. Release / validation source of truth

- Release gate：`docs/RELEASE_READINESS.md`
- Current state：本檔
- Stabilization ordering：`docs/STABILIZATION_PLAN.md`
- CI：`docs/audits/CI-GATE-2026-08-18.md`
- Production DB truth：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- Free DB runtime：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- Production package：`docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`

CI/local DB green **不等於 production 已修改，也不等於前台/真 Shopify E2E 已完成**。

## 11. 新 agent 文件順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. 對應 audit
6. `docs/RELEASE_READINESS.md`（release/deploy 時）
7. 歷史 docs（按需）

不要從歷史施工文件猜目前狀態。
