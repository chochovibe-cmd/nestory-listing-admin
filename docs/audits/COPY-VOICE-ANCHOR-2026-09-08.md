# COPY-FIX-4 潮巢語氣範例注入包（2026-09-08）

## What（做了什麼）

老闆實測「潮巢導購」後，為什麼潮巢選它／商品賣點／文案／FAQ 都像罐頭：prompt 只用形容詞描述語氣，沒有真實寫作範例。

本包只改潮巢導購 writer 語氣，不動標題、三段結構、bullets、導購小標銜接、紅線清單、搜尋管線、UI、API。

1. 新增共用【潮巢語氣真實錨點】：引用潮巢編輯部真實文章的關鍵句，標明「模仿語感，不要抄句子」。
2. description／why／highlights／FAQ 都引用該錨點（全文生成一次注入；單欄重生只給這四欄）。
3. Why／Highlights／FAQ 各加寫作要求＋反面示範（「這些是你不准寫出來的句型」）。

## Why（為什麼）

形容詞（自然、幽默、有人味）不夠讓模型寫出潮巢編輯部的短句、立場與具體知識。Few-shot 真實樣本才是語氣錨。

## 樣本出處

指揮官從老闆正式部落格抓取、審核後交付：

- 樣本一：Hello Kitty 50 週年文章（破題／觀點／敢講真話／「為什麼潮巢選它」收尾）
- 樣本二：日本 IP 周邊品質文章（具體知識當梗／價值主張／誠實選品）

Prompt 只當節奏錨點，禁止把樣本角色或情節硬套到別件商品。標題與 SEO 明確排除，不套用這些文章句子。

## Affected files

| 檔案 | 變更 |
|---|---|
| `src/lib/providers/systemPrompt.ts` | 新增 `CHAOCHAO_VOICE_ANCHOR`；Why／Highlights／FAQ 加寫作要求與反面示範；Description persona 改引用錨點；全文生成與四欄重生注入錨點 |
| `scripts/verify-copy-c1-chaonest-sales-tone.mjs` | 新增 COPY-FIX-4 錨點／禁用句型鎖；既有標題／結構／紅線 assertion 未改 |
| `docs/audits/COPY-VOICE-ANCHOR-2026-09-08.md` | 本檔 |

未動：`CHAOCHAO_TITLE_QUALITY`、三段／bullets／導購小標格式、`systemPromptBase.ts` 紅線清單、`docs/CURRENT_STATUS.md`、`docs/施工清單.md`、搜尋管線、UI、API。

## Verifier 影響

- `verify-copy-c1-chaonest-sales-tone.mjs`：舊 assertion 全部保留（含 COPY-FIX-3 標題格式 v2、Boss 三段結構、anti-AI 清單、`systemPromptBase` blob）。**新增**錨點標題、「模仿語感不要抄句子」、Hello Kitty／公仔樣本句、Why／Highlights／FAQ 寫作要求與禁用句型、全文／單欄注入鎖。
- `verify-copy-format.mjs`：無語氣措辭鎖，未改。

## 驗證結果

- `corepack pnpm run typecheck`：PASS
- `corepack pnpm run verify:all`：PASS
- `node scripts/verify-copy-c1-chaonest-sales-tone.mjs`：PASS
- `node scripts/verify-copy-format.mjs`：PASS
