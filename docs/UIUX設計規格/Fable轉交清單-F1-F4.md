# Fable 轉交清單：F1–F4 系統邏輯修復

> **來源**：UIUX Design Reviewer 於 2026-07-19 審核老闆截圖反饋時分類
> **性質**：非 CSS/視覺問題，涉及系統邏輯 / 事件串接 / 資料操作 / 命名決策
> **目標**：由 Fable 總指揮分診排包

---

## F1 — 重複通知（Toast 同時彈兩次）

**現象**：使用者從「待輸入」以外的草稿進入 `/drafts/new` 時，同時看到兩個 Toast 通知（內容相同：「此草稿已離開待輸入」）。

**位置**：
- `src/app/drafts/new/page.tsx` L69-70：redirect 帶 `?notice=` URL param
- `src/app/drafts/new/page.tsx` L147：同時把 `loadNotice` prop 傳給 WorkspaceInputPanel
- `src/components/listing/WorkspaceInputPanel.tsx` L485-489：讀 `loadNotice` prop 後 `showToast()`
- `src/lib/drafts/mapDraftToWorkspaceForm.ts` L160：「此草稿已離開「待輸入」」文字來源

**期望行為**：只彈一次 Toast。建議移除其中一條路徑：
- 方案 A：移除 `?notice=` URL param 路徑，只靠 `loadNotice` prop
- 方案 B：移除 `loadNotice` prop，只靠 URL param（但 URL 美觀度較差）

---

## F2 — 快速預覽點按後展開對應結果卡片

**現象**：快速預覽列的 chip 點按後，會發射 `emitJumpToDraft` 事件跳到對應 station，但不會自動展開該結果卡片。使用者還需手動找到並點開卡片。

**位置**：
- `src/components/listing/QuickPreviewPanel.tsx` L79：`emitJumpToDraft({ draftId, station })`
- `src/lib/drafts/jumpToDraft.ts`：CustomEvent 分發
- `src/components/listing/DraftResultsPanel.tsx`：監聽 jumpToDraft 事件

**期望行為**：
1. 點 QuickPreview chip → 跳到對應 station filter
2. 自動展開（setExpanded(true)）目標 draftId 的 ResultCard
3. scrollIntoView 讓該卡片可見

**實作方向**：在 jumpToDraft event payload 加 `autoExpand: true`，DraftResultsPanel 接收後找到目標 ResultCard 並 call expand。

---

## F3 — 快速預覽輸入區選項可刪除

**現象**：QuickPreviewPanel 的「未完成草稿」群組顯示的 chip 無法刪除。老闆希望能直接在預覽區移除不要的草稿。

**位置**：
- `src/components/listing/QuickPreviewPanel.tsx` L67-88：chip 列表渲染
- 目前只有 onClick 跳轉，無 delete 功能

**期望行為**：
1. 每個 chip 右上角出現 ✕ 小按鈕（hover 或 mobile always-visible）
2. 點 ✕ → 確認 Toast（「已移除草稿 XXX」+ undo）
3. 實際行為：soft-delete 或 archive 該 draft（Supabase update `status` 或 `archived_at`）

**注意**：刪除邏輯需確認是「從預覽隱藏」還是「真的 archive draft」— 需老闆定義。

---

## F4 — 規格區術語不直觀（維度 vs 軸值 vs 庫存）

**現象**：老闆反饋 VariantEditor 中的「維度」和「軸值」術語不直覺（「規格區很不直觀，維度跟軸值差在哪裡，庫存呢？」）。

**位置**：
- `src/components/listing/VariantEditor.tsx`：variant axis/dimension UI
- 相關資料欄位：Shopify 的 option name = 維度（如「顏色」「尺寸」），option value = 軸值（如「紅」「L」）

**期望行為**：
1. 「維度」→ 改為更直覺的名稱，如「規格名稱」或「選項類型」
2. 「軸值」→ 改為「選項值」或「規格值」
3. 庫存欄位（inventory_quantity）需在 VariantEditor 中可見
4. 具體命名需老闆拍板（見 T106）

---

## 狀態

| # | 歸屬 | 優先 | 備註 |
|---|------|------|------|
| F1 | Fable 排包 | 🔴 體驗 bug | 兩行程式碼修復，快 |
| F2 | Fable 排包 | 🟡 體驗升級 | 事件串接，中等 |
| F3 | Fable 排包 | 🟡 功能新增 | 需老闆確認刪除語義 |
| F4 | Fable + 老闆 | 🟡 命名決策 | 與 T106 合併處理 |
