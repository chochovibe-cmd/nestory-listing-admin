# COPY-FIX-1 文案證據供應修復包（2026-09-07）

## What（做了什麼）

老闆反映：表單填得不完整時，即使開了網路搜尋，LLM 文案仍空洞。本包修三個根因：

### A：搜尋 query 供應改善
- `buildWebSearchQuery` 新增輸入 `specText`／`note`／`imageDescription`：
  - 標題仍為主幹，保留既有 160 字上限與雜訊清洗。
  - 三個新來源經 `extractSupplementKeywords` 取前段關鍵內容（去 URL、壓空白），合計截到 120 字，附在標題後作補充關鍵詞（總 query 遠低於 Tavily 建議的 400 字）。
  - hints（ip_name／character_name／product type）改為「標題沒包含才附加」的補充關鍵詞（原本只在標題全空時才使用）。
  - 標題空但其他來源有內容時，現在能組出 query，不再直接放棄。
- `resolveWebSearchForGenerate` 同步新增三個參數並傳入 query builder；空 query 警語從「標題為空」改為「標題、規格、備註與圖片辨識皆為空」。
- `generate/route.ts` 呼叫處把 `draft.spec_text`／`draft.note`／`draft.image_description` 傳入（ip／character／type 原本就有傳）。
- Cache fingerprint 機制不變：query 內容變了 fingerprint 自然變、觸發一次重新搜尋後再快取，結構未動。

### B：單欄重生帶回搜尋證據
- `systemPromptBase.ts` 的 `buildFieldRegenUserMessage` 新增 `webSearchSummary` 注入（有值才加），措辭與完整生成的注入行一致。
- route 的 field-regen 路徑「原本就有」把 cached summary 傳給 provider（`webSearchSummary: parseCachedWebSearchSummary(draft.web_search_cache)`），不需補——原缺口只在 prompt builder 沒使用該值。
- `systemPrompt.ts`（潮巢分支 wrapper）的 C5E SEO parity 區塊原本只對 SEO 兩欄附 cached Web Search；base 現在對所有欄位注入後，該處會重複，故移除 wrapper 裡的 webSearchSummary 段（保留款式與備註 parity）。此舉同時移除了該處「內部參考」貶抑措辭。

### C：搜尋證據使用權調整（prompt 措辭）
防幻覺紅線不放鬆（精確數字仍須有依據、不確定不寫），但把搜尋結果從「二等公民」升級為「同款判斷後可正面使用的證據」：
- `tavily.ts` formatTavilySummary 開頭：由「僅供內部參考……不確定的規格數字不要寫」改為「合理判斷同款時可把規格、功能、系列背景當可用事實寫進文案；非同款或矛盾才捨棄」；仍保留禁止標「來源：網路」／貼 URL、無依據數字不寫。
- `systemPromptBase.ts` webSearchSummary 注入行（完整生成＋單欄重生共用措辭）同步改為一致的正面措辭。
- 證據池優先序（spec 規則）排序維持，第 4 項補註：操作者輸入不足時，搜尋結果經同款判斷後可作主要素材來源，不要因輸入少而整段棄寫。
- 【網路搜尋補充（若有提供）】段改寫為「先判斷同款、同款則正面使用、不要當二等資料」，並加一條「輸入不足時可作主要素材來源」。
- 【P4 出處標記禁令】尾句「網搜僅作內部參考」改為「同款判斷成立的網搜事實可以直接寫，只是不標出處」（禁令本身不變）。
- 「潮巢導購」各 writer 段落檢查過：引用 cached Web Search 皆為中性列舉（evidence 清單），無貶抑字眼，未改動。

## Why（為什麼）
1. 原 query 幾乎只用 rawTitle，表單的規格／備註／圖片辨識完全沒進搜尋，標題稀疏時搜不到有用資料。
2. 單欄重生的 user message 完全沒帶 webSearchSummary，即使 route 有 cache 也白白丟掉。
3. 搜尋結果被 tavily 頭注、user message 注入行、優先序段多層貶抑，模型拿到資料也不敢用。

## Affected files
| 檔案 | 變更 |
|---|---|
| `src/lib/providers/webSearch/index.ts` | A：query builder 擴充三來源＋補充關鍵詞截斷 helper；resolver 新參數；空 query 警語更新 |
| `src/app/api/generate/route.ts` | A：完整生成路徑把 spec_text／note／image_description 傳入 search resolver |
| `src/lib/providers/systemPromptBase.ts` | B：field-regen user message 注入 webSearchSummary；C：注入行、證據池第 4 項、【網路搜尋補充】段、P4 禁令尾句措辭升級 |
| `src/lib/providers/systemPrompt.ts` | B/C：移除 C5E SEO parity 區塊中重複且帶「內部參考」措辭的 webSearchSummary 段（base 已對所有欄位注入） |
| `src/lib/providers/webSearch/tavily.ts` | C：formatTavilySummary 開頭指示升級為「同款判斷後可正面使用」 |

## Verifier 影響（改了哪些 assertion、為什麼）
- `scripts/verify-copy-c1-chaonest-sales-tone.mjs`：`systemPromptBase.ts` 的 immutable blob SHA 由 `d25eaddf…` 重釘為 `42ee3bdb…`。原因：該 verifier 以 git blob hash 鎖定整份 base prompt，本包依規格必須改 base 的搜尋證據措辭與 field-regen 注入，屬「verifier 鎖住必改措辭」情境，僅更新 hash 一行＋註解。
- `scripts/verify-copy-format.mjs`：修正 4 個「在本分支 baseline（8edbde8，未含本包）就已失敗」的過時 assertion——與本包程式變更無關，但交付要求此 verifier PASS：
  1. 「◈ headers」檢查改讀 `systemPromptBase.ts`（prompt 主體已移至 base，wrapper 不含 ◈ 段）。
  2. emoji tone policy 由「2 tones」改「3 tones」並改讀 base（COPY C1 已新增潮巢導購版為第三個 emoji tone）。
  3. `saleStatusNoticeHtml(draft.sale_status)` regex 放寬為可帶 `, draft.generation_tone`（本分支已為 Chaochao 加 tone 參數）。
  4. tone cards `usesEmoji: true` 數量 2 → 3（同上，第三 tone）。
- `verify-p4-source-and-seller.mjs` 未動：其 assertion（tavily 保留「不要標「來源：網路」」、base 保留「網路搜尋補充（若有提供）」與「不確定就不寫」）在新措辭下仍成立。
- （非本次驗證範圍）`scripts/verify-b8-b19-websearch.mjs` 內含 `buildWebSearchQuery` 的鏡像複本且直讀 `systemPrompt.ts` 找證據池字串，在本分支架構下原本就已過時；未在 verify:all 清單內，未動。

## 驗證結果
- `corepack pnpm run typecheck`：PASS
- `corepack pnpm run verify:all`：PASS
- `node scripts/verify-copy-c1-chaonest-sales-tone.mjs`：PASS
- `node scripts/verify-copy-format.mjs`：PASS

## 超出 scope 的觀察（只記錄、未施工）
- `src/lib/providers/ipKnowledgePack.ts` 的 IP 網路背景補充 block 仍寫「搜尋內容須核實，不確定勿寫」；那是 IP 背景 lore 層（P5 層3），非商品規格證據，不在本包範圍。若之後也要升級措辭，另開包處理。
- 既有 draft 因 query 組成改變，下次生成 fingerprint 會不同、各觸發一次重新搜尋（一次性 Tavily 用量增加，屬預期行為）。
