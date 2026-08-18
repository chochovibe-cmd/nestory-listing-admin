# Nestory — AI Start Here

> 給任何新 Codex / Claude Code / ChatGPT / 其他 AI coding session 的最短入口。
> 目標：不用先掃完整 repo，也能在 1–3 分鐘內知道專案現在在哪、什麼能動、什麼不要碰。

## 1. 先讀這三份

1. `AI_START_HERE.md`（本檔）— 專案入口與讀取順序
2. `docs/CURRENT_STATUS.md` — 目前真實進度、已知風險、下一步
3. `AGENTS.md` — 常駐施工規則與 UI/安全鐵則

如工作涉及 UI，再讀：
- `docs/mockups/nestory-v7-mockup.html`
- `docs/Mockup差異備忘.md`
- `docs/REGRESSION_AUDIT.md`
- `docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`（P07 overflow / Variant / swipe / sticky 專項稽核）

如工作涉及歷史細節，再查：
- `docs/施工清單.md`
- `docs/UIUX本輪改動同步-2026-07-21.md`
- 其他 dated / worker brief 文件

**不要一開始就通讀所有 docs。** 舊文件保留歷史，但不是目前進度的唯一真相。

## 2. 專案一句話

Nestory 是潮巢玩居內部使用的 Shopify 商品上架 PWA：從商品輸入、圖片/規格、AI 文案，到審核、圖片處理與 Shopify 發布；Supabase 作資料層，Vercel 部署。

## 3. 現況摘要

- 核心上架流程已相當完整，曾完成「輸入 → AI 生成 → 審核 → Shopify DRAFT」真實流程測試。
- 目前不是缺功能為主，而是需要做 **穩定化、文件收斂、權限/資料庫驗證、UI regression 修復**。
- 最近 UIUX 修改密度很高，已確認有「優化後造成版面回歸、再補修」的 commit 歷史；前端工作不要假設最新 UI 一定是正確版本。
- P07 containment 已完成第一輪專項稽核：Variant 桌機圖片 hover preview 有高可信裁切風險；ResultCard swipe / sticky 目前不是 P07 的主要嫌疑。
- 不要優先開 Phase F/G 新功能，除非目前 P0 穩定化事項已處理。

完整內容看 `docs/CURRENT_STATUS.md`。

## 4. 修改前的鐵則

- 不刪舊文件；歷史文件之後只做 archive/索引整理。
- 不因「對齊 Mockup」而移除現有功能。
- UI 修改前先看 Git 歷史與 `docs/REGRESSION_AUDIT.md`，避免重複踩回歸。
- 不要大包混改：文件整理、UI 修復、權限/DB 修復、功能新增分開 commit。
- SQL 只新增 migration 檔，不自行跑 Supabase CLI。
- 不 deploy，除非使用者明確同意。
- push/PR 前先驗證改動範圍與可跑的 checks。

## 5. 目前建議工作順序

1. 完成最近 UIUX commit regression audit
2. 文件收斂：把 CURRENT_STATUS 當唯一短版進度真相
3. 修已確認的 UI regression（小包、可回退）
4. 角色/權限模型一致化
5. Supabase migration 實際環境核對
6. CI / verify / typecheck / build gate
7. 真實商品 E2E
8. 再繼續新功能 Phase E6 / F / G

## 6. 文件權威分級

### 現役／優先
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `AGENTS.md`
- `docs/Mockup差異備忘.md`
- `docs/mockups/nestory-v7-mockup.html`
- `docs/REGRESSION_AUDIT.md`
- `docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`

### 歷史／按需查詢
- `docs/施工清單.md`
- `docs/UIUX本輪改動同步-*.md`
- `docs/UX-B*-P*工人開場指令-*.md`
- `docs/UIUX總指揮計劃包-*.md`
- 其他 dated handoff / planning 文件

歷史文件可以提供「為什麼當時這樣做」，但**不能單獨用來判斷現在是否完成或現在應該怎麼改**。

## 7. 新 session 建議開場方式

新的 AI coding session 可以直接說：

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`，只讀完成目前任務必要的其他文件。不要先掃完整 docs。先確認目前 branch/HEAD 與相關 Git 歷史，再開始修改。

這樣可以避免每個新 session 因 context 太長而讀到一半就開始施工。
