# COPY-PB1｜潮巢文案 Product Brief 重構｜2026-09-30

> 狀態：**Draft / Preview-only / 不可上 Production**
>
> Owner 目標：恢復原本「給淘寶標題 → AI 先理解商品 → 補必要資料 → 產出潮巢固定格式文案」的工作方式；不要再靠一層又一層 prompt 補丁。
>
> 本包 authority：branch `gpt/copy-product-brief-refactor-20260930`，Draft PR #13，base `agent/chaochao-tone-on-live@5203e4a5`。

## 1. 為什麼要做這包

9/23–9/24 已反覆調過潮巢語氣、範例、搜尋、段落與 Writer，但 Owner 實測仍常看到目錄式／公版電商句。

根因不是少一條「更會寫」的 prompt，而是 full generate 的同一個模型同時要：

- 判 IP／角色／品項／品牌／category；
- 生 SKU、拆商品標題；
- 判斷網搜是不是同款；
- 整理 spec；
- 寫商品介紹、FAQ、SEO、選品理由、亮點。

它同時扮演商品研究員、資料整理員與文案寫手。注意力先花在「把欄位交齊」，最後才剩下寫作。

9/23 曾有 CC-7「Writer 拆層」且被 Owner 明確退回。**COPY-PB1 不是把 CC-7 撿回來。**
差別是：本包先新增真正的 Product Brief / evidence-distillation stage，把原始搜尋、OCR、規格與不確定事實先整理乾淨，再讓 Writer 只吃精簡商品理解；不是只把既有大 prompt 拆成另一種寫法。

## 2. 新流程

```
Taobao / capture / variants / vision / spec / web search / IP knowledge
                         │
                         ▼
              Product Brief（便宜模型）
       商品身份 / 確認事實 / 差異點 / 使用情境
       粉絲角度 / 安全規格 / unknowns / rejected evidence
                         │
                         ▼
               潮巢 Focused Writer
       description / FAQ / SEO / why / highlights
       enriched_title 只照抄 Brief 建議標題
                         │
                         ▼
            既有 finalizer / tag / handle / DB
```

其他語氣維持原路徑。本包只改「潮巢導購版」full generation。

## 3. Product Brief 契約

版本：`pb1-20260930`

預設模型：`OPENAI_BRIEF_MODEL || gpt-4o-mini`。目的不是寫文案，而是便宜地做資料理解／過濾。

內部欄位：

- `identity`: ip / character / productType / brand / category / sku
- `title`: enrichedTitle / ip / brand / item / diff
- `confirmedFacts`
- `differentiators`
- `useCases`
- `fanHooks`
- `specLines`
- `unknowns`
- `rejectedEvidence`

證據優先順序固定為：

```
賣家款式／標題／圖中文字／既有規格
> 明確同款官方或零售資料
> 圖片可見外觀
> 泛網搜
```

只有同 IP、同品類、但不是同款的搜尋結果不能進 `confirmedFacts/specLines`，要丟到 `rejectedEvidence`。尺寸、材質、授權、年份、限定、庫存與 ETA 沒直接證據就進 `unknowns`，Writer 不可補猜。

Writer 不會看到 `rejectedEvidence` 或原始網搜全文，只收到整理後的 Brief。

## 4. Writer 現在只負責什麼

Focused Writer 只輸出 7 個顧客文案欄位：

1. enriched_title（**原樣照抄 Product Brief 建議標題**）
2. generated_description_html
3. generated_faq_html
4. seo_title
5. meta_description
6. why_we_chose_it
7. product_highlights

它不再輸出／判斷：

- detected_ip_name
- detected_character_name
- detected_product_type
- detected_product_brand
- detected_category
- sku
- spec
- title_ip / title_brand / title_item / title_diff

這些責任由 Product Brief + 既有後端接回。

潮巢既有 Owner-approved voice samples（雨衣 Hello Kitty／曬傷衝浪 Hello Kitty／滑雪布丁狗）保留；五段正文「商品介紹／收藏亮點／適合誰／商品資訊／購買提醒」也保留。

