# UX-X：儀表板與全站流程優化（Dashboard & Flow Optimization）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：DashboardTodoPanel.tsx、WorkbenchPageClient.tsx、全站流程分析

---

## T90 — Dashboard 載入態缺少骨架屏

### 問題
`DashboardTodoPanel` 有 `loading` 狀態但只顯示 Suspense fallback 的「載入中…」文字。
儀表板有 5 個區塊（待辦/漏斗/Make額度/月預算/健康指標），全部等 loading 完才一次出現，
使用者看到長時間空白 → 猛然全部彈出，體感很慢。

### 設計規格

骨架屏（Skeleton）pattern：

| 元素 | 規格 |
|---|---|
| class | `.skeleton` |
| background | `var(--surface2)` |
| 動畫 | shimmer 左→右掃光效果，1.5s infinite |
| border-radius | `var(--radius-s)` |

```css
.skeleton {
  background: var(--surface2);
  border-radius: var(--radius-s);
  overflow: hidden;
  position: relative;
}
.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(
    90deg,
    transparent 0%,
    color-mix(in srgb, var(--text) 5%, transparent) 50%,
    transparent 100%
  );
  animation: skeleton-shimmer 1.5s ease infinite;
}
@keyframes skeleton-shimmer {
  from { transform: translateX(-100%); }
  to { transform: translateX(100%); }
}
```

各區塊骨架尺寸：

| 區塊 | 骨架形狀 |
|---|---|
| 待辦卡片 | 3 張 80px 高矩形 + 間距 |
| 漏斗 | 5 列 bar 遞減寬度 |
| Make 額度 | 1 張 120px 高矩形 |
| 月預算 | 1 張 100px 高矩形 |
| 健康指標 | 2×2 格 60px 正方形 |

#### 三主題影響
- shimmer 光線用 `color-mix(in srgb, var(--text) 5%, transparent)`
  - dark：微白光
  - nordic/kitty：微黑光
- 底色 `var(--surface2)` 三主題自動適配

#### 驗收清單
- [ ] Dashboard 載入中顯示骨架屏而非純文字
- [ ] 骨架屏有 shimmer 動畫
- [ ] 資料載入完成後骨架屏平滑切換為真實內容
- [ ] 三主題 shimmer 色調正確

---

## T91 — Workbench 三區佈局缺少拖拽調整

### 問題（記錄用，不建議目前修）
WorkbenchPageClient 的三區（input / quickPreview / results）用固定 CSS 寬度。
專業用戶可能想調整區域比例（例如縮小快速預覽、放大輸入區）。

### 規格
**此項標為 P3 低優先**——拖拽 resize 涉及較多互動邏輯，建議等核心流程穩定後再排。
如果實施，建議使用 CSS `resize` property 搭配 `min-width` / `max-width` 限制。

#### ⚠ 備註
不產出具體實施規格，僅記錄為未來優化方向。

---

## T92 — 新增商品流程缺少步驟指示

### 問題
WorkspaceInputPanel 是一個長表單，新用戶第一次使用時不清楚：
1. 應該先填什麼？
2. 有哪些必填？
3. 填完之後下一步是什麼？

### 設計規格

在 WorkspaceInputPanel 頂部加入步驟引導條：

```
[1 填入資料] ─── [2 AI 生成] ─── [3 確認發布]
```

| 元素 | 規格 |
|---|---|
| 容器 class | `.step-indicator` |
| 佈局 | flex, justify-content: space-between, align-items: center |
| 步驟圓圈 | 24px 圓形, border `var(--frame-w) solid var(--border)`, font-size 11px |
| 當前步驟 | 圓圈 background `var(--accent)`, color `var(--accent-fg)` |
| 已完成步驟 | 圓圈 background `var(--success)`, color `var(--on-solid)`, 打勾 ✓ |
| 未到步驟 | 圓圈 background transparent, color `var(--text-muted)` |
| 連接線 | height 2px, flex-grow 1, background `var(--border)` |
| 已通過連接線 | background `var(--success)` |
| 步驟文字 | font-size 11px, color `var(--text-muted)`, 圓圈下方 margin-top 4px |

#### 狀態清單
| 步驟 | 觸發條件 |
|---|---|
| 1 active | 表單正在填寫 |
| 1 done → 2 active | 按下「生成」按鈕後 |
| 2 done → 3 active | AI 結果出來，進入審核 |
| 全部 done | 發布完成 |

#### 三主題影響
- accent / success / border / text-muted 全部使用 token，自動適配
- kitty 的 accent (#ff6a00) 在圓圈內很醒目 ✅
- nordic 的 accent (#58a9dc) 在淡背景上需確保對比度 ≥ 3:1 ✅（#58a9dc on #fffdf6 ≈ 3.2:1）

#### 手機版
- 三步驟橫排，文字隱藏只保留圓圈 + 數字
- 觸控目標 44px（圓圈 24px + padding 10px each side）

#### 驗收清單
- [ ] 表單頂部有三步驟指示條
- [ ] 當前步驟高亮
- [ ] 三主題色值正確
- [ ] 手機版只顯示圓圈

---

## T93 — 手機版 WorkbenchMobileShell tab 切換缺動畫

### 問題
手機版 Workbench 在三個 tab（input/quickPreview/results）間切換，
內容直接跳換沒有過渡動畫，體感生硬。

### 設計規格

| 屬性 | 值 |
|---|---|
| 切換動畫 | slide + fade, 200ms ease-out |
| 左→右 tab | 新內容從右滑入 |
| 右→左 tab | 新內容從左滑入 |

```css
.workbench-mobile-body {
  overflow: hidden;
}
.workbench-mobile-tab-enter {
  animation: slide-in-right 200ms ease-out;
}
.workbench-mobile-tab-enter-reverse {
  animation: slide-in-left 200ms ease-out;
}
@keyframes slide-in-right {
  from { opacity: 0; transform: translateX(24px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes slide-in-left {
  from { opacity: 0; transform: translateX(-24px); }
  to { opacity: 1; transform: translateX(0); }
}
```

#### 注意
- `prefers-reduced-motion: reduce` → 關閉此動畫
- 不影響桌機佈局（桌機是三欄同時顯示）

#### 驗收清單
- [ ] 手機版 tab 切換有滑動動畫
- [ ] 方向正確（左tab→右tab = 從右滑入）
- [ ] reduced-motion 時無動畫
