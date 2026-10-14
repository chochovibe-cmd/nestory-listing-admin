# VARIANT-CLEAN 修正批：隔離分支施工交接（2026-10-15）

## 版本／權限
- Repository: `chochovibe-cmd/nestory-listing-admin`
- 施工分支：`gpt/variant-clean-fixbatch`，從 `fix/variant-clean` 的 `b588484933ab5c698ef68d8b3e04eea75e3d0a15` 建立。
- 原 PR #51 / `fix/variant-clean` 完全不寫入；這包不建立 PR、不 merge、不跑 Supabase migration、不部署。
- `vercel.json` 的 `git.deploymentEnabled["gpt/**"] = false` 已核對。
- 開工前分析另見 `docs/VARIANT-CLEAN-fix-investigation-2026-10-15.md`，其 HOLD 與單次 push 限制屬前一階段歷史，已由 Owner 改為隔離分支施工。

## A. 角色譯名
- 唯一靜態替換表仍是 `src/lib/zhTwLocalizer.ts`，沒有複製到 tags 或 IP 知識包。
- 加入三麗鷗、迪士尼、寶可夢及龍珠常見簡繁／地區稱呼；處理 Hello Kitty 重複稱呼與「七七龍珠」反例。
- `variantNameValidator.ts` 正規化保護名稱與 AI 候選名稱做同義檢查，原數字、英文、長度、新資訊與組合去重保護仍保留。
- `systemPromptBase.ts` 示範名稱改為「大耳狗」。
- 驗證腳本覆蓋「M8玉桂狗16G拍立得→M8大耳狗16G拍立得」、每個詞條、重複轉換及 AI 角色名稱保留。

## B. ResultCard 窄卡片
- `globals.css` 僅對 results-panel 裡的單欄 grid、result-card 內容和 vc-toolbar 補上 zero min-size、max-width、可換行。
- 原 `.vc-toolbar` 本來已有 `flex-wrap:wrap`；問題另一半是 grid 的自動最小寬度與 `overflow:hidden` 的裁切。
- 款式表格由 `.rc-specs-wrap` 接管內部橫向捲動，不讓卡片整體被撐寬；原輸入區手機款式表 CSS 不動。
- 無新的顏色、圓角、陰影或 `!important`。
- 375、560、768px 的實際卡片寬度 **尚未取得瀏覽器截圖**，須由 Claude／Owner 再驗收。

## C. 刪除款式與圖片
- `VariantEditor` 共用於 `WorkspaceInputPanel` 與 `ResultCardSpecsPanel`，兩者皆有 `onQueueImageDeletion` 回呼。
- 刪除前顯示「會一起移除 N 張款式圖」，使用者可選連圖移除或保留圖片只刪款式；清理等待成功儲存，不提前刪圖。
- 純函式 `imageIdsOrphanedByRemovingVariant`：只選 `imageType === "variant"` 且其他本機款式未使用的圖片。
- `removeUnusedVariantImagesFromDraft`：成功持久化剩餘款式後，重新查 `product_images.image_type` 與 `product_variants.image_id`。查詢失敗／共享圖片／主圖／詳情圖皆不刪。
- 刪圖只走 `deleteProductImages` 既有 IMAGE-INTEGRITY 途徑，以 `unbindVariants:false` 防誤解綁；新選項 `keepStorageFiles:true` **只移除 product_images 的草稿資料列，不刪除 Storage 實體檔案**。其他既有圖片刪除操作保留原行為。
- 驗證腳本涵蓋：專屬 variant 圖移除、共用圖不動、主／詳情圖不動、跨草稿不動、Storage 零次刪除、兩 UI 入口與儲存順序。

## 交給 Claude 的驗收
- `npx tsc --noEmit`
- `npm run verify:all`（既有 verify-all 已經包含 `scripts/verify-variant-clean.mjs`，本批直接擴充該檔，避免重複註冊）
- `npm run build`
- 真瀏覽器：ResultCard 規格頁籤寬度 375／560／768px，兩顆按鈕皆可見且可點；AI 偵測、SKU、款式表格不會被右邊切掉，三主題確認。
- 草稿測試：刪除獨享款式圖／共享圖／主圖；分別選「連圖移除」與「保留圖片」，儲存後核對 product_images、product_variants、Storage 實體未刪。
- 若上列任何測試失敗：HOLD，勿合併回 PR #51。
- 本環境未執行 TypeScript、npm verifier 或 build；不可把原 PR #51 的既有測試成果當作本次通過。
