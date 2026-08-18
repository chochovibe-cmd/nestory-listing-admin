# Nestory — UI/UX Regression Audit

> 目的：記錄最近 UIUX 修改中，哪些 commit 已確認有回歸、哪些高風險、哪些尚需驗證。
> 原則：不要憑印象整包 revert；先找正常錨點，再做小範圍修復。

更新基準：2026-08-18

## 0. 快速結論

| 分類 | Commit / 範圍 | 結論 |
|---|---|---|
| ✅ 相對乾淨 | `2ee67a7` B3-P01 | 單一 WorkspaceInputPanel 上傳互動，scope 清楚 |
| ✅ 相對乾淨 | `862c175` B3-P03 | 把重複 mobile stage-filter CSS 收斂到單一 959 block |
| ✅ 相對低風險 | `6ba1856` B3-P05 | workspace-input-panel scoped 純 CSS 視覺分層 |
| 🟡 中風險 | `d1fe39b` B3-P02 | 重構 ResultPanel 批次操作 DOM + sticky/batch layout |
| 🟠 高風險 | `ba7d69d` B3-P04 | mobile long-press、多選、swipe state 與 touch gesture |
| 🟠 高風險 | `e798b5a` B3-P06 | VariantEditor DOM/CSS/drag/mobile long-press/portal 同包 |
| 🟠 高風險 | `6af3a25` B4-P03 | 名義 UX，實際改 Variant auto-expand/duplicate row 功能 |
| 🟠 高風險 | `47a96c4` B4-P04 | 手機 ResultCard 大幅改 grid，並隱藏原 checkbox/quick row |
| 🔴 已知回歸 | `754a879` B4-P06 | fail reason flex 曾撐壞 desktop header，後續另補修 |
| 🟠 高風險 | `5f73952` B4-P07 | 大範圍 overflow-x:clip / containment，可能裁浮層 |
| 🔴 已知來回 | `159721e` → `8c7db19` | P08 縮圖方案做完後 P09 又還原到 B2-P10 |
| ⚠️ scope 污染 | `2b5d3f7` B4-P01 | Tags commit 同時帶入 Variant layout CSS |

## 1. 已確認有回歸／補救歷史

### `754a879` — B4-P06 fail reason 進 title row
目的：把失敗原因移到標題旁，並讓失敗狀態更緊湊。

風險／結果：
- `.rc-fail-reason` 改成 flex item，曾使用 `flex: 1 1 10em`。
- 後續 `24c8d9b` 專門修「長失敗文案把 desktop header 撐亂」。

結論：
- 這是一個已被 Git 歷史證實的 UI regression。
- 後續若再改 ResultCard header，要把 title/fail/status/chips 當同一組測。

### `159721e` → `8c7db19` — B4-P08 / P09 圖片縮圖來回
P08：
- 改成 wrap
- 72/96 square thumbs
- spec badge 移到圖下
- remove control 位置重做

P09：
- 明確撤 P08，還原到 B2-P10 錨點 `2cc900b`
- nowrap horizontal scroll
- 96/120 thumbs
- spec badge 右上、remove 左上

結論：
- 圖片輸入區在短時間內被反覆改動。
- 目前應以 P09 / B2-P10 還原邏輯為基準，不應再從 P08 文件推導現況。

## 2. B3 稽核

### `2ee67a7` — B3-P01 source screenshot upload
改動集中在 `WorkspaceInputPanel.tsx`：desktop 點文字輸入區會開檔案選擇器；mobile 改純提示，同時保留貼上辨識。

判定：**相對乾淨**。
- 單一元件。
- 沒有全域 CSS 大改。
- 沒有 API / 資料結構變更。

仍需實機驗證：desktop 是否會重複觸發 file dialog、mobile 點卡片是否仍能正確開檔。

### `d1fe39b` — B3-P02 ResultPanel 批次操作重構
改動不是純樣式：
- 全選搬到 header。
- 原本 `results-batch-toolbar` JSX 退休，改成只有選取時才渲染 `.rc-batch-strip`。
- sticky / mobile 行為同步重做。

判定：**中風險**。

原因：它重構了操作 DOM 與 selection UI，後面的 B3-P04 長按多選、B4-P04 手機卡片又建立在這個 selectedIds 模型上。因此若出現「選取後按鈕消失／批次條錯位／手機多選怪異」，要從 P02 一起看，不能只怪 P04。

### `862c175` — B3-P03 stage filter mobile CSS consolidation
主要刪掉散落在 640/960/nordic 區塊中的重複規則，集中為一個 `max-width:959px` override。

判定：**相對乾淨，而且方向正確**。

理由：這種「移除重複 selector、建立單一 mobile source」正是目前 globals.css 應採用的方向。

仍需驗證：stage pills 橫滑、scope/sort 兩個 select 在窄手機是否各半寬且不爆版。

