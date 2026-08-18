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
- `supabase/reconcile/2026-08-18_production_reconcile_draft.sql`（review draft，**不是 migration、不可直接 production apply**）

查 CI 歷史與 verifier 整理：
- `docs/audits/CI-GATE-2026-08-18.md`

歷史細節才查 `施工清單.md`、dated UIUX docs、worker brief、`docs/CHANGELOG.md`。**不要一開始通讀所有歷史文件。**

## 2. 專案一句話

Nestory 是潮巢玩居內部的 Shopify 商品上架 PWA：商品輸入、圖片/規格、AI 文案、審核、圖片處理、Shopify 發布；Supabase 資料層、Vercel 部署。

## 3. 現況

主線是**穩定化與 production reconcile，不是擴功能**。

已實作、尚待最終整合/實機驗證的 stabilization stack：
- **P0-1** `agent/p0-variant-atomic-confirm` / `171bbaa`：Variant axis confirm atomic。
- **P0-2** `agent/p0-variant-duplicate-protection`：duplicate option protection。
- **P0-3** `agent/p0-mobile-resultcard-expand`：mobile ResultCard selectMode 恢復 compact expand toggle。
- **P1-1** `agent/p1-mobile-gesture-guard`：interactive child touch 不再被 card long-press/swipe 接管。
- **P1-2** `agent/p1-variant-picker-clipping`：保留 P07 containment，局部修 desktop hover preview clipping。
- **P1-3** `agent/p1-localstorage-secret-policy`：browser storage 改成阻擋 credential-like writes，不 blanket-ban localStorage。
- **P0 archive authorization** `agent/p0-archive-owner-authorization` / `fdc5527`：batch archive requested IDs 先走 authenticated RLS，再由 service role mutation。
- **Production Supabase audit** `agent/production-supabase-reconcile-audit` / `7e1c49d`：已唯讀盤點 live DB，production DB 未修改。
- **CI gate** `agent/ci-gate` / `b935290` / Draft PR #1：`verify:all → typecheck → build` 最終 squashed head green。
- **Supabase 001–039 reconciliation** `agent/supabase-reconcile-plan` / Draft PR #2：live-state matrix 完成，production unchanged。
- **Free local Supabase runtime gate** `agent/supabase-local-ci` / Draft PR #3：GitHub runner + Docker + Postgres 17 已完成 current reconcile / role / batch / trigger matrix；不用付費 Supabase branch、不連 production。

### Current CI / DB runtime proof

Source CI canonical：`agent/ci-gate` / `b935290`。

Current free-DB same-head proof after latest reconcile draft：
- Standard CI run `32140335793` / job `95721221015` ✅
- Supabase Local run `32140335899` / job `95721221385` ✅

Local gate 已 runtime 證明：
- production-like `001–039` reconstruction 可執行，但要遵守已記錄的歷史 032/033 reconstruction conditions；
- migration 004 的 8-policy drift 可重現並由 reconcile draft 補回；
- operator/admin catalog RLS 正常；
- operator own-vs-other draft、reviewer/admin cross-team RLS 正常；
- sensitive-field guard、new-user trigger、batch ownership helpers、archive authorization scope 正常；
- image/publish batch paths 不回歸 `42P17`；
- timestamp functions設 `search_path=pg_catalog` 後正常；
- `handle_new_user()` / `guard_sensitive_product_draft_fields()` 拿掉 client direct EXECUTE 後 trigger behavior仍正常；
- RLS helper authenticated EXECUTE 保留。

完整證據：`docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`。

Vercel recent preview failure target = `build-rate-limit / upgradeToPro`；GitHub CI 已可 production build，不要把 Vercel preview quota failure 當 code compile failure。

### Canonical role model

- `operator`：建立/操作自己的商品；不審核、不發布。
- `reviewer`：可讀全隊、審核、發布。
- `admin`：reviewer 能力 + profiles / 敏感 team settings 管理。
- `viewer`：沒有 TS/DB role；目前不要新增。

