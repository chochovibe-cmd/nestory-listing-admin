# Nestory — Current Status

> 更新基準：2026-08-27（Asia/Taipei）。
> 這是狀態快照；真正施工前仍要重新查 GitHub / Vercel。

## 1. Current production

Repo：`chochovibe-cmd/nestory-listing-admin`

Default / Production branch：`codex/nestory-v0.1-safety-skeleton`

最近重新驗證的 Production HEAD：
`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`

Production Vercel：
- deployment：`dpl_ELzL4fEBhxuGLJW5XeLgYUVurbFM`
- source SHA：`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`
- state：READY
- target：Production

Production/default 預設 READ-ONLY。

## 2. Current COPY branch / PR

Feature branch：`agent/copy-chaocao-sales-tone`

最近重新驗證的 feature HEAD：
`5c160942a269574737d6876cf035ce73099a6aa0`

PR：`#9 Copy C1: add Chaochao sales copy tone`

PR state：**OPEN / NOT MERGED**

Latest CI：
- run：CI #324
- SHA：`5c160942a269574737d6876cf035ce73099a6aa0`
- result：SUCCESS

Latest feature Preview：
- deployment：`dpl_HjFD8dyxHbs42TkGgGyPiV1aqvJa`
- source SHA：`5c160942a269574737d6876cf035ce73099a6aa0`
- state：READY
- target：Preview

Owner real-device acceptance：
**COPY C1.P1 Preview layout PASS**。

## 3. COPY C1 completed

已完成：

1. R0A shared data pipeline recovery
2. R0B title / SKU / FAQ recovery
3. R0B.3 single-field tone preservation
4. Restore Chaochao-only detailed copy contract
5. Preview uses stored `generation_tone` / `sale_status`
6. C1.P1 missing-heading-prefix Preview fallback
7. CI #324 PASS
8. Owner real-device Preview layout PASS

C1 目前沒有新的 recovery blocker。

**禁止自行 merge PR #9。**

## 4. Current next package

下一個 runtime copy package：`COPY C2 — Description Quality`。

C2 不是 recovery，也不是 shared engine redesign。

已批准設計方向只有三項：

1. 商品專屬購買理由：facts → feature → benefit / usage reason。
2. 生活感寫法：減少抽象 AI 稱讚與萬用句，改成具體、有人味、潮巢小編式表達。
3. 三段分工：商品介紹 / 收藏亮點 / 導購小標各自有工作，不重複換句話說同一賣點。

C2 Owner acceptance 重點：

- 第一段不是 AI 萬用問句。
- evidence 足夠時至少自然使用 3 個本商品專屬 facts。
- 收藏亮點不是純形容詞，優先 feature → benefit / 情境。
- 三個 section 不重複講同一件事。
- 導購小標段增加新的使用 / 收藏情境，不是全文 summary。
- C1 已 PASS 的三段 hierarchy、bullets、Preview、tone preservation 不得退步。

## 5. Documentation checkpoint

目前 docs-only package：`DOCS C0 — Commander Memory Reset`。

Branch：`agent/docs-commander-checkpoint-20260827`

Authority start：Production `6960a0cd257590abb6c1ccb7c97a2c3e772714d3`

Allowed：
- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `docs/AI_WORKING_RULES.md`
- `docs/DECISIONS.md`
- `docs/WORK_HISTORY.md`
- `docs/ROADMAP.md`
- `docs/ACTIVE_TASKS.md`

Forbidden：所有 runtime / CI workflow / Vercel config / Shopify / Supabase 修改。

## 6. Weekly priority

### P0

- Copy quality：C2 → C3 → C4
- Shopify Go-Live audit
- ONE controlled Shopify smoke（Owner 明確授權後才做）
- Showmore CSV audit / MVP

### P1

UIUX 平行：
- 卡片區複製 / HTML / 按鈕
- 桌機 UIUX
- 輸入區 UIUX
- 手機跳轉順序
- 輸入區卡片
- 壹加壹螢光綠 Theme

### P2

- 新上架商品 GSC / indexing
- SEO follow-up

## 7. Showmore CSV target direction

目標資料流：

Shopify 成功上架
→ 使用 Shopify 媒體庫
→ 生成 Showmore CSV
→ 記錄哪些 Shopify 商品已下載過 SM CSV
→ 導入 SM category mapping

目前仍屬 audit / MVP 規劃，尚未授權 broad runtime / DB 變更。

## 8. Known data caveat

舊 Pingu draft 曾被舊版本污染 `spec_text`。目前 existing-first contract 會保留既有非空規格，因此舊 Pingu 不適合拿來判斷新的 spec pipeline 是否乾淨。

不要在 COPY package 自動清 DB。若要修舊 business data，另開 narrow data repair package 並由 Owner 明確批准。

## 9. Current risk assessment

目前沒有新的 Production / CI / Vercel blocker。

主要風險是：

1. 文件落後 live state。
2. Copy quality 若不拆包，容易再次 scope creep。
3. 多 Agent 若碰同一檔案，可能產生 race。
4. PR #9 尚未 Owner merge approval。

對策：

- live re-check GitHub / Vercel；
- package 最多 1–3 adjustments；
- Reserved files；
- 每次寫入前 Race Guard；
- Worker report 由 Commander 獨立驗收。