另加一條實質品質線：不要用「品質有保證、絕佳收藏、經久耐用、不可錯過」這種換掉商品名仍成立的空句。

## 5. 失敗與 rollback 設計

Product Brief 是增量層，不是 hard dependency。

- Brief 成功：走 `Product Brief → focused Writer`，最後把 identity/title/spec/SKU 合回 provider output。
- Brief 逾時、解析失敗或 API 不可用：**不**把半成品 Brief 交給 Writer；自動退回原本 legacy full-generation prompt。
- 只有成功走新路徑才寫 `generation_rule_version = chaochao-pb1-20260930`。
- 無 DB migration。
- 無 Production deploy。
- 無 Shopify write。
- 要整包回退：直接停止使用本 branch / 關閉 Draft PR #13；base branch 完整保留。

## 6. API / 成本策略

這包刻意沒有用「更貴模型全部重跑」解問題。

- Brief：預設 gpt-4o-mini；最多 1200 output tokens。
- Writer：沿用現有 copy provider/model 設定，不在本包偷換模型。
- Writer 不再收到原始大坨 web/spec/vision evidence；只吃 compact Brief。
- Brief input 對長 evidence 有上限，避免 Tavily 8 筆結果無限灌 token。
- 單欄重生目前維持舊流程，避免每按一次重生都再付一次 Brief API；等 Owner 驗證 full generation 後，再決定要不要持久化 Brief 做 regen cache。

成本是否真的下降，**必須用 5–10 筆 live A/B token/cost 實測後才能下結論**，本文件不先聲稱百分比。

## 7. Golden regression set

新增 `scripts/fixtures/chaochao-product-brief-golden.json`，先鎖 4 種不同風險：

- Miffy 70 週年蘋果樹矽膠臺燈：不能退化成「通用療癒小夜燈」。
- Pingu 迷你 CCD 相機吊飾盲盒：功能與吊飾型態都必須被理解，不能只寫可愛。
- MINISO × DRAGON BALL Z Q 版萌粒鍵帽盲盒：泛七龍珠 PVC 公仔網搜不得污染尺寸／材質。
- Sanrio × Bandai 家族米粒公仔吊飾盲盒：不能用「品質有保證／絕佳收藏」取代產品差異。

`scripts/verify-copy-product-brief.mjs` 會守住：
- evidence authority；
- generic web rejection；
- unknown boundary；
- Writer 不再接回 upstream operations；
- 7 欄 Writer contract；
- route 確實 build/pass/merge Brief；
- recipe version 只有成功 brief 才記錄。

這是「架構／回歸契約」測試，不等於文案美感已獲 Owner 驗收。

## 8. 這包刻意沒做

- 沒改其他語氣。
- 沒改 Vision。
- 沒重做 Tavily provider；先在 Brief 層擋 generic evidence。
- 沒做 Supabase migration／新欄位。
- 沒把 `system_prompt_versions` 接進 runtime；本包先用現有 `generation_rule_version` 留 recipe 可追溯性。
- 沒改單欄 regen 架構。
- 沒 deploy Production。
- 沒自動 merge PR。
- 沒宣稱文案已通過 Owner 眼睛。

## 9. 後續驗收順序

1. CI：`verify:all` / typecheck / build 必須綠。
2. Vercel Preview 必須 READY。
3. 用同一批 5–10 個真實商品做舊版 vs COPY-PB1 A/B；至少要包含上面四個 golden 類型。
4. 看輸出是否更「像真的理解這件商品」：具體度、事實支持、潮巢語感、重複度、買家資訊價值。
5. 記錄 input/output tokens、估算 cost 與 latency。
6. Owner 明確認可後，才討論 merge / Production；不因 CI 綠就自動上線。

## 10. 主要檔案

