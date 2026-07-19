# UX-AD：視覺打磨＋流程體驗優化（2026-07-19 第二輪）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **範圍**：全站微交互打磨 + 卡片/空狀態/主題細節 + 批次操作動態回饋
> **分級**：🟢 快速打磨 / 🟡 中度提升

---

## 快速打磨批次（T122–T126）— 預估各 1-5 行 CSS

---

### T122 — 全站按鈕按壓微縮回饋

**問題**：Mockup 有 `button:active { transform:scale(.97) }`，但目前只有少數元件（`.pthumb:active`、`.dash-todo-card:active`）有按壓效果，全站多數按鈕點下去沒有觸覺回饋。

**規格**：

```css
/* T122: 全站按鈕按壓回饋（排除 disabled + 已有自定義 active 的元件） */
button:active:not(:disabled),
.act-btn:active:not(:disabled),
.mini-btn:active:not(:disabled),
.btn-mini:active:not(:disabled),
.hdr-btn:active:not(:disabled),
.nb-btn:active:not(:disabled) {
  transform: scale(0.97);
}
```

**注意**：
- 不加 `transition` 在 `:active` 上（按下瞬間要即時）
- 已有 `transition: transform .15s` 的元素放開時自然彈回
- `.btn-gen` 已有 hover 的 `translateY(-1px)`，按壓覆蓋是正確的（scale 取代 translateY）
- 不影響 `.pthumb:active` 等已有自定義的元素

**驗收**：
- [ ] 任意按鈕按下有 0.97 縮小感
- [ ] disabled 按鈕不觸發
- [ ] 放開後平滑回彈
- [ ] 不新增 `!important`

---

### T123 — 結果卡片 hover 微上移

**問題**：目前 `.result-card:hover:not(.active)` 只加了 box-shadow，沒有 mockup 的 `translateY(-1px)` 微浮效果。已有 token `--hover-transform: translateY(-1px)`。

**規格**：

```css
/* T123: 卡片 hover 微上移（利用已有 token） */
.result-card:hover:not(.active) {
  transform: var(--hover-transform);
}
```

在已有的 L5147 `.result-card:hover:not(.active)` 區塊裡加一行 `transform`。

**注意**：
- `.result-card` 已有 `transition: box-shadow .2s, border-color .2s, opacity .25s ease`，需在 transition 加 `transform .2s`
- `.result-card.active` 不應上移（已被 `:not(.active)` 排除）

**驗收**：
- [ ] 非展開卡片 hover 時微上移 1px + shadow 加深
- [ ] 展開中的 active 卡片不上移
- [ ] transition 平順
- [ ] 三主題確認

---

### T124 — Nordic 主題卡片陰影加強

**問題**：Nordic 的 `--shadow-s: 0 2px 0 rgba(28,28,28,.055)` 和 `--shadow-m: 0 3px 0 rgba(28,28,28,.065)` 是硬邊 sticker 風格，透明度極低。在 `#f4efe4` 背景上卡片幾乎看不出層次感。

**規格**：微調 Nordic `:root` 陰影 opacity：

```css
/* 原值 */
--shadow-s: 0 2px 0 rgba(28, 28, 28, .055);
--shadow-m: 0 3px 0 rgba(28, 28, 28, .065);

/* T124 新值：保持硬邊 sticker 風格，只提高 opacity */
--shadow-s: 0 2px 0 rgba(28, 28, 28, .09);
--shadow-m: 0 3px 0 rgba(28, 28, 28, .11);
```

**注意**：
- 不改陰影形狀（保持 0 blur = sticker 品牌風格）
- 只動 opacity，從 5.5%/6.5% → 9%/11%
- Kitty 有同樣問題，同步微調：
  ```css
  /* Kitty 原值 */
  --shadow-s: 0 2px 0 rgba(23, 23, 23, .045);
  --shadow-m: 0 3px 0 rgba(23, 23, 23, .055);
  /* T124 新值 */
  --shadow-s: 0 2px 0 rgba(23, 23, 23, .08);
  --shadow-m: 0 3px 0 rgba(23, 23, 23, .10);
  ```
- Dark 主題不動（已有足夠對比）

