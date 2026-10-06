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

## 14. COPY-PB1.2｜Why 選物語氣 + source-only full regen｜2026-10-06

Owner 覺得 PB1.1 的「為什麼潮巢選他」仍差一點，並指定 `https://littlesecret.showmore.cc/` 作為風格參考。Commander 只取其首頁可觀察到的語氣原則：把「物件」接到「日常的小驚喜／送禮心意」，語氣像真正在替人挑東西的選物者；**不複製對方句子、不把潮巢改成別店口吻**。

同時，PB1.1 實機重測後 Supabase 仍看到七龍珠舊錯誤 `PVC / 約11公分 / 單一孫悟空` 回流。這證明只靠 prompt 說「legacy candidate」不夠，因為 full regenerate 仍把上一輪 AI 寫回 draft 的 spec / character / product type / brand / cached product search 再餵回研究流程，形成 self-confirming loop。

### Authority / scope

- Branch：`gpt/copy-product-brief-refactor-20260930`
- Draft PR：#13
- Start HEAD：`58574e993da13fb5678eabf39b912e9f64eaf916`
- Allowed：潮巢 full-generation 的 source-evidence rebuild、Product Brief recipe version、focused Writer 的 Why 規則、對應 verifier / docs。
- Forbidden：其他 tone、Description / Highlights / FAQ 的既有品質規則、single-field regen、DB migration、Shopify write、Production deploy、merge。
- Owner acceptance：
  1. Why 像真實選物者分享「我看到哪個細節，所以想把它挑進店裡」，不是品牌公關稿。
  2. 同一個已生成 draft 再做 full regenerate 時，不再把上一輪 AI 產生的 spec / character / type / brand / product-search cache 當來源重新證明自己。

### PB1.2 implementation

Recipe version：`pb1.2-20261006`；成功路徑寫入：

`generation_rule_version=chaochao-pb1.2-20261006`

#### 1. Why 語氣

Focused Writer 的 `why_we_chose_it` 仍只寫 1–2 句，但改成：

- 先抓「這件才成立」的小細節、反差、功能或角色巧思；
- 再落到它進入日常／送禮時多出的感受；
- 可以自然用「我們喜歡的是…／會把它挑進來，是因為…／比起又一個___，我們更喜歡它___」的選物者視角，但不能固定套模板；
- 明確排除企業式句子：`滿足收藏需求 / 潮巢希望 / 展現角色魅力 / 帶入生活空間 / 兼具收藏與實用價值 / 值得收藏 / 充分滿足`；
- 仍禁止抽象角色頌歌、人生感悟與無商品根據的療癒抒情。

#### 2. Full regenerate 改成 source-only evidence rebuild

如果目前 draft 的 `generation_rule_version` 已經是 `chaochao-pb*`，下一次「完整生成」會視為 rebuild：

- 不把舊 `spec_text` 送進 product web search；
- 不把舊 character / product type / brand 送進 Product Brief 當 fallback evidence；
- 不重用舊 product-search cache；
- legacy fallback Writer 也不再吃舊 `spec_text`；
- existing IP 與 SKU 仍保留 authority；
- 原始 title / variants / operator note / image evidence / fresh exact-product web search 仍正常使用。

這個 guard 只影響「潮巢導購版」full regenerate。其他 tone 與 single-field regen 不改。

### Diff gate

PB1.2 runtime code 只動：

- `src/app/api/generate/route.ts`
- `src/lib/providers/productBrief.ts`
- `src/lib/providers/chaochaoPrompt.ts`
- `scripts/verify-copy-product-brief.mjs`

### Validation

Validated runtime code SHA：

`1eece231bdab6ae03eff01a9736296a130f9635e`

- GitHub CI run #588：`verify:all` ✅ / typecheck ✅ / build ✅
- Vercel deployment：`dpl_22TL66PD6j2XLc7SnWNKP1JmM4b6` ✅ READY
- Vercel target：Preview（`target=null`），不是 Production
- Stable branch Preview：`https://nestory-listing-admin-git-gpt-copy-produc-c2532b-chocho-nestory.vercel.app`
- PR #13：Draft / OPEN / NOT MERGED
- Production / Shopify / DB：未寫入、未 deploy、未 migration

### 下一個 Owner gate

只需重測 2 筆：

1. MINISO × 七龍珠萌粒鍵帽盲盒：舊 `PVC / 11公分 / 單一孫悟空` 不應再自我回流。
2. Pingu 吹風機：Why 應更像真心選物理由，而不是「滿足需求／潮巢希望／角色魅力」式公關稿。

測完後 Commander 再用 Supabase 唯讀核對 `chaochao-pb1.2-20261006` 實際結果；Owner 明確接受前不 merge、不上 Production。

## 15. COPY-PB1.3｜Why 回調 + evidence integrity｜2026-10-06

Owner 實測 PB1.2 後明確回報：「沒有上一版好的感覺」。Commander 隨即用 Supabase 唯讀比對 PB1.1 / PB1.2 實際 `generation_history`，確認不是主觀錯覺：