- `src/lib/providers/productBrief.ts` — 新 Product Brief distiller + fallback + merge
- `src/lib/providers/chaochaoPrompt.ts` — focused Writer
- `src/lib/providers/systemPromptBase.ts` — Brief 優先的潮巢 user message
- `src/lib/providers/systemPrompt.ts` — brief-mode switch
- `src/lib/providers/openai-copy-provider.ts`
- `src/lib/providers/claude-copy-provider.ts`
- `src/lib/providers/copy.ts` — `productBrief` input contract
- `src/app/api/generate/route.ts` — full-generate orchestration
- `scripts/fixtures/chaochao-product-brief-golden.json`
- `scripts/verify-copy-product-brief.mjs`

## 11. 接手模型必讀

若下一個模型要繼續改潮巢文案，先讀：

1. 本文件
2. `docs/audits/COPY-CHAOCHAO-REWRITE-2026-09-23.md`
3. `docs/audits/COPY-CHAOCHAO-WRITER-2026-09-23.md`（特別看 CC-7 為何被退）
4. `docs/audits/COPY-CHAOCHAO-SALES-OPT-2026-09-24.md`
5. `src/lib/providers/productBrief.ts`
6. `src/lib/providers/chaochaoPrompt.ts`

不要再把問題簡化成「多加幾條禁詞／再加一個 few-shot」；除非 A/B 證明 Product Brief 的商品理解已正確而 Writer 仍失敗，才回到純 voice prompt 調整。

## 12. 驗證紀錄

最終驗證的**程式碼 SHA**：`ae110bd96e57e52ee34ac7d8c5b2b089a92bc7af`

### 最終結果

- GitHub Draft PR：#13，base `agent/chaochao-tone-on-live@5203e4a5`，mergeable = true，仍保持 Draft。
- GitHub CI：run **#519**（`36702474412`）✅
  - `pnpm run verify:all` ✅
  - TypeScript typecheck ✅
  - Next.js build ✅
- Vercel deployment：`dpl_BcAfEnzM9BzxSFXYkMcDKqEcECvj` ✅ READY
- branch Preview：`https://nestory-listing-admin-git-gpt-copy-produc-c2532b-chocho-nestory.vercel.app`
- Preview HTTP smoke：登入頁回 200，對應 deployment id `dpl_BcAfEnzM9BzxSFXYkMcDKqEcECvj`。
- Production：**未 deploy、未 merge、未做 Shopify write、未做 DB migration**。

### 這輪實際踩到並修掉的 CI 問題

1. CI #507：舊 P4 verifier 假設 `buildCopySystemPrompt` 必須永遠直接 delegate Production base；新 focused Writer 有合法分支後，source-shape check 先失敗。
   - 沒有刪安全檢查。
   - Product Brief 新增賣家服務排除：保固／售後／退換／贈品／滿額／店鋪活動／客服承諾／物流時效不得進商品事實欄。
   - Focused Writer 再加顧客文案「來源：網路／URL」禁令與 seller-service guard。
   - P4 verifier 改成同時確認 Production fallback **以及** COPY-PB1 focused path 的安全條件。

2. CI #517：COPY-PB1 自己的 verifier 還期待 `productBriefResult?.writerText` 直接傳 Writer，與後來加入的 safe fallback 不一致。
   - verifier 改成明確要求：只有 `productBriefResult && !productBriefResult.fallback` 才能把 Brief 傳進 focused Writer。
   - 這把「半成品 Brief 不得送進 Writer」鎖成 regression contract。

3. CI #519：上述修正後，verify / typecheck / build 全數通過。

### 仍未完成的品質 gate

技術 gate 綠 **不等於 Owner 已認可文案**。下一步仍是 Preview 上用真實 5–10 商品做舊版 vs COPY-PB1 A/B，記錄：
- 商品理解是否正確；
- 文案具體度與潮巢語感；
- hallucination／generic 搜尋污染；
- input/output tokens、成本與 latency。

Owner 沒明確說「這版文案可以」以前，PR #13 保持 Draft，Production 不動。

## 13. COPY-PB1.1｜Owner live QA follow-up｜2026-10-06

