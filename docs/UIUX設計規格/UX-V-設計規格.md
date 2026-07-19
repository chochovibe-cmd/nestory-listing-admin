# UX-V：safe-area 與 z-index 一致性（Safe-Area & Stacking Consistency）

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：globals.css 中 safe-area-inset-bottom 使用處（4 處）

---

## T83 — safe-area-inset-bottom 計算不一致

### 問題
全站有 4 處使用 `env(safe-area-inset-bottom)`，各處 base offset 不同：
1. `.mobile-tabbar` `bottom: calc(10px + env(safe-area-inset-bottom))` — L5256
2. `.toast-host` `bottom: calc(84px + env(safe-area-inset-bottom))` — L6050
3. `.toast-host` (≤960px) `bottom: calc(76px + env(safe-area-inset-bottom))` — L6140
4. 圖片標記浮動按鈕 `bottom: calc(72px + env(safe-area-inset-bottom))` — L4175

tabbar 高度（含 padding）實際約 64px，那 toast 應該在 `64px + 10px + safe-area` 之上，
但桌機 toast 用 84px、手機 76px 都沒有跟 tabbar 實際高度嚴格對齊。

### 設計規格

建議統一使用 CSS custom property 管理 tabbar 佔位高度：

```css
:root {
  --tabbar-h: 0px;
}
@media (max-width: 960px) {
  :root {
    --tabbar-h: 64px;
  }
}
```

然後各固定底部元素統一引用：

| 元素 | bottom 值 |
|---|---|
| `.mobile-tabbar` | `calc(env(safe-area-inset-bottom))` （tabbar 本身貼底） |
| `.toast-host` | `calc(var(--tabbar-h) + 12px + env(safe-area-inset-bottom))` |
| 圖片標記按鈕 | `calc(var(--tabbar-h) + 8px + env(safe-area-inset-bottom))` |

#### 三主題影響
無——純 layout token。

#### 驗收清單
- [ ] iPhone（有 safe-area）上 toast 不被 tabbar 遮擋
- [ ] 桌機上 toast 正常顯示在底部
- [ ] 圖片標記浮動按鈕不與 tabbar 重疊
- [ ] 新的 `--tabbar-h` token 寫在 `:root` 區塊

---

## T84 — !important 使用過多

### 問題
globals.css 是單一 CSS 檔（6102 行），同檔內出現多處 `!important` 來解決 specificity 衝突。
這不是 bug，但會讓後續維護者難以覆寫樣式，每次修改都可能連鎖 !important。

### 現況記錄（非修改項，列為技術債提醒）

此項不產出具體修改規格，但建議：
1. 新增 CSS 規則時**禁止新增 !important**
2. 遇到 specificity 問題優先提高 selector 精確度或調整 source order
3. 長期可考慮拆分 globals.css 為模組（component-level CSS modules），但這是架構變更，超出 UIUX 規格範圍

#### ⚠ 轉交 Fable 總指揮
此項屬於 CSS 架構技術債，建議由 Fable 總指揮排進 refactor backlog。

---

## T85 — 空狀態（Empty State）視覺統一

### 問題
多個面板在沒有資料時顯示純文字 muted 提示，缺乏視覺引導：
- `QuickPreviewPanel`："尚無可預覽的稿件"（純 `.muted` 文字）
- `DashboardTodoPanel` 各區塊有 loading 但空態文字風格不一
- `SetupNotice`：有結構但缺少圖示引導

### 設計規格

統一空狀態 pattern：

```
┌──────────────────────────────┐
│                              │
│       📋（圖示/emoji）       │
│     尚無可預覽的稿件          │
│  從「新增」開始建立第一筆      │
│                              │
└──────────────────────────────┘
```

| 元素 | 規格 |
|---|---|
| 容器 class | `.empty-state` |
| padding | 32px 16px |
| text-align | center |
| 圖示 | emoji 或 SVG icon, font-size 32px, opacity 0.6 |
| 主標文字 | font-size 14px, font-weight 600, color `var(--text)`, margin-top 8px |
| 副標文字 | font-size 12px, color `var(--text-muted)`, margin-top 4px |
| 操作按鈕（可選） | `.btn-mini` 或文字連結, margin-top 12px |

各面板的空態 copy text：

| 面板 | 圖示 | 主標 | 副標 |
|---|---|---|---|
| QuickPreviewPanel | 📋 | 尚無可預覽的稿件 | 從「新增」開始建立第一筆 |
| DraftResultsPanel (全空) | 📦 | 還沒有任何草稿 | 使用左側表單新增第一筆商品 |
| DashboardTodoPanel (空) | ✅ | 今日待辦已清空 | 太棒了，沒有待處理項目 |
| SetupNotice | ⚙ | （保留現有 title） | （保留現有說明文字） |

#### 三主題影響
全部使用 token（`--text`, `--text-muted`），三主題自動適配。

#### 手機版
padding 縮至 24px 12px，圖示 font-size 28px。

#### 驗收清單
- [ ] 各面板空態使用統一 `.empty-state` 結構
- [ ] 有圖示 + 主標 + 副標
- [ ] 三主題文字可讀
- [ ] 手機版不溢出
