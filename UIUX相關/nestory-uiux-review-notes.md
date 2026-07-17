# Nestory Listing Admin — UI/UX 檢視筆記

> 專案：`nestory-listing-admin-codex-nestory-v0.1-safety-skeleton`（Next.js + Supabase，商品上架管理後台，多主題設計系統：dark / nordic / kitty）
> 用途：整理給其他 AI 對話參考，內容涵蓋現況問題、mockup 融合建議、已產出的 Toast 元件規格。
> 所有檔案路徑皆相對於專案根目錄。

---

## 0. 專案背景速覽

- Next.js App Router，核心工作流程頁面：`/drafts/new`（新增/工作檯，左右兩欄 `WorkspaceInputPanel` + `DraftResultsPanel`）、`/drafts/[id]`、`/review`、`/records`、`/scouting`、`/settings`、`/dashboard`。
- 狀態管理有**兩套並存的語彙**：
  - `DraftStatus`（13 值，如 `pending_input`／`ready_for_review`／`csv_ready`／`archived`）
  - `PipelineStage`（6 值：`input`／`copy_review`／`image_review`／`ready`／`published`／`archived`），`domain.ts` 註明「Dual-written with status; R2+ may retire status gradually」——即尚未收斂完的過渡期架構。
- 設計系統：`src/app/globals.css`（近 5000 行），用 CSS variable 做三主題切換（`body[data-theme="dark|nordic|kitty"]`），有清楚的「選取態 vs 狀態態」顏色規範註解（`.sel` / `.schip` 不可混用）。
- 專案裡另外還有一份 **mockup 參考檔**：`docs/mockups/nestory-v7-mockup.html`（v7.4 App Shell 完整 Mockup），是實作前的視覺稿，風格比現行版本「柔」一些（雙層模糊陰影、backdrop-filter 毛玻璃、22px 圓角、fadeIn 動效），現行專案则偏「硬」（選取態用硬邊偏移陰影 `6px 6px 0`，像貼紙/復古科技感）。

---

## 1. 第一輪整體 UI/UX 問題（不看 mockup，純看現行專案）

### 1-1.〔高風險〕破壞性、不可逆動作只靠瀏覽器原生 `window.confirm()` 把關
出現位置：
- `src/components/listing/ResultCard.tsx`（第 541, 678, 795, 838, 1237 行）
- `src/components/listing/DraftResultsPanel.tsx`（第 340 行）
- `src/components/drafts/DraftQueueList.tsx`（第 141 行，`batchApproveAndPublish`，會**直接把商品上架到 Shopify ACTIVE**）

問題：
- 只顯示「幾筆」，不會列出是哪幾件商品（標題/縮圖），選錯品項時使用者無從察覺。
- 原生 confirm 樣式無法客製、手機體驗差，跟專案裡精緻的 `Station3PublishModal`／`ApproveSummaryModal` 風格不一致。
- 沒有「上架後可以做什麼補救」的提示。

建議：改用清單式確認 modal（列出即將上架的商品標題/縮圖），或至少用「再按一次確認」的 inline 雙重確認（見 1-1 補充，`Station3PublishModal` 其實已經有一個更好的做法可以複用）。

**補充發現**：`Station3PublishModal.tsx` 的 `handlePrimary()` 已經實作了「只選一個動作時，第一次點擊只跳警告文字、要再點一次才真的送出」（`singleWarn` 狀態），這正是可以取代 `window.confirm` 的 pattern，而且專案自己已經寫過一次，只是沒推廣到 `DraftQueueList` / `ResultCard` 其他 5 處。建議抽成共用 `useDoubleConfirm()` hook 統一複用。

### 1-2. 兩套狀態語彙同時曝光給使用者，造成心智負擔
- `StageFilterPills`（用 `pipeline_stage`／「站」）與 `StatusBadge`（用 `DraftStatus`）同時出現在畫面上，兩者命名不一致、無對照表，使用者要同時記兩套系統。

