# VARIANT-CLEAN 修正批｜GitHub 原始碼盤點與未完成交接

日期：2026-10-15（Asia/Taipei）
Repo：`chochovibe-cmd/nestory-listing-admin`
PR：https://github.com/chochovibe-cmd/nestory-listing-admin/pull/51
Base：`handoff/20261008-golive-spec` @ `0dad86edcc641bf1481fcff73df6f155984fad9b`
Head：`fix/variant-clean` @ `b588484933ab5c698ef68d8b3e04eea75e3d0a15`
PR：OPEN / NOT MERGED，已由 GitHub connector 即時核對。

## 執行狀態與阻礙

**HOLD：本回合沒有修改 GitHub，沒有 push，也沒有部署。**
已用 GitHub connector 讀取分支上的 AGENTS.md、施工規格、globals.css、localizer、清理規則與驗證器、UI 元件，以及 IMAGE-INTEGRITY 刪圖模組。
本機 `/mnt/data` 未掛載 repo，`git ls-remote https://github.com/chochovibe-cmd/nestory-listing-admin.git` 回報 `Could not resolve host: github.com`。
GitHub connector 可逐檔讀取，但單檔寫入會立即建立一次 commit／Vercel 部署，不能在未本機完整驗證的情況下拿它逐檔施工。因 Owner 嚴格要求全部通過才推送一次，這次沒有執行任何 GitHub 寫入。
`npx tsc --noEmit`、`npm run verify:all`、`npm run build`：**未執行**（缺完整 checkout，不能視為 PASS）。
375/560/768 寬度：**未取得瀏覽器畫面**，不能宣稱驗收。

## 調整一：IP 台灣譯名

- `src/lib/variants/variantNameRules.ts` 已經透過 `normalizeVariantText` 呼叫 `localizeToTaiwanTraditionalText`，所以不該再自建另一個詞表。
- 集中用語表目前在 `src/lib/zhTwLocalizer.ts` 的 `TAIWAN_TERM_REPLACEMENTS`；有 3C 名稱轉換，但缺玉桂狗等角色別名。
- `src/lib/nestoryTagsV2.ts` 角色 canonicalization 依賴由外部傳入的 `ipCharacters` 與 aliases，屬 tag canonicalization，不是可直接套進一般字串中的靜態文字別名表。
- `src/lib/providers/ipKnowledgePack.ts` 文字介紹提到大耳狗、酷洛米等台灣名，但不是大陸→台灣別名字典，不應拿 free text 做 replacement。
- 建議在**唯一詞表**加：玉桂狗→大耳狗、庫洛米→酷洛米、凱蒂貓→Hello Kitty（但遇已有 Hello Kitty／Kitty 時不可重複）；同義詞經 OpenCC 自動成美樂蒂、帕恰狗、布丁狗、大眼蛙，應加入明確 regression fixtures；迪士尼、寶可夢其他文字只加已核實確有地區差異的名稱，不要猜。
- `src/lib/variants/variantNameValidator.ts` 的 `checkCell` 會以 `ctx.names` 文字直接比對 `rule`/AI，應使用同一 localizer 正規化受保護名稱和 AI 候選文字，確保台灣別名視為角色名保留，同時不放鬆原本數字、英文、長度與重複檢查。
- 測試：`cleanOptionValue('M8玉桂狗16G拍立得') === 'M8大耳狗16G拍立得'`，AI 角色名保留、已包含 Kitty 不重複、規則冪等、名稱重複檢查不退化。

## 調整二：窄畫面

