# UX-T：全站可及性與觸控安全（Accessibility & Touch Safety）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：globals.css L4405–4411、login/page.tsx、Toast.tsx、AppSidebar.tsx

---

## T74 — Checkbox 手機觸控區域過小

### 問題
`.rc-checkbox` 固定 16×16px，遠低於 Apple HIG / WCAG 最低 44×44 觸控目標。
桌機滑鼠可接受，但手機上「選取單張圖片」「勾選草稿」都很難點中。

### 設計規格

| Token / 屬性 | 桌機值 | 手機值（≤960px） |
|---|---|---|
| `.rc-checkbox` width/height | 16px（不動） | 20px |
| `.rc-checkbox` 外層 padding（touch area wrapper） | 0 | 12px each side（= 44px touch target） |
| 實作方式 | — | 用 `::before` pseudo-element 擴充觸控區 position:absolute inset:-12px |

#### 狀態清單
- default：16px visible box
- hover (desktop)：border-color → `var(--accent)`, cursor: pointer
- focus-visible：`box-shadow: var(--focus-ring)`
- checked：現有打勾樣式不變
- disabled：opacity 0.5, cursor: default

#### 三主題影響
無差異——觸控區是 transparent 擴充，不影響 border/bg tokens。

#### 手機版注意
核心修改就在手機，確保 `::before` 層不遮擋相鄰互動元素（z-index: -1 或 pointer-events 穿透父層）。

#### 驗收清單
- [ ] 桌機 checkbox 視覺大小不變（16px）
- [ ] 手機上手指不精準點擊周圍 12px 內仍能觸發
- [ ] 三主題下外觀一致
- [ ] 不影響 `.queue-card .rc-checkbox` 的 z-index 層級

---

## T75 — 登入頁 Label 缺少 htmlFor 綁定

### 問題
`login/page.tsx` 的 `<label>Email</label>` 和 `<label>Password</label>` 沒有 `htmlFor`，
`<input>` 也沒有 `id`。螢幕閱讀器無法把 label 與 input 配對；點擊 label 文字不會自動聚焦 input。

### 設計規格

```
<label htmlFor="login-email">Email</label>
<input id="login-email" type="email" ... />

<label htmlFor="login-password">Password</label>
<input id="login-password" type="password" ... />
```

#### 狀態清單
- normal：label 可點擊，聚焦對應 input
- error：現有 `message` notice 不變
- submitting：disabled 狀態不變

#### 驗收清單
- [ ] 點擊 "Email" 文字 → email input 獲得 focus
- [ ] 點擊 "Password" 文字 → password input 獲得 focus
- [ ] 螢幕閱讀器朗讀 input 時報出 label 名稱

---

## T76 — Toast 鍵盤不可達

### 問題
`.toast-host` 設定 `pointer-events: none`，子 `.toast` 用 `pointer-events: auto` 讓滑鼠可點擊消除。
但 toast 是 `<button>`（可 tab 到），鍵盤用戶 tab 過去時 `pointer-events: none` 不阻擋 focus，
可是 **focus ring 不可見**（沒有 `:focus-visible` 規則），也沒有 Escape 鍵關閉。

### 設計規格

| 行為 | 目前 | 目標 |
|---|---|---|
| Tab 可達 | 技術上可，但無視覺 | 可，且顯示 focus ring |
| focus-visible 樣式 | 無 | `outline: 2px solid var(--accent); outline-offset: 2px;` |
| Escape 關閉 | 無 | 聚焦 toast 時按 Escape → 消除該 toast |
| role | 無（靠 aria-live） | 保留 aria-live="polite"，button role 不變 |

#### 三主題影響
focus ring 使用 `var(--accent)` → dark: #c8ff00, nordic: #58a9dc, kitty: #ff6a00。三主題皆有足夠對比。

#### 驗收清單
- [ ] Tab 到 toast 時有明顯 focus ring
- [ ] 按 Enter 或 Space → 消除 toast（現有 onClick 已處理）
- [ ] 按 Escape → 消除該 toast
- [ ] 三主題 focus ring 可見

---

## T77 — Sidebar 收合態圖示缺 Tooltip

### 問題
`AppSidebar.tsx` 收合時 label `opacity: 0`，圖示只有 `title={item.label}`。
瀏覽器原生 title tooltip 延遲約 1 秒、無法自訂樣式、手機完全看不到。

### 設計規格

| 屬性 | 值 |
|---|---|
| Tooltip 觸發 | 收合態（`.sidebar.collapsed`）hover/focus-visible |
| 位置 | 圖示右側 8px offset |
| 背景 | `var(--surface)` |
| 邊框 | `var(--frame-w) solid var(--border)` |
| 圓角 | `var(--radius-s)` |
| 陰影 | `var(--shadow-m)` |
| 文字 | `var(--text)`, font-size 12px, font-weight 600 |
| padding | 6px 10px |
| z-index | 1100（在 sidebar 800 之上，modal 1200 之下） |
| 動畫 | opacity 0→1, 80ms ease-out |
| 手機 | 不適用——手機無 sidebar 收合態 |

#### 狀態清單
- collapsed + hover → 顯示 tooltip
- collapsed + focus-visible → 顯示 tooltip
- expanded → 不顯示（label 已可見）
- mobile → sidebar 隱藏，不適用

#### 三主題色值
| 主題 | --surface | --border | --text |
|---|---|---|---|
| dark | #141418 | #2a2a38 | #f0edf8 |
| nordic | #fffdf6 | #1c1c1c | #1f1f1f |
| kitty | #ffffff | #171717 | #171717 |

#### 驗收清單
- [ ] 收合態 hover 每個圖示 → 顯示中文 label tooltip
- [ ] 展開態 → 無 tooltip
- [ ] 三主題色值正確
- [ ] tooltip 不超出視窗邊界

---

## T78 — 全站 body 缺少 Firefox scrollbar-width

### 問題
globals.css 有 `::-webkit-scrollbar` 自訂（L5096–5106），也在局部元素用了 `scrollbar-width: thin`，
但 `body` / `.shell-main` 沒有 `scrollbar-width: thin`，Firefox 用戶看到預設粗滾動條。

### 設計規格

```css
body,
.shell-main {
  scrollbar-width: thin;
  scrollbar-color: var(--border) transparent;
}
```

#### 三主題影響
`scrollbar-color` 使用 `var(--border)` → 三主題各自的 border 值，自動適配。

#### 驗收清單
- [ ] Firefox 主視窗 scrollbar 變窄
- [ ] 三主題下 scrollbar thumb 色 = 各主題 --border
- [ ] Chrome/Safari 現有 WebKit scrollbar 不受影響