### 1-3. `StatusBadge` 分類邏輯用字串包含比對，容易誤判
```js
status.includes("ready") ... ? "ready" : ...
```
- `csv_ready`（只是 CSV 匯出檔備妥）會被歸類成跟 `active_published` 一樣的綠色「ready」樣式，容易誤導使用者以為已上架。
- `archived`（已封存）不符合任何條件 → 拿到空 className → **沒有顏色的預設樣式**，反而是列表中最容易被忽略的重要狀態。
- 隱性技術債：以後每新增一個 `DraftStatus` 值，都要重新確認會不會被 `.includes()` 意外分錯類別。

### 1-4. 字級普遍過小，密集分布在 9–13px
統計 `globals.css` 全部 `font-size` 宣告：9px×7、10px×34、11px×59、12px×54、13px×27，加總佔全部宣告八成以上；14px 以上只有 11 筆。對長時間判斷商品文案品質的後台工具而言閱讀負擔偏重，尤其中文字在 9–10px 幾乎難以舒適辨識。
建議：內容性文字（標題、文案預覽、表單輸入）至少拉到 13–14px，9–10px 只保留給輔助小標籤。

### 1-5. 沒有統一的 toast / 錯誤提示元件
只有 4 個元件（`PublishRecordsPanel`、`ProductLibraryModal`、`ImageReviewPanel`、`DashboardTodoPanel`）自己寫了局部 `setError`，其餘元件（包含核心的 `ResultCard`）錯誤/成功回饋方式不統一。→ **已產出解法，見第 3 節。**

### 1-6. 圖片缺少 alt 文字
`next/image` 用法有 6 處沒帶 `alt`，`<img>` 有 2 處沒帶。商品圖片審核是核心功能，建議至少補上「商品主圖 - {draft.title}」這類有意義的 alt。

### 1-7.〔本輪新補充〕`.schip--warn` 在 nordic／kitty 主題下文字對比度過低
- `--warn` 在 nordic 是 `#f6ce45`、kitty 是 `#ffd966`，都是淺黃色；這兩個主題的 surface 背景是 `#fffdf6`／`#ffffff`，接近白色。
- `.schip--warn { color: var(--warn); }` 直接把淺黃當文字色用在近白底上 → 對比度嚴重不足，「處理中」這個常見狀態在亮色主題下幾乎隱形。
- 建議：`.schip--warn` 文字色改用 `color-mix(in srgb, var(--warn) 65%, var(--text))`，混入深色文字，而非原色直出。
- 這也是本輪設計 Toast 元件時，刻意不用「純色填滿背景」而改用「surface 底 + 左側色條 + icon 圈」的原因（見第 3 節）。

### 1-8. 按鈕 class 高度碎片化，同一視覺角色被重複定義
統計專案裡「明顯是 primary/大顆行動按鈕」角色，就有 `btn-add`、`btn-gen`、`btn-gen-short`、`btn-gen-full`、`btn-save-version`、`ir-btn-confirm`、`ir-batch-confirm`、`button primary` 等十幾個各自獨立定義樣式的 class，padding/字重/圓角些微不同。
問題：不是功能 bug，是設計系統債——以後想統一調整「主要按鈕」手感，得同時改十幾處，容易漏改造成視覺不一致。
建議：收斂成 `.button.primary` / `.button.success` / `.button.danger` + size modifier（`.lg`），逐步替換掉一次性 class。

### 1-9. Modal 開啟時自動 focus 在「主要按鈕」上，對破壞性動作是雙面刃
`ApproveSummaryModal`、`Station3PublishModal` 開啟後 30ms 會執行 `primaryRef.current?.focus()`。對一般表單很好（可以直接按 Enter 送出），但若 primary 按鈕本身是「確定上架」這種不可逆動作，使用者手滑按到 Enter 就會誤觸。
建議：確認類 modal 的預設 focus 改放在「取消/關閉」按鈕上；只有真正安全、可重來的操作（如 `RegenCopyModal`）才 focus 在 primary 上。

### 1-10. 篩選後的空狀態沒有「清除篩選」出路
`DraftQueueList` 篩選出 0 筆時只顯示「這個篩選條件下沒有商品」，使用者若忘記自己套了篩選條件，會誤以為資料不見了。
建議加一顆「清除篩選」按鈕，跟 `ProductLibraryModal` 空狀態已有的「→ 新增商品」CTA 做法一致（專案裡其實已經在用這個模式，只是沒全面套用）。

