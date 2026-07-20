# UX-AF：全面體驗打磨（2026-07-20 第四輪）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-20
> **範圍**：微互動完善、視覺一致性、無障礙、錯誤體驗、流程引導
> **方法**：不參考 Mockup，以專業 UIUX 設計師視角重新審視整個產品

---

## 設計哲學

這輪聚焦三個使用者感知層面：
1. **觸感（Tactile）**：每個互動都要有即時、自然的回饋
2. **安全感（Safety）**：錯誤不該嚇人，載入不該迷路
3. **引導感（Guidance）**：介面自己會說話，減少「我該按哪裡」的疑惑

---

## T137 — Input focus 光暈淡入

### 問題
文字欄位 focus 時，`box-shadow`（accent 光暈）瞬間跳出，與 `border-color` 的 `.2s` transition 不一致。視覺上像閃爍而非聚焦。

### 規格

```css
/* T137: focus ring 與 border 同步淡入 */
/* 修改 globals.css 約 L1167 */
/* 原本：transition: border-color .2s; */
/* 改為： */
input,
textarea,
select {
  transition: border-color .2s, box-shadow .2s;
}
```

只改一行，加 `box-shadow .2s`。

### 驗收
- [x] focus 時光暈 0.2s 淡入（不是瞬間出現）— 程式 2026-07-20 第十六批
- [x] blur 時光暈 0.2s 淡出
- [x] 三主題確認（token 路徑）
- [x] 不影響 `.field.error` 狀態（T138 更高 specificity）
- [ ] **待 Claude 核畫面**

---

## T138 — 錯誤欄位紅色光暈

### 問題
`.field.error input` 只有紅框（`border-color: var(--accent2)`），沒有光暈。正常 focus 有光暈、錯誤卻沒有，視覺不對稱。錯誤應該比正常更強烈。

### 規格

```css
/* T138: error 欄位加紅色光暈 */
.field.error input,
.field.error textarea,
.field.error select {
  border-color: var(--accent2);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent2) 14%, transparent);
}
```

### 驗收
- [x] 有 `.field.error` 的欄位出現淡紅光暈 — 程式 2026-07-20 第十六批
- [x] focus 時仍保持紅色（`.field.error input` 0,2,1 > `input:focus` 0,1,1）
- [x] 三主題確認（`--accent2` token）
- [x] 光暈也跟著 T137 的 transition 淡入
- [ ] **待 Claude 核畫面**

---

## T139 — Modal 進場動畫

### 問題
Modal 打開時瞬間出現，沒有任何過渡。感覺像「跳出來嚇人」，不像「被邀請出場」。

### 規格

**桌面版**：

