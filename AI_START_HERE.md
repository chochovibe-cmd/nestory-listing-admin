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
- **CI gate** `agent/ci-gate` / Draft PR #1：GitHub Actions `verify:all → typecheck → build` 已取得完整 green run。

### CI canonical state

GitHub Actions run `32132498629`：
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
- **不要 replay repo `001–039`。**
- `ip_catalog / ip_characters / tag_rules / collection_rules`：RLS enabled，但 production 沒 policy；repo migration 004 原本有 authenticated read + admin write policies。
- Security Advisor 另有 SECURITY DEFINER direct EXECUTE / trigger search_path warnings。
- production 目前只有 1 個 admin profile，尚無 operator/reviewer。
- production DB 在 audit/CI 工作中都**沒有被修改**。

完整證據：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`。

## 4. 下一步順序

1. 收尾 `agent/ci-gate`：整理 Git 歷史、保持 Draft PR #1，不直接 merge。
2. Production Supabase reconciliation：建立乾淨的新 migration workflow，不 replay `001–039`、不偽造 history。
3. 驗證/修復 catalog RLS policies + SECURITY DEFINER RPC surface + trigger search_path。
4. rerun Supabase Security Advisor。
5. Vercel production env / Shopify production config audit。
6. real-product E2E。
7. 再進 E6/F/G。

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
- 權限/RLS 改動要對齊 frontend helper + API + DB。
- service-role API 不可信任前端傳來的 IDs；先 authenticated/RLS 或明確 owner authorization。
- 不 deploy / 不套 production DDL，除非使用者明確同意。
- push/PR 前核對 diff 與 GitHub CI。

## 6. 新 session 開場指令

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。再確認 branch/HEAD、Draft PR/CI 狀態，以及是否已有對應 stabilization/audit。碰 DB 必讀 production Supabase reconcile audit；判斷 release readiness 必讀 `docs/RELEASE_READINESS.md`。不要從歷史施工文件猜目前狀態。
