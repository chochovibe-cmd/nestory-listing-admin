# UX-W：結果卡片與審核流 UX 優化（Result Card & Review Flow）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：ResultCard.tsx、DraftResultsPanel.tsx、globals.css

---

## T86 — ResultCard Tab 切換缺少動態過渡

### 問題
ResultCard 有多個 tab（文案/圖片/規格/匯出等），切換時內容直接跳換，沒有任何過渡動畫。
在快速審核多張卡片時，使用者容易「看花」，分不清內容是否真的切換了。

### 設計規格

| 屬性 | 值 |
|---|---|
| Tab 內容切換 | fade-in animation, 120ms ease-out |
| Tab 指示條 | 底部 2px accent 色條，使用 `transform: translateX()` 滑動動畫 200ms |

```css
.rc-tab-body {
  animation: tab-fade 120ms ease-out;
}
@keyframes tab-fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.rc-tab-btn.active::after {
  content: '';
  position: absolute;
  bottom: -1px;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--accent);
  border-radius: 1px;
  transition: transform 200ms ease;
}
```

#### 狀態清單
- inactive tab：無底線
- active tab：accent 底線 + 內容 fade-in
- hover（非 active）：color `var(--accent)`, 底線半透明
- disabled tab：opacity 0.4, cursor default

#### 三主題 accent 色
| 主題 | --accent |
|---|---|
| dark | #c8ff00 |
| nordic | #58a9dc |
| kitty | #ff6a00 |

#### 驗收清單
- [ ] Tab 切換有 fade 動畫
- [ ] active tab 底部有 accent 色條
- [ ] 三主題底線色正確
- [ ] 動畫不阻擋快速連續切換

---

## T87 — DraftResultsPanel 排序選擇器視覺不明顯

### 問題
`DraftResultsPanel` 有排序功能（`RESULT_SORT_OPTIONS`），但排序 UI 在視覺上跟篩選 pill 混在一起，
新用戶很難發現「可以排序」這個功能。

### 設計規格

排序 selector 獨立視覺區分：

| 元素 | 規格 |
|---|---|
| 位置 | 篩選 pill 列右側，用 `margin-left: auto` 推到最右 |
| 圖示 | ↕ 排序箭頭 icon（CSS 或 unicode ⇅），放在文字左側 |
| 文字 | 當前排序名稱，font-size 12px, color `var(--text-muted)` |
| 互動 | 點擊展開下拉選單 or 循環切換 |
| hover | color → `var(--text)`, 排序圖示 color → `var(--accent)` |

#### 驗收清單
- [ ] 排序控件明顯可見，與篩選 pill 視覺區分
- [ ] 當前排序模式有文字顯示
- [ ] hover 有視覺回饋

---

## T88 — 長文案內容在卡片內無截斷保護

### 問題
ResultCard 的文案 tab 顯示完整文案內容，當文案很長時卡片被撐得非常高，
破壞列表的整體節奏感，也讓上下滾動距離過大。

### 設計規格

| 屬性 | 值 |
|---|---|
| `.rc-tab-body`（文案 tab） | max-height: 320px; overflow-y: auto |
| 滾動條 | scrollbar-width: thin |
| 底部 fade | 用 `::after` pseudo-element 做 gradient mask，高 32px |

```css
.rc-tab-body--copy {
  max-height: 320px;
  overflow-y: auto;
  scrollbar-width: thin;
  position: relative;
}
.rc-tab-body--copy::after {
  content: '';
  position: sticky;
  bottom: 0;
  display: block;
  height: 32px;
  background: linear-gradient(transparent, var(--surface));
  pointer-events: none;
}
```

#### 三主題影響
gradient 末端色用 `var(--surface)`：
| 主題 | --surface |
|---|---|
| dark | #141418 |
| nordic | #fffdf6 |
| kitty | #ffffff |

#### 手機版
max-height 縮為 240px。

#### 驗收清單
- [ ] 長文案被截斷在 320px 高度內
- [ ] 可滾動查看全部
- [ ] 底部有 fade gradient 暗示「還有更多」
- [ ] 短文案不顯示 fade（內容沒超出時 ::after 不遮擋）
- [ ] 三主題 gradient 色正確

---

## T89 — 批次審核流缺少進度指示

### 問題
`SequentialReviewOverlay` 提供連續審核模式，但沒有顯示「第 3 / 12 件」的進度，
使用者不知道還剩多少件要審。

### 設計規格

在 overlay header 加入進度條：

| 元素 | 規格 |
|---|---|
| 進度文字 | 「3 / 12」, font-size 13px, color `var(--text-muted)`, 放在 header 右側 |
| 進度條 | height 3px, width 100%, background `var(--surface2)` |
| 進度條填充 | background `var(--accent)`, width = 百分比, border-radius 2px |
| transition | width 200ms ease |
| 位置 | header 下方，與內容之間 |

#### 三主題影響
- 進度條 track：`var(--surface2)` 各主題自動
- 進度條 fill：`var(--accent)` 各主題自動

#### 驗收清單
- [ ] 連續審核時右上角顯示「N / M」
- [ ] 進度條隨審核推進
- [ ] 三主題顏色正確
- [ ] 完成最後一件時進度條 100%
