# UX-AE：進階打磨 + 流程體驗（2026-07-19 第三輪）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **範圍**：sidebar 動態、上傳進度、Dashboard 跳轉 highlight、中斷 badge、FAB 擴展
> **前置發現**：C2（圖片對比滑桿）和 C3（IP 排行進度條）查核後已存在，不需重做

---

## 已存在（不需出包）

| 原始編號 | 項目 | 發現 |
|----------|------|------|
| C2 | 圖片審核 before/after 滑桿 | `src/components/review/ImageCompareSlider.tsx` 已完整實作（D5 + BX9 lightbox） |
| C3 | 儀表板 IP 排行進度條 | `dash-funnel-bar-track/fill` 已實作（globals.css L3357-3376） |
| B3 部分 | Dashboard → 跳頁 | `prepareTodoNavigation()` + `onCardClick()` 已有 sessionStorage 帶 stage filter 跳轉 |

---

## T131 — Sidebar active 滑動指示器

### 問題

目前 `.sidebar-item.active` 只有背景色切換（`background: var(--accent)`），沒有過渡動畫。切頁時 active 瞬間跳到新項目，缺乏空間連續感。

### 規格

**方案：CSS transition on background + pill shape 平滑過渡**

```css
/* T131: sidebar active 平滑過渡 */
.sidebar-item {
  transition: background .2s ease, color .2s ease, box-shadow .2s ease;
}
```

只需一行 transition 加在現有 `.sidebar-item` 區塊（約 L330 附近）。原本 `background: none` → `background: var(--accent)` 會自然 fade in。

**進階（可選）**：如果想要 sliding pill（active 背景跟隨移動），需用 JS 計算 `translateY` + absolute positioned pseudo element。但風險大（sidebar 有收合/展開態），建議先只做 transition，效果已足夠。

### 驗收

- [ ] 切換側欄項目時 active 背景有 0.2s 淡入淡出
- [ ] 收合態（icon only）同樣有效
- [ ] 展開態（icon + label）同樣有效
- [ ] 三主題確認
- [ ] 不新增 `!important`

---

## T132 — 圖片上傳進度環（conic-gradient）

### 問題

目前上傳中的圖片 thumbnail 只有半透明覆蓋層 + 文字「上傳中…」（`.pthumb-status-overlay`），沒有進度視覺。使用者不知道上傳到什麼程度。

### 根因

`ImageUploader.tsx` L442: `status: "uploading"` — 但沒有 progress percentage。Supabase storage upload 的 `onUploadProgress` 回呼可提供百分比。

### 規格

**分兩層**：

**第一層（純 CSS 美化，不需 progress 數據）— 本批做**：

把「上傳中…」覆蓋改為旋轉環形動畫：

```css
/* T132: upload ring animation (indeterminate) */
.pthumb-status-overlay {
  /* 保持現有定位 */
  background: conic-gradient(
    var(--accent) 0deg,
    var(--accent) 90deg,
    color-mix(in srgb, var(--surface) 72%, transparent) 90deg
  );
  -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
  animation: uploadSpin .8s linear infinite;
  color: transparent; /* 隱藏「上傳中…」文字，改用純環 */
  font-size: 0;
}
@keyframes uploadSpin {
  to { transform: rotate(360deg); }
}
```

**注意**：
- 保持 `.pthumb-status-fail` 不變（失敗用文字+紅色）
- `mask` 打洞成環形（外圓 - 內圓 = 4px 環）
- 不確定進度 → 旋轉動畫（indeterminate）

**第二層（需 JS + progress %）— 未來做**：
- `onUploadProgress` 回呼拿 percentage
- 改 conic-gradient 角度為 `${pct * 3.6}deg`
- 這層歸 Fable 排程（需碰上傳邏輯）

### 驗收

- [ ] 上傳中的 thumbnail 顯示旋轉環（不是文字覆蓋）
- [ ] 環色 = `--accent`
- [ ] 上傳完成 → overlay 消失（已有邏輯）
- [ ] 失敗 → 仍顯示「失敗」紅字（`.pthumb-status-fail` 不被覆蓋）
- [ ] 三主題確認

