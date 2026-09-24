# 重生彈窗 portal — 2026-09-24

分支：`agent/chaochao-tone-on-live`  
本包 commit：`89fe098`（2026-09-24 17:35 +0800）  
接在文案優化 `0410016` 之後。已 push。正式站沒換。

## 發生什麼事

Owner 17:31 截圖結果列：第一張（MINISO × 七龍珠）中間出現「潮巢導購版」下拉與「修改方向／補充資訊」，卡片變灰、標題與取消／確認被切掉；酷洛米、Kitty 兩張看起來正常。問這幾輪有沒有改壞畫面。

## 查了什麼

文案優化 `0410016` **沒有**改 CSS、ResultCard、DraftResultsPanel、globals。近幾輪潮巢 commit 也幾乎只動 prompt／vision／title／search。

截圖裡的 placeholder「例：更強調禮盒感…」只出現在 `RegenCopyModal`。這是按「重生」後的對話框，不是結果卡格子被改掉。

根因（舊的，不是這輪文案引入）：

- `RegenCopyModal` 畫在 `ResultCard` 裡面（`.result-card` 內、再包在 `.rc-swipe-wrap`）
- `.result-card { overflow: hidden }` 且 hover 有 `transform: translateY(-1px)`
- `.rc-swipe-wrap { overflow: hidden }`
- `position: fixed` 被關在卡片當 containing block，overlay 只蓋第一張，modal 標題／按鈕被裁切

`LockedCopyPreview` 在 UX-B2-P01（`341795e`，2026-07-20）已用 `createPortal(..., document.body)` 修過同一類問題。重生窗當時沒一起改。`CURRENT_STATUS` 2026-09-24 撤回未完成包時也寫過「重新生成視窗這次沒有改過程式」。

## 改了什麼

- `src/components/listing/RegenCopyModal.tsx`：比照 `LockedCopyPreview` portal 到 `document.body`
- `scripts/verify-p0-fixes.mjs`：P0-61 額外要求 `createPortal`／`document.body`
- 語氣下拉、修改方向欄位、Esc、busy 禁關、生成 API **沒改**
- 沒有改卡片排版、篩選列、核准鈕、globals tokens、沒有新 `!important`

## 還沒修（同類風險，本包故意不順手改）

`ResultCard` 裡還有 `Station3PublishModal`、`ExportPreflightModal` 沒 portal。從卡片開「發布／匯出」 theoretically 可能再被 overflow/transform 關住。批次列上的同元件在 panel 層，風險較低。下一包若再看到彈窗黏在單一卡片上，先查這兩個。

## 驗證

- `pnpm run typecheck` 通過
- `pnpm run verify:all` 通過
- `node scripts/verify-p0-fixes.mjs` 的 RegenCopyModal 項通過；該腳本另有與本包無關的歷史失敗（P0-63 operator 字串、不在 `verify:all`）
- 本機沒有登入 Preview 實點重生。Owner 需等 Vercel 編完後再點一次重生：應為整頁變暗、中間完整「↻ 重新生成文案」視窗，含取消／確認

## 不要當成已完成

- Owner 尚未回報重生窗已正常
- Station3／Export 從卡片開啟尚未 portal
- 正式站未換
