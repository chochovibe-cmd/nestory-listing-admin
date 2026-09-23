# 潮巢導購文案重建 — 2026-09-23

分支：`agent/chaochao-tone-on-live`  
基準 SHA：`a3b3c577343478f94a70774b3d06a06088b2e479`  
本包：推 Preview 供 Owner 實測（CC-5）。**不是正式站。** 無真實 Shopify write、無 DB migration。  
未改使用者 `.claude/settings.local.json`。

## 已確認的程式問題（有原始碼證據）

1. 潮巢 prompt 曾疊完整共用正文 + 多層覆蓋，同時存在舊四段 ◈、三段導購小標、不同篇幅與標題規則。
2. 聲音範例偏品牌宣言；強制痛點開頭。
3. 「把段落寫滿」沒有欄位分工；正文亮點、`product_highlights`、選品理由互相重複。
4. 非 SEO 單欄重生 user message 可能沒帶款式／備註（搜尋後來有補；本包把款式、備註、IP 背景一併固定帶入）。
5. 潮巢 SEO 後處理會堆同義詞並追加「○○首選」，再截短。
6. 商品標題模型 80 字、`title_zh` 再砍 60，history 與正式欄可能不一致；finalizer 只做分隔符／清洗／截字，不組欄位順序。
7. 潮巢 renderer 只有 intro／highlights／sales 三段。
8. 搜尋補充詞 spec／note／image 共用 120 字，前面的來源會吃光後面；摘錄固定取前 400 字。

## 品質推論（本包沒有真實模型輸出當證據）

- 舊工具費用較低、同一模型：先改提示結構與素材利用，不增加第二次模型呼叫。
- 3000 output-token 先維持。只有實際截斷才建議加容量；本包改為辨識 `finish_reason=length`／`stop_reason=max_tokens` 並警告，不自動重試。

## 設計

- 模型負責商品理解與選材；程式負責標題欄位順序與 80 字詞組整理。
- 標題組件 `title_ip`／`title_brand`／`title_item`／`title_diff` 只在 provider 輸出與 parser，不新增 DB 欄位。
- 潮巢不再繼承與它衝突的舊正文／SEO 指令；其他語氣正文維持原狀。
- 搜尋次數不變；快取版本 `adv8` → `adv8eq3`（均分補充詞後舊快取不沿用）。

## 主要檔案

| 檔案 | 作用 |
|---|---|
| `src/lib/contentGenerator/titleContract.ts` | 組裝、詞組截斷、80 字 |
| `src/lib/providers/titlePrompt.ts` | 全語氣唯一標題指令 |
| `src/lib/providers/chaochaoPrompt.ts` | 潮巢寫作契約 |
| `src/lib/providers/systemPromptBase.ts` | 潮巢走專屬組裝；重生帶上下文 |
| `src/lib/contentGenerator/htmlFormat.ts` | 四段 + 舊三段 |
| `src/lib/contentGenerator/seoGenerator.ts` | 潮巢跳過首選／同義詞堆疊 |
| `src/lib/providers/webSearch/index.ts` | 補充詞均分；快取 `adv8eq3` |
| `src/lib/providers/webSearch/tavily.ts` | 相關句摘錄 |
| `src/app/api/generate/route.ts` | 同一最終標題；截斷警告；潮巢 SEO |
| `src/components/listing/WorkspaceInputPanel.tsx` | 語氣說明改「小編導購・具體生活感」 |

UI 只改一句語氣說明，沿用既有 tone option；預覽／發布沿用現有 `h2/p/ul/li`，未改 `globals.css`。

## 驗證

- 新 verifier：`scripts/verify-chaochao-copy-rewrite-2026-09-23.mjs` — 通過
- 已改鎖舊 60 字／三段／痛點 overlay 的 C1、title-sync、p2、websearch — 通過
- 5 組 fixture：`docs/audits/fixtures/chaochao-copy-rewrite-2026-09-23.json`（**非真實模型生成**）
- `pnpm run verify:all` — 通過
- `pnpm run typecheck` — 通過
- `pnpm run build` — 通過（編譯期間有短暫 `read ECONNRESET` 重試，最後 Compiled successfully）
- 真實模型抽樣：1 筆 OpenAI `gpt-4o`（麵包吊飾固定素材），約 $0.027、input 7268／output 882、未截斷。紀錄在 `docs/audits/fixtures/chaochao-live-sample-2026-09-23.json`。其餘 4 組僅 fixture，非真實模型。

## Owner 還需要實測

1. 用潮巢導購版跑真實生成（麵包吊飾、單角色、多角色盲盒、功能商品、資料少）。
2. 看幽默是否從商品長出來、欄位是否各說各話、拿掉角色名後是否仍能辨識商品。
3. 若出現截斷警告，再討論是否提高 3000 token。
4. 預覽站看過後再決定是否 push／部署。
