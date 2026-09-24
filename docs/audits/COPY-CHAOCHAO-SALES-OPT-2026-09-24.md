# 潮巢導購版文案優化（對齊實作清單，CC-6 上補強）— 2026-09-24

來源規格：Downloads `潮巢導購版文案優化-實作清單.md`  
工作分支：`agent/chaochao-tone-on-live`  
接續：CC-6 Owner 樣板。預覽曾退回未完成包 `b6fc4d7`／標題三段 `8490d51`。  
本包 commit：`0410016`（2026-09-24 17:21 +0800）  
已 push origin。Preview 分支網址：`https://nestory-listing-admin-git-agent-chaochao-6460e3-chocho-nestory.vercel.app`  
**不是正式站。** 無真實 Shopify write、無 DB migration。

後續同日：Owner 截圖結果列第一張卡被重生窗蓋住 → 另包 `89fe098`，見 `docs/audits/COPY-REGEN-MODAL-PORTAL-2026-09-24.md`。那包不是文案規則變更。

## 這輪為什麼這樣做

清單的行號對的是舊 `systemPromptBase.ts`（潮巢還跟其他語氣共用一大包時）。現役潮巢已走 `chaochaoPrompt.ts`，正文是五段：商品介紹／收藏亮點／適合誰／商品資訊／購買提醒。

若照清單 A1 改回「商品介紹＋收藏亮點＋導購小標」三段，會推翻 CC-6／差異 49–50，且 `verify-chaochao-copy-rewrite` 已禁止 `導購小標：依這件商品`。本包**不改回三段**。

CC-6 要求正面引導、不加重空泛句禁詞池。C 類因此寫成「換掉商品名就不成立」，不寫長禁詞清單。

## 清單對照

| 清單項 | 本包 |
|---|---|
| A1 描述格式依語氣分支 | 分支**已存在**。維持五段。加「至少一句角色／IP 粉絲才會點頭」；禁止 ◈。 |
| B1 文青可愛 | `CHAOCHAO_TONE_DESCRIPTION` 改為帶文青可愛、講清楚為什麼好、不叫賣。不加「痛點導購」（CC-5 已否決痛點開頭）。 |
| B2 示範句 | 三句寫進潮巢專屬 prompt。不寫進共用 `TONE_EXAMPLES`（潮巢產生時讀不到）。 |
| C1–C4 | **只進潮巢 prompt。** 其他 6 語氣 why／賣點／FAQ 原文不動。 |
| D 看圖 | 可寫畫面感；總長約 300–500 字；`max_tokens` 700→1000。數字仍只有圖上有印才抄。模型仍 `gpt-4o-mini`。 |
| E 知識包 | **沒做。** 建議見下方。 |
| F 有知識包還搜角色 | **沒做。** 建議見下方。 |

## 改了哪些檔

- `src/lib/providers/chaochaoPrompt.ts`
- `src/lib/providers/visionProvider.ts`
- `scripts/verify-chaochao-copy-rewrite-2026-09-23.mjs`
- `scripts/verify-copy-c1-chaonest-sales-tone.mjs`
- `scripts/verify-p4-source-and-seller.mjs`
- `docs/CURRENT_STATUS.md`、`docs/施工清單.md`、本檔

未動：標題契約、其他 6 語氣正文、`systemPromptBase.ts` 共用欄位規則、UI／CSS／ResultCard、API、搜尋深度／快取版本、IP 知識包內容、Shopify、DB、看圖模型名稱。

## E／F — 當日口頭建議（Owner 尚未拍板，不要當已做）

E：不要一次寫 80 個知識包。先對近 3–6 個月上架量，補「常賣但沒包或包太薄」的 8–15 個。寫法要像吉伊卡哇包（角色互動、粉絲梗），不要「這個 IP 很可愛」。三麗鷗／迪士尼過籠統可拆角色。後台 `ip_catalog.knowledge_pack` 可覆蓋 code 預設，不必等工程排期。

F：現況已是「有知識包就不再搜角色世界觀」；商品規格搜尋仍會跑。不建議每次都搜（Tavily 約 1000 次／月，熱門 IP 世界觀不週更）。過期才搜可以以後做，TTL 不要設成 2 個月（現有包日期幾乎都是 2026-07-19，一上線會連打熱門 IP）。較安全是約 12 個月、當補充不當替換、快取記在 IP 不是每份草稿。

## 驗證

- `pnpm run typecheck` 通過
- `pnpm run verify:all` 通過
- 沒有真實模型連跑 5–10 筆；G 項仍待 Owner 用潮巢導購版在 Preview 測

## 不要當成已完成

- Owner 語氣／人味實測
- 看圖模型升級（清單 D3，要 A/B）
- E 知識包內容、F 搜尋觸發改寫
- Owner 標題例句 `MINISO × 七龍珠 DRAGON BALL Z | 孫悟空 盲盒擺件 | Q版萌粒鍵帽`（仍待 Codex 確認；本包沒動標題契約）
- 正式站 deploy、真實 Shopify write
