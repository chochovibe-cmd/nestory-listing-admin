# COPY-FIX-2 正面提示詞改寫包（2026-09-07）

## What（做了什麼）

老闆反映：LLM 文案空洞，一半是證據沒送到（COPY-FIX-1 已修），一半是 prompt 疊了十幾條「不確定就不寫／寧可少寫／整段刪除」負面禁令，模型被嚇到只敢輸出罐頭句。

本包只改 guardrail 措辭，不動排版與結構：

1. 把散落的「不確定就不寫／寧可少寫／不要充數」收斂成一份集中紅線清單。
2. 改成正面指令：體驗式內容放手寫、搜尋同款事實直接自信寫入。
3. evidence 少時改用體驗式內容把段落寫滿；只有紅線項目才留白。
4. COPY-FIX-1「同款判斷後可正面使用」與新原則整合成同一套措辭。

## Why（為什麼）

負面禁令重複疊加後，模型把「使用情境／適合誰／幽默觀察」也當成高風險，結果交安全但空洞的句子。老闆拍板：體驗式內容是文案本體、不需要證據；會退貨／投訴的才是紅線。

## 紅線清單全文

【文案紅線｜只有這些沒依據才不准寫】
以下項目沒有賣家自標（款式／標題／圖上文字／操作者補充）或「同款判斷成立的搜尋結果」時，不要寫、不要猜、不要用目測數字充數。紅線以外不在此限。
- 精確規格數字：尺寸、重量、容量
- 材質（照片看得出來的客觀材質類別可以寫；沒看到就不要猜具體材質名）
- 發售年份
- 官方售價／定價（文案也不要重複本店售價數字）
- 授權／正版／官方聲明
- 限定款、絕版、停產、流通量少
- 庫存數量、到貨日期／到貨承諾

分類欄位（IP／品牌）的誠實規則仍保留：`detected_product_brand` 沒把握就留空，避免上錯架。這不是顧客文案空洞問題。

## Affected files

| 檔案 | 變更 |
|---|---|
| `src/lib/providers/systemPromptBase.ts` | 新增【放手寫】＋【文案紅線】；收斂描述／spec／網搜／自檢／單欄重生的負面禁令；同款搜尋改「直接自信寫入」 |
| `src/lib/providers/systemPrompt.ts` | 潮巢導購各 writer：少寫／不要補 → 體驗式寫滿；結構／◈ 禁令／導購小標銜接／三段 architecture 不動 |
| `docs/audits/COPY-POSITIVE-PROMPT-2026-09-07.md` | 本檔 |
| `scripts/verify-copy-c1-chaonest-sales-tone.mjs` | 見下方 verifier |
| `scripts/verify-p4-source-and-seller.mjs` | 見下方 verifier |
| `scripts/verify-p1-copy-quality.mjs` | 見下方 verifier |
| `scripts/verify-p2-copy-tune.mjs` | 見下方 verifier |

未動：搜尋管線、`docs/CURRENT_STATUS.md`、`docs/施工清單.md`、UI、API、Shopify、auth。

## Verifier 影響（改了哪些 assertion、為什麼）

- `verify-copy-c1-chaonest-sales-tone.mjs`
  1. `/evidence 不足時寧可少寫/` → `/evidence 不足時改用體驗式內容把段落寫滿/`（本包必須刪掉「寧可少寫」）。
  2. `systemPromptBase.ts` blob SHA `42ee3bdb…` → `a78d2dfe…`（base prompt 必改，重釘 hash）。
- `verify-p4-source-and-seller.mjs`：不再鎖 `不確定就不寫`／`不確定勿寫`；改鎖【文案紅線】標題＋同款正面使用句（誠實邊界仍在，只是集中表述）。
- `verify-p1-copy-quality.mjs`：prompt 檢查改讀 base＋wrapper。本分支 prompt 主體早已在 base，舊 assertion 只讀 wrapper 會假失敗；`沒把握就留空`（品牌欄）仍保留在 base。另：033／034／035／027 讀路徑改為 `supabase/history/pre_tracking_migrations/`（本分支 baseline squash 後編號 SQL 已歸檔，與本包句子改寫無關，但本包要求此 verifier PASS）。
- `verify-p2-copy-tune.mjs`：標題長度表檢查改讀 base＋wrapper；80/83 constants 改讀 `titleGeneratorBase.ts`；route 的 segment-3 scrub 改認 `normalizeEnrichedTitleContract`＋`titleFinalizer.ts`（理由同上，與本包句子改寫無關）。

## 驗證結果

- `corepack pnpm run typecheck`：PASS
- `corepack pnpm run verify:all`：PASS
- `node scripts/verify-copy-c1-chaonest-sales-tone.mjs`：PASS
- `node scripts/verify-copy-format.mjs`：PASS
- `node scripts/verify-p1-copy-quality.mjs`：PASS
- `node scripts/verify-p2-copy-tune.mjs`：PASS

## 超出 scope 的觀察（只記錄、未施工）

- `src/lib/providers/ipKnowledgePack.ts` 仍有「搜尋內容須核實，不確定勿寫」（IP lore 層，非商品規格）。COPY-FIX-1 已記過，本包仍未動。
- `src/lib/providers/webSearch/tavily.ts` 頭注已是 COPY-FIX-1 正面措辭，本包依禁止事項未再改搜尋管線。
- Chaochao「anti-AI smell」萬用句黑名單、三段 heading 硬性銜接、emoji／saleStatusNotice 均未改。