### 1-11. 三主題共用同一份 CSS token，但沒有「新增主題檢查清單」
Token 系統設計嚴謹（B15 系列註解規範選取/狀態色不可混用），但目前完全靠人工記憶維持三套主題一致性。建議：修改任何 `--xxx` token 時，寫一份 checklist 要求同步檢查三個 `body[data-theme]` 區塊的對比度，避免 1-7 這類問題在其他 token 上重演。

---

## 2. 現行風格 vs Mockup（`docs/mockups/nestory-v7-mockup.html`）比較

### 2-1. Token 層級差異

| | 現行專案 | Mockup |
|---|---|---|
| 陰影 | `--shadow-m: 0 3px 10px rgba(0,0,0,.18)`（單層）；選取態用**硬邊偏移陰影** `--card-active-shadow: 6px 6px 0 ...`（貼紙/復古感） | `--shadow-s/m` 都是雙層柔陰影（`0 1px 2px + 0 4px 14px`），沒有硬偏移貼紙感 |
| 圓角 | radius-l 20px | radius-l 22px（差異不大） |
| Topbar | 純色不透明 | `backdrop-filter:blur(8px)` 毛玻璃 + 半透明背景 |
| 動效 | 已有 pulse（含 `.brand-dot` 待機呼吸動畫，已存在）/ skeleton-shine / spin，集中在生成中狀態 | 多了 `fadeIn` 頁面切換、hover `translateY(-1px)+scale` 縮圖回饋 |
| 排版標籤 | 一般小寫 | `panel-hdr` 用 Space Grotesk + 全大寫 + 寬字距，質感偏精品 |

結論：色票（accent 綠、danger 紅、success 綠松石）幾乎共用，真正差異集中在幾個 token，融合成本低。

### 2-2. 建議直接搬：功能面缺口

1. **Toast 元件** — mockup 有現成、風格一致的 toast（`.toast` + 2.3 秒自動消失 JS）。→ 已落地，見第 3 節。
2. **「再按一次確認」banner 取代 `window.confirm`** — mockup 的「一鍵全部確認」用按鈕文字動態切換成警告字樣，要求再按一次才執行；專案裡 `Station3PublishModal` 已有同款邏輯，建議推廣到 1-1 提到的其他 5 處。
3. **Modal 手機版變成 bottom sheet**：`@media(max-width:960px){ .modal-overlay{align-items:flex-end;padding:0;} }`，需確認現行 `.modal-box` 手機版是否已做到貼齊底部滑出（比置中卡片更貼近原生 App 手勢感）。
4. **圖片縮圖拖曳排序**：查證 `ImageUploader.tsx` 目前只有拖檔案上傳（`onDrop`），**縮圖之間沒有拖曳重新排序**，也沒有 mockup 那種 `cursor:grab` + 按下微放大（`scale(1.08)`）回饋。這是功能落差，不只是風格，建議實際補上拖曳排序功能。

### 2-3. 值得搬的「柔化」細節（份量抓小，視覺層而已）

1. **panel-hdr 標題質感**：全大寫、寬字距、搭配 icon（如「🖼 IMAGE REVIEW」），套到 `ResultCard`、`DraftQueueList` 分段標題，不動版面結構。
2. **Topbar 毛玻璃**：加 `backdrop-filter:blur(8px)` + 半透明背景，捲動時有浮動感，成本最低。
3. **柔陰影只用在 hover/非選取態元素**（dropzone hover、縮圖 hover、卡片 hover），從單層 `--shadow-m` 換成雙層柔陰影；**選取態的硬邊偏移陰影建議保留**，那是目前風格最有記憶點的部分。
4. **軟刪除淡出效果**：mockup 刪除卡片時 `opacity:.35` 淡出再移除，而非瞬間消失；建議用在封存/刪除/移除圖片等操作。

### 2-4. 不建議照搬 / 需保留現行「硬」特色

- **選取態的硬邊偏移陰影**（貼紙感 `6px 6px 0`）：是目前風格裡最有辨識度的視覺記號，跟 lime green accent 搭配很有個性，不應被 mockup 的柔陰影整套取代。
- **Mockup 整體圓角+多層陰影的「精品化」感不要整套搬**：只在 2-3 提到的 hover 場景用，避免緊湊的資訊密度感消失、跟工程/科技感定位衝突。