Owner 在 PR #13 Preview 實測後回報：**文案明顯比舊版好很多**，代表 Product Brief → focused Writer 方向成立；但仍希望小修。

Commander 隨後用 Supabase 正式測試專案 `nestory-listing-tool-test` 唯讀核對實際生成紀錄，確認 2026-10-05 至少有兩筆 `generation_rule_version=chaochao-pb1-20260930` 的 live COPY-PB1 full generation：

- Pingu × 您萌吹風機；
- MINISO × DRAGON BALL Z Q 版萌粒鍵帽盲盒。

實際輸出暴露三個窄缺口：

1. **legacy draft evidence 污染**：七龍珠舊 draft 的 `spec_text`／角色分類仍把「PVC、約 11 公分、孫悟空單一角色」帶進新版，即使當次商品標題本身是多角色／隨機盲盒。
2. **Why 太抒情**：選品理由仍會跑出「不變的夢想、溫柔治癒」這類抽象句，商品價值反而被稀釋。
3. **FAQ／效果過度肯定**：例如沒有明確證據卻回答「圖案不會褪色」、把「靜音設計」擴成「比一般吹風機更安靜」，或從材質／功能名自行推導耐用、清潔、髮質效果。

### PB1.1 調整

Product Brief 版本由 `pb1-20260930` 升為 `pb1.1-20261006`；成功走新路徑時新的 recipe trace 為：

`generation_rule_version=chaochao-pb1.1-20261006`

只做三個 adjustment：

- `productBrief.ts`：當次賣家標題／款式／操作備註／圖中文字高於舊 draft；草稿既有 IP／角色／品項／品牌／規格只當 legacy candidate。高風險尺寸／材質等若只存在舊 `spec_text`，不得直接進 confirmed facts/spec；多角色／隨機盲盒也不得只因舊 character 縮成單一角色。既有 SKU authority 不變。
- `chaochaoPrompt.ts`：只在 Product Brief focused Writer 增加 value-first Why 規則；`why_we_chose_it` 改成 1–2 句，先講商品具體價值，再補潮巢觀察，禁止用抽象角色頌歌代替理由。
- 同一 focused Writer 增加 FAQ／效果 evidence boundary：Brief 沒明講的耐用性、比較優勢、保證性結論不可靠常識延伸；FAQ 只問 Brief 有資料能回答的問題。單欄 regen／其他 tone 沒有改。

Diff gate 最終只出現：

- `src/lib/providers/productBrief.ts`
- `src/lib/providers/chaochaoPrompt.ts`
- `scripts/verify-copy-product-brief.mjs`

### PB1.1 驗證證據

Validated runtime code SHA：

`71c49f2cfccf4673392d7e12d09fdc536986446d`

- GitHub CI run #567：`verify:all` ✅、typecheck ✅。第一次 build 在 `next/font` Google loader 發生環境型錯誤；同一 SHA 直接 rerun failed job 後整個 workflow **SUCCESS**，沒有用 noop commit 觸發。
- Vercel deployment：`dpl_BBS9k3QRvB7BcJ4RaxXvXPYcf5DV`，state=`READY`、target=`Preview`（不是 Production）、git SHA=`71c49f2...`。
- stable branch Preview 仍是：`https://nestory-listing-admin-git-gpt-copy-produc-c2532b-chocho-nestory.vercel.app`
- PR #13 仍 Draft / OPEN / NOT MERGED。
- Production / Shopify / DB：未寫入、未 deploy、未 migration。

### 下一個 Owner gate

不需要再大範圍 A/B。優先用同一個 Preview 重測：

1. MINISO × 七龍珠萌粒鍵帽盲盒：確認舊 `11 公分 / PVC / 單一孫悟空` 不再無證據回流。
2. Pingu 吹風機：確認 Why 更像選品理由；FAQ 不再保證不褪色，也不把「靜音」擴寫成「比一般更安靜」。

Owner 明確接受前，PR #13 繼續 Draft，不 merge、不上 Production。