```css
/* T139: modal 淡入 + 微縮放 */
.modal-box {
  animation: modalIn .18s ease;
}
@keyframes modalIn {
  from {
    opacity: 0;
    transform: scale(0.97) translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

**手機版**（`@media max-width: 959px`）：

```css
/* T139: 手機底部抽屜滑入 */
.modal-box {
  animation: sheetUp .22s ease;
}
@keyframes sheetUp {
  from {
    transform: translateY(30px);
    opacity: 0.6;
  }
  to {
    transform: none;
    opacity: 1;
  }
}
```

### 驗收
- [x] 桌面：modal 有輕微縮放 + 淡入（0.18s）— 程式 2026-07-20 第十七批
- [x] 手機：modal 從底部滑入（0.22s）— 程式 2026-07-20 第十七批
- [x] 連續開關不卡頓 — 純 CSS animation，無 JS 狀態
- [x] Sequential Review overlay 不受影響（`.seq-review-box { animation: none }`）
- [ ] **待 Claude 核畫面**

---

## T140 — Dark 主題陰影加深

### 問題
Dark 模式的 `--shadow-s` 和 `--shadow-m` 太淡（`.16` 和 `.18`），暗色背景上卡片幾乎沒有深度感，整個畫面像平的。

### 規格

```css
/* T140: dark 陰影加深（目前 L65-66） */
:root,
body[data-theme="dark"] {
  --shadow-s: 0 1px 4px rgba(0, 0, 0, .30);
  --shadow-m: 0 4px 18px rgba(0, 0, 0, .38);
}
```

原本：`.16` / `.18` → 改為 `.30` / `.38`。不到 mockup 的 `.35` / `.45`（太重），取中間值。

### 注意
- 這改的是 dark 主題的 CSS 變數，nordic/kitty 不受影響
- 所有用 `var(--shadow-s/m)` 的元件自動跟著變
- 需要在 dark 主題下確認：卡片、modal、dropzone、toast 都不會太重

### 驗收
- [x] dark 模式卡片有明顯深度 — 程式 2026-07-20 第十七批（.30 / .38）
- [x] 不會太重（不像浮在空中）— 取中間值（非 mockup .35/.45）
- [x] nordic/kitty 不受影響 — 僅改 `:root`/dark 區塊
- [x] modal 的 shadow-m 自然 — token 路徑
- [ ] **待 Claude 核畫面**

---

## T141 — 風格卡 hover 微上浮

### 問題
`.tone-card` hover 時只變色，沒有 micro-lift。其他按鈕（`.act-btn`、`.result-card`）hover 都有 `translateY(-1px)`，風格卡是唯一沒有的可點擊卡片。

### 規格

```css
/* T141: tone-card hover lift（修改現有 hover 規則） */
.tone-card:hover {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface2));
  box-shadow: var(--control-shadow);
  transform: translateY(-1px);
}
```

只加一行 `transform: translateY(-1px)`。保持現有 `transition: all .2s` 已足夠。

### 驗收
- [x] hover 時輕微上浮 — 程式 2026-07-20 第十七批
- [x] active 狀態不上浮（`.tone-card:hover` 獨立規則加 transform）
- [x] 三主題確認（token 路徑）
- [ ] **待 Claude 核畫面**

---

## T142 — 水平捲軸 + 捲軸圓角

### 問題
目前只設定 `width:4px`（垂直），水平捲軸（`.rc-tabs` 等 `overflow-x: auto` 區域）仍用瀏覽器預設粗條。捲軸 thumb 也缺圓角。

### 規格

```css
/* T142: 水平捲軸高度 + thumb 圓角 */
::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}
::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 3px;
}
```

### 驗收
- [x] 水平溢出區 scrollbar 細而圓 — 程式 2026-07-20 第十六批
- [x] 垂直 scrollbar 不受影響（width 仍 4px）
- [x] 三主題確認（thumb 仍走既有 kitty/nordic override）
- [ ] **待 Claude 核畫面**

---

## T143 — prefers-reduced-motion 無障礙降級

### 問題
多個動畫缺乏 `prefers-reduced-motion` 降級：`uploadSpin`、`toast-in`、`spinStatus`、`arm-shake`。有前庭敏感的使用者會不舒服。

### 規格

```css
/* T143: 無障礙動畫降級（放在檔案末尾，統一管理） */
@media (prefers-reduced-motion: reduce) {
  .pthumb-status-overlay,
  .gen-dot.running,
  .brand-dot,
  .arm-shake-trigger {
    animation-duration: 0s;
  }
  .toast {
    animation: none;
  }
}
```

已有 `prefers-reduced-motion` 的動畫（`page-enter`、`brand-pulse`、`rc-tab-fade`）不需再加。

### 驗收
- [ ] 開啟系統「減少動態效果」後，旋轉環停止旋轉（但仍顯示靜態環）
- [ ] toast 不滑入（直接出現）
- [ ] 品牌圓點不閃爍
- [ ] 頁面切換等有用的過渡不受影響

---

## T144 — Dropzone hover 微放大

### 問題
拖曳區 hover 只變框線，缺乏「歡迎你放進來」的邀請感。

### 規格

```css
/* T144: dropzone hover 微放大（改現有規則） */
.dropzone:hover {
  border-color: var(--accent);
  border-style: solid;
  transform: scale(1.005);
  box-shadow: var(--shadow-s);
}
```

加 `transform: scale(1.005)` + `box-shadow`。scale 比 mockup 的 `1.006` 略小，更含蓄。

需在 `.dropzone` 加 `transition: border-color .15s, transform .15s, box-shadow .15s;`（如果沒有的話）。

### 驗收
- [x] hover 有微微放大 + 陰影加深 — 程式 2026-07-20 第十七批
- [x] 離開後回彈自然 — transition 0.15s
- [x] 手機版不影響（touch 沒有 hover）
- [ ] **待 Claude 核畫面**

---

## T145 — 圖片 thumbnail 拖曳回饋

### 問題
拖曳 thumbnail 時只換 cursor 為 `grabbing`，沒有視覺回饋告訴使用者「你正在抓著它」。

### 規格

```css
/* T145: thumbnail 抓取回饋 */
.pthumb-img:active {
  transform: scale(1.06);
  box-shadow: var(--shadow-m);
  cursor: grabbing;
  z-index: 10;
}
```

### 驗收
- [x] 長按/拖曳 thumbnail 時放大 + 陰影加深 — 程式 2026-07-20 第十七批
- [x] 放開後回彈 — :active 偽類
- [x] 不影響拖曳排序功能 — 僅視覺 transform/shadow
- [ ] **待 Claude 核畫面**

---

## T146 — Error boundary 全域錯誤攔截

### 問題
整個 app 沒有任何 `error.tsx`。如果任何頁面元件 throw，使用者看到的是 Next.js 預設錯誤頁（白底紅字，完全脫離品牌）。

### 規格

新增 `src/app/error.tsx`（client component）：

```tsx
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="empty-state" style={{ padding: "48px 24px" }}>
      <div className="empty-icon" aria-hidden>⚠️</div>
      <p className="empty-state-title">發生了預期外的錯誤</p>
      <p className="empty-state-desc">
        {error.message || "系統暫時無法處理這個請求"}
      </p>
      <button
        className="button"
        onClick={() => reset()}
        type="button"
      >
        重新載入
      </button>
    </div>
  );
}
```

用現有的 `.empty-state` 樣式，不需新增 CSS。品牌內的錯誤頁，不是白底紅字。

### 驗收
- [ ] 任何頁面 throw error 時顯示品牌內錯誤頁
- [ ] 「重新載入」按鈕能 reset
- [ ] 三主題確認
- [ ] 不影響現有的 per-component error handling

---

## T147 — 缺頁面的 loading skeleton

### 問題
`/dashboard`、`/review`、`/records`、`/settings` 沒有 `loading.tsx`，Suspense fallback 只有一行文字「載入中...」。使用者在慢網路會看到空白頁閃過。

### 規格

為以下路由新增 `loading.tsx`，用現有 `.skel` 骨架動畫：

**`src/app/dashboard/loading.tsx`**：
```tsx
export default function Loading() {
  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <div className="skel" style={{ width: 120, height: 20, marginBottom: 16 }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 11 }}>
        {Array.from({ length: 5 }, (_, i) => (
          <div className="skel" key={i} style={{ height: 90, borderRadius: "var(--radius-m)" }} />
        ))}
      </div>
    </div>
  );
}
```

**`src/app/review/loading.tsx`**：
```tsx
export default function Loading() {
  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <div className="skel" style={{ width: 100, height: 20, marginBottom: 16 }} />
      <div className="skel" style={{ height: 200, borderRadius: "var(--radius-m)", marginBottom: 13 }} />
      <div className="skel" style={{ height: 200, borderRadius: "var(--radius-m)" }} />
    </div>
  );
}
```

**`src/app/records/loading.tsx`**：
```tsx
export default function Loading() {
  return (
    <div className="container" style={{ maxWidth: 900, paddingBottom: 48 }}>
      <div className="skel" style={{ width: 100, height: 20, marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {Array.from({ length: 4 }, (_, i) => (
          <div className="skel" key={i} style={{ width: 70, height: 32, borderRadius: 999 }} />
        ))}
      </div>
      <div className="skel" style={{ height: 120, borderRadius: "var(--radius-m)", marginBottom: 11 }} />
      <div className="skel" style={{ height: 120, borderRadius: "var(--radius-m)" }} />
    </div>
  );
}
```

`/settings` 已有 Suspense fallback 且結構簡單（accordion），不需額外 loading.tsx。

### 驗收
- [ ] 各頁面首次載入時顯示骨架而非空白
- [ ] 骨架動畫平滑（已有 `.skel` pulse）
- [ ] 三主題確認（`.skel` 用 `--surface2`）

---

## T148 — Modal overlay 點擊提示

### 問題
Modal 背景（overlay）可以點擊關閉，但 cursor 是預設箭頭，使用者不知道可以點。

### 規格

```css
/* T148: modal overlay 可點擊提示 */
.modal-overlay {
  cursor: pointer;
}
.modal-box {
  cursor: default;
}
```

### 驗收
- [x] 點 overlay 區域時 cursor 是手指 — 程式 2026-07-20 第十六批
- [x] modal 內容區 cursor 正常（箭頭）— `.modal-box { cursor: default }`
- [x] 不影響 modal 內的其他 interactive 元素（button/link 自有 cursor）
- [ ] **待 Claude 核畫面**

---

## T149 — Skeleton loading.tsx 缺頁補齊（scouting）

### 問題
`/scouting` 是 server component，重新訪問時沒有 loading state（雖然目前內容是靜態的，但 auth guard 需要 Supabase 往返）。

### 規格

**`src/app/scouting/loading.tsx`**：
```tsx
export default function Loading() {
  return (
    <div className="container scout-page">
      <div className="skel" style={{ width: 120, height: 20, marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 7, marginBottom: 16 }}>
        <div className="skel" style={{ width: 100, height: 32, borderRadius: 999 }} />
        <div className="skel" style={{ width: 100, height: 32, borderRadius: 999 }} />
      </div>
      <div className="skel" style={{ height: 42, borderRadius: "var(--radius-s)", marginBottom: 11 }} />
    </div>
  );
}
```

### 驗收
- [ ] 訪問 `/scouting` 時有骨架閃過（如果有 auth latency）

---

## T150 — focus-visible 圓角

### 問題
`:focus-visible` 的 outline 是方角的，跟所有元素的圓角格格不入。

### 規格

```css
/* T150: focus outline 跟元素圓角（修改 L1196） */
:focus-visible {
  outline: 2px solid var(--accent) !important;
  outline-offset: 2px;
  border-radius: 6px;
}
```

加一行 `border-radius: 6px`。注意：這不會改變元素本身的圓角，只是讓 outline 的角變圓。在支援 `outline` 圓角的瀏覽器（Chrome 94+, Firefox 88+, Safari 16.4+）有效。

### 驗收
- [x] Tab 瀏覽時焦點框是圓角的 — 程式 2026-07-20 第十六批（`border-radius: 6px`）
- [x] 不影響已有圓角的元素（button, input 自身 radius 未改）
- [ ] **待 Claude 核畫面**

---

## T151 — 手機返回時的方向感

### 問題
手機版切換 tab 時有左右滑入動畫（T93 已做），但從子頁面返回主頁面時沒有任何過渡提示方向。使用者按「←返回」後畫面瞬間跳轉，失去空間感。

### 規格

CSS（在 `@media max-width: 960px` 區塊內）：

```css
/* T151: 手機版頁面進場淡入（不做方向，只做存在感） */
@media (max-width: 960px) {
  .shell-main > main {
    animation: mobilePageIn .2s ease;
  }
  @keyframes mobilePageIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: none; }
  }
}
```

不做左右方向判斷（太複雜且 Next.js App Router 不原生支持），只做淡入 + 微向上，製造「到了新地方」的存在感。

### 驗收
- [ ] 手機版切頁時有輕微淡入
- [ ] 桌面版不受影響
- [ ] 不與 WorkbenchMobileShell 的 tab slide 衝突

---

## T152 — 空狀態 CTA 一致性

### 問題
審核後發現各空狀態 CTA 風格不一致：
- DraftResultsPanel 用 `<Link className="empty-state-cta">`
- ImageReviewPanel 用 `<Link className="empty-state-cta">`
- PublishRecordsPanel 有些 tab 有 CTA 有些沒有
- DashboardTodoPanel 的「全部完成」沒有 CTA（只有文字）

「全部完成」應該是慶祝時刻，不是死路。

### 規格

**DashboardTodoPanel**：在「太棒了，沒有待處理項目」下加 CTA：

```tsx
<Link className="empty-state-cta button" href="/drafts/new">
  ✦ 新增下一件商品
