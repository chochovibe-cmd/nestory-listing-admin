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
- **P1-1** `agent/p1-mobile-gesture-guard`：ResultCard interactive child touch 不再被 card long-press/swipe 接管；新增 centralized target guard + verifier，並補齊 package/verify-all wiring。

P1-1 特別注意：舊分支 whole-file replacement 曾意外把 ResultCard tab active predicate 改壞，後續已修；目前 verifier 明確鎖住 `activeTab === tab.id`，不要再改回去。

**下一個主線：P1-2 P07 Variant desktop picker / hover preview clipping。**
另有 P1-3 localStorage verifier policy。

後面才是 role/RLS、production Supabase reconcile、CI、real-product E2E；不要先開 Phase F/G。

## 4. 修改鐵則

- 不刪舊文件；歷史檔只 archive/索引。
- 不因 Mockup 移除既有功能。
- 一個 regression 一個 commit；不要混改。
- 每次實際改動：append CHANGELOG，同步 CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit。
- UI 改前看 Git 歷史與 regression audit。
- `src/app/stabilization.css` 只作小型已記錄 hotfix，不得長成第二份 general stylesheet。
- SQL 只新增 migration，不自行跑 Supabase CLI。
- 不 deploy，除非使用者明確同意。
- push/PR 前核對 diff 與 checks。

## 5. 下一步順序

1. 收尾/squash P1-1，手機實機留待有執行環境驗證
2. P1-2 P07 Variant desktop picker clipping
3. P1-3 localStorage verifier policy
4. role / DB-RLS consistency
5. production Supabase migration reconcile
6. CI / typecheck / build gate
7. real-product E2E
8. 再進 E6/F/G

## 6. 新 session 開場

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。做穩定化再讀 `docs/STABILIZATION_PLAN.md` 與對應 audit；要查前一位 agent 實際改過什麼再看 `docs/CHANGELOG.md`。先確認 branch/HEAD 與 Git 歷史，再修改。
