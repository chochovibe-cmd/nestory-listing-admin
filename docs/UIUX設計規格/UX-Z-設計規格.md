# UX-Z：Mockup 融合＋前次報告未修項補完

> **角色**：UIUX Design Reviewer — Mode A 設計規格
> **日期**：2026-07-19
> **依據**：mockup nestory-v7-mockup.html、前次 Claude 對話報告、程式碼驗證

---

## 前次報告 7 個論點驗證結果

| # | 論點 | 狀態 | 說明 |
|---|---|---|---|
| 1 | schip--warn 對比度 | ✅ 已修 | `.schip--warn` 已改用 `var(--warn-text)`（color-mix 混入 --text），不再是純 --warn |
| 2 | 按鈕 class 碎片化 | ❌ 未修 | 仍有 btn-add/btn-gen/btn-save-version/ir-btn-confirm 等 10+ class，技術債在 |
| 3 | 雙重確認未推廣 | ⚠️ 部分修 | ResultCard (UX-L T61) 已改 inline double-confirm；**但 VariantEditor 仍有 2 處 `window.confirm`** |
| 4 | Modal auto-focus 風險 | ❓ 需驗證 | 未查到修改記錄，大概率未處理 |
| 5 | 篩選空狀態缺「清除篩選」 | ❓ 需驗證 | 需要啟動 app 實際查看 |
| 6 | StatusBadge 字串比對 | ⚠️ 記錄 | 屬系統邏輯（轉交 Fable） |
| 7 | 主題 token lint checklist | ❌ 未做 | 沒有任何 lint script 或 checklist |

### 已修但報告內容已過時的項目：
- **Ctrl+V 貼圖**：✅ UX-D T20 已實作（`ImageUploader.tsx` 有 `onPaste` + `clipboardData`）
- **Google Fonts 外連**：✅ UX-K T50 已移除，改用 `next/font` 自托管
- **Kitty --success = --accent3**：✅ UX-A T12 已修（`--success: #2f8f6b`，不再是 `#1d4f91`）

---

## Mockup vs 現行站台差異分析——值得融入的元素

我比對了 mockup 的 CSS 和現行 globals.css，整理出 mockup 做得更好的 UI 細節：

### 1. Topbar 毛玻璃效果（backdrop-filter）

**Mockup**（L61）：
```css
background: color-mix(in srgb, var(--bg) 88%, transparent);
backdrop-filter: blur(8px);
```

**現行**：topbar 是純色 `var(--bg)` + `border-bottom`，沒有透明度和模糊。

**建議融入**：加入半透明 + blur 讓滾動時 topbar 有「浮」的高級感。

---

### 2. Panel / Card 有 box-shadow（柔陰影層次）

**Mockup**：
```css
.panel { box-shadow: var(--shadow-s); }  /* 0 1px 2px + 0 4px 14px */
.rcard { box-shadow: var(--shadow-s); }
.rcard:hover { box-shadow: var(--shadow-m); }
```

**現行**：大部分元素用 `--frame-shadow` token，dark 主題設為 `none`。
Nordic/kitty 有 `0 3px 0 rgba(...)` 的硬陰影（offset shadow），但這是「微硬風格」的選擇。

**建議**：不改光影（你確認喜歡微硬風格），但可加入 **hover 時陰影加深**（目前有 `--hover-shadow` 但部分元素沒套用）。

---

### 3. brand-dot 呼吸動畫

**Mockup**（L63-64）：
```css
.brand-dot { animation: pulse 2.4s infinite; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
```

**現行**：brand-dot 是靜態圓點，沒有動畫。

**建議融入**：加入微弱呼吸動畫讓 logo 有「活著的」感覺。

---

### 4. 全站 :focus-visible 統一定義

**Mockup**（L45）：
```css
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 6px; }
```

**現行**：只有個別元素有 focus 樣式，無全站通用規則。

**建議融入**：這正好是我 T96 已經提出的問題，mockup 的做法更簡潔——用一條通用規則蓋全站。

---