- PB1.2 Why 開始反覆出現「我們喜歡的是…不僅…還…讓日常…」等新模板，實際上只是把舊企業式模板換成另一套模板。
- 七龍珠 PB1.2 最新搜尋把不相干的 MegaHouse `Petitrama DX DRACAP` 七龍珠商品當成尺寸／材質線索；Tavily 綜合摘要錯把該來源的 `75mm / 55mm / PVC+ABS` 歸到 MINISO 萌粒鍵帽盲盒。
- 同一筆 draft 的 `spec_text` 仍停在更舊的 `PVC / 約11公分`。根因是 full-generation 寫回邏輯原本刻意遵守「新 spec 空白時不覆蓋舊 spec」，但對 PB1.x source-only rebuild 來說，這反而會保留上一輪 AI 產生的 stale spec，造成卡片新文案與 DB 規格不一致。

### Authority / scope

- Branch：`gpt/copy-product-brief-refactor-20260930`
- Draft PR：#13
- Start HEAD：`8ae0e28abd45ac3a26d70e9c682006a324068ee9`
- Allowed adjustments（最多 3 個）：
  1. Why 取消 PB1.2 過度模板化，回到自然選物者回答。
  2. PB source-only full rebuild 若沒有新的可信 spec，就清掉舊 AI spec，不得默默保留。
  3. Product Brief 不得把 web-search 綜合摘要本身當證據；尺寸／材質等必須能由來源標題／摘錄確認同款身份。
- Forbidden：Description / Highlights / FAQ 既有規則、其他 tone、single-field regen、Shopify、DB schema、Production、merge。

### PB1.3 implementation

Recipe version：`pb1.3-20261006`；成功路徑寫入：

`generation_rule_version=chaochao-pb1.3-20261006`

#### 1. Why 回調

移除 PB1.2 的固定示範句型與「日常／送禮／小驚喜」節奏要求。

現在只問 Writer 一個自然問題：

> 你看到這件時，為什麼會想把它選進潮巢？

要求從一個只有這件才成立的細節回答，再自然說明那個細節為什麼讓人想留下。沒有固定開頭、沒有必備情緒詞；如果讀起來只是商品介紹的濃縮版就重寫。企業式抽象句與角色頌歌仍禁止。

#### 2. stale spec consistency

PB1.2 已有 source-only rebuild guard。PB1.3 再補寫回規則：

- 一般流程仍維持「model spec 空白不擦掉既有手填／既有規格」的舊安全行為。
- 只有在 `rebuildChaochaoBriefFromSource=true` 的 PB full regenerate：若新的 verified `providerOutput.spec` 為空，就把 `finalSpecText` 設為 null，不再保存上一輪 AI spec。
- 若新 Brief 有可信 `specLines`，仍正常寫回新 spec。

#### 3. web evidence integrity

Product Brief 新增 source-level guard：

- 搜尋供應商的「綜合摘要」只算候選線索，不是證據。
- 尺寸、材質、配件、系列等商品事實必須在來源標題／來源摘錄看到同款身份線索，至少對得上品牌／聯名方、品項或系列。
- 來源若明顯是另一品牌、另一系列或另一種商品，即使綜合摘要聲稱是目標商品，也必須進 `rejectedEvidence`，不能拿該來源規格。

這條就是針對本次觀察到的「MINISO 萌粒鍵帽盲盒 ← MegaHouse Petitrama DRACAP 75mm」污染類型，但規則本身是一般化的，不綁死單一商品。

### Diff gate

PB1.3 runtime code 只動：

- `src/lib/providers/chaochaoPrompt.ts`
- `src/lib/providers/productBrief.ts`
- `src/app/api/generate/route.ts`
- `scripts/verify-copy-product-brief.mjs`

### Validation

Validated runtime code SHA：

`1722b3dcfe262e3d95e344c851ce6535e5bf9190`

- GitHub CI run #612：`verify:all` ✅ / typecheck ✅ / build ✅
- Vercel deployment：`dpl_BdSzosWX52u2oKYwbpDgbS4w1LQq` ✅ READY
- Vercel target：Preview（不是 Production）
- PR #13：Draft / OPEN / NOT MERGED
- Production / Shopify / DB schema：未動

### 下一個 Owner gate

只需再用相同 Preview 做兩筆 full generation：

1. 七龍珠 MINISO 萌粒鍵帽盲盒：
   - 不應再拿 MegaHouse Petitrama 的 `75mm / 55mm / PVC+ABS`；
   - 舊 `11公分` 若本次沒有可信規格，也應從 `spec_text` 清掉；
   - 角色不得縮成單一孫悟空。
2. Pingu 吹風機：
   - Why 不應再固定成「我們喜歡的是…不僅…還…」；
   - 應像自然回答「為什麼我會挑這件」，而不是商品介紹濃縮版。

測完後用 Supabase 唯讀檢查 `chaochao-pb1.3-20261006` 實際結果。Owner 明確接受前不 merge、不上 Production。