詳細證據：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`。

### Production Supabase truth

實際專案：`nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`)。

- migration ledger **空白**，但 live end-state 幾乎反映 `001–039`。
- **不要 replay `001–039`。**
- 唯一明確 migration-level drift：migration `004` 的 4 張 catalog/rule tables RLS enabled，但 8 條預期 policy 全缺。
- production DB 在 audit / CI / local runtime 工作中都**沒有被修改**。
- `rls_auto_enable()` 是 production hosted-only event-trigger helper；free local Supabase 沒有它，minimal reconcile **不改它**。

Current review draft：`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`
- restore 8 policies
- pin 3 timestamp search_path
- revoke client direct EXECUTE from `handle_new_user()` / sensitive guard（local-proven）
- preserve RLS helpers
- leave `rls_auto_enable` alone
- no role/data/history change
- 不在 `supabase/migrations/`，不可直接 `db push` production。

### Historical reconstruction debt — do not misread

- migration `033` 假設 production 早已有 `ip_catalog.ip_name='吉伊卡哇'`; local CI 用 `supabase/reconcile/local-production-baseline.sql` 模擬最低 legacy state。**禁止 production apply。**
- migration `032` 用 `pg_temp ... ON COMMIT DROP`; manual replay 必須把 staged copy 視為單一 transaction。

這些是歷史 test-reconstruction conditions，不是 production 缺 migration。

## 4. 下一步順序

1. 收尾 `agent/supabase-local-ci` / Draft PR #3：文件同步、squash、final-head standard CI + local DB gate再跑一次。
2. 建立下一個 review branch：準備 production **precheck / apply / rollback / postcheck** SQL，仍然不執行 production。
3. 用相同免費 local DB 測 `apply → postcheck → rollback → verify rollback → apply again → postcheck`。
4. 設計 future tracked-migration baseline；不 replay 001–039、不偽造 ledger。
5. **任何 production DDL 前重新取得使用者明確授權。**
6. 若授權，才跑 live precheck、narrow apply、postcheck、Security Advisor。
7. Vercel production env / Shopify production config audit。
8. manual mobile/Variant/role + controlled real-product E2E。
9. 再進 E6/F/G。

## 5. 修改鐵則

- 不刪舊文件；歷史檔只 archive/索引。
- 不因 Mockup 移除既有功能。
- 一個 regression / authorization bug 一個 commit；不要混改。
- 每次實際改動：同步 CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit；長 CHANGELOG 不能安全 patch 時不要整檔覆寫。
- Release / deploy 前讀 `docs/RELEASE_READINESS.md` 並要求 CI green。
- UI 改前看 Git 歷史與 regression audit。
- `src/app/stabilization.css` 只作小型已記錄 hotfix，不得長成第二份 general stylesheet。
- Production Supabase DDL 前必讀 production reconcile audit + local reconcile audit。
- **不要 replay `001–039`；不要手動偽造 migration history。**
- `supabase/reconcile/` 是審核／隔離測試素材區，不是可直接 deploy 的 migration queue。
- `local-production-baseline.sql` 只允許 local/CI；禁止 production apply。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 權限/RLS 改動要對齊 frontend helper + API + DB。
- service-role API 不可信任前端傳來的 IDs；先 authenticated/RLS 或明確 owner authorization。
- 不 deploy / 不套 production DDL，除非使用者明確同意。
- **不要建立付費 Supabase branch；使用者要求免費方案，目前採 GitHub Actions + Docker local Supabase。**
- push/PR 前核對 diff 與 GitHub CI。

## 6. 新 session 開場指令

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。再確認 branch/HEAD、Draft PR/CI 狀態，以及是否已有對應 stabilization/audit。碰 DB 必讀 production Supabase reconcile audit、free local reconcile audit 與 `supabase/reconcile/` review artifacts；判斷 release readiness 必讀 `docs/RELEASE_READINESS.md`。不要從歷史施工文件猜目前狀態。