### 5. page 切換 fadeIn 動畫

**Mockup**（L109-110）：
```css
.page.active { animation: fadeIn .2s ease; }
@keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
```

**現行**：頁面切換沒有過渡動畫（Next.js App Router 預設無 transition）。

**建議融入**：用 CSS `@view-transition` 或簡單的 wrapper animation 加入頁面級 fade-in。

---

### 6. input / textarea 更大的 min-height 和 padding

**Mockup**（L128-131）：
```css
input { min-height: 42px; padding: 10px 13px; font-size: 13.5px; }
textarea { min-height: 62px; }
```

**現行**（globals.css ~L5900）：input 用 `border + border-radius + box-shadow` 但沒有設定 min-height。

**建議融入**：統一表單控件 min-height: 42px，提升觸控舒適度。

---

### 7. Modal 手機改底部抽屜（Sheet）

**Mockup**（L539-544）：
```css
@media(max-width:960px) {
  .modal-overlay { align-items: flex-end; padding: 0; }
  .modal-box { width: 100%; border-radius: var(--radius-l) var(--radius-l) 0 0; animation: sheetUp .22s ease; }
  .modal-hdr::before { /* 拉桿指示條 */ }
}
```

**現行**：`MobileTabbar.tsx` 的「更多」按鈕已用底部 sheet 模式（有 drag handle）。
但其他 modal（ApproveSummaryModal、Station3PublishModal、ExportPreflightModal）在手機仍是置中彈窗。

**建議融入**：所有 modal 在 ≤960px 時自動轉為底部 sheet。

---

## 新增 Task（T98–T106）

### T98 — Topbar 毛玻璃效果

| 屬性 | 值 |
|---|---|
| `.topbar` background | `color-mix(in srgb, var(--bg) 88%, transparent)` |
| backdrop-filter | `blur(8px)` |
| -webkit-backdrop-filter | `blur(8px)` |
| border-bottom | 保留現有 `var(--header-border-w)` |

#### Kitty 主題特殊處理
Kitty topbar 有 `--header-bg: #2f56bf`，改為：
```css
body[data-theme="kitty"] .topbar {
  background: color-mix(in srgb, #2f56bf 90%, transparent);
}
```

#### 驗收清單
- [ ] 滾動頁面時 topbar 下方內容透過模糊可見
- [ ] 三主題 topbar 背景色不變但多了透明度
- [ ] kitty 藍色 header 仍然是藍色（只是略透）
- [ ] 不影響 topbar 內按鈕的可讀性

---

### T99 — brand-dot 呼吸動畫

```css
.brand-dot {
  animation: brand-pulse 2.4s ease-in-out infinite;
}
@keyframes brand-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
@media (prefers-reduced-motion: reduce) {
  .brand-dot { animation: none; }
}
```

#### 驗收清單
- [ ] 品牌圓點有柔和呼吸效果
- [ ] reduced-motion 時靜態
- [ ] 三主題圓點色不受影響

---

### T100 — 全站 :focus-visible 通用規則

取代 T96 分散添加方式，用 mockup 的全站單一規則：

```css
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
/* 已有 box-shadow focus-ring 的 input 用原本的 */
input:focus-visible,
textarea:focus-visible,
select:focus-visible {
  outline: none;
  /* 保留現有 border-color + box-shadow: var(--focus-ring) */
}
```

#### 注意
此規則取代 T96 的分散添加方式。如果實施 T100，T96 可以跳過。

#### 驗收清單
- [ ] 所有按鈕/連結 Tab 聚焦時有 2px accent outline
- [ ] input/textarea 保持現有 focus-ring（不重複 outline）
- [ ] 三主題 outline 色 = 各主題 --accent

---

### T101 — 表單控件統一 min-height

```css
input[type="text"],
input[type="number"],
input[type="password"],
input[type="url"],
input[type="email"],
textarea,
select {
  min-height: 42px;
  padding: 10px 13px;
}
textarea {
  min-height: 62px;
}
```