**驗收**：
- [ ] Nordic 卡片/面板在 `#f4efe4` 背景上可見層次
- [ ] Kitty 卡片在 `#eaf2ff` 上同樣
- [ ] Dark 不受影響
- [ ] 硬邊 sticker 感保留（0 blur）

---

### T125 — Kitty 主題 accent hover 亮化

**問題**：Kitty accent=#ff6a00 橘色，`filter:brightness(1.05)` hover 效果幾乎看不出變化。需要更明顯的 hover 信號。

**規格**：為 Kitty 主題的 accent 填充按鈕加 hover 提亮：

```css
/* T125: Kitty accent 按鈕 hover 更明顯 */
body[data-theme="kitty"] .act-btn.fill:hover,
body[data-theme="kitty"] .act-btn.good:hover,
body[data-theme="kitty"] .btn-gen:hover,
body[data-theme="kitty"] .btn-save-version:hover {
  filter: brightness(1.12);
}
```

**注意**：
- 只影響實底色 CTA 按鈕（.fill / .good / .btn-gen / .btn-save-version）
- 不動透明底按鈕（那些靠 border-color 變化已足夠）
- Nordic 的 accent=#58a9dc 藍色 brightness(1.05) 足夠，不動

**驗收**：
- [ ] Kitty accent 按鈕 hover 有明顯提亮
- [ ] Dark/Nordic 不受影響
- [ ] disabled 按鈕不 hover（已有全站 `:disabled { pointer-events:none }` 或 opacity 處理）

---

### T126 — Kitty 主題 scrollbar 可見度

**問題**：`::-webkit-scrollbar-thumb { background: var(--border) }` 在 Kitty 中 `--border` 是淡色（接近背景），scrollbar 幾乎隱形。且 `scrollbar-color` 只在 `body` 設了一次。

**規格**：為 Kitty 主題覆蓋 scrollbar 色：

```css
/* T126: Kitty scrollbar 加深 */
body[data-theme="kitty"] ::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--text) 20%, transparent);
}
body[data-theme="kitty"] {
  scrollbar-color: color-mix(in srgb, var(--text) 20%, transparent) transparent;
}
```

**注意**：
- 使用 `--text`（#1a2a4a）的 20% = 半透明深色 → 低調但可見
- Nordic 的 `--border` 也偏淡但尚可接受，如要同步可加：
  ```css
  body[data-theme="nordic"] ::-webkit-scrollbar-thumb {
    background: color-mix(in srgb, var(--text) 18%, transparent);
  }
  ```
- Dark 不動（已足夠）

**驗收**：
- [ ] Kitty 頁面/面板滾動時 scrollbar 可見
- [ ] Nordic 同上（如有加）
- [ ] Dark 不受影響
- [ ] scrollbar 不粗不醜（保持 5px width 不變）

---

## 中度提升批次（T127–T130）— 預估 10-30 行 CSS/TSX

---

### T127 — 卡片展開滑順動畫

**問題**：ResultCard 展開是 React 條件渲染 `{expanded ? <div>...}` → 瞬間出現/消失。缺乏動態過渡。

**方案**：不動 React 邏輯（太大改），用 CSS animation 在出現時 fade-in + slide-down：

```css
/* T127: 卡片展開時 fade+slide 入場動畫 */
.rc-body {
  animation: rcBodyIn .2s ease;
}
@keyframes rcBodyIn {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
```

**注意**：
- 收合（移除 DOM）不需動畫（React unmount 無法 CSS 動畫化，除非改架構）
- 展開即入場動畫已足夠體感提升
- 已有 `fadeIn` keyframes 用於 `.page`，此 keyframes 命名不衝突

**驗收**：
- [ ] 點擊卡片 header 展開時有 0.2s 淡入+下滑動畫
- [ ] 不影響收合速度
- [ ] 三主題確認

---

### T128 — 批次操作成功：卡片淡出動畫

**問題**：批次核准/發布後，卡片直接從列表中消失，太突然。

**分析**：`ResultCard.tsx` 已有 `.is-leaving` class（from UX-H T49 softDelete）。需確認批次操作是否也套用了。

**規格**：確保 `.is-leaving` 的 CSS 適用於批次場景：