---

## T133 — Dashboard 跳轉後 highlight 目標卡片

### 問題

Dashboard Todo card 點擊已能跳轉到對應 station（`prepareTodoNavigation` 寫 sessionStorage → `/drafts/new?pane=results` 帶 stage filter）。但到達後沒有 highlight 告訴使用者「這就是你要看的」。

### 規格

**方案：到達後第一張卡片加入 pulse highlight 動畫（3 秒後消失）**

CSS：
```css
/* T133: arrival highlight for jump-target card */
.result-card.is-jump-target {
  animation: jumpPulse 1.5s ease 2;
}
@keyframes jumpPulse {
  0%, 100% { box-shadow: var(--frame-shadow); }
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 35%, transparent); }
}
```

TSX（`DraftResultsPanel.tsx`）：
- 讀 sessionStorage 的 `jumpDraftId`（如果有）
- 對該 draftId 的卡片加 `is-jump-target` class
- 3 秒後移除（或用 `onAnimationEnd`）
- scrollIntoView({ behavior: "smooth", block: "center" })

### 驗收

- [ ] 從 Dashboard 點 Todo card → 到 Results panel 後目標卡片有 pulse glow
- [ ] 3 秒後 glow 消失
- [ ] 卡片自動 scroll 到視窗中央
- [ ] 三主題確認（pulse 用 `--accent`）

---

## T134 — QuickPreview「中斷」badge

### 問題

使用者生成到一半關頁面，再回來時 QuickPreview 的「未完成草稿」chip 沒有視覺提示哪些是被中斷的。

### 規格

**判斷條件**：`pipeline_stage = 'generating'` 且 `updated_at` 超過 2 分鐘（= 超時中斷）

CSS：
```css
/* T134: interrupted badge on quick-preview chip */
.queue-chip.is-interrupted::before {
  content: '⚠';
  font-size: 9px;
  color: var(--warn);
}
```

TSX（`QuickPreviewPanel.tsx`）：
- 在 `buildJumpStripGroups` 或渲染 chip 時，判斷 `item.pipeline_stage === 'generating'` 且 `Date.now() - new Date(item.updated_at).getTime() > 120_000`
- 為這些 chip 加 `is-interrupted` class

### 驗收

- [ ] 超時中斷的草稿 chip 前面出現 ⚠ 標記
- [ ] 正常的 chip 不受影響
- [ ] 三主題確認（warn 色）
- [ ] ⚠ 不會讓 chip 寬度爆掉（inline, gap 足夠）

---

## T135 — 手機 FAB long-press 擴展選單

### 問題

手機底部 tabbar 的 FAB（＋新增）目前只是 Link 跳轉 `/drafts/new`。老闆想要 long-press 展開多選項（新增/掃碼/貼連結）。

### 規格

**方案**：long-press（500ms）→ 向上展開 3 個 mini action

CSS：
```css
/* T135: FAB expand menu (mobile only, inside @media <960px) */
.mtb-fab-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  gap: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity .15s ease, transform .15s ease;
  transform: translateX(-50%) translateY(8px);
}
.mtb-fab-menu.open {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(-50%) translateY(0);
}
.mtb-fab-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  box-shadow: var(--shadow-m);
  min-height: 44px;
}
```

TSX（`MobileTabbar.tsx`）：
- FAB `<Link>` → 改為 `<button>` + `onTouchStart`/`onTouchEnd`/`onClick`
- 短按（<500ms）→ 跳轉 `/drafts/new`（保持現有行為）
- 長按（≥500ms）→ 展開 `.mtb-fab-menu`
- 選項：
  1. 「✦ 新增商品」→ `/drafts/new`
  2. 「📋 貼連結」→ `/drafts/new?mode=paste`（或 focus 到 URL 欄位）
  3. 「📷 從相簿」→ trigger file input（如果有 camera/photo upload flow）

