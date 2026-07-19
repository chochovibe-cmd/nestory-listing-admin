# UX-Y：色彩對比與微調收尾（Color Contrast & Polish）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：globals.css 三主題 token 交叉比對

---

## T94 — nordic/kitty --border-soft 與 --border 相同

### 問題
dark 主題 `--border: #2a2a38` vs `--border-soft: #38384a`（有區分）。
nordic `--border: #1c1c1c` = `--border-soft: #1c1c1c`（相同）。
kitty `--border: #171717` = `--border-soft: #171717`（相同）。

globals.css L58-59 的註解說「刻意與 --border 同值（B15 ③-2 維持現狀）」，
所以這是 **已知設計決策**。

### 規格
**維持現狀，不修改。** 此項僅記錄為設計備忘。

如果日後 nordic/kitty 需要分層邊框（例如 panel 內嵌區域用更淡邊框），可以將 --border-soft 調為：
- nordic: `#d0cec6`（warm gray, 比 #1c1c1c 淡很多）
- kitty: `#c8d0dd`（cool gray）

但目前的全黑邊框是 B15 刻意的「粗線手感」設計語言，**不建議自行變更**。

---

## T95 — warn-text 對比度在淺色主題可能不足

### 問題
`--warn-text` 在三主題的計算結果：
- dark: `color-mix(in srgb, #f5c842 55%, #f0edf8)` ≈ 淡黃偏白（在 dark bg 上可讀）
- nordic: `color-mix(in srgb, #f6ce45 45%, #1f1f1f)` ≈ 暗黃（在 light bg 上需驗證）
- kitty: `color-mix(in srgb, #ffd966 40%, #171717)` ≈ 暗黃（在 light bg 上需驗證）

`--warn-text` 用在 `.schip--warn` 等 status 文字上。

### 設計規格

**需要實際在瀏覽器中驗證對比度**——用 DevTools 的 color contrast checker：
- 目標：WCAG AA 4.5:1（normal text）
- 如果不合格，調整 mix 百分比

建議的驗證步驟（給 worker / audit 用）：
1. 開三主題
2. 找到任何 `.schip--warn` 文字
3. 用 DevTools Inspect 檢查 computed color vs background color
4. 算對比度 ratio
5. 不合格時調整百分比：nordic 降到 40%、kitty 降到 35%

#### 驗收清單
- [ ] 三主題 `.schip--warn` 文字對比度 ≥ 4.5:1
- [ ] 調整後 warn-text 在各主題仍能與 success-text 區分

---

## T96 — 聚焦指示環（focus-ring）未統一到所有互動元素

### 問題
`--focus-ring` token 已定義（`0 0 0 3px color-mix(...)`），但只有 `input:focus` 和少數元素使用。
以下互動元素缺少 focus-visible ring：
- `.btn-add`
- `.btn-mini`
- `.hdr-btn`
- `.pill-btn`
- `.queue-card`（可點擊卡片）
- `.sidebar-item`
- `.theme-btn`
- `.rc-tag`（可刪除 tag）
- `.source-pill`

### 設計規格

統一 focus-visible 規則：

```css
.btn-add:focus-visible,
.btn-mini:focus-visible,
.hdr-btn:focus-visible,
.pill-btn:focus-visible,
.queue-card:focus-visible,
.sidebar-item:focus-visible,
.theme-btn:focus-visible,
.rc-tag:focus-visible,
.source-pill:focus-visible,
.theme-picker-toggle:focus-visible {
  outline: none;
  box-shadow: var(--focus-ring);
}
```

#### 注意
- 使用 `:focus-visible`（不是 `:focus`），避免滑鼠點擊也出現 ring
- 部分元素有 `box-shadow: var(--hover-shadow)` 的 hover 效果，focus 時改為 `var(--focus-ring)`（兩者不疊加）
- `.sel--fill` active 狀態的 `box-shadow` 優先級高於 focus-ring → 需要 compound selector：
  ```css
  .sel--fill:focus-visible {
    box-shadow: var(--pill-active-shadow), var(--focus-ring);
  }
  ```

#### 三主題 focus-ring 色
| 主題 | --accent | focus-ring 色（22% mix） |
|---|---|---|
| dark | #c8ff00 | 半透明黃綠 |
| nordic | #58a9dc | 半透明藍 |
| kitty | #ff6a00 | 半透明橘 |

#### 驗收清單
- [ ] 所有可點擊元素 Tab 聚焦時有 focus ring
- [ ] 滑鼠點擊不顯示 ring（focus-visible）
- [ ] 三主題 ring 色與 accent 一致
- [ ] 不干擾現有 hover 動畫

---

## T97 — 按鈕 disabled 態視覺不明確

### 問題
`.primary:disabled` 和 `.btn-add:disabled` 只靠 `cursor: not-allowed`，
沒有明顯的透明度或色調變化，使用者可能誤以為按鈕可點。

### 設計規格

```css
button:disabled,
.primary:disabled,
.btn-add:disabled,
.btn-mini:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
  transform: none;
  box-shadow: none;
}
```

| 屬性 | 值 | 說明 |
|---|---|---|
| opacity | 0.45 | 明顯區分於 enabled |
| pointer-events | none | 防止誤觸 |
| transform | none | 移除 hover-transform |
| box-shadow | none | 移除 hover-shadow |

#### 驗收清單
- [ ] disabled 按鈕有明顯灰化
- [ ] hover 時不產生 transform / shadow 動畫
- [ ] 三主題下 disabled 態都能辨別
