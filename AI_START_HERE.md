# Nestory — AI Start Here

> 給任何新 Codex / Claude Code / ChatGPT / 其他 AI coding session 的最短入口。
> 目標：不用掃完整 repo，也能在 1–3 分鐘內知道專案在哪、什麼已上 production、什麼仍只在 branch、下一步是什麼。

## 1. 新 session 先讀

1. `AI_START_HERE.md`（本檔）
2. `docs/CURRENT_STATUS.md`
3. `AGENTS.md`
4. 做穩定化再讀 `docs/STABILIZATION_PLAN.md` + 對應 `docs/audits/*.md`
5. 要判斷 release / deploy：讀 `docs/RELEASE_READINESS.md`

碰 production Supabase / migration / RLS，**必讀**：
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`
- active `supabase/migrations/`

`supabase/reconcile/2026-08-18_*` 現在是**執行證據 / reference material**；production canonical history 已轉到 tracked `supabase/migrations/`。

## 2. 專案一句話

Nestory 是潮巢玩居內部 Shopify 商品上架 PWA：商品輸入、圖片/規格、AI 文案、審核、圖片處理、Shopify 發布；Supabase 資料層、Vercel 部署。

## 3. 重要：現在已經有一部分真正上 production

### Production Supabase reconcile — 已完成

正式專案：`nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`)。

2026-08-18 使用者已明確授權 production DB repair，且已成功執行：

- live precheck：`PRECHECK_OK` ✅
- tracked baseline migration：`20260818142712 baseline_existing_schema_20260818` ✅
- tracked reconcile migration：`20260818142919 production_reconcile_20260818` ✅
- live postcheck：`POSTCHECK_OK` ✅

受保護 row counts 前後完全一致：
- product drafts 32
- product images 147
- product variants 143
- profiles 1

正式 reconcile 已：
- 補回 migration 004 遺失的 8 條 catalog/rule RLS policies；
- 3 個 timestamp trigger helpers 固定 `search_path=pg_catalog`；
- `handle_new_user()` / `guard_sensitive_product_draft_fields()` 移除 anon/authenticated direct EXECUTE，保留 service_role；
- 保留 authenticated RLS helper execution；
- 不改 `rls_auto_enable()`；
- 不改商品資料、角色語意、Shopify/Vercel config。

Security Advisor after apply：原本 4-table no-policy 與 3 個本 package 目標 search_path findings 已消失。仍有 SECURITY DEFINER/RLS helper/Auth 類警告，屬**下一個獨立 hardening scope**，不可一刀切 revoke。

### Migration tracking 已正式開始

Production 在這次之前沒有 migration ledger；live DB 卻已包含歷史 `001–039` 的大部分最終狀態。

因此正式策略是：**tracking 從 2026-08-18 現有 audited state 開始**，不是假裝 001–039 曾被 Supabase CLI 管理。

Active queue：`supabase/migrations/`
- `20260818142712_baseline_existing_schema_20260818.sql`
- `20260818142919_production_reconcile_20260818.sql`
- 未來 tracked migrations 往後 append。

Pre-tracking history：
- `supabase/history/pre_tracking_migrations/001…039`
- 內容完整保存；是歷史 / local reconstruction input，**不是 production migration queue**。

鐵則：
- 不把 `001–039` 搬回 active queue；
- 不 replay 到 production；
- 不偽造舊 ledger；
- tracked migration 上線後若需 rollback，要新增 tracked revert migration，不可只手動跑舊 rollback SQL造成 schema/ledger 不一致。

## 4. 仍然只在 GitHub branches、尚未 merge/deploy 的程式修復

Stabilization stack 包含：
- P0-1 Variant axis atomic confirm
- P0-2 duplicate option protection
- P0-3 mobile ResultCard expand affordance
- P1-1 mobile gesture isolation
- P1-2 Variant hover containment
- P1-3 browser-storage secret policy
- P0 batch archive authorization

這些 UI / app 程式修復仍在 stabilization branches / Draft PR stack，**不要因為 Supabase production 已修就說前台 app 也已部署。**

目前沒有 Vercel production deploy。Vercel recent Preview failure target 曾是 `build-rate-limit / upgradeToPro`；GitHub CI 可正常 production build。

## 5. CI / free DB gate

Source CI canonical：`agent/ci-gate` / `b935290` / Draft PR #1。

Free Supabase runtime branch：`agent/supabase-local-ci` / `f017765` / Draft PR #3。

Production package branch：`agent/supabase-production-package` / `2d96fce` / Draft PR #4。

Current migration housekeeping branch：`agent/supabase-migration-baseline`。

免費 DB gate 使用 GitHub runner + Docker + Supabase CLI + Postgres 17；**不要建立付費 Supabase Development Branch**。

已 runtime 驗證：
- production-like historical reconstruction（含 032 transaction modeling / 033 legacy parent fixture）；
- 8-policy drift + restore；
- operator/admin catalog RLS；
- operator owner boundary、reviewer/admin cross-team；
- new-user / sensitive-field triggers；
- batch ownership helpers無 `42P17`；
- archive authorization scope；
- timestamp search_path hardening；
- trigger-only function EXECUTE hardening；
- production precheck/apply/postcheck/rollback/re-apply cycle。

Migration baseline verifier：`scripts/verify-supabase-migration-baseline.mjs`，已接入 `verify:all`，鎖 active queue / archive / local bootstrap 路徑。

## 6. Canonical role model

- `operator`：建立/操作自己的商品；不審核、不發布。
- `reviewer`：全隊讀取、審核、發布。
- `admin`：reviewer + profiles / 成員角色 / 敏感設定。
- `viewer`：沒有 TS/DB role；目前不要新增。

不要單獨把 operator 加進 `canPublish()`；權限變更必須 UI/API/helper/RLS/tests 一起對齊。

## 7. 下一步順序

1. 收尾 `agent/supabase-migration-baseline`：CI + free local DB gate全綠、squash、Draft PR；不 merge。
2. 檢查 production migration list仍精確是 `20260818142712` + `20260818142919`。
3. 下一個 DB hardening scope才處理 remaining Security Advisor findings；先設計/測試，不直接 revoke RLS helpers或 hosted-only functions。
4. Vercel production env + Shopify production config audit。
5. manual mobile/Variant/role UX cases + controlled real-product E2E。
6. 最後才整合 stabilization branches、決定 merge / production app deploy。
7. 再進 E6/F/G。

## 8. 修改鐵則

- 每次修改要記錄 what / why / affected files / state / remaining risks。
- 不刪舊文件；歷史只 archive / index。
- `supabase/migrations/` 現在是正式 tracked history；任何新增都要 timestamped + test + production discipline。
- `supabase/history/pre_tracking_migrations/` 不可 production replay。
- `supabase/reconcile/` 是 review/evidence，不是一般 deploy queue。
- `local-production-baseline.sql` 只允許 local/CI。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 不為了 Security Advisor 綠燈而一刀切 SECURITY DEFINER / RLS helper EXECUTE。
- service-role API 不可信任前端傳來的 IDs。
- 不 merge / 不 Vercel production deploy，除非使用者明確同意。
- 使用者要求 Supabase 免費方案；不要建立付費 branch。

## 9. 新 session 開場指令

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。確認 GitHub branch / Draft PR / CI 與 production migration list。碰 DB 必讀四份 Supabase audits與 active `supabase/migrations/`。不要再把「production DB 尚未修改」當成現況：2026-08-18 reconcile 已正式成功套用，但 app stabilization branches 尚未 merge/deploy。
