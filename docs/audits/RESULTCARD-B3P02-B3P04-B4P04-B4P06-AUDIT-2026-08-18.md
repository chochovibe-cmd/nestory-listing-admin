# ResultCard B3-P02 + B3-P04 + B4-P04 + B4-P06 Audit — 2026-08-18

> 範圍：結果列表批次操作、手機長按/左滑、三排 ResultCard、fail reason header。
> 原 audit 保留在下方；修復進度以本段更新為準。

## 2026-08-18 修復狀態更新

### P0-A mobile selectMode expand affordance — 已實作，待手機驗證/merge

分支：`agent/p0-mobile-resultcard-expand`
canonical：branch HEAD / commit message `fix(mobile): restore ResultCard expand affordance`

已確認 root cause 不在 ResultCard handler：
- `handleHeaderClick()` 在 mobile selectMode 會 toggle selection，這是原設計。
- `.rc-toggle` 本身會 `stopPropagation()` 後呼叫 `tryToggleExpand()`，也是正確的。
- regression 是 B4-P04 mobile CSS 隱藏整個 `.rc-quick-row`，把唯一 toggle 一起藏掉。

本輪最小修法：
- 新增 `src/app/stabilization.css`，只在 `max-width:959px` 生效。
- `.rc-quick-row { display: contents }`，但 `.rc-quick` / `.rc-dismiss-btn` 繼續隱藏。
- 只恢復原有 `.rc-toggle`，44×44px；title row 預留右側 48px。
- `layout.tsx` 在 `globals.css` 後載入 hotfix。
- 新增 `verify-mobile-resultcard-expand.mjs` 並納入 `verify:all`。

本輪**沒有**處理下方 P0/P1-B touch gesture 冒泡；那是下一個獨立 P1-1，避免把兩個 regression 混成一包。

待驗證：normal tap、long-press 進多選、多選中 toggle 展開/收合、退出多選、窄手機長標題、專用 verifier/typecheck。

---

## 快速結論（原 audit）

已確認 3 個需要處理的交叉問題：

1. **手機多選模式沒有可見的展開入口**
2. **手機 visible action（重生）沒有隔離 touch gesture，長按/水平移動會冒泡到 card header**
3. **B4-P04 新增的 localStorage gesture hint 會被現有 `verify-no-secrets.mjs` 視為錯誤**

另外：B4-P06 的 desktop fail-reason 撐版問題目前 source 已有後續修正，不應再次整包 revert。

---

## P0-A — 手機多選模式無法依原設計展開卡片

### 程式邏輯
`handleHeaderClick()`：
- normal mobile：tap header → expand/collapse
- `selectMode=true`：tap card → toggle selection，**不 expand**
- 程式註解明確寫：`expand via ▸ only`

### B4-P04 CSS
`@media (max-width:959px)`：
- `.rc-checkbox { display:none }`
- `.rc-quick-row { display:none }`

但 `rc-toggle`（▸ / ▾）就在 `.rc-quick-row` 裡。

### 結果
進入 multi-select 後：
- tap card 只會選取/取消
- 原本設計宣稱唯一可展開的 ▸ 被 CSS 隱藏
- 使用者沒有可見的 expand control

判定：**已確認交叉 regression。**

### 原修復方向
不要重新顯示整條 desktop quick row。
應該只提供 mobile 專用 compact expand control，或讓 selectMode 下某個明確 gesture/按鈕可展開。

> 狀態更新：已採用「只恢復既有 compact toggle」方案，詳見本檔最上方。

---

## P0/P1-B — 手機重生按鈕的 touch 事件會冒泡到 header gesture

B4-P04 mobile 第 3 排會顯示 `rc-m-regen-slot`。

目前 wrapper 只有：
- `onClick(event => event.stopPropagation())`

但整個 `.rc-header` 有：
- `onTouchStart={handleHeaderTouchStart}`
- `onTouchMove={handleHeaderTouchMove}`
- `onTouchEnd={handleHeaderTouchEnd}`

