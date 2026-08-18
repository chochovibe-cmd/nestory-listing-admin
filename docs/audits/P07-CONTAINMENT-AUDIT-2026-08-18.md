# P07 Containment Audit — 2026-08-18

> 範圍：只稽核 `5f73952`（UX-B4-P07）造成的水平 containment 交叉影響。
> 原 audit 保留在下方；修復進度以本段更新為準。

## 2026-08-18 修復狀態更新

### P1-2 Variant desktop hover preview containment — 已實作，待 desktop 實機/merge

分支：`agent/p1-variant-picker-clipping`
canonical：branch HEAD / commit message `fix(ui): keep Variant hover preview inside picker`

本輪重新確認後，最明確的 P07 交叉問題是 **picker 內 160px desktop hover preview 的水平溢出**：
- picker `260px`
- tile `72px`
- gap `8px`
- flex-wrap 現況形成三欄
- preview 原本每格置中 `left:50% + translateX(-50%)`

因此第 1 / 第 3 欄 preview 會超出 picker 水平邊界，之後被 WorkspaceInputPanel 的 P07 `overflow-x:clip` 裁掉。

本輪採用最小 collision-aware CSS：
- **不移除** `.panel.workspace-input-panel` / `.workspace-input-panel .panel-body` 的 P07 clip。
- **不改** `globals.css`。
- **不改** `VariantEditor.tsx`。
- `stabilization.css` 僅在 desktop fine-pointer：
  - 第 1 欄 preview 靠左、向 picker 內展開。
  - 第 3 欄 preview 靠右、向 picker 內展開。
  - 中間欄維持置中。
- 新增 `verify-variant-picker-containment.mjs`，鎖住 P07 containment 仍存在與 picker 三欄幾何 assumption。

目前 code/verifier diff 相對 P1-1 只有：`stabilization.css`、新 verifier、`package.json`、`verify-all.mjs`。

尚未聲稱完成：
- desktop 960px 附近
- dark / nordic / kitty
- 第一/中間/第三欄 hover
- picker shell 本身在極端寬度是否仍完整位於 panel 內

若實機仍發現 **picker shell 本身** 被裁，應另開 follow-up 做 picker positioning；不要因此放寬整個 P07 containment。

---

## 結論摘要（原 audit）

### A. 已確認高可信交叉風險：Variant 桌機圖片 hover preview

路徑：
`WorkspaceInputPanel` → `.panel.workspace-input-panel` → `.panel-body` → `VariantEditor(.variant-box)` → `.vthumb-wrap` → `.v-pop-pick` → `.pick-grid .pk .pk-zoom-preview`

相關 CSS：
- P07：`.workspace-input-panel .panel-body { overflow-x: clip; }`
- Variant picker：`.v-pop-pick { width:260px; overflow:visible; }`
- hover preview：`.pk-zoom-preview { position:absolute; width:160px; left:50%; transform:translateX(-50%); }`

判定：**高可信會互相衝突。**

原因：桌機 hover preview 仍在 WorkspaceInputPanel DOM 樹內，不是 portal；只要 preview 或 picker 超出祖先 panel 的水平 padding box，就會被 `overflow-x:clip` 裁掉。

原建議：不要整包撤 P07。修復時優先考慮 portal / collision-aware positioning / 局部安全策略。

> 狀態更新：已先採用「hover preview 局部 collision-aware」方案；實機若證實 picker shell 也裁，再獨立處理 shell positioning。

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

## 修復／驗證優先序（更新）

1. ~~Variant desktop hover zoom 水平裁切~~ — 已做局部 collision fix，待實機
2. picker shell 本身 960px 邊界實機確認；有問題才另開 follow-up
3. `.vh-more-menu` 邊界
4. 縮圖 main badge 是否被 `.pthumb-strip` 自己裁切
5. swipe / sticky 只做驗證，不先改 P07

## 不建議的修法

- 不要直接刪除所有 `overflow-x:clip`
- 不要把 `.panel` 改回 `overflow:visible`，否則可能復發左右欄互相覆蓋
- 不要為了 hover zoom 再加全域 `!important`
- 不要把 Variant / ResultCard / uploader 一次混成同一個修復 commit

## 下一位 Agent 接手

先讀：
1. `AI_START_HERE.md`
2. `docs/CURRENT_STATUS.md`
3. `docs/STABILIZATION_PLAN.md`
4. 本檔
5. `docs/CHANGELOG.md`

P1-2 已有修復分支，**不要重做或直接撤 P07 containment**。下一個主線是 P1-3：修正 `verify-no-secrets.mjs` 的 localStorage policy。