#### 驗收清單
- [ ] 所有 input 至少 42px 高
- [ ] textarea 至少 62px 高
- [ ] 不影響 variant grid 內的小 input（那些有自己的 override）

---

### T102 — Modal 手機版轉底部 Sheet

```css
@media (max-width: 960px) {
  .modal-overlay {
    align-items: flex-end;
    padding: 0;
  }
  .modal-box {
    width: 100%;
    max-width: 100%;
    max-height: 88vh;
    border-radius: var(--radius-l) var(--radius-l) 0 0;
    animation: sheet-up 220ms ease;
  }
  .modal-hdr::before {
    content: '';
    position: absolute;
    top: 8px;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 4px;
    border-radius: 2px;
    background: var(--border-soft);
  }
}
@keyframes sheet-up {
  from { transform: translateY(30px); opacity: 0.6; }
  to { transform: none; opacity: 1; }
}
```

適用 modal：
- ApproveSummaryModal
- Station3PublishModal
- ExportPreflightModal
- RegenCopyModal
- ProductLibraryModal

（MobileTabbar 的「更多」sheet 已經是此模式。）

#### 驗收清單
- [ ] 手機上 modal 從底部滑入
- [ ] 有拉桿指示條
- [ ] 可滾動內容
- [ ] Escape 仍可關閉

---

### T103 — 頁面切換 fade-in 過渡

在 `shell-main` 添加：

```css
.shell-main > * {
  animation: page-enter 180ms ease-out;
}
@keyframes page-enter {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (prefers-reduced-motion: reduce) {
  .shell-main > * { animation: none; }
}
```

#### 注意
Next.js App Router 的頁面切換用 React transition，這個 CSS 只在首次 mount 時生效。
如果需要路由切換動畫，需要用 `next-view-transitions` 或 loading.tsx。

#### 驗收清單
- [ ] 頁面載入時有微弱 fade + slide-up
- [ ] reduced-motion 時無動畫
- [ ] 不影響 HMR / dev 體驗

---

### T104 — VariantEditor 的 2 處 window.confirm 改為 inline 確認

**現況**：`VariantEditor.tsx` L217 和 L253 仍用 `window.confirm`。

**規格**：改用 ResultCard 已有的 inline double-confirm pattern（UX-L T61 同模式）：
1. 第一次點擊 → 按鈕文字變紅色警告文字 + 顫抖動畫
2. 3 秒內再按 → 真的執行
3. 3 秒後 → 自動復原

具體元素：
- 「移除維度」按鈕 → 第一按顯示 "確定移除？{N}筆會丟失"，紅色，再按才執行
- 「重新展開」按鈕 → 第一按顯示 "確定展開？{N}筆會丟失"，紅色，再按才執行

#### 驗收清單
- [ ] 不再出現瀏覽器原生 confirm 彈窗
- [ ] 有 3 秒 auto-reset
- [ ] 警告文字色 = `var(--danger)`

---

### T105 — 按鈕 class 收斂（設計系統債——規格記錄）

**現況**：同為「主要大按鈕」角色的 class 有 10+ 個，各自定義 padding/weight/radius。

**建議收斂為**：
```
.button          — base reset
.button.primary  — accent bg
.button.success  — success bg
.button.danger   — danger bg/outline
.button.lg       — 14px 50px min-height（現 btn-gen）
.button.md       — 12px 40px min-height（現 act-btn）
.button.sm       — 11px 32px min-height（現 btn-mini）
```

**⚠ 此為架構重構**，影響面大（32 處引用），建議由 Fable 總指揮排入 refactor backlog，不建議現在做。

---

### T106 — 導覽命名一致性審查

**現況**（已驗證）：
- 桌機 sidebar：`label: "生圖工廠"`
- 手機 tabbar：`shortLabel: "工廠"` ← nav.ts L72 已改（不再叫「圖審」）
- 手機 tabbar 另一個：`label: "審核"` ← 實際是 pane=results（審文案）
- sidebar：`label: "新增商品"` ← 但 pane 內含「審核」結果卡片

