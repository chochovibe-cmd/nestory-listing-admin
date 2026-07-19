# T95 — Nordic warn-text WCAG 對比度修復

> **問題**：Fable DevTools 實測 Nordic 主題的 warn chip 前景色對比度 = 4.38:1，未達 WCAG AA 最低要求 4.5:1。
> **其他主題**：Kitty 5.12 ✅ / Dark 13.98 ✅ — 只需修 Nordic。

---

## 根因

Nordic `:root` 定義：
```css
--warn: #f6ce45;
--warn-text: color-mix(in srgb, var(--warn) 45%, var(--text));
```

- `--warn` = #f6ce45（亮黃）
- `--text` = #1f1f1f（近黑）
- 45% mix → 計算結果約 srgb(0.501, 0.430, 0.189) = ~#806E30
- 背景 `--surface` = #fffdf6（或 `--bg` = #f4efe4）
- #806E30 vs #f4efe4 = 對比 4.38 → 差 0.12 不過

---

## 修復規格

**方案**：將 Nordic 的 `--warn-text` mix 比例從 45% 降到 38%（讓 `--text` 佔更多 → 更深）

```css
/* 原值 (L112) */
--warn-text: color-mix(in srgb, var(--warn) 45%, var(--text));

/* T95 修復 */
--warn-text: color-mix(in srgb, var(--warn) 38%, var(--text));
```

**計算驗證**：
- 38% of #f6ce45 + 62% of #1f1f1f
- R: 0.38×246 + 0.62×31 = 93+19 = 112 → 0x70
- G: 0.38×206 + 0.62×31 = 78+19 = 97 → 0x61
- B: 0.38×69 + 0.62×31 = 26+19 = 45 → 0x2D
- 結果約 #70612D
- #70612D vs #f4efe4 → 對比約 5.1:1 ✅ 超過 4.5

**備選（更保守）**：降到 35% → 更深，約 5.5:1。但 38% 已足夠且保留黃色辨識度。

---

## 影響範圍

所有使用 `var(--warn-text)` 的元素在 Nordic 主題下會略深：
- `.schip.busy` 文字
- `.rc-fail-reason` 裡的 warn 類文字
- warn chip 類通用元素

不影響 Dark / Kitty（各自獨立定義）。

---

## 驗收

- [ ] Nordic 主題 warn chip 文字對比 ≥ 4.5:1（用 DevTools color picker 驗）
- [ ] 視覺上仍可辨識為「黃/棕色警告」（不能太深變成像普通文字）
- [ ] Dark/Kitty 不受影響
- [ ] Fable 代量複驗

---

## 施工

**位置**：`src/app/globals.css` L112
**改動**：一個數字 `45%` → `38%`
**Fable 可代做 + 代驗**：確認。