### 影響
在 mobile：
- 使用者長按「重生」約 500ms，header 的 long-press timer 仍可能觸發 `onToggle()`，把卡片加入多選
- 在重生按鈕上水平移動，也可能進入 card swipe 判斷
- click 最後雖被 stopPropagation，但 touch gesture 已經先執行

判定：**已確認事件冒泡路徑；需實機確認體感嚴重度。**

### 修復方向（下一個 P1-1）
建立共用 interactive-target guard，而不是每個按鈕散加 touch stop：
- header gesture handler 遇到 `button/input/select/textarea/a/[role=button]` 等 interactive target 直接 return
- 或使用明確的 `data-no-card-gesture`

這比在每個子按鈕補 `onTouchStart stopPropagation` 更穩。

---

## P1-C — B4-P04 gesture hint 造成 verifier drift

`DraftResultsPanel.tsx`：
- `window.localStorage.getItem(RC_GESTURE_HINT_KEY)`
- `window.localStorage.setItem(...)`

`verify-no-secrets.mjs`：
- 對所有 `src/**` 搜 `/localStorage/i`
- 只有 allowlist 內檔案放行
- allowlist **沒有** `src/components/listing/DraftResultsPanel.tsx`

所以目前靜態規則下，`verify:no-secrets` 會把 DraftResultsPanel 判成：
`browser localStorage usage`

判定：**確定的 verifier mismatch。**

注意：這不是唯一 localStorage drift；其他合法 autosave 也已有類似問題。因此修 verifier 時應重新定義「禁止 secret 存 browser」，不要只一直擴充檔名 allowlist。

---

## B4-P06 — fail reason desktop header 現況

B4-P06 原本曾把 `.rc-fail-reason` 設成 `flex:1 1 10em`，後續造成 desktop header 被長文撐亂。

目前 source 已修成：
- `flex:0 1 auto`
- `max-width:min(100%, 36em)`
- `min-width:0`

判定：**目前已有針對性補修。**

所以後續如果手機 title row 還亂，不要直接 revert B4-P06；應查 B4-P04 mobile grid + title/chip 內容長度。

---

## B3-P02 + B3-P04 selection coupling

B3-P02 把：
- 全選搬到 header
- 批次動作改成選取後才出 `.rc-batch-strip`

B3-P04 再把：
- long press 作為進入 selection mode 的主要 mobile 手勢
- selectMode 下 card tap 改成 toggle selection

這兩包本身可以共存，但 B4-P04 把 checkbox/quick row 全隱藏後，mobile selection mode 變得高度依賴 gesture，缺少明確 secondary escape / expand affordance。

目前「取消」仍存在 batch strip，Esc 主要是 desktop 鍵盤路徑。

---

## archived mobile action — 待驗證

current mobile CSS 會隱藏整個 `.rc-quick-row`；而 `swipeEnabled` 明確要求 `!isArchived`。

quick row 內有 archived 狀態的「解除封存」按鈕。

因此需實機/完整 source 再確認：
- archived card 展開 body 是否另有解除封存入口
- 若沒有，mobile archived card 可能失去主要 unarchive action

這一點目前標為**待驗證，不先宣稱 bug**。

---

## 修復順序（更新）

1. ~~P0-A mobile selectMode expand affordance~~ — 已實作，待手機驗證/merge
2. P1-B interactive target gesture guard — **下一個主線**
3. P1-C verifier localStorage policy
4. archived mobile unarchive action 實機確認
5. 長 title / fail / chips 的 mobile grid 壓力測試

## 不建議

- 不要恢復整條 mobile desktop quick row
- 不要拿掉 long-press/swipe 全功能
- 不要 revert 整個 B4-P04
- 不要為了 localStorage 直接關掉 no-secrets check

## 下一位 Agent 接手

先讀：
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `docs/STABILIZATION_PLAN.md`
- `docs/CHANGELOG.md`
- 本檔

P0-A 已有修復分支，**不要重做 P0-3**。下一個修復是 P1-1：集中隔離 interactive child 的 touch gesture。
