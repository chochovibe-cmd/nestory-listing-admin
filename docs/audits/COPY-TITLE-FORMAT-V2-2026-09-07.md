# COPY-FIX-3 標題格式規則 v2（2026-09-07）

## What（做了什麼）

老闆 Preview 實測「潮巢導購」標題格式不符：實際產出「三麗鷗 Sanrio | 玉桂狗 | 高顏值毛巾禮盒三件套」——第二段只剩角色名、商品名稱被擠到第三段、單一角色沒並列英文。

本包只改潮巢導購 Title writer（`CHAOCHAO_TITLE_QUALITY`），把老闆拍板的三段格式寫死。不動 description / why / highlights / FAQ / SEO、搜尋管線、UI、API。

## 格式規則全文

三段，分隔符固定「 | 」，`enriched_title` 上限 80 字。

**第一段：品牌 × IP**
- 品牌：有英文名時英文優先；沒有英文才用中文。
- IP：中文＋英文並列（例：三麗鷗 Sanrio）。
- 沒有品牌時只放 IP。
- 品牌／IP 英文名沒依據不要硬翻，寧可只用中文。

**第二段：角色 + 半形空格 + 商品名稱／類型**（兩者必須同段，商品名稱不可以被擠到第三段）
- 單一角色：中文＋英文（例：凱蒂貓 Hello Kitty、玉桂狗 Cinnamoroll）；角色英文名沒依據不要硬翻，寧可只用中文。
- 多角色 2–3 個：只用中文，全形「．」分隔（例：凱蒂貓．美樂蒂．酷洛米）。本 tone 覆蓋 Production 骨架的「・」。
- 超過 3 個：只列最熱門前 3 個，其餘省略。
- 之後接精準、一眼看懂的商品名稱／類型（例：浴巾禮盒、毛巾禮盒三件套）。
- `detected_product_type` 只當 fallback / semantic reference，不是 mandatory exact substring。

**第三段：吸引點擊的鉤子**
- 關鍵字、購買情境、送禮場景、差異化賣點（例：婚禮伴手禮、蘋果樹造型小夜燈）。
- 「高顏值」這類修飾詞屬於第三段，不屬於第二段。
- 只放第二段沒有的新資訊；要重新寫成有記憶點的標題語感；沒有可靠 differentiator 用 neutral fallback。

正確範例：`家泰吉 × 三麗鷗 Sanrio | 凱蒂貓 Hello Kitty 浴巾禮盒 | 婚禮伴手禮`

錯誤案例：`三麗鷗 Sanrio | 玉桂狗 | 高顏值毛巾禮盒三件套`

## Affected files

| 檔案 | 變更 |
|---|---|
| `src/lib/providers/systemPrompt.ts` | 重寫 `CHAOCHAO_TITLE_QUALITY` 為格式 v2；保留 C5A fallback／第三段新資訊／editorial selection／evidence safety |
| `scripts/verify-title-sync.mjs` | 見下方 verifier |
| `scripts/verify-copy-c1-chaonest-sales-tone.mjs` | 見下方 verifier |
| `docs/audits/COPY-TITLE-FORMAT-V2-2026-09-07.md` | 本檔 |

未動：其他 writer、`docs/CURRENT_STATUS.md`、`docs/施工清單.md`、搜尋管線、UI、API。

## Verifier 影響（改了哪些 assertion、為什麼）

- `verify-title-sync.mjs`
  1. **保留**既有 C5A 鎖：`COPY C5A 潮巢導購版 Title Writer`、`detected_product_type 只當 fallback / semantic reference…`、`第三段：只放第二段還沒有的新資訊`、ASCII pipe。
  2. **新增** v2 鎖：商品名稱不可擠到第三段、老闆正確範例、全形「．」、英文名不要硬翻、「高顏值」屬第三段。
- `verify-copy-c1-chaonest-sales-tone.mjs`
  1. **未改** C5A backend no-append／titleFixtures（後端仍只正規化 separator，不改寫段落）。
  2. **新增** prompt 鎖：C5A 標題、v2 正確／錯誤範例、全形「．」、不要硬翻、detected_product_type fallback。
- `verify-copy-format.mjs`：無標題措辭鎖，未改。

## 驗證結果

- `corepack pnpm run typecheck`：PASS
- `corepack pnpm run verify:all`：PASS
- `node scripts/verify-copy-c1-chaonest-sales-tone.mjs`：PASS
- `node scripts/verify-copy-format.mjs`：PASS
