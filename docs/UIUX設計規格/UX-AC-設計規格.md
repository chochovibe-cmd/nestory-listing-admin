# UX-AC：全站質感大修 — 對齊 Mockup + 視覺統一（Visual Polish Pass）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：老闆截圖反饋 6 點 + nestory-v7-mockup.html 比對 + globals.css 實查
> **優先級**：🔴 P1（老闆直接點名）

---

## 問題總覽（對應老闆截圖反饋）

| # | 老闆原話 | 根因 | Task |
|---|---|---|---|
| 1 | 按鈕太寬太胖，跟全站風格不符 | .btn-gen width:100%、「繼續編輯/丟棄」用 .btn-mini 但 notice 撐滿、.act-btn padding 偏大 | T112 |
| 2 | nordic 主題有些要選取才看得到字、按鈕整個白的 | nordic 的 .mini-btn / .act-btn 在 #fffdf6 上 surface2 太接近、border 存在但太淡看不到 | T113 |
| 3 | 結果卡片排列醜、「審文案」chip 位置怪、移出應該用 ✕ 不是按鈕 | rc-status-chips 佈局問題 + 移出/封存按鈕用文字不用 icon | T114 |
| 4 | 紅字（失敗原因）超出容器 | .rc-fail-reason 有 word-break 但沒有 padding 限制、.rc-collapsed-notice 紅字同問題 | T115 |
| 5 | 商品庫按鈕位置（topbar pill 位）是否正確 | HeaderControls 放在 topbar-right 合理但視覺權重不足 | T116 |
| 6 | 卡片展開後文案/價格排版 + 儲存按鈕都不如 mockup | .btn-save-version 缺 mockup 的 success 實底、rc-actions gap/layout 不對齊 mockup | T117 |

---

## T112 — 按鈕瘦身 Round 2：全站胖按鈕收斂

### 問題清單

1. **`.btn-gen`（生成按鈕）**：width: 100% 讓它撐滿整個面板，在寬螢幕上非常胖
2. **「繼續編輯/丟棄」按鈕**：在 `.notice.workspace-restore-notice` 內用 `.btn-mini`，但 notice 自身 width 撐滿面板，按鈕組看起來很寬
3. **`.act-btn`**：padding 9px 15px + min-height 38px 在小卡片語境下太胖（mockup 是 9px 15px + 無 min-height limit）

### 設計規格

```css
/* T112-1: Generate CTA — auto width with max, centered */
.btn-gen,
.button.primary.btn-gen {
  width: auto;
  min-width: 180px;
  max-width: 100%;
  margin: 0 auto;      /* center when alone */
}

/* T112-2: Restore notice — inline compact buttons */
.workspace-restore-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.workspace-restore-notice .btn-mini {
  min-height: 28px;
  padding: 3px 12px;
  font-size: 11px;
}

/* T112-3: act-btn tighten for card context */
.rc-actions .act-btn {
  padding: 7px 13px;
  min-height: 34px;
  font-size: 11.5px;
}
```

#### 注意
- `.btn-gen-full` / `.btn-gen-short` 在手機版已有 override（L3552/3567），確認不衝突
- 表單區如果只有一顆生成按鈕，auto width + margin: 0 auto 讓它居中且不撐滿

#### 驗收清單
- [ ] 生成按鈕不再撐滿整個面板寬度
- [ ] 「繼續編輯/丟棄」按鈕變小、跟文字同行
- [ ] 結果卡片內 act-btn 比之前緊湊
- [ ] 手機版按鈕仍觸控安全（≥44px min-height via mobile override）

---

## T113 — Nordic/Kitty 淺色主題元素隱形修復

### 問題

