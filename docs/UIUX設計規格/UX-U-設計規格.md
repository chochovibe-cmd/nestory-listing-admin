# UX-U：登入頁視覺強化（Login Page Polish）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：login/page.tsx、globals.css `.container` / `.panel` 區塊

---

## T79 — 登入面板無 max-width，桌機過度拉伸

### 問題
登入頁 `<form className="panel">` 在 `.container` 內，container 有 `max-width: 1440px`。
登入表單只有兩個欄位 + 一個按鈕，在 1440px 寬螢幕上被拉得非常寬，視覺重心散失。

### 設計規格

| 屬性 | 值 |
|---|---|
| `.container` 內 `form.panel`（login 專用） | max-width: 400px |
| margin | 0 auto（水平置中） |
| 垂直位置 | margin-top: 12vh（桌機）; margin-top: 8vh（手機） |

建議加一個 `.login-panel` class 在 `<form>` 上，避免影響其他頁面的 `.panel`：

```tsx
<form className="panel login-panel" onSubmit={signIn}>
```

```css
.login-panel {
  max-width: 400px;
  margin: 12vh auto 0;
}
@media (max-width: 960px) {
  .login-panel {
    margin-top: 8vh;
  }
}
```

#### 三主題影響
無——只有 layout 屬性，不涉及色值。

#### 驗收清單
- [ ] 桌機（1280px+）登入表單置中，寬度 ≤ 400px
- [ ] 手機正常顯示，不被截斷
- [ ] 其他使用 `.panel` 的頁面不受影響

---

## T80 — 登入頁缺少品牌視覺

### 問題
登入頁只有純文字 `<h1>團隊登入</h1>`，沒有品牌識別（logo / 品牌色 / icon）。
作為進入系統的第一個畫面，缺乏專業感與安全信任感。

### 設計規格

在 `<div className="panel-header">` 內加入品牌元素：

```
[品牌圓點 brand-dot] 
潮巢 商品上架助手
團隊登入
```

| 元素 | 規格 |
|---|---|
| brand-dot | 複用 `.brand-dot`（現有 topbar 的那顆圓點） |
| 主標 | "潮巢 商品上架助手"，font-size 18px, font-weight 700, color: `var(--text)` |
| 副標 | "團隊登入"，font-size 14px, font-weight 400, color: `var(--text-muted)`, margin-top 4px |
| 間距 | brand-dot 下方 margin-bottom 12px |
| 對齊 | 全部置中 text-align: center |

#### 狀態清單
- default：品牌 + 表單
- Supabase 未設定：品牌 + notice（現有）
- submitting：品牌不變，按鈕 disabled
- error：品牌不變，notice 顯示錯誤

#### 三主題色值
| 元素 | dark | nordic | kitty |
|---|---|---|---|
| brand-dot bg | `var(--accent)` #c8ff00 | `var(--accent)` #58a9dc | `var(--warn)` #ffd966 |
| 主標 color | #f0edf8 | #1f1f1f | #171717 |
| 副標 color | #a09ab8 | #777064 | #5b6475 |

*kitty 的 brand-dot 是 `var(--warn)` 而非 `var(--accent)`，與 topbar 一致（見 globals.css L6012–6013）。*

#### 驗收清單
- [ ] 登入頁頂部有品牌圓點 + "潮巢 商品上架助手" + "團隊登入"
- [ ] 三主題圓點色正確
- [ ] 手機版排版不溢出

---

## T81 — 登入按鈕無 loading spinner

### 問題
`submitting` 狀態只是文字從「登入」變「登入中...」，按鈕 disabled。
缺少視覺動態回饋（使用者不確定是否真的在處理）。

### 設計規格

| 狀態 | 按鈕內容 |
|---|---|
| default | 「登入」 |
| submitting | 「登入中」+ 旋轉 spinner icon（CSS animation） |

Spinner 規格：
| 屬性 | 值 |
|---|---|
| 尺寸 | 14px × 14px |
| border | 2px solid `color-mix(in srgb, var(--accent-fg) 30%, transparent)` |
| border-top-color | `var(--accent-fg)` |
| border-radius | 50% |
| animation | spin 0.6s linear infinite |
| 位置 | 文字右側 gap 6px，inline-flex align-items center |

```css
@keyframes spin {
  to { transform: rotate(360deg); }
}
```

#### 驗收清單
- [ ] 點擊登入 → 按鈕顯示 spinner + "登入中"
- [ ] 三主題 spinner 在按鈕底色上都可見
- [ ] 登入成功/失敗後 spinner 消失

---

## T82 — 登入錯誤訊息缺少視覺區分

### 問題
錯誤用 `<div className="notice">` 顯示，跟 Supabase 未設定的提示用同一個樣式。
使用者無法一眼區分「資訊提示」和「錯誤」。

### 設計規格

錯誤訊息改用：
```tsx
{message ? <div className="notice login-error">{message}</div> : null}
```

```css
.login-error {
  border-left: 4px solid var(--danger);
  color: var(--danger);
  font-weight: 600;
}
```

| 主題 | --danger |
|---|---|
| dark | #ff6b6b |
| nordic | #d9272e |
| kitty | #e4002b |

#### 驗收清單
- [ ] 密碼錯誤 → 紅色左邊條 + 紅色文字
- [ ] Supabase 未設定 → 普通 notice 樣式（無紅色）
- [ ] 三主題紅色正確
