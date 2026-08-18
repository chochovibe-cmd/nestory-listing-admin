# Nestory 上架系統 — 給所有 AI 模型的常駐規則

## 新 session 的最短入口

接手任何工作前，先讀：
1. `AI_START_HERE.md`
2. `docs/CURRENT_STATUS.md`
3. 本檔 `AGENTS.md`

只有工作涉及 UI 時，再讀：
- `docs/mockups/nestory-v7-mockup.html`
- `docs/Mockup差異備忘.md`
- `docs/REGRESSION_AUDIT.md`

歷史細節才按需查 `docs/施工清單.md`、`docs/UIUX本輪改動同步-*.md`、`docs/UX-B*-P*工人開場指令-*.md` 等。

**不要在新 session 一開始通讀整個 docs。** 現在的唯一短版進度真相是 `docs/CURRENT_STATUS.md`；舊施工文件保留歷史，但不能單獨判斷現況。

`docs/archive/` 仍只作歷史保存，不作現行實作依據。

## UI 一致性鐵則（每次動到前端都適用，無例外）

1. **動 CSS 前，先讀 `src/app/globals.css` 現有的 class 與 CSS 變數**，優先重用既有元件樣式。
   禁止自創新的顏色值、圓角值、陰影值、字級——只能用現有 tokens。
2. **風格基準＝globals.css 現有三主題（dark／nordic／kitty）**。
   Mockup v7.4 的柔化樣式只是示意，**不要**把現有主題整包改成 Mockup 視覺數值。
3. **禁止新增 `!important`**。既有歷史補丁可保留；新規則衝突時用更精確 selector 或調整 source order。
4. 設計語言約定：
   - 使用者選取＝`.sel`
   - 系統狀態＝`.schip`
   - 選取與狀態不可混用
   - 狀態色：灰=未開始／黃=進行中／綠=完成／紅=失敗
   - 卡片內欄位優先用留白＋小型粗體標籤分層，不要堆框
   - 影響結果的操作用大尺寸 CTA；輔助操作用 mini
   - 新樣式必須 dark／nordic／kitty＋手機版都驗證
5. 新增 UI 功能要指出沿用哪個既有元件樣式；找不到才提案新樣式。
6. 改完前端要回報：動了哪些檔案、哪些 class、與哪個既有元件保持一致。
7. 手機（<960px）必查：觸控高度 ≥44px、彈窗偏 bottom sheet、無橫向爆版。
8. **最近 UIUX 已確認有 regression 歷史**；動 ResultCard、VariantEditor、ImageUploader 或 workbench containment 前，先讀 `docs/REGRESSION_AUDIT.md` 與相關 Git diff。
9. UI 修復與功能邏輯變更分開 commit；不要把「順手改功能」塞進純 UI 包。

## 工作規則

- SQL 只產 `.sql` 到 `supabase/migrations/`（編號接續），不自行跑 Supabase CLI。
- `src/app/api/**/route.ts` 只能 export HTTP methods；共用 helper 放 `src/lib/`。
- 敏感 key 只放伺服器端環境變數；部署平台是 Vercel。
- Tags/Collections 由規則引擎產出；文案生成走同步呼叫；圖片與發布走 worker。
- 不 deploy，除非使用者明確同意。
- push / PR 前先確認 scope；不要混入無關改動。
- 使用者是非技術背景店主，用白話回報：做了什麼／改哪些檔案／下一步／需要手動操作嗎。

## Mockup 的參考權限分級

動任何前台前，先看 Mockup 對應區塊，再看 `docs/Mockup差異備忘.md`。

| 層面 | 權威 | 規則 |
|---|---|---|
| 功能與流程 | Mockup + 已確認差異 | 不自行刪減功能 |
| 資訊架構 | Mockup + 已確認差異 | 保留現有更完整能力 |
| 視覺細節 | 現有網站 | Mockup 只作示意 |

保護規則：
- **只加不減**：現有功能做得更完整時要保留，移除／簡化必須取得使用者同意。
- **衝突交裁決**：現況與 Mockup 衝突且無法判斷時，列差異給使用者選，不自行決定。

## 資訊密度規範

- Mockup 的工程說明文字不等於正式 UI 文案。
- 核心表單優先保持清楚；進階項目可收合。
- 寧可頁面長，不要把欄位擠變形。
- 手機表單避免橫向爆版。
- 示範警告在真 App 應條件式顯示。

## 風格更新處理

1. 調性微調：優先改既有 tokens，不亂加局部 magic values。
2. 元件級：先列會影響哪些畫面，再改共用 class。
3. 整體換風格：不要直接覆蓋現有主題；優先新增可切換 theme。
4. 有使用者截圖／參照物時，以參照物為準；方向不明時先小範圍驗證。

## 新增或修改 UI 功能的標準流程

1. 讀相關元件、現有 CSS、`docs/REGRESSION_AUDIT.md`、必要 Git 歷史。
2. 確認：要新增什麼、保留什麼、是否碰到既有功能。
3. 實作最小範圍 diff。
4. 檢查 desktop / mobile / 三主題與核心互動。
5. 將新的現況更新到 `docs/CURRENT_STATUS.md`；若屬 regression 修復，更新 `docs/REGRESSION_AUDIT.md`。

## 文件維護規則

- `docs/CURRENT_STATUS.md`：只放「現在仍成立」的進度、風險、下一步。
- `docs/REGRESSION_AUDIT.md`：只放 UI/UX regression 稽核與修復索引。
- dated 施工文件：保留歷史，不要求每個新 session 全讀。
- 若 CURRENT_STATUS 與舊施工文件衝突，以實際 source/Git HEAD + CURRENT_STATUS 為優先，必要時修正 CURRENT_STATUS。