```css
/* 確認已有（UX-H T49）：*/
.result-card.is-leaving {
  opacity: 0;
  transform: scale(0.97) translateY(-4px);
  transition: opacity .25s ease, transform .25s ease;
  pointer-events: none;
}
```

**TSX 檢查項**：
- `DraftResultsPanel.tsx` 或 batch action handler 需在移除卡片前先 set `leaving` state → 等 250ms → 實際移除
- 如果批次操作已用 `is-leaving`：此 task 為確認/pass
- 如果沒有：需在批次 approve/publish handler 加入延遲移除邏輯

**驗收**：
- [ ] 批次核准後卡片有 0.25s 淡出+縮小動畫
- [ ] 單張核准/移出同樣有動畫（已有 T49 保證）
- [ ] 動畫結束後 DOM 確實移除

---

### T129 — 空狀態加 CTA 跳轉按鈕

**問題**：T85 建立了統一空狀態（icon + title + desc），`.empty-state-cta` class 已存在但部分空狀態沒用。

**規格**：在以下位置的空狀態加 CTA：

| 位置 | CTA 文字 | 行為 |
|------|----------|------|
| 結果列表（DraftResultsPanel）空狀態 | 「去新增第一筆商品」 | 手機：切到「輸入」tab；桌機：focus 到輸入面板 |
| 圖片審核列表空狀態 | 「回到新增頁開始上架」 | router.push('/') |
| 發布紀錄空狀態 | 「核准商品後會出現在這裡」 | 無按鈕（純說明） |

**CSS**：`.empty-state-cta` 已有樣式（L6070-6088），TSX 只需加一個帶此 class 的 `<button>` 或 `<Link>`。

**驗收**：
- [ ] 三處空狀態顯示正確 CTA（或說明文字）
- [ ] 按鈕用 `.empty-state-cta` class
- [ ] 點擊後跳轉正確
- [ ] 手機版 44px 觸控安全

---

### T130 — 價格區塊卡片化（對齊 Mockup .price-card）

**問題**：Mockup 的展開卡片 Pricing tab 有 `.price-card`（4 格 dashboard 小卡：成本/售價/利潤/利潤率）。目前 `ResultCardPricingPanel` 是純欄位列表。

**規格**：

```css
/* T130: 價格摘要 mini dashboard — 4 格 grid */
.rc-price-summary {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 9px;
  margin-bottom: 16px;
}
.rc-price-item {
  background: color-mix(in srgb, var(--surface2) 60%, var(--surface));
  border-radius: var(--radius-s);
  padding: 11px;
  text-align: center;
}
.rc-price-item-label {
  font-size: 9px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .04em;
  margin-bottom: 3px;
}
.rc-price-item-value {
  font-family: var(--font-space-grotesk), 'Space Grotesk', sans-serif;
  font-size: 15px;
  font-weight: 700;
}

@media (max-width: 960px) {
  .rc-price-summary {
    grid-template-columns: 1fr 1fr;
  }
}
```

**TSX**：在 `ResultCardPricingPanel.tsx` 頂部加一組 4 格摘要：
- 成本（CNY ¥ + TWD $）
- 售價（NT$）
- 利潤（NT$，色 `--success`）
- 利潤率（%，色 `--success` 或 `--danger`）

**驗收**：
- [ ] 價格 tab 頂部出現 4 格摘要
- [ ] 數字用 Space Grotesk + 粗體
- [ ] 手機版改 2×2
- [ ] 利潤為負時顯示 danger 色
- [ ] 三主題確認

---

## 建議發包順序

```
第十一批（快速打磨）：T122 + T123 + T124 + T125 + T126 → 純 CSS，10 分鐘內能交
第十二批（中度提升）：T127 + T128 + T129 + T130 → 需碰 TSX，30-60 分鐘
```

---

## ⚠ 備註

- T127 只做入場動畫，收合仍為瞬間消失（React unmount 限制，完整進出場需用 framer-motion 或改為 always-render + CSS toggle，屬大型重構 → 暫不做）
- T128 依賴確認批次操作是否已套用 `is-leaving`（可能已有 → 核帳即可）
- T130 的利潤計算邏輯已存在於 `ResultCardPricingPanel.tsx`，只是換個展示方式
- 所有改動不觸碰系統邏輯 / prompt / SQL
- 禁止新增 `!important`
