# Nestory — AI Start Here

> 給任何新 Codex / Claude Code / ChatGPT / 其他 AI coding session 的最短入口。
> 目標：不用先掃完整 repo，也能在 1–3 分鐘內知道專案現在在哪、什麼能動、什麼不要碰。

## 1. 先讀這三份

1. `AI_START_HERE.md`（本檔）— 專案入口與讀取順序
2. `docs/CURRENT_STATUS.md` — 目前真實進度、已知風險、下一步
3. `AGENTS.md` — 常駐施工規則與 UI/安全鐵則

穩定化工作再讀：
- `docs/STABILIZATION_PLAN.md`
- `docs/CHANGELOG.md`
- 對應 `docs/audits/*.md`

UI 規格按需讀：
- `docs/mockups/nestory-v7-mockup.html`
- `docs/Mockup差異備忘.md`

歷史細節才查：
- `docs/施工清單.md`
- `docs/UIUX本輪改動同步-2026-07-21.md`
- 其他 dated / worker brief

**不要一開始就通讀所有 docs。** 舊文件保留歷史，但不是目前進度的唯一真相。

## 2. 專案一句話

Nestory 是潮巢玩居內部使用的 Shopify 商品上架 PWA：從商品輸入、圖片/規格、AI 文案，到審核、圖片處理與 Shopify 發布；Supabase 作資料層，Vercel 部署。

## 3. 現況摘要

核心流程已相當完整；目前主線是**穩定化，不是擴功能**。

已實作但尚未 merge / 完整 runtime 驗證：
- **P0-1** `agent/p0-variant-atomic-confirm` / `171bbaa`：Variant axis confirm atomic。
- **P0-2** `agent/p0-variant-duplicate-protection`：duplicate option protection；涵蓋 expand、Workspace、persistence、Shopify publish 409 guard。
- **P0-3** `agent/p0-mobile-resultcard-expand`：mobile ResultCard 恢復既有 compact expand toggle，不恢復整條 quick row；code-only diff 已乾淨重疊到最新 P0-2，現在收尾文件/squash，仍待手機驗證。

**下一個直接修復：P1-1 Mobile interactive-target gesture guard。**
原因：`rc-header` 的 touch handlers 仍會看到重生、toggle 等 interactive child 的 touch，可能誤觸 long-press selection / swipe。

其他後續：
- P07 Variant desktop picker/hover clipping
- verifier localStorage policy
- role/RLS model
- production Supabase migration reconcile
- CI + real-product E2E

不要優先開 Phase F/G。

## 4. 修改前鐵則

- 不刪舊文件；歷史檔之後只 archive/索引。
- 不因對齊 Mockup 移除現有功能。
- 一個 regression 一個 commit；文件整理、UI 修復、DB/權限、功能新增分開。
- 每次實際改動 append `docs/CHANGELOG.md`，同步 CURRENT_STATUS / STABILIZATION_PLAN / 對應 audit。
- UI 改前看 Git 歷史與 regression audit。
- `src/app/stabilization.css` 只作小型已記錄 regression hotfix，不得長成第二份 general stylesheet。
- SQL 只新增 migration，不自行跑 Supabase CLI。
- 不 deploy，除非使用者明確同意。
- push/PR 前先核對 diff 與可跑 checks。

## 5. 現在建議工作順序

1. 收尾/squash P0-3；手機實機留待可執行環境驗證
2. P1 mobile interactive-target gesture guard
3. P07 Variant desktop picker clipping
4. verifier localStorage policy
5. role / DB-RLS consistency
6. production Supabase migration reconcile
7. CI / typecheck / build gate
8. real-product E2E
9. 再進 Phase E6/F/G

## 6. 文件權威分級

### 現役／優先
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `docs/STABILIZATION_PLAN.md`
- `AGENTS.md`
- `docs/REGRESSION_AUDIT.md`
- 對應當前問題的 `docs/audits/*.md`
- `docs/CHANGELOG.md`（查實際已改過什麼）

### 歷史／按需查詢
- `docs/施工清單.md`
- `docs/UIUX本輪改動同步-*.md`
- `docs/UX-B*-P*工人開場指令-*.md`
- `docs/UIUX總指揮計劃包-*.md`
- 其他 dated handoff / planning 文件

歷史文件可以回答「為什麼當時這樣做」，但不能單獨判斷現在狀態。

## 7. 新 session 建議開場

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。若做穩定化，再讀 `docs/STABILIZATION_PLAN.md` 與對應 audit；需要知道前一位 agent 實際改過什麼，再查 `docs/CHANGELOG.md`。不要先掃完整 docs。先確認 branch/HEAD 與 Git 歷史，再修改。