**問題**：「審核」這個 tab 其實包含了三站（審文案→標圖→待發布），用「審核」太窄。

**建議命名方案**：

| 元素 | 現行 | 建議 |
|---|---|---|
| 手機 tab 2 | "審核" | "進度" 或 "管理" |
| 桌機 sidebar | "生圖工廠" | 不改（已清楚） |
| 手機 tab 3 | "工廠" | 不改（已清楚） |

**⚠ 這是產品/命名決策**，需要老闆確認。我只提出問題，不擅自改名。

---

## 第二批前次報告驗證（6 點論述）

### 論點 1 — 破壞性動作只靠 window.confirm
**驗證結果：⚠️ 大部分已修，剩 VariantEditor 2 處**

| 元件 | 狀態 |
|---|---|
| ResultCard（version switch / regen / collapse with dirty） | ✅ UX-L T61 inline double-confirm |
| DraftQueueList（批次上架） | ✅ UX-E T28 arm pattern（publishArm 狀態） |
| Station3PublishModal | ✅ singleWarn pattern |
| **VariantEditor.tsx L217, L253** | ❌ **仍用 window.confirm** |

→ 已列入 T104。

### 論點 2 — DraftStatus + PipelineStage 兩套語彙
**驗證結果：⚠️ 架構如描述，但 UI 已用 pipeline_stage 為主**

`domain.ts` 確實有 13 種 DraftStatus + 6 種 PipelineStage，註解寫「R2+ may retire status gradually」。
但看 `StageFilterPills` 和 `stationFilter.ts`，UI 篩選面已經主要用 pipeline_stage 的三站邏輯。
StatusBadge 仍然顯示 DraftStatus 的文字（「待生成」「已上架」等）。

**結論**：這是系統架構過渡期設計，使用者實際操作已被三站篩選引導，不需要同時記兩套。
**建議**：不做 UI 變更，但在 StatusBadge 旁加 tooltip 說明它屬於哪一站（如果使用者疑惑）。
→ 低優先，標為觀察不排 task。

### 論點 3 — StatusBadge 字串比對
**驗證結果：✅ 已修**

`StatusBadge.tsx` 已在 UX-H T41 重構為 **explicit map**（`STATUS_TONE` Record），不再用 `.includes("ready")`。
`csv_ready` 正確分類為 `"neutral"`（不是綠色），`archived` 分類為 `"archived"`。

### 論點 4 — 字級偏小 9-13px
**驗證結果：❌ 客觀事實存在，但需判斷是否要改**

globals.css 的字級分佈確實集中在 9-13px。但考量到：
- 這是**密集資訊型後台工具**，不是消費者面產品
- AGENTS.md 明確規定「核心 4 欄可見，其餘摺疊」的資訊密度策略
- 輔助標籤 9-10px 是業界後台常見做法

**建議**：
- 文案預覽 `.rc-text` 目前是 12.5px → 建議提升到 **14px**（閱讀性核心內容）
- 表單 input 內文保持 13.5px（已在合理範圍）
- 9px 只保留給真正的 badge/chip 小標籤
→ 新增 T107。

### 論點 5 — 沒有統一 Toast 元件
**驗證結果：✅ 已修**

`Toast.tsx` 已存在完整 Toast 系統（`ToastHost` + `showToast` CustomEvent），支援 success/error/warn/info 四種。
全站多處（ResultCard、DraftQueueList、WorkspaceInputPanel 等）已改用 `showToast()`。

### 論點 6 — 圖片缺少 alt
**驗證結果：✅ 已修**

逐項查驗所有 `<img>` 標籤：
- `ImageReviewPanel.tsx`: `alt={\`${title} 縮圖\`}`
- `ImageUploader.tsx`: `alt={zone.label}`
- `ResultCard.tsx`: `alt={\`${draft.title_zh || ...} 主圖\`}`, `alt={image.alt_text ?? slot}`
- `VariantEditor.tsx`: `alt={im.label}`, `alt="規格圖"`
- `FactoryBridgeStrip.tsx`: `alt={\`${item.title} 縮圖\`}`
- `ProductLibraryModal.tsx`: `alt={\`${title} 商品圖\`}`
- `ImageCompareSlider.tsx`: `alt="原圖"`, `alt="處理後（暫存）"`

