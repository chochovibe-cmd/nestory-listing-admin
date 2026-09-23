# 潮巢導購寫手拆層 — 2026-09-23

分支：`agent/chaochao-tone-on-live`  
接續：`14f27c4`（CC-6 Owner 樣板 Preview，語氣仍未過）  
本包：CC-7 `5966c33`。Preview：`https://nestory-listing-admin-mrdilc17v-chocho-nestory.vercel.app`  
**潮巢導購版維持現有五段**，不改回舊工具 A｜B｜C｜D｜E。  
無正式站 deploy、無真實 Shopify write、無 DB migration。

## Owner 判定（2026-09-23）

Owner 說這版不喜歡，先回到上一版。

已 `git revert` `51e0b94` 與 `5966c33`。程式回到 CC-6 `14f27c4`。

現役 Preview：`https://nestory-listing-admin-2u2u3lg60-chocho-nestory.vercel.app`  
不要再用 `mrdilc17v`（CC-7）或 `8i15ggzf2`（CC-5）。

## 為什麼又改

Owner 實測 CC-5／CC-6 都覺得幾乎沒差。GPT／Showmore 診斷與程式對得上：

- 雛型（`分支/index.html`）系統提示短，描述是一篇導購；搜尋摘要整包當商品資料。
- 現在同一次呼叫要填 IP／SKU／標題零件／SEO／規格，寫手注意力被作業吃掉。
- 看圖 prompt 曾要求「不要形容詞、不要行銷」，顏色材質被寫乾後才進文案。
- 搜尋查詢尾巴只有「商品規格 尺寸 材質」，開 web search 變不成以前那種豐富。
- 3～5 個特色若當成上限，資料多的商品會被砍。Owner 定案：3～5 是主軸先後，其餘真實特色繼續補。

## 本包改什麼

1. `chaochaoPrompt.ts`：短寫手核心放在 prompt **最後**（避免後面作業蓋掉語氣）。先後 3～5 個鮮明特色當主軸，其餘真實特色補潤。特色→好處（10cm 掛包例子）。看得到的顏色／材質可以寫。潮巢五段不變。拿掉長篇標題契約與三篇吊飾 few-shot。
2. `visionProvider.ts`：外觀素材允許具體觀察詞（雨衣黃、淺咖啡糖霜、蓬鬆絨毛）；數字仍只有圖上有印才抄。
3. 搜尋：`adv8eq3` → `adv8feat1`；查詢加上造型／系列／角色／特色；Tavily 說明改為已確認商品資料，不限規格。顧客文案仍不要標「來源：網路」（P4 契約保留）。
4. 潮巢 user message：圖片與搜尋標成「已確認畫面／搜尋資料」。

## 驗證

- `pnpm run typecheck` 通過
- `pnpm run verify:all` 通過（含 Chaochao rewrite、C1、P4）

## 不要當成已完成

- CC-7 不是現役；不要在這包上面繼續改
- 現役是 CC-6 Owner 樣板
- 正式站未換