### 2-5. 落地順序建議
因流程已與 mockup 當初設定不同 → **只抽「元件層級」UI pattern，不照搬頁面結構**：
1. Toast 元件（已完成，見第 3 節）
2. 「再按一次確認」banner 取代批次上架的 `window.confirm`（可複用 `Station3PublishModal` 既有邏輯）
3. panel-hdr 標題樣式 + topbar 毛玻璃（純視覺，風險最低）
4. 軟刪除淡出效果
5. 圖片縮圖拖曳排序（工程量較大，排最後）

---

## 3. 已產出：Toast / 通知元件規格

### 設計原則
- 沿用專案既有的 `GENERATION_PROGRESS_EVENT` / `JUMP_TO_DRAFT_EVENT` 慣例：純模組 export 一個 event 常數 + type，用 `window.CustomEvent` 跨 client component 溝通，不用 prop drilling / Context。
- **顏色刻意不用 mockup 原本「純色填滿背景」的做法**，改用專案既有「soft outline chip」語言（`surface` 底 + 文字色 + 左側色條 + icon 圈），原因：`--warn` 在 nordic/kitty 主題下是淺黃色，若填滿背景配白字或深字都容易對比度不足（呼應 1-7 的發現）。文字固定是 `var(--text-dim)` on `var(--surface)`，跟全站其他地方相同組合，保證三主題下都可讀。

### 檔案結構
```
src/lib/toast/toastEvents.ts   — TOAST_EVENT 常數 + ToastVariant/ToastDetail 型別
src/components/Toast.tsx       — showToast() 輔助函式 + <ToastHost/> 元件
（globals.css 結尾追加）toast-additions.css 內容
```

### API
```ts
showToast(message: string, variant?: "success"|"error"|"warn"|"info", duration?: number)
```
- `duration` 預設 3200ms；傳 `0` 則不自動消失，需使用者點擊關閉。
- 多個 toast 疊加時由下往上堆疊（`flex-direction: column-reverse`）。
- `<ToastHost/>` 需在 `src/app/layout.tsx` 掛載一次，緊接在 `<MobileTabbar/>` 之後。

### 使用範例
```tsx
import { showToast } from "@/components/Toast";

showToast("已儲存此版本組合", "success");
showToast("上傳失敗，請重試", "error");
showToast("2 件缺重量欄位，已略過", "warn");
```

### 建議接下來替換的地方
- 把 `PublishRecordsPanel`、`ProductLibraryModal`、`ImageReviewPanel`、`DashboardTodoPanel` 目前各自的局部 `setError` 統一改成 `showToast(msg, "error")`。
- `DraftQueueList.batchApproveAndPublish` 目前用 `setMessage("批次核准中...")` 這種局部文字，可在動作成功/失敗後補一句 toast 收尾：
```tsx
if (!approveResponse.ok) {
  showToast("批次核准失敗，請重試", "error");
} else {
  showToast(`已核准並上架 ${selectedArray.length} 件`, "success");
}
```
- 注意：`window.confirm(...)` 那幾處**不建議**改用 toast（toast 不該拿來做「確認」動作），那是 1-1 / 2-2 第 2 點要解決的另一個問題（改用清單式 modal 或 inline 雙重確認）。

---

## 4. 優先順序總結（若要照順序做）

1. `.schip--warn` 對比度修正（1-7）— 改一行 CSS，立即解決可讀性問題。
2. 用 `Station3PublishModal` 既有的雙重確認邏輯抽成 `useDoubleConfirm()`，取代其餘 5 處 `window.confirm`（1-1）。
3. 掛上 Toast 元件並逐步替換零散的 `setError`（1-5 / 第 3 節，程式碼已就緒）。
4. `StatusBadge` 分類邏輯改用明確 map，不用字串包含（1-3）。
5. 收斂按鈕 class（1-8）、補圖片 alt（1-6）、篩選空狀態加「清除篩選」（1-10）。
6. 視覺柔化：panel-hdr 大寫字距、topbar 毛玻璃、hover 柔陰影、軟刪除淡出（2-3）。
7. 字級系統調整（1-4）。
8. 圖片縮圖拖曳排序（2-2 第 4 點，工程量較大）。
