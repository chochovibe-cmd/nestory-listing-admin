# 潮巢導購版文案優化（對齊實作清單，CC-6 上補強）— 2026-09-24

來源規格：Downloads `潮巢導購版文案優化-實作清單.md`  
工作分支：`agent/chaochao-tone-on-live`  
基準：CC-6 Owner 樣板（預覽曾退回未完成包 `b6fc4d7`）  
**不是正式站。** 無真實 Shopify write、無 DB migration、未改模型、未改搜尋觸發。

## 清單與現況的差距

那份清單的行號對的是舊的 `systemPromptBase.ts`（潮巢還跟其他語氣共用一大包時）。現役潮巢已走 `chaochaoPrompt.ts`，正文契約是五段：商品介紹／收藏亮點／適合誰／商品資訊／購買提醒。

因此：

| 清單項 | 本包做法 |
|---|---|
| A1 描述格式依語氣分支 | **已存在。** 不改回舊三段「導購小標」，也不用 ◈。只在五段裡加「至少一句角色／IP 粉絲才會點頭」。 |
| B1 文青可愛 | 更新 `CHAOCHAO_TONE_DESCRIPTION`。不加「痛點導購」（CC-5 已否決痛點開頭）。 |
| B2 示範句 | 寫進潮巢專屬 prompt。不寫進共用 `TONE_EXAMPLES`（潮巢產生時根本不會讀到那份）。 |
| C1–C4 欄位規則 | **只進潮巢 prompt。** 其他 6 個語氣的 why／賣點／FAQ 原文不動。正面引導為主，不加空泛句禁詞池。 |
| D 看圖豐富度 | 放寬外觀描述畫面感；數字仍只有圖上有印才抄。模型維持 `gpt-4o-mini`。 |
| E IP 知識包 | **本包不做。** 要營運先盤點近 3–6 個月上架量大、但沒有知識包的 IP。 |
| F 有知識包就跳過背景搜尋 | **本包不做。** 等拍板：過期才重搜（A）或每次都搜（B）。 |

## 改了什麼

- `src/lib/providers/chaochaoPrompt.ts`：語氣說明、三句語感、描述／選品理由／賣點／FAQ 具體度。
- `src/lib/providers/visionProvider.ts`：外觀描述可寫畫面感；總長約 300–500 字；`max_tokens` 700→1000。P4 賣家服務排除與數字紅線保留。
- 驗證：`verify-chaochao-copy-rewrite-2026-09-23.mjs`、`verify-copy-c1-chaonest-sales-tone.mjs`、`verify-p4-source-and-seller.mjs`。

未動：標題契約、其他 6 語氣正文、UI、API、搜尋深度／快取版本、IP 知識包內容、Shopify、DB。

## 不要當成已完成

- 還沒有真實模型連跑 5–10 筆人工驗收。
- 看圖模型沒換成更強的；要 A/B 再決定。
- 知識包覆蓋率、背景搜尋過期重搜都還沒做。
- Owner 標題例句 `MINISO × 七龍珠 DRAGON BALL Z | 孫悟空 盲盒擺件 | Q版萌粒鍵帽` 不在本包。