全部有 alt。

---

## 第二批 Mockup 融合建議驗證

### 已做到的（不需再排）

| Mockup 建議 | 現行狀態 |
|---|---|
| Toast 元件 | ✅ Toast.tsx 完整實作 |
| 「再按一次確認」取代 confirm | ✅ ResultCard + DraftQueueList 已改（剩 VariantEditor → T104） |
| Modal 手機改底部 sheet | ✅ globals.css L2260-2268 已有（align-items:flex-end, radius 上圓下方, width:100%） |
| 圖片拖曳排序 | ✅ UX-D T22 已有（draggable, pthumb-dragging, pthumb-drag-over 樣式） |
| 軟刪除淡出效果 | ✅ UX-H T49 `.is-fading/.is-leaving { opacity:0.35; transition:0.25s }` |
| 圖片 alt 文字 | ✅ 全數補齊 |

### 尚未做到的（納入計畫）

| Mockup 建議 | 狀態 | 對應 Task |
|---|---|---|
| Topbar 毛玻璃 | ❌ 未做 | T98 |
| brand-dot 呼吸動畫 | ❌ 未做 | T99 |
| 全站 :focus-visible 通用規則 | ❌ 未做 | T100 |
| panel-hdr 全大寫標題質感 | ❌ 未做 | T107（新增） |
| 頁面切換 fade-in | ❌ 未做 | T103 |
| hover 雙層柔陰影（限 hover 態） | ❌ 未做 | T108（新增） |

---

## 新增 Task T107–T108

### T107 — 文案預覽字級提升 + panel-hdr 標題質感

#### 文案預覽字級
```css
.rc-text {
  font-size: 14px;  /* 原 12.5px */
  line-height: 1.8;
}
.rc-text.long {
  line-height: 1.95;
}
```

#### panel-hdr 標題質感（融合 mockup 精品感）
```css
.panel-header,
.panel-hdr {
  font-family: var(--font-space-grotesk), sans-serif;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}
```

**注意**：`text-transform: uppercase` 對中文無效（不是 bug，只是中文字自動忽略）。
如果 panel-hdr 內容是中文（如「商品資料」「圖片審核」），uppercase 不會產生效果，只對英文子串有效（如「IMAGE REVIEW」）。
建議：中文標題保持不動，僅在有英文的地方（如 header controls）生效。

#### 驗收清單
- [ ] 文案預覽字級從 12.5px → 14px
- [ ] panel-hdr 用 Space Grotesk 字體
- [ ] 中文 panel 標題不受 uppercase 影響
- [ ] 三主題文字仍可讀

---

### T109 — WorkspaceInputPanel inline notice 改為 Toast

**現況**：`WorkspaceInputPanel.tsx` 有 20+ 處用 `setMessage(...)` 顯示 inline `<div className="notice">` 在生成按鈕下方。這些提示卡在輸入區裡，不顯眼又佔空間，跟全站其他地方用 `showToast()` 的風格完全不統一。

**需改為 Toast 的 message 類型**：
| 類型 | 範例 | 改法 |
|---|---|---|
| 成功提示 | "生成完成，右側卡片可繼續編輯" | `showToast(msg, "success")` |
| 錯誤提示 | "建立草稿失敗"、"生成連線失敗" | `showToast(msg, "error")` |
| 進行中狀態 | "生成文案中..."、"儲存商品草稿中..." | 改為按鈕 loading 態（spinner + 文字），不用 notice |
| 表單驗證 | "庫存數量請填 0 或正整數" | **保留** `.field-msg` inline（表單驗證緊貼欄位是正確的） |
| 還原/暫存 | "已還原上次未完成的填寫" | `showToast(msg, "info")` |

**保留 inline 的**：
- `.field-msg`（表單欄位級錯誤）→ 正確做法，不改
- `.workspace-restore-notice`（gate message）→ 首次進入頁面的一次性提示，保留