</Link>
```

**PublishRecordsPanel `shopify_drafts` tab**（如果沒有 CTA）：確認已有（T129 應該做過）。

### 驗收
- [ ] Dashboard 待辦清空時有「新增下一件」按鈕
- [ ] 所有空狀態都有至少一個行動選項

---

## T153 — Toast 位置避開手機 tabbar

### 問題
Toast 固定在 `bottom: 84px`，但手機版 tabbar 高度 + safe area 可能讓 toast 被遮住或太近。

### 規格

```css
/* T153: toast 在手機版抬高（避開 tabbar + safe area） */
@media (max-width: 960px) {
  .toast {
    bottom: calc(90px + env(safe-area-inset-bottom));
  }
}
```

### 驗收
- [ ] 手機版 toast 不被 tabbar 遮住
- [ ] 桌面版 toast 位置不變

---

---

## 建議發包順序

```
第十六批（純 CSS 快打）：T137 + T138 + T142 + T148 + T150 → 5 行 CSS 改動，5 分鐘
第十七批（動畫組）：T139 + T140 + T141 + T144 + T145 → CSS 動畫，10 分鐘
第十八批（無障礙 + 手機體驗）：T143 + T151 + T153 → 10 分鐘
第十九批（TSX 結構）：T146 + T147 + T149 + T152 → 新增 error.tsx + loading.tsx + CTA，15 分鐘
```

---

## ⚠ 備註

- T137-T145、T148、T150-T153 全部是純 CSS，不碰系統邏輯
- T146 是新增 `error.tsx`，client component，不碰現有 error handling
- T147 + T149 是新增 `loading.tsx`，server component，不碰現有頁面
- T152 只加一個 `<Link>` CTA，不碰 dashboard 數據邏輯
- 所有改動禁止新增 `!important`（T150 用的是修改既有 !important 行）
- 所有改動只用現有 tokens
