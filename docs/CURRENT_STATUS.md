# Nestory — Current Status

> 給新 AI session 的短版現況；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 → role audit → P0 archive auth → production Supabase audit → CI gate → Supabase 001–039 reconcile plan → **free local Supabase runtime gate**
目前工作分支：`agent/supabase-local-ci`
目前 Draft PR：#1 CI gate、#2 production reconcile plan、#3 free local Supabase runtime gate；全部未 merge。

## 1. 專案狀態

Nestory 核心商品上架、AI 文案、圖片/規格、審核、Shopify publish 架構已相當完整；目前主線是**穩定化與正式環境一致性**，不是擴新功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 80–85%（source CI + free local DB runtime matrix 已綠；production DB 尚未套用、前台實機 UX / production config / real-product E2E 仍未完成）

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

Workflow：
1. `pnpm install --frozen-lockfile`
2. `pnpm run verify:all`
3. `pnpm run typecheck`
4. `pnpm run build`

Final squashed-head green run：`32132941280` / job `95697924316`。

Vercel recent preview failure target 是 `build-rate-limit / upgradeToPro`；GitHub CI 已成功 `next build`，不要把 Vercel preview quota failure 當成 code compile failure。

## 4. Role / RLS canonical model

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- `viewer` 沒有進 TS/DB enum；目前不要新增。

不要只把 operator 加進 `canPublish()`；未來若改角色，必須 helper + API + UI + DB/RLS + tests 一次對齊。

## 5. Production Supabase reconcile — live matrix complete / production unchanged

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
實際 Supabase：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
工作分支：`agent/supabase-reconcile-plan`
Draft PR：#2
production DB：**尚未修改**。

Repo migration `001–039` 已逐份和 live schema / constraints / indexes / policies / functions / grants / representative seed data 對照。

結論：
- migration ledger 空白，但 production live end-state 幾乎完整反映 `001–039`。
- **不要 replay `001–039`。**「ledger 沒紀錄」不等於「schema 沒套」。
- `009 → 010`、`019 → 030`、`025/027 policies → 028` 是 intentional supersede chain。
- `032/033/037/038` catalog/tag/knowledge seeds 有 strong live evidence。
- `039` dual image URLs 已存在。
- 唯一明確 migration-level drift：migration `004` 的 4 張 catalog/rule table 有 RLS + grants，但 **8 條預期 policies 全缺**。

其他 security debt：
- production SECURITY DEFINER direct EXECUTE / RPC surface warnings。
- 3 個 timestamp trigger helper 原本缺 explicit search_path。
- Auth leaked-password protection disabled。

## 6. Production reconcile review draft — local runtime proven, production NOT applied

Review draft：`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

目前 active scope：
1. restore 8 missing migration-004 catalog/rule policies；
2. `set_updated_at / touch_image_batches_updated_at / touch_publish_batches_updated_at` 固定 `search_path=pg_catalog`；
3. revoke direct PUBLIC/anon/authenticated EXECUTE from repo-owned trigger-only functions:
   - `handle_new_user()`
   - `guard_sensitive_product_draft_fields()`
   並保留 service_role；
4. **不** revoke `current_user_role / is_admin / is_reviewer / user_owns_*_batch`；
5. **不**修改 hosted-only `rls_auto_enable()`；
6. 不改 role、商品資料、migration history。

Draft 刻意在 `supabase/reconcile/`，不是 `supabase/migrations/`；**不可直接 `db push` production**。

## 7. Free local Supabase runtime gate — full current matrix green

專項：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
分支：`agent/supabase-local-ci`
Draft PR：#3

使用者明確要求**只用免費方案**。目前採：
- GitHub-hosted Ubuntu runner
- Docker
- Supabase CLI local DB
- Postgres 17
- **不使用付費 Supabase Development Branch**
- **不 link production project、不讀 production Supabase secrets**

Latest same-head proof after current active draft：
- Supabase Local run `32140335899` / job `95721221385` ✅
- Standard CI run `32140335793` / job `95721221015` ✅

Runtime 已證明：
- controlled production-like historical SQL reconstruction 可跑完（需 documented 032 transaction modeling + 033 legacy parent fixture）；
- 模擬 production 8-policy drift 後，review draft 可補回全部 8 條 policy；
- operator active-only / admin active+inactive catalog read 正常；
- operator catalog write denied、admin write allowed；
- timestamp trigger search_path hardening 後 runtime 正常；
- `handle_new_user` 仍建立 operator profile；
- operator own-draft read/update 正常；
- operator cross-owner draft read/update denied；
- reviewer/admin cross-team access 正常；
- sensitive-field guard 仍阻擋 operator escalation；
- reviewer privileged transition 正常；
- image/publish batch helper paths沒有 `42P17` recursion；
- archive authorization DB scope 對齊 route design；
- `handle_new_user` / `guard_sensitive_product_draft_fields` 拿掉 client direct EXECUTE 後 trigger runtime 仍正常；
- authenticated RLS helpers仍保留 EXECUTE。

### Hosted-only `rls_auto_enable()`

Production 有 `public.rls_auto_enable()` / event trigger `ensure_rls`，但 free local Supabase 不建立它，因此沒有本機 runtime proof。

**目前 production reconcile draft 不修改它。** 不要為了消 Security Advisor warning 猜測性 revoke。

### Historical bootstrap debt

1. migration `033` 假設 `ip_catalog.ip_name='吉伊卡哇'` 已存在；local CI 用 `supabase/reconcile/local-production-baseline.sql` 在 033 前模擬最低 legacy state。該檔禁止 production apply。
2. migration `032` 使用 `pg_temp ... ON COMMIT DROP`；manual replay 必須把 staged 032 視為單一 transaction。原始 migration 不改。

這兩點是歷史重建條件，**不是 production 缺 032/033**。

## 8. 下一步順序

1. **Production 繼續不動。**
2. 收尾 `agent/supabase-local-ci`：文件同步、squash、final head 重新跑 standard CI + Supabase Local gate。
3. 建立下一條 review branch，準備精確：
   - production precheck SQL
   - production apply SQL
   - rollback SQL
   - postcheck SQL
4. 用同一套 free local DB 驗證 apply + rollback + re-apply / postcheck。
5. 設計「從現在開始」的 tracked migration/baseline 策略；仍不 replay 001–039、不偽造 ledger。
6. **production DDL 前重新取得使用者明確授權。**
7. 若授權：只套 narrow reconcile package，立即跑 live read-only postchecks + Supabase Security Advisor。
8. Vercel production env + Shopify production config audit。
9. `docs/RELEASE_READINESS.md` manual mobile/Variant/role cases + controlled real-product E2E。
10. 再往 E6/F/G。

## 9. Release / validation source of truth

- Release gate：`docs/RELEASE_READINESS.md`
- Current state：本檔
- Stabilization ordering：`docs/STABILIZATION_PLAN.md`
- CI history：`docs/audits/CI-GATE-2026-08-18.md`
- Production DB truth + 001–039 matrix：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- Free DB runtime evidence：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- Reconcile SQL review draft：`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

CI green = source/verifier/typecheck/build green；free Supabase local green = documented DB runtime cases green；**兩者都不等於正式 DB 已修改或前台/真 Shopify E2E 已全部實測**。

## 10. 新 agent 文件順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. 對應 audit
6. `docs/RELEASE_READINESS.md`（release/deploy 時）
7. `docs/CHANGELOG.md` / 歷史施工文件（按需）

不要要求新 session 一開始全文讀 `施工清單.md` 或全部 dated docs。