**改為 Toast 的**：約 15 處 `setMessage(...)` 可以直接改成 `showToast()`。

#### 驗收清單
- [ ] 成功/錯誤/info 訊息改為底部 Toast
- [ ] 生成中/儲存中改為按鈕 loading 態
- [ ] 表單欄位驗證（.field-msg）保持 inline
- [ ] message state 清理後移除底部多餘的 notice 區塊

---

### T110 — Toast 樣式改為 Mockup 風格（圓潤 pill 型）

**現況 Toast 樣式**：surface 底 + 左側色條 + icon 圈（較保守）
**Mockup Toast 樣式**：`border-radius:999px; background:var(--accent); color:var(--accent-fg); padding:10px 22px;`（圓潤 pill、實心填色）

**建議新樣式**（融合兩者）：

```css
.toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 200px;
  max-width: 88vw;
  padding: 10px 20px;
  border: none;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 700;
  text-align: center;
  cursor: pointer;
  pointer-events: auto;
  animation: toast-in 0.18s ease;
}
.toast--success { background: var(--success); color: var(--on-solid); box-shadow: var(--shadow-m); }
.toast--error { background: var(--danger); color: var(--on-solid); box-shadow: var(--shadow-m); }
.toast--warn { background: var(--warn); color: var(--accent-fg); box-shadow: var(--shadow-m); }
.toast--info { background: var(--accent); color: var(--accent-fg); box-shadow: var(--shadow-m); }
```

**kitty warn 特殊處理**：`#ffd966` 太亮，改用 `color: var(--text)` (#171717)。

#### 驗收清單
- [ ] Toast 改為圓潤 pill 型
- [ ] 四種狀態各自填色
- [ ] 三主題下文字都可讀
- [ ] 移除左側色條 + icon 圈舊樣式

---

### T111 — 按鈕與輸入框過寬過大修正

**現況**：`.btn-gen` min-height:50px + width:100%，生成按鈕佔滿整行非常笨重。

**建議**：
| 元素 | 現行 | 建議 |
|---|---|---|
| `.btn-gen` | min-height:50px | min-height:**44px**, padding:12px |
| `.btn-gen` 文字 | font-size:14px | font-size:**13px** |
| `.btn-add` 獨立 | width:100% 有些場景 | width:**auto**, min-width:120px |
| `.act-btn` | min-height:40px | min-height:**38px**, padding:7px 13px |

**原則**：44px 是觸控標準上限，50px 是過胖。

#### 驗收清單
- [ ] 生成按鈕高度 50→44px
- [ ] 獨立 .btn-add 不再 full-width
- [ ] 手機版觸控目標仍 ≥ 44px

---

### T108 — hover 態補充雙層柔陰影

目前 `--hover-shadow` 是單層：`0 4px 12px rgba(0,0,0,.22)`（dark）/ `0 3px 0 rgba(...)` (nordic/kitty)。

Mockup 的 hover 是雙層更柔和的陰影。建議只更新 dark 主題的 --hover-shadow：

```css
/* dark 主題 */
--hover-shadow: 0 2px 4px rgba(0, 0, 0, .18), 0 8px 24px rgba(0, 0, 0, .22);
```

Nordic/kitty 保留現在的硬偏移風格（你確認喜歡）：
```css
/* nordic/kitty 不改 */
--hover-shadow: 0 3px 0 rgba(26, 26, 26, .07);
```

**保留不動的**：
- `--card-active-shadow`（6px 6px 0 硬貼紙感）→ 這是品牌辨識度最高的視覺元素，不要碰
- `--pill-active-shadow`（2px 2px 0）→ 同上

#### 驗收清單
- [ ] dark 主題 hover 卡片有更柔和的雙層陰影
- [ ] nordic/kitty hover 陰影不變
- [ ] 選取態（.sel--fill, .active）仍是硬偏移貼紙風
- [ ] 不影響 transform: translateY(-1px) 的 hover lift