**簡化方案（如功能面還沒齊）**：只做 UI 骨架（3 個按鈕），後兩個 disable 或 coming soon tag。先確立互動模式。

### 注意

- 需要 backdrop click/touchEnd outside → close menu
- 需要 `aria-expanded` + focus trap
- 桌面版不適用（桌面版 sidebar 有獨立「新增」entry）
- 只在 `@media (max-width: 960px)` 生效

### 驗收

- [ ] 短按 FAB → 正常跳轉新增頁（regression check）
- [ ] 長按 FAB → 展開向上彈出選單
- [ ] 選單有 fade-in + slide-up 動畫
- [ ] 點選單外區域 → 收合
- [ ] 三選項各自跳轉正確（或 disabled）
- [ ] 三主題確認

---

## T136 — 選品情報頁佈局骨架

### 問題

`/scouting` 目前是 `<ComingSoonPage>` 佔位。Mockup 有完整的 merchant-strip + scout-card + pocket-add 設計。

### 規格

**本批只做 UI 骨架（static layout + empty state），不做數據邏輯**

CSS（直接參考 mockup L451-467 token 值）：
```css
/* T136: scouting page layout skeleton */
.scout-page-title {
  font-family: var(--font-space-grotesk), 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  gap: 10px;
}
.merchant-strip {
  display: flex;
  gap: 7px;
  flex-wrap: wrap;
  margin-bottom: 16px;
}
.merchant-chip {
  display: flex;
  align-items: center;
  gap: 7px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 7px 14px;
  font-size: 11.5px;
  box-shadow: var(--shadow-s);
}
.pocket-add {
  display: flex;
  gap: 7px;
  margin-bottom: 11px;
}
.pocket-add input {
  flex: 1;
}
.pocket-add button {
  flex-shrink: 0;
  background: var(--accent);
  color: var(--accent-fg);
  border: none;
  border-radius: var(--radius-s);
  padding: 0 17px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: var(--shadow-s);
  min-height: 42px;
}
.scout-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-m);
  padding: 13px 15px;
  margin-bottom: 10px;
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  box-shadow: var(--shadow-s);
}
.scout-thumb {
  width: 52px;
  height: 52px;
  border-radius: 11px;
  border: 1px solid var(--border);
  background: var(--surface2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  flex-shrink: 0;
}
.scout-body {
  flex: 1;
  min-width: 170px;
}
.scout-title {
  font-size: 12.5px;
  font-weight: 700;
}
.scout-meta {
  font-size: 10.5px;
  color: var(--text-muted);
  word-break: break-all;
}
```

TSX（`src/app/scouting/page.tsx`）：
- 移除 `<ComingSoonPage>`
- 放入 static layout：page title + empty merchant-strip + pocket-add input + 空狀態
- 空狀態文字：「新增商家連結，系統會自動追蹤新品」
- 功能邏輯留給 Phase F

### 驗收

- [ ] `/scouting` 不再顯示「即將推出」
- [ ] 顯示 page title + 輸入欄 + 空狀態
- [ ] 三主題確認
- [ ] 手機版堆疊正常
- [ ] 按鈕 disabled（功能未接）

---

## 建議發包順序

```
第十三批（輕量 CSS）：T131 + T132（sidebar 過渡 + 上傳環）→ 10 分鐘
第十四批（中度 TSX）：T133 + T134（Dashboard highlight + 中斷 badge）→ 20 分鐘
第十五批（較大 TSX）：T135 + T136（FAB 擴展 + 選品骨架）→ 45-60 分鐘
```

---

## ⚠ 備註

- T132 的「第二層」（真實 progress %）歸 Fable 排程（需碰 Supabase upload 邏輯）
- T133 需確認 `sessionStorage` key 與 `prepareTodoNavigation` 一致
- T135 把 FAB 從 `<Link>` 改 `<button>` 是破壞性改動，需特別注意短按行為 regression
- T136 是 UI 骨架 only，Phase F 的數據邏輯不在此包
- 所有改動不觸碰系統邏輯 / prompt / SQL
- 禁止新增 `!important`
