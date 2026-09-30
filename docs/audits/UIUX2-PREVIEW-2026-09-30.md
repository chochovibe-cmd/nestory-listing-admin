# Nestory UI/UX 2.0 Preview P1 — 2026-09-30

> 狀態：Preview branch only。未 merge、未 production deploy、未改 production DB、未做真實 Shopify write。
> Branch: `agent/uiux2-preview-20260930`
> Base: `codex/nestory-v0.1-safety-skeleton`

## 1. 為什麼做這包

Owner 要把 Astra 的實務 UI/UX 建議與既有 Nestory 架構稽核合併，但文案生成／prompt 線由另一條工作線處理，本包不得碰。

本包先驗證一個方向：不先大改 business semantics，也能讓日常工作更像「商品營運工作台」而不是工程後台。

優先目標：

1. 舊商品找得到，不受工作檯最近 40 件未封存＋50 件封存限制。
2. 每張待辦卡直接告訴使用者下一步，不必自己讀 status。
3. 使用者可見名稱改成工作語言，降低工程術語。
4. 修正 Dashboard 把 backlog 稱為「今日待辦」的語意誤導。
5. 新 UI 優先 component-scoped CSS，停止繼續大量堆 globals 補丁。

## 2. 本包改動

### A. 全庫商品搜尋

新增：

- `src/components/listing/WorkbenchProductSearch.tsx`
- `src/components/listing/WorkbenchProductSearch.module.css`

行為：

- 搜尋 `product_drafts` 全庫（仍受既有 RLS 權限限制）。
- 搜尋欄位：中文標題、來源標題、原始標題、SKU、來源網址、淘寶網址。
- 不依賴 `/drafts/new` 初始載入的 40／50 筆集合。
- 260ms debounce；最多顯示 12 筆最近更新結果。
- `/` 快捷鍵聚焦搜尋。
- 未完成草稿導回 `/drafts/new?draft=<id>`；其他結果打開既有 `/drafts/<id>` 詳情。
- 只讀查詢，不新增 migration，不改任何商品內容。

### B. 工作區語意

`DraftResultsPanel`：

- 「生成結果（三站工作佇列）」→「待處理商品」。
- 在結果區頂部加入全庫商品搜尋。

### C. 卡片直接顯示下一步

`ResultCard` 只使用現有事實推導提示，不新增狀態：

- block warning → 「先處理：…」
- 文案站 → 「下一步：確認文案」或「確認 N 項資訊後核准」
- 圖片站 → 「下一步：標示 N 張圖片」或「確認圖片分流」
- ready → 「下一步：發布／匯出」

這個提示是 action hint，不冒充 system status；CSS 使用獨立 `.rc-next-action`，沒有改狀態色語意。

### D. Dashboard 文案修正

`DashboardTodoPanel`：

- 「今日待辦」→「現在要處理」
- 「積壓待辦 · 不限今天」→「依目前流程整理 · 不限今天」

原因：現有程式計算的是 backlog，不是 calendar-day todo。

## 3. 明確沒有做

本包沒有碰：

- `/api/generate`、prompt、潮巢文案、SEO 生成。
- DraftStatus / PipelineStage schema 或 migration。
- warning Regex → structured error 的底層改造。
- pricing localStorage → team settings。
- autosave revision / multi-tab conflict。
- background job persistence。
- Evidence Model。
- Variant source diff。
- 成本拆解。
- Shopify 真實寫入與 production DB。
- production merge / production deploy。

這些保留給 UI 方向確認後的後續包，避免一次改太多造成回歸。

## 4. 風險與驗收

### 必測

Desktop + Mobile、dark / nordic / kitty：

1. 搜尋 2 字以上能查到工作檯 40／50 筆以外的舊商品。
2. 搜尋名稱、SKU、來源網址皆可用。
3. 搜尋結果點擊能正確開啟未完成草稿或商品詳情。
4. 搜尋無結果／失敗有明確訊息。
5. ResultCard 下一步提示不把標題、價格、快捷操作擠壞。
6. block warning 顯示紅色 action hint，但不改原 warning/status 判斷。
7. Dashboard「現在要處理」數字與原本 backlog 完全相同，只改名稱。

### 仍需後續驗證

- 真實資料量下搜尋延遲。
- RLS 不同角色的搜尋結果範圍。
- iPhone 窄寬度結果列是否需要再縮 stage label。

## 5. 回退方式

本包只存在 preview branch。若方向不採用：

- 不 merge PR 即可。
- 或刪除 `agent/uiux2-preview-20260930`。

production source / production DB / Shopify 不需要任何 rollback。

## 6. 下一包候選（需 Owner 看完 Preview 再決定）

高 ROI：

1. 工作檯初始資料改成摘要載入＋按需載圖片／款式。
2. 搜尋／站別／排序／返回位置統一保存。
3. ResultCard 收合狀態再瘦身，展開才進完整編輯。
4. Variant 來源更新 Diff（新增／刪除／成本變更）。
5. Pricing 商店共用設定與成本拆解。

架構包：

1. Product Facts / Workflow / Job / Platform 四層狀態模型。
2. Structured Error / Warning。
3. Server-persisted job progress。
4. Team / personal / device settings 分層。
5. Evidence Model + source lineage。

以上都尚未實作，不得由本 Preview 推論為已完成。
