# P07 Containment Audit — 2026-08-18

> 範圍：只稽核 `5f73952`（UX-B4-P07）造成的水平 containment 交叉影響。
> 原則：本輪不修功能、不改 `src/`；只確認 selector / DOM 路徑並留下可接手紀錄。

## 結論摘要

### A. 已確認高可信交叉風險：Variant 桌機圖片 hover preview

路徑：
`WorkspaceInputPanel` → `.panel.workspace-input-panel` → `.panel-body` → `VariantEditor(.variant-box)` → `.vthumb-wrap` → `.v-pop-pick` → `.pick-grid .pk .pk-zoom-preview`

相關 CSS：
- P07：`.workspace-input-panel .panel-body { overflow-x: clip; }`
- Variant picker：`.v-pop-pick { width:260px; overflow:visible; }`
- hover preview：`.pk-zoom-preview { position:absolute; width:160px; left:50%; transform:translateX(-50%); }`

判定：**高可信會互相衝突。**

原因：桌機 hover preview 仍在 WorkspaceInputPanel DOM 樹內，不是 portal；只要 preview 或 picker 超出祖先 panel 的水平 padding box，就會被 `overflow-x:clip` 裁掉。

目前建議：不要整包撤 P07。修復時優先考慮：
1. hover preview 改 portal / fixed layer；或
2. picker 在接近左右邊界時做 collision-aware positioning；或
3. 只針對真正需要溢出的局部 ancestor 調整，不移除整個 workbench containment。

### B. 手機 Variant 長按圖片預覽：目前較安全

手機預覽透過 `createPortal(..., document.body)` 顯示 `.pk-zoom-modal`。

判定：**P07 不是主要風險。**

因為 portal 已脫離 `.workspace-input-panel .panel-body` 的 clipping ancestor。

仍需實機測試 long-press gesture，但那屬 B3-P06 gesture 本身，不是 P07 containment。

### C. Variant `⋯ 更多` menu：有理論風險，但目前沒有證據顯示是主要回歸

路徑：`.vh-more { position:relative }` → `.vh-more-menu { right:0; width:200px }`，其底層是 `.pop-menu { position:absolute; z-index:50 }`。

判定：**中低風險。**

理由：menu 從右側按鈕向左展開，正常桌機欄寬下通常仍位於 panel 內；但如果可用寬度小於 200px、或 toolbar 被其他內容擠壓，仍可能撞到 P07 clip。

實機驗證點：
- desktop 960px 附近斷點
- 長維度名稱 / toolbar 被擠壓時
- kitty/nordic/dark 三主題尺寸差異

### D. `新增規格類型` / `依角色建立` inline pop：P07 風險較低

`.vh-inline-pop` 已改成 `position:relative; width:100%; max-width:280px;`，保留在文件流中。

判定：**低風險。**

這類 inline panel 不依賴越過父層水平邊界顯示，因此不應因 P07 直接消失。

### E. 圖片輸入縮圖角標：主要嫌疑不是 P07，而是 `.pthumb-strip` 自己

現況：
- `.pthumb-strip { overflow-x:auto; flex-wrap:nowrap; }`
- `.pthumb-badge { top:-8px; left:-8px; }`
- remove button 已在圖內 `top:6px; left:6px`
- spec badge 已在圖內 `top:6px; right:6px`

判定：
- remove / spec badge：P07 造成裁切的風險低，因為目前都在縮圖盒內。
- main badge 使用負座標，若看到被裁，**先查 `.pthumb-strip` 自己的 scroll overflow**，不要先怪 P07。

注意：`overflow-x:auto` 會讓該 strip 本身形成 scroll containment；所以 P09 還原後若有角標問題，可能是 B2-P10/P09 的既有布局特性。

### F. ResultCard swipe：P07 不是主要嫌疑

現況：
- `.rc-swipe-wrap { position:relative; overflow:hidden; max-width:100%; }`
- `.rc-swipe-actions` absolute 貼右
- `.rc-swipe-front` 以 translateX 滑動

判定：**P07 低風險。**

swipe 自己就刻意用 wrapper `overflow:hidden` 來露出右側 action；外層 `.results-list { overflow-x:clip }` 沒有改變核心機制。

如果 swipe 壞掉，應優先查 B3-P04 的 touch / state / transform 邏輯，以及 B4-P04 mobile grid，而不是先改 P07。

### G. Sticky batch / generate footer：目前沒有看到 P07 直接破壞 vertical sticky 的證據

P07 使用：
- `overflow-x:clip`
- `overflow-y:visible`

而且原始註解就是為了避免舊 `overflow:hidden` 破壞 sticky。

判定：**目前低風險，但仍需 browser 實機驗證。**

`.rc-batch-strip` 仍是 `position:sticky; top:0`；P07 的 horizontal clip 不應等同把祖先變成 vertical scroll container。

## 修復優先序（等正式進入修復階段）

1. Variant desktop image picker / hover zoom（最高）
2. 實機確認 `.vh-more-menu` 邊界
3. 縮圖 main badge 是否被 `.pthumb-strip` 自己裁切
4. swipe / sticky 只做驗證，不先改 P07

## 不建議的修法

- 不要直接刪除所有 `overflow-x:clip`
- 不要把 `.panel` 改回 `overflow:visible`，否則可能復發左右欄互相覆蓋
- 不要為了 hover zoom 再加全域 `!important`
- 不要把 Variant / ResultCard / uploader 一次混成同一個修復 commit

## 下一位 Agent 接手

先讀：
1. `AI_START_HERE.md`
2. `docs/CURRENT_STATUS.md`
3. `docs/REGRESSION_AUDIT.md`
4. 本檔

下一個 audit：**VariantEditor B3-P06 + B4-P03 疊加後的功能與欄位變形**。