- **注意：`src/app/globals.css` 的 `.vc-toolbar` 在目前 PR #51 已經有 `display:flex; flex-wrap:wrap`，不可把加 wrap 當作完成修復。**
- `.result-card` 目前 `overflow:hidden`，`.rc-specs-wrap` 目前 `max-width:100%; overflow-x:auto`；尚需查清真正最小寬度來源，尤其卡片內容與規格頁籤父層、內部 grid/flex child 的 `min-width:0`。
- 對照 375、560、768px 的**卡片寬**，不是僅 browser viewport；切換規格頁籤查工具列兩按鈕、VariantEditor 的 SKU/AI 偵測相鄰欄位／整卡內容，不得有右邊被 `overflow:hidden` 裁切。
- 僅修改局部 selector/既有 spacing tokens；不要新增 `!important`、新顏色/圓角/陰影；不應對全站套 `overflow:hidden` 當修法。
- 測試：透過 Playwright／真瀏覽器記錄 3 種卡片尺寸，驗證可見按鈕與元素 bounding rect 不超出可見容器；搭配畫面截圖及 3 主題回歸。

## 調整三：刪款式連圖

- 兩個 UI 入口都使用共用 `src/components/listing/VariantEditor.tsx`（輸入區：`WorkspaceInputPanel`；結果卡：`ResultCardSpecsPanel`→`ResultCard`）。`VariantEditor.removeRow` 現在只 filter + `onRowsChange`，**完全沒有圖片清理**。
- 已有 `src/lib/images/deleteProductImages.ts`：順序是查圖片與綁定 → 先 unbind variant → 刪 DB 列 → 參照安全檢查 → 最後刪 Storage。不得改成直接 `storage.remove`。
- `VariantImageOption` 目前只有 `id,url,label`，未帶 `image_type`，故不能僅由 picker list 判断「是款式圖、非主圖／詳情圖」。在排程刪除前須查 `product_images.image_type` 的權威值。
- 需要共用純函式針對「**移除後**仍存在的全部款式」算候選 image_id：非空、非其他款使用且 image_type 嚴格等於 `variant` 才有資格。獨立 DB 查證也要檢查其他既存 variant binding，並拒絕未知／查詢錯誤情況。
- 刪除前的確認必須呈現「同時刪除這款的款式圖（N 張）」且有「保留圖片，僅刪款式」分支。對多列刪除去重計數。
- 特別注意**持久化順序**：UI 刪 row 是 local state，`WorkspaceInputPanel` 與 `ResultCard` 的實際 variants DB 保存另有時點。不可立即 `unbindVariants:true` 刪圖，否則在行仍未存檔或 UI 比資料庫舊時可能誤解除其他變體；建議將用戶同意刪除的候選圖排入 queue，等成功保存刪款式到 DB 後**重新查**剩餘綁定及 image_type，再透過 `deleteProductImages(...,{unbindVariants:false})` 安全刪除（無存留綁定方可執行）。使用者不儲存時不應提前刪圖。對於結果卡 UI imageMarks 需在成功後更新；對輸入區 variantImages 亦然。
- 驗證：專屬 variant 圖被刪；共用圖保留；image_type=main/detail 保留；不同步的 DB 綁定保留；用戶選「保留圖片」保留；讀取／刪除失敗不先刪 Storage；兩入口皆可操作。

## 收工驗證及 Publication gate

1. 取得能 checkout repo 的實際工作環境，從 `fix/variant-clean` HEAD 開始；禁止假設 HEAD 不變。
2. 僅做上述三項 scope，檢查 diff 與 README/AGENTS 規則；不要碰 Production、Shopify write、DB migration。
3. 本機執行 `npx tsc --noEmit`、`npm run verify:all`、`npm run build`，逐一留存 PASS 及 verify 計數；失敗則 HOLD。
4. 做 375/560/768px 窄卡片畫面截圖／尺寸說明，並驗證刪圖操作／權限與錯誤路徑。
5. push 前即時確認 remote `fix/variant-clean` HEAD 未變；只有所有 gates 通過才正常 commit + **push 一次**。若沒有 target 分支寫入能力，從其最新 HEAD 以 `fix/` 名稱開新分支，PR base=`fix/variant-clean`。不要使用手工 blob/tree/update_ref 常態施工；不要 merge 或手動 redeploy。

## 回報目前數字

- 新修改檔案：0。
- 本次 `verify:variant-clean` 執行：0 次。
- 本次 `verify:all` 執行：0 次；不能引用既有 PR 說明中的 72 項當本次 PASS。
- 新 GitHub commit：0；push：0；新部署：0。