### `ba7d69d` — B3-P04 mobile long-press + swipe
改動包含：
- `selectedIds` 多選模式互動。
- touch start/move/end gesture 判斷。
- 500ms long press。
- swipe open peer state。
- swipe action layer / transform。
- expanded/selectMode/sequentialMode 多重互斥。

判定：**高風險功能型 UI commit**。

需要專項驗證：
- 滾動頁面時不可誤觸 long press。
- 點表單/按鈕不能被 header gesture 吃掉。
- 左滑後再點展開、長按、切站別應正確關閉 swipe。
- 多選模式退出後不能殘留 swipeX。

### `6ba1856` — B3-P05 input panel visual hierarchy
主要 scope 在 `.workspace-input-panel` 的純 CSS 視覺分層。

判定：**相對低風險**。

雖仍需三主題實機驗證，但不像主要功能 regression 來源。

### `e798b5a` — B3-P06 VariantEditor 大改
目的：Variant B-layout、拖曳排序、選圖放大。

風險：
- 同時改 CSS、DOM、交互、drag、mobile long-press、portal preview。
- `.v-pop-pick` / `.pick-grid` 使用 overflow visible，而後面的 P07 containment 可能互相衝突。

判定：**高風險**。

待查：
- desktop hover zoom 是否被裁。
- mobile long-press portal 是否仍正常。
- row reorder / up-down 是否會影響輸入欄布局。
- menu 在窄欄是否位移。

## 3. B4 高風險與 scope 問題

### `5f73952` — B4-P07 workbench containment
目的：解決 desktop 左右欄互相覆蓋。

主要改動：
- grid 改 `minmax(0, ...)`
- `.panel.results-panel` / `.panel.workspace-input-panel` 加 `overflow-x: clip`
- `.panel-body` / `.results-list` 也加 containment
- 多個 form controls / cards 加 `max-width:100%`、`min-width:0`

風險：
- 會修 overflow，但也可能裁掉 popover / badge / zoom preview / absolute controls。
- P08 的歷史紀錄已提到 P07 clip 會加劇 thumb/角標問題。

待查：
- Variant image picker hover preview
- dropdown / overflow menu
- thumbnail remove/spec badge
- result-card swipe layer
- sticky toolbar/footer

### `6af3a25` — B4-P03 Variant auto-expand
名義：UX 改善。
實際：功能行為變更。

改動：
- add/drop axis value 後自動 expand/merge rows
- 新增 duplicate row
- manual expand CTA 語義改變

判定：**高風險功能變更**。

如果使用者感覺「規格欄位自己變了／款式列數量怪／輸入後突然重排」，必須查這包邏輯，不可只調 CSS。

### `47a96c4` — B4-P04 mobile ResultCard 三排
不只是 spacing：
- mobile header grid 從舊結構改成 `title / thumb+chips / regen+price` 三排。
- mobile 直接 `display:none` checkbox 與原 quick-row。
- `.rc-headmain` 改 `display:contents`。
- 新增 mobile regen slot。
- 新增 gesture hint + localStorage 狀態。

判定：**高風險結構性 UI commit**。

它與 B3-P04 gesture、多選高度耦合；若手機版「框框移位、某按鈕不見、標題/價格位置怪」，優先看這包。

### `2b5d3f7` — B4-P01 Tags scope 污染
commit 名稱主要是 Tags，但同時包含 Variant layout/CSS 變更，例如：
- `.vh-dim-row`
- `.vh-dim-type`
- `.v-row-actions`
- duplicate row 樣式

影響：
- 之後用 commit 名稱追 regression 容易誤判。
- 未來應強制「一個元件／一個 regression 一個 commit」。

## 4. 我目前認為最可能對應你描述的問題

如果症狀是「欄位變形、框框移位、浮層被切掉」：
1. `5f73952` P07 containment
2. `e798b5a` Variant popover / zoom
3. `47a96c4` mobile ResultCard grid
4. `2b5d3f7` 混入的 Variant CSS

如果症狀是「原本能操作，UI 優化後某功能行為變了」：
1. `6af3a25` Variant auto-expand
2. `ba7d69d` long-press / swipe
3. `d1fe39b` selection/batch toolbar restructuring

## 5. 建議修復策略

不要：
- revert 整個 B3/B4
- 一次重寫 `globals.css`
- 邊整理文件邊改 UI

要：
1. 先確認現在實際錯誤畫面。
2. 對應到元件與相關 commit。
3. 找最後正常 commit 錨點。
4. 做最小 diff。
5. desktop + mobile + dark/nordic/kitty 驗證。
6. 一個 regression 一個 commit。

## 6. 下一輪 audit 優先順序

1. **P07 containment 對 Variant/image popover 的實際 selector 路徑**。
2. **VariantEditor B3-P06 + B4-P03 疊加後的 DOM/功能互動**。
3. **ResultCard B3-P02 + B3-P04 + B4-P04 + B4-P06 疊加效果**。
4. `globals.css` 中 `.result-card`、`.variant-*`、`.workspace-input-panel` 同 selector 多次 override 的區域。

此文件是 audit 索引，不替代實際 source / Git diff。
