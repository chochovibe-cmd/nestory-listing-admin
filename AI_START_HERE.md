# Nestory — AI Start Here

> 給任何新 Codex / Claude Code / ChatGPT / 其他 AI coding session 的最短入口。
> 目標：不用掃完整 repo，也能在 1–3 分鐘內知道專案在哪、什麼能動、下一步是什麼。

## 1. 新 session 先讀

1. `AI_START_HERE.md`（本檔）
2. `docs/CURRENT_STATUS.md`
3. `AGENTS.md`
4. 做穩定化再讀 `docs/STABILIZATION_PLAN.md` + 對應 `docs/audits/*.md`
5. 要判斷是否可 release / deploy：讀 `docs/RELEASE_READINESS.md`

碰 production Supabase / migration / RLS，**必讀**：
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `supabase/reconcile/2026-08-18_production_precheck.sql`
- `supabase/reconcile/2026-08-18_production_apply.sql`
- `supabase/reconcile/2026-08-18_production_rollback.sql`
- `supabase/reconcile/2026-08-18_production_postcheck.sql`

查 CI 歷史與 verifier 整理：
- `docs/audits/CI-GATE-2026-08-18.md`

歷史細節才查 `施工清單.md`、dated UIUX docs、worker brief、`docs/CHANGELOG.md`。**不要一開始通讀所有歷史文件。**

## 2. 專案一句話

Nestory 是潮巢玩居內部的 Shopify 商品上架 PWA：商品輸入、圖片/規格、AI 文案、審核、圖片處理、Shopify 發布；Supabase 資料層、Vercel 部署。

## 3. 現況

主線是**穩定化與 production reconcile，不是擴功能**。

Stabilization / infrastructure stack：
- P0/P1 UI/Variant/ResultCard fixes：已有獨立 branches/verifiers，尚待最後整合與實機 UX。
- P0 archive authorization：`agent/p0-archive-owner-authorization` / `fdc5527`。
- Production Supabase audit：live DB 唯讀盤點完成，production unchanged。
- CI gate：`agent/ci-gate` / `b935290` / Draft PR #1，final CI green。
- Supabase 001–039 live reconciliation：`agent/supabase-reconcile-plan` / Draft PR #2，production unchanged。
- Free local Supabase runtime gate：`agent/supabase-local-ci` / `f017765` / Draft PR #3，final standard CI + local DB runtime green。
- **Reversible production Supabase package**：`agent/supabase-production-package` / Draft PR #4，precheck/apply/rollback/postcheck 已建立且第一輪 free-local cycle green；production STILL unchanged。

### Canonical role model

- `operator`：自己的商品；不審核、不發布。
- `reviewer`：全隊讀取/審核/發布。
- `admin`：reviewer + profiles / 成員角色 / 敏感設定。
- `viewer`：沒有 TS/DB role；目前不要新增。

### Production Supabase truth

實際專案：`nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`)。

- migration ledger **空白**，但 live end-state 幾乎反映 `001–039`。
- **絕對不要 replay `001–039`。**
- 唯一明確 migration-level drift：migration `004` 的 `ip_catalog / ip_characters / tag_rules / collection_rules` RLS enabled，但 8 條預期 policy 全缺。
- production DB 目前仍**沒有被這次工作修改**。
- hosted-only `rls_auto_enable()` 沒有 free-local proof，minimal package不改它。

### Free local DB proof

使用者要求免費方案；目前採 GitHub-hosted runner + Docker + Supabase CLI + local Postgres 17，**不要建立付費 Supabase Development Branch**。

`agent/supabase-local-ci` final proof：
- Standard CI `32140954043` / `95723352624` ✅
- Supabase Local `32140953894` / `95723233923` ✅

已 runtime 驗：
- production-like historical reconstruction（含 documented 032/033 reconstruction conditions）；
- 8-policy drift + restore；
- operator/admin catalog RLS；
- operator owner boundary / reviewer-admin cross-team；
- new-user + sensitive-field triggers；
- batch ownership helpers no `42P17`；
- archive authorization scope；
- timestamp search_path hardening；
- direct client EXECUTE 從 `handle_new_user()` / sensitive guard 移除後 trigger仍正常；
- RLS helper execution preserved。

### Production package — ready for final branch cleanup, NOT live approval

Package files：
- `2026-08-18_production_precheck.sql`：live 狀態不符合 audit 就 fail / STOP。
- `2026-08-18_production_apply.sql`：只做 narrow local-proven reconcile。
- `2026-08-18_production_rollback.sql`：只逆轉本 package、回 audited pre-state，不碰 business rows。
- `2026-08-18_production_postcheck.sql`：驗 8 policies、RLS、search_path、ACL、trigger wiring、role enum。

第一輪 package cycle：
- Supabase Local `32141584338` / `95725267127` ✅
- Standard CI `32141584347` / `95725266572` ✅

完整循環 `rollback → precheck → apply → postcheck → rollback → verify → precheck → re-apply → postcheck` 成功，protected business-row counts前後不變。

## 4. 下一步順序

1. 收尾 `agent/supabase-production-package` / Draft PR #4：handoff同步、squash、final squashed head重新跑 standard CI + Supabase Local。
2. **然後停在 production approval gate。沒有使用者明確同意，不可修改 live DB。**
3. 若使用者明確同意：
   - 先 live run `production_precheck.sql`；
   - precheck fail → STOP / re-audit；
   - precheck pass → exact `production_apply.sql`；
   - immediately `production_postcheck.sql` + Supabase Security Advisor；
   - 驗證失敗才依 reviewed rollback plan處理。
4. DB reconcile 後再做 future migration discipline、Vercel production env / Shopify config audit。
5. manual mobile/Variant/role + controlled real-product E2E。
6. 再進 E6/F/G。

## 5. 修改鐵則

- 不刪舊文件；歷史檔只 archive/索引。
- 不因 Mockup 移除既有功能。
- 一個 regression / authorization bug 一個 commit；不要混改。
- 每次實際改動：同步 CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit。
- Release / deploy 前讀 `docs/RELEASE_READINESS.md` 並要求 CI green。
- Production Supabase DDL 前必讀三份 Supabase audits + 四份 production package SQL。
- **不要 replay `001–039`；不要手動偽造 migration history。**
- `supabase/reconcile/` 是審核／安全執行素材區，不是一般 migration queue。
- `local-production-baseline.sql` 只允許 local/CI；禁止 production apply。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 權限/RLS 改動要對齊 frontend helper + API + DB。
- service-role API 不可信任前端 IDs；先 authenticated/RLS 或明確 owner authorization。
- 不 deploy / 不套 production DDL，除非使用者明確同意。
- **不要建立付費 Supabase branch。**
- push/PR 前核對 diff 與 GitHub CI。

## 6. 新 session 開場指令

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。再確認 branch/HEAD、Draft PR/CI 狀態。碰 DB 必讀 production reconcile audit、free local audit、production package audit與四份 package SQL。任何 live DB DDL 前確認是否已有使用者本次明確授權；沒有就停在 review/test 階段。
