# ResultCard B3-P02 + B3-P04 + B4-P04 + B4-P06 Audit — 2026-08-18

> 範圍：結果列表批次操作、手機長按/左滑、三排 ResultCard、fail reason header。
> 原 audit 保留在下方；修復進度以本段更新為準。

## 2026-08-18 修復狀態更新

### P0-A mobile selectMode expand affordance — 已實作，待手機驗證/merge

分支：`agent/p0-mobile-resultcard-expand`
canonical：branch HEAD / `fix(mobile): restore ResultCard expand affordance`

- root cause 是 B4-P04 CSS 隱藏 `.rc-quick-row`，不是 ResultCard toggle handler。
- mobile-scoped hotfix 只恢復既有 44×44 `.rc-toggle`；quick/dismiss 繼續隱藏。
- `verify:mobile-resultcard-expand` 已接入。

### P1-B interactive target gesture guard — 已實作，待手機驗證/merge

分支：`agent/p1-mobile-gesture-guard`
canonical：branch HEAD / `fix(mobile): isolate ResultCard controls from card gestures`

已實作：
- 新增 `cardGestureTarget.ts`：集中辨識 native controls、role button/link、contenteditable、`data-no-card-gesture`。
- `handleHeaderTouchStart()` 在 `onGestureStart` 與 long-press timer 前先 guard；interactive touch 不再交給 card gesture。
- `handleHeaderTouchMove()` / `handleHeaderTouchEnd(event)` 也 guard interactive target。
- blank card surface 的 long-press/swipe 保留。
- 新增 `verify-mobile-resultcard-gesture-guard.mjs`；已補 package script / `verify:all` wiring。
- verifier 額外鎖定 ResultCard tab active predicate，避免整檔替換再次把 `activeTab === tab.id` 誤改。

目前 code/verifier diff 相對 P0-3 已確認只含 5 檔，沒有 CSS/API/DB/Shopify/Variant 改動。

待驗證：長按重生不進多選、toggle/重生上水平移動不拖卡、空白卡面 gesture 正常、專用 verifier/typecheck。

下一個主線改為 **P1-C verifier localStorage policy**；P07 Variant clipping 則由 P07 audit/plan 繼續處理。

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

> 狀態更新：已採用「只恢復既有 compact toggle」方案。

---

## P0/P1-B — 手機重生按鈕的 touch 事件會冒泡到 header gesture

B4-P04 mobile 第 3 排會顯示 `rc-m-regen-slot`。

原本 wrapper 只有：
- `onClick(event => event.stopPropagation())`

但整個 `.rc-header` 有：
- `onTouchStart={handleHeaderTouchStart}`
- `onTouchMove={handleHeaderTouchMove}`
- `onTouchEnd={handleHeaderTouchEnd}`

### 原影響
在 mobile：
- 使用者長按「重生」約 500ms，header 的 long-press timer 可能觸發 `onToggle()`
- 在重生按鈕上水平移動，也可能進入 card swipe 判斷
- click 最後雖被 stopPropagation，但 touch gesture 已先執行

判定：**已確認事件冒泡路徑。**

### 原修復方向
建立共用 interactive-target guard，而不是每個按鈕散加 touch stop。

> 狀態更新：此方案已在 P1-1 分支實作；仍待手機實機驗證。

---

## P1-C — B4-P04 gesture hint 造成 verifier drift

`DraftResultsPanel.tsx`：
- `window.localStorage.getItem(RC_GESTURE_HINT_KEY)`
- `window.localStorage.setItem(...)`

`verify-no-secrets.mjs`：
- 對所有 `src/**` 搜 `/localStorage/i`
- 只有 allowlist 內檔案放行
- allowlist **沒有** `src/components/listing/DraftResultsPanel.tsx`

所以目前靜態規則下，`verify:no-secrets` 會把 DraftResultsPanel 判成 `browser localStorage usage`。

判定：**確定的 verifier mismatch。**

注意：其他合法 autosave 也有類似問題。修 verifier 時應重新定義「禁止 secret 存 browser」，不要只擴檔名 allowlist。

---

## B4-P06 — fail reason desktop header 現況

B4-P06 原本曾把 `.rc-fail-reason` 設成 `flex:1 1 10em`，後續造成 desktop header 被長文撐亂。

目前 source 已修成：
- `flex:0 1 auto`
- `max-width:min(100%, 36em)`
- `min-width:0`

判定：**目前已有針對性補修。**

---

## B3-P02 + B3-P04 selection coupling

B3-P02 把全選搬到 header、批次動作改成選取後才出 `.rc-batch-strip`；B3-P04 再把 long press 作為 mobile 多選入口、selectMode card tap 改成 toggle selection。

B4-P04 隱藏 checkbox/quick row 後，mobile selection 高度依賴 gesture；P0-3 / P1-1 分別補回 expand affordance 與 interactive touch isolation。

---

## archived mobile action — 待驗證

mobile CSS 隱藏 `.rc-quick-row`，而 `swipeEnabled` 要求 `!isArchived`；quick row 內又有 archived 的解除封存按鈕。

仍需確認 expanded body 是否另有解除封存入口；沒有證據前不宣稱 bug。

---

## 修復順序（更新）

1. ~~P0-A mobile selectMode expand affordance~~ — 已實作，待驗證/merge
2. ~~P1-B interactive target gesture guard~~ — 已實作，待驗證/merge
3. **P1-C verifier localStorage policy**
4. archived mobile unarchive action 實機確認
5. 長 title / fail / chips mobile grid 壓力測試

## 不建議

- 不恢復整條 mobile desktop quick row
- 不拿掉 long-press/swipe
- 不 revert 整個 B4-P04
- 不為了 localStorage 直接關掉 no-secrets check

## 下一位 Agent 接手

先讀 `AI_START_HERE.md`、`CURRENT_STATUS`、`STABILIZATION_PLAN`、`CHANGELOG` 與本檔。

**不要重做 P0-3 / P1-1。** ResultCard 下一個直接問題是 P1-C localStorage verifier policy；另一路主線是 P07 Variant desktop clipping。
