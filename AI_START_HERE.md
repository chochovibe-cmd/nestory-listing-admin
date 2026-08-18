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
- **CI gate** `agent/ci-gate` / `b935290` / Draft PR #1：GitHub Actions `verify:all → typecheck → build` 最終 squashed head 已完整 green。
- **Supabase 001–039 reconciliation** `agent/supabase-reconcile-plan`：逐份 live-state 對帳完成，production 仍未修改。

### CI canonical state

Final squashed CI run `32132941280`：
- install ✅
- `pnpm run verify:all` ✅
- `pnpm run typecheck` ✅
- `pnpm run build` ✅

這次 CI 同時清掉多個舊 verifier/document drift；詳見 `docs/audits/CI-GATE-2026-08-18.md`。

Vercel recent preview failure 的 GitHub status target 是 `build-rate-limit / upgradeToPro`。GitHub CI 已能在乾淨 Ubuntu runner 完成 production build，所以不要把該 Vercel 狀態當成 code build failure。

### Canonical role model

- `operator`：建立/操作自己的商品；不審核、不發布。
- `reviewer`：可讀全隊、審核、發布。
- `admin`：reviewer 能力 + profiles / 敏感 team settings 管理。
- `viewer`：沒有 TS/DB role；目前不要新增。

詳細證據：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`。

### Production Supabase 已確認

實際專案：`nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`)。

- migration ledger **空白**，但 live schema 已包含 late-stage fields。
- **`001–039` 已逐份對照 live end-state；不要 replay。**
- 幾乎所有最終 schema/data effects 都能在 live DB 找到。
- 唯一明確 migration-level drift：`004` 的 4 張 catalog/rule table 都 RLS enabled，但 **8 條預期 policy 全部缺失**。
- `025/027` 的 recursive batch policy 已由 `028` 正確取代。
- `009` 已由 `010` 取代；`019` 的 constraint 已由 `030` 擴充。
- Security Advisor 另有 SECURITY DEFINER direct EXECUTE / trigger search_path warnings。
- production 目前只有 1 個 admin profile，尚無 operator/reviewer。
- production DB 在 audit / CI / 001–039 reconcile 工作中都**沒有被修改**。

完整矩陣與證據：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`。

目前安全 SQL 草稿：
- `supabase/reconcile/2026-08-18_production_reconcile_draft.sql`
- 刻意**不放** `supabase/migrations/`，避免 migration ledger 空白時誤用 `db push` 重播歷史 SQL。
- Active draft 只含：8 條 catalog/rule policy restore + 3 個 timestamp trigger `search_path` hardening。
- SECURITY DEFINER direct-RPC revoke 仍是註解候選，必須隔離測試後才能啟用。

## 4. 下一步順序

1. `agent/ci-gate` / Draft PR #1 保持不 merge；它目前是已驗證的 CI 基底。
2. 在 `agent/supabase-reconcile-plan` review/驗證 reconcile draft；production 不動。
3. 決定隔離 DB 測試方式。Supabase 目前沒有 development branch；建立 branch 有成本，需使用者明確確認成本後才能建立。
4. 在隔離環境測：8 policies、timestamp trigger search_path、trigger/event-trigger EXECUTE hardening候選、RLS/role matrix。
5. 測試通過後才形成真正的新 tracked migration/baseline 策略；仍不可直接 replay `001–039`。
6. rerun Supabase Security Advisor。
7. Vercel production env / Shopify production config audit。
8. real-product E2E。
9. 再進 E6/F/G。

## 5. 修改鐵則

- 不刪舊文件；歷史檔只 archive/索引。
- 不因 Mockup 移除既有功能。
- 一個 regression / authorization bug 一個 commit；不要混改。
- 每次實際改動：同步 CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit；長 CHANGELOG 不能安全 patch 時不要整檔覆寫。
- Release / deploy 前讀 `docs/RELEASE_READINESS.md` 並要求 CI green。
- UI 改前看 Git 歷史與 regression audit。
- `src/app/stabilization.css` 只作小型已記錄 hotfix，不得長成第二份 general stylesheet。
- Production Supabase DDL 前必讀 production reconcile audit。
- **不要 replay `001–039`；不要手動偽造 migration history。**
- `supabase/reconcile/` 是審核草稿區，不是可直接 deploy 的 migration queue。
- 權限/RLS 改動要對齊 frontend helper + API + DB。
- service-role API 不可信任前端傳來的 IDs；先 authenticated/RLS 或明確 owner authorization。
- 不 deploy / 不套 production DDL，除非使用者明確同意。
- push/PR 前核對 diff 與 GitHub CI。

## 6. 新 session 開場指令

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。再確認 branch/HEAD、Draft PR/CI 狀態，以及是否已有對應 stabilization/audit。碰 DB 必讀 production Supabase reconcile audit與 `supabase/reconcile/` draft；判斷 release readiness 必讀 `docs/RELEASE_READINESS.md`。不要從歷史施工文件猜目前狀態。
