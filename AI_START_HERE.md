# Nestory — AI Start Here

> 給任何新 Codex / Claude Code / ChatGPT / 其他 AI coding session 的最短入口。
> 目標：不用掃完整 repo，也能在 1–3 分鐘內知道專案在哪、什麼能動、下一步是什麼。

## 1. 先讀

1. `AI_START_HERE.md`（本檔）
2. `docs/CURRENT_STATUS.md`
3. `AGENTS.md`

做穩定化再讀：
- `docs/STABILIZATION_PLAN.md`
- 對應 `docs/audits/*.md`
- `docs/CHANGELOG.md`（查實際改過什麼）

歷史細節才查 `施工清單.md` / dated UIUX / worker brief。**不要一開始通讀所有 docs。**

## 2. 專案一句話

Nestory 是潮巢玩居內部的 Shopify 商品上架 PWA：商品輸入、圖片/規格、AI 文案、審核、圖片處理、Shopify 發布；Supabase 資料層、Vercel 部署。

## 3. 現況

主線是**穩定化，不是擴功能**。

已實作、尚待完整 runtime 驗證/merge：
- **P0-1** `agent/p0-variant-atomic-confirm` / `171bbaa`：Variant axis confirm atomic。
- **P0-2** `agent/p0-variant-duplicate-protection`：duplicate option protection，涵蓋 expand/Workspace/persistence/Shopify 409。
- **P0-3** `agent/p0-mobile-resultcard-expand`：mobile ResultCard 恢復既有 compact expand toggle，不恢復整條 quick row。
- **P1-1** `agent/p1-mobile-gesture-guard`：ResultCard interactive child touch 不再被 card long-press/swipe 接管。
- **P1-2** `agent/p1-variant-picker-clipping`：保留 P07 containment，只把 Variant desktop hover preview 對齊 picker 內側。
- **P1-3** `agent/p1-localstorage-secret-policy`：no-secrets 改成阻擋 credential-like browser-storage writes，不再 blanket-ban localStorage。
- **Role/RLS audit** `agent/role-rls-consistency-audit`：已完成第一輪；建議保留 `admin | operator | reviewer` 三角色，不新增 viewer。
- **P0 archive authorization** `agent/p0-archive-owner-authorization`：已修正 batch archive/unarchive 在 service-role read 前未套 owner/team RLS 的越權路徑；authorization read 改走 authSupabase，service role 只做後續 mutation。

### Canonical role 建議
- `operator`：製作/操作自己的商品；不審核、不發布。
- `reviewer`：可讀全隊、審核、發布。
- `admin`：reviewer 能力 + profiles / 敏感 team settings 管理。
- `viewer`：目前只存在部分文件語意，沒有 TS/DB role；不要先新增。

詳細證據：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`。

### 目前已知下一步
1. 收尾/squash P0 batch archive authorization + verifier。
2. production Supabase migration / RLS reconcile。
3. CI / typecheck / build gate。
4. real-product E2E。
5. 再進 E6/F/G。

P1-3 最終 preview 的 Vercel status 曾顯示 failure，但 target 明確是 `build-rate-limit / upgradeToPro`，不是程式 build log；因此記為「預覽額度阻擋、未驗證」，不要當 code failure。

## 4. 修改鐵則

- 不刪舊文件；歷史檔只 archive/索引。
- 不因 Mockup 移除既有功能。
- 一個 regression / authorization bug 一個 commit；不要混改。
- 每次實際改動：append CHANGELOG，同步 CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit。
- UI 改前看 Git 歷史與 regression audit。
- `src/app/stabilization.css` 只作小型已記錄 hotfix，不得長成第二份 general stylesheet。
- SQL 只新增 migration，不自行跑 Supabase CLI。
- 權限/RLS 改動要對齊 frontend helper + API + DB；不要只改按鈕或 `canPublish()`。
- service-role API 不可信任前端傳來的 IDs；需要先做 authenticated/RLS 或明確 owner authorization。
- 不 deploy，除非使用者明確同意。
- push/PR 前核對 diff 與 checks。

## 5. 新 session 開場

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。做穩定化再讀 `docs/STABILIZATION_PLAN.md` 與對應 audit；要查前一位 agent 實際改過什麼再看 `docs/CHANGELOG.md`。先確認 branch/HEAD 與 Git 歷史，再修改。