Nordic 主題（`--surface: #fffdf6`, `--surface2: #eee7d8`）下：
- `.mini-btn` / `.btn-mini`：background `var(--surface2)` + border `var(--border)` = `#1c1c1c` 邊框其實看得到，但 `--surface2` (#eee7d8) 底色讓按鈕融入背景，對比不足
- `.act-btn`：同問題，surface2 底在 surface 背景上太接近
- `.rc-quick-btn` / card header 按鈕：在淺底上幾乎隱形
- 有些 `sel` 類 pill：未選取時全白（surface bg + border-soft = #1c1c1c 應該有邊框，但如果在白底 panel 上 surface=#fffdf6 也近乎隱形）

### 設計規格

```css
/* T113: Nordic/Kitty — boost button contrast on light backgrounds */
body[data-theme="nordic"] .mini-btn,
body[data-theme="nordic"] .btn-mini,
body[data-theme="nordic"] .act-btn,
body[data-theme="nordic"] .rc-quick-btn {
  background: var(--surface);
  border-color: color-mix(in srgb, var(--border) 55%, transparent);
  box-shadow: 0 1px 2px rgba(28, 28, 28, .06);
}

body[data-theme="kitty"] .mini-btn,
body[data-theme="kitty"] .btn-mini,
body[data-theme="kitty"] .act-btn,
body[data-theme="kitty"] .rc-quick-btn {
  background: var(--surface);
  border-color: color-mix(in srgb, var(--border) 50%, transparent);
  box-shadow: 0 1px 2px rgba(23, 23, 23, .05);
}

/* sel pills on light themes — ensure visible border */
body[data-theme="nordic"] .sel,
body[data-theme="kitty"] .sel {
  border-color: color-mix(in srgb, var(--border) 40%, transparent);
}
```

#### 原理
- 不改 dark 主題（dark 的 surface2 vs surface 已有足夠對比）
- 淺色主題按鈕底色改 `--surface`（白色），在 `--surface2` 面板上浮起
- border 用 color-mix 調透明度，讓邊框不黑得像 border-soft 但清晰可見
- 輕微 box-shadow 增加層次感

#### 驗收清單
- [x] Nordic 主題下所有 mini-btn 清晰可辨（程式完成；待畫面核）
- [x] Kitty 主題下按鈕不融入背景（程式完成；待畫面核）
- [x] Dark 主題不受影響（僅 nordic/kitty 選擇器）
- [x] hover 狀態仍有 accent 邊框轉色（主題區塊重申 hover）

---

## T114 — 結果卡片 header 佈局美化 + 移出改 ✕ 圖示

### 問題

1. 「審文案 7」站別 chip 在卡片左側下方，位置不直覺——mockup 是 `rc-status-chips` 緊貼在 header 右側 quick-actions 旁
2. 「🗄 移出」按鈕佔太多空間——應該用 ✕ icon button 替代，放在卡片右上角
3. header 行動按鈕（✓核准、↻重生、🗄移出）排列不如 mockup 緊湊

### 設計規格

```css
/* T114-1: Status chips inline with header (not separate row) */
.rc-status-chips {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  padding: 0;
  margin: 0;
}

/* T114-2: Archive/remove → icon-only ✕ button */
.rc-dismiss-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-muted);
  font-size: 14px;
  cursor: pointer;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all .15s;
  opacity: 0;
}
.rcard:hover .rc-dismiss-btn,
.rc-dismiss-btn:focus-visible {
  opacity: 1;
}
.rc-dismiss-btn:hover {
  background: color-mix(in srgb, var(--danger) 12%, var(--surface));
  color: var(--danger);
}
```

#### JSX 變更（ResultCard.tsx）
- 「🗄 移出」按鈕 → 改為 `<button className="rc-dismiss-btn" title="移出">×</button>`
- 放在 `.rcard` 容器內右上角（position absolute）
- hover 卡片才顯示（opacity 0→1）

#### 驗收清單
- [ ] status chips 不獨佔一行，跟 header 同排
- [ ] 移出按鈕改為右上角 ✕
- [ ] hover 卡片時 ✕ 浮現
- [ ] 三主題 ✕ hover 顏色 = danger

---

## T115 — 紅字/錯誤文字溢出容器修復

### 問題

截圖中「缺少有效售價，無法產生 價格帶_ tag。」紅字超出卡片邊界。

`.rc-fail-reason` 已有 `word-break: break-word` 但：
1. 缺 `padding: 0 14px`（文字起點就在容器邊緣）
2. `.rc-collapsed-notice` 內的錯誤文字可能同樣溢出
3. 全站其他 `color: var(--danger)` 文字需檢查是否有 overflow 保護

### 設計規格

```css
/* T115: Error text containment */
.rc-fail-reason {
  margin: 4px 14px 0;
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 6%, var(--surface));
  border-radius: var(--radius-s);
  word-break: break-word;
  overflow-wrap: break-word;
  /* keep truncation for non-expanded */
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* Collapsed notice also needs containment */
.rc-collapsed-notice {
  margin: 0 14px 10px;
  padding: 8px 12px;
  border-radius: var(--radius-s);
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
  overflow-wrap: break-word;
  /* existing styles preserved */
}
```

#### 驗收清單
- [x] 紅字不超出卡片邊界（margin 14px + padding + clamp；待畫面核）
- [x] 長錯誤訊息自動換行（word-break + overflow-wrap）
- [x] 淡紅背景讓錯誤更明顯但不刺眼（danger 6% + surface）
- [x] 三主題 danger 色 + 淡底正確（token only）

---

## T116 — 商品庫按鈕視覺權重調整

### 問題

商品庫 `🔍 商品庫` 按鈕在 topbar 右側，用 `.hdr-btn` class——跟「更多」「登出」同一排。
位置本身合理（topbar 是全站工具列），但：
1. 視覺權重不足——跟旁邊按鈕一模一樣，使用者可能忽略
2. 老闆覺得它「長在那邊」不像正確位置

### 設計規格

```css
/* T116: Product library button — slight accent tint to distinguish from generic hdr-btn */
.hdr-btn-library {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  border-color: color-mix(in srgb, var(--accent) 30%, var(--border));
  color: var(--accent);
  font-weight: 700;
}
.hdr-btn-library:hover {
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  border-color: var(--accent);
}
```

#### JSX 變更（HeaderControls.tsx）
- 商品庫按鈕 className 從 `"hdr-btn"` → `"hdr-btn hdr-btn-library"`

#### 驗收清單
- [ ] 商品庫按鈕有 accent 色調區分
- [ ] 三主題下都明顯可辨
- [ ] 不影響其他 hdr-btn

---

## T117 — 結果卡片展開區排版對齊 Mockup

### 問題

卡片展開後的排版與 mockup 差距大：
1. **儲存按鈕**：目前是半透明 success 底 + border，mockup 是 `success 實底 + 白字`
2. **rc-actions（底部動作列）**：gap 偏大、按鈕太分散
3. **文案欄位**：rc-field 間距和 label 排版跟 mockup 不同
4. **價格區**：rc-priceblock 跟 mockup 的緊湊右對齊不同

### 設計規格

```css
/* T117-1: Save version button — solid success like mockup */
.btn-save-version {
  background: var(--success);
  color: var(--on-solid);
  border: none;
  border-radius: var(--radius-s);
  padding: 11px 14px;
  font-size: 12.5px;
  font-weight: 800;
  box-shadow: var(--shadow-s);
  margin: 10px 15px;
  width: calc(100% - 30px);
}
.btn-save-version:hover:not(:disabled) {
  filter: brightness(1.06);
  background: var(--success);
  border: none;
}
.btn-save-version:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  filter: none;
}

/* T117-2: Actions row — tighter, mockup gap */
.rc-actions {
  display: flex;
  gap: 8px;
  padding: 0 15px 15px;
  flex-wrap: wrap;
}

/* T117-3: Field label uppercase + spacing (mockup convention) */
.rc-field {
  margin-bottom: 16px;
}
.rc-field:last-child {
  margin-bottom: 4px;
}
.rc-field-label {
  font-size: 10px;
  font-weight: 800;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: .08em;
}

/* T117-4: Price block alignment */
.rc-priceblock {
  text-align: right;
  flex-shrink: 0;
  min-width: 90px;
}
.rc-price {
  font-size: 13.5px;
}
.rc-price s {
  color: var(--text-muted);
  font-size: 10px;
  font-weight: 400;
  margin-right: 4px;
}
.rc-profit {
  font-size: 9.5px;
  color: var(--success);
  margin-top: 2px;
}
```

#### 驗收清單
- [ ] 儲存按鈕改為 success 實底白字
- [ ] 底部動作列更緊湊
- [ ] 文案 label 有 uppercase + letter-spacing
- [ ] 價格右對齊 + 利潤文字 success 色
- [ ] 三主題 success / on-solid 色正確

---

## 額外全站掃描項目

### T118 — 手機版卡片觸控優化

```css
@media (max-width: 960px) {
  /* Card header tap area */
  .rc-head {
    padding: 14px;
    gap: 10px;
  }
  /* Quick action buttons full-width stack */
  .rc-quick {
    width: 100%;
    justify-content: flex-end;
  }
  .rc-quick-btn {
    min-height: 44px;
    flex: 0 1 auto;
  }
  /* Dismiss ✕ always visible on mobile (no hover) */
  .rc-dismiss-btn {
    opacity: 1;
    width: 32px;
    height: 32px;
  }
}
```

### T119 — 全站 overflow 防護巡檢

所有 `color: var(--danger)` 文字元素需確認有：
- `word-break: break-word`
- `overflow-wrap: break-word`  
- 容器有 `overflow: hidden` 或 `padding` 限制

需檢查的元素：
- `.rc-fail-reason` ✅（T115 處理）
- `.rc-collapsed-notice` ✅（T115 處理）
- `.field-msg`（表單錯誤提示）
- `.login-error`（登入頁錯誤）
- `.notice` 內嵌的錯誤文字

```css
/* T119: Global error text containment */
.field-msg,
.login-error,
.notice {
  word-break: break-word;
  overflow-wrap: break-word;
}
```

---

## 建議發包順序

```
第一批：T113 + T115（淺色主題隱形修復 + 紅字溢出）→ 最急，影響可用性
第二批：T112 + T117（按鈕瘦身 + 卡片排版對齊 mockup）→ 最有感
第三批：T114 + T116 + T118 + T119（卡片 header 美化 + 商品庫 + 手機 + overflow）→ 完善
```

---

## ⚠ 備註

- T114 的「移出→✕」改動涉及 ResultCard.tsx 的 JSX 重構，需要 Grok 仔細處理 archiveOne() 的 onClick 綁定
- T117 的儲存按鈕改色會影響所有展開卡片，確認 disabled 態仍正確
- 所有改動不觸碰系統邏輯 / prompt / SQL（那些歸 Fable）
