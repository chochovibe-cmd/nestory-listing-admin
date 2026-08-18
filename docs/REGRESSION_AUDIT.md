# Nestory — UI/UX Regression Audit

> 目的：記錄最近 UIUX 修改中，哪些 commit 已確認有回歸、哪些高風險、哪些尚需驗證。
> 原則：不要憑印象整包 revert；先找正常錨點，再做小範圍修復。

更新基準：2026-08-18

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

## 2. 高風險 commit

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

### `e798b5a` — B3-P06 VariantEditor 大改
目的：Variant B-layout、拖曳排序、選圖放大。

風險：
- 同時改 CSS、DOM、交互、drag、mobile long-press、portal preview。
- `.v-pop-pick` / `.pick-grid` 使用 overflow visible，而後面的 P07 containment 可能互相衝突。

待查：
- desktop hover zoom 是否被裁
- mobile long-press portal 是否仍正常
- row reorder / up-down 是否會影響輸入欄布局
- menu 在窄欄是否位移

### `6af3a25` — B4-P03 Variant auto-expand
名義：UX 改善。
實際：功能行為變更。

改動：
- add/drop axis value 後自動 expand/merge rows
- 新增 duplicate row
- manual expand CTA 語義改變

風險：
- 這不是純 UI commit。
- 若使用者感覺「欄位或規格流程被改壞」，這包必須一起查邏輯，不可只看 CSS。

## 3. Commit scope 污染

### `2b5d3f7` — B4-P01 Tags
commit 名稱主要是 Tags，但同時包含 Variant layout/CSS 變更，例如：
- `.vh-dim-row`
- `.vh-dim-type`
- `.v-row-actions`
- duplicate row 樣式

影響：
- 之後用 commit 名稱追 regression 容易誤判。
- 未來整理時要避免「UI 一包順手改另一個模組」。

## 4. 手機結果卡需專項驗證

相關：
- `ba7d69d` — B3-P04 mobile long-press + swipe actions
- `47a96c4` — B4-P04 mobile result card 3-row layout

需要測：
- 長按多選
- 左滑快捷
- swipe 與展開是否互斥
- swipe 與 card hover/transform 是否互斥
- 三排 grid 在長標題、長 fail reason、多 chips、價格區是否爆版
- 觸控區是否 >=44px

## 5. 相對低風險

### `6ba1856` — B3-P05 input panel visual hierarchy
目前看到的改動主要 scope 在 `.workspace-input-panel` 的純 CSS 視覺分層。

雖仍需實機驗證三主題，但相較上面幾包，較不像功能 regression 來源。

## 6. 建議修復策略

不要：
- revert 整個 B3/B4
- 一次重寫 `globals.css`
- 邊整理文件邊改 UI

要：
1. 先確認使用者現在實際看到的錯誤畫面
2. 對應到元件與相關 commit
3. 找最後正常 commit 錨點
4. 做最小 diff
5. desktop + mobile + dark/nordic/kitty 驗證
6. 一個 regression 一個 commit

## 7. 下一輪 audit 優先順序

1. P07 containment 對 Variant/image popover 的影響
2. VariantEditor B3-P06 + B4-P03 的 DOM/功能互動
3. ResultCard B3-P04 + B4-P04 + B4-P06 的疊加效果
4. `globals.css` 中同 selector 多次 override 的區域

此文件是 audit 索引，不替代實際 source / Git diff。
