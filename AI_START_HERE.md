# Nestory — AI Start Here

> 新 Project Commander / Codex / GPT Work / Claude / 其他 Agent 的最短接手入口。
> 更新基準：2026-08-27（Asia/Taipei）。
> **重要：這份文件是 handoff snapshot，不是 live authority。真正開始工作前，必須重新查 GitHub / Vercel。**

## 1. 新 session 先讀

依序讀：

1. `AI_START_HERE.md` — 現在在哪裡
2. `docs/AI_WORKING_RULES.md` — 在這個專案怎麼工作
3. `docs/CURRENT_STATUS.md` — 目前真實狀態摘要
4. `docs/ACTIVE_TASKS.md` — 正在施工的 package / Agent / reserved files

需要歷史與決策時再讀：

- `docs/DECISIONS.md`
- `docs/WORK_HISTORY.md`
- `docs/ROADMAP.md`
- `docs/RELEASE_READINESS.md`
- `docs/audits/`

## 2. 專案一句話

Nestory 是潮巢玩居內部商品上架工具：商品輸入、圖片 / 規格、AI 文案、審核、Shopify 發布、Showmore CSV、Supabase 資料層與 Vercel 部署。

## 3. 目前 live snapshot

Repo：`chochovibe-cmd/nestory-listing-admin`

Production / default branch：`codex/nestory-v0.1-safety-skeleton`

最近重新驗證的 Production HEAD：
`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`

最近重新驗證的 Production deployment：
- Vercel deployment：`dpl_ELzL4fEBhxuGLJW5XeLgYUVurbFM`
- source SHA：`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`
- target：Production

COPY feature branch：`agent/copy-chaocao-sales-tone`

最近重新驗證的 feature HEAD：
`5c160942a269574737d6876cf035ce73099a6aa0`

PR：`#9 Copy C1: add Chaochao sales copy tone`

PR 狀態：**OPEN / NOT MERGED**

Latest CI：
- CI `#324`
- SHA：`5c160942a269574737d6876cf035ce73099a6aa0`
- result：**SUCCESS**

Latest COPY Preview：
- deployment：`dpl_HjFD8dyxHbs42TkGgGyPiV1aqvJa`
- source SHA：`5c160942a269574737d6876cf035ce73099a6aa0`
- state：READY
- target：Preview（不是 Production）

## 4. COPY C1 現況

已完成並通過目前工程 / Owner 驗收的項目：

1. R0A shared data pipeline recovery
2. R0B title / SKU / FAQ recovery
3. R0B.3 single-field tone preservation
4. Chaochao-only detailed description contract restore
5. Preview 使用 stored `generation_tone` / `sale_status`
6. C1.P1 missing-heading-prefix Preview fallback
7. CI #324 PASS
8. Owner real-device：COPY C1.P1 Preview layout PASS

目前 **不要 merge PR #9**。

下一階段不再叫 recovery。Copy quality 要分開處理：

- `COPY C2` — Description Quality
- `COPY C3` — Title Quality
- `COPY C4` — Metafield + FAQ Quality

每包最多 1–3 個 adjustment，不得把 description / title / FAQ / shared system 一次大改。

## 5. COPY C2 已批准的設計方向

C2 只改善「潮巢導購版」description 的內容品質，不再重做 C1 已通過的版型。

三個 adjustment：

1. 商品專屬購買理由：從 evidence 找出只有本商品才成立的 facts，轉成合理的 feature → benefit / usage reason。
2. 生活感寫法：減少抽象稱讚與 AI 萬用句，改成有具體使用畫面的潮巢小編語氣。
3. 三段分工：商品介紹、收藏亮點、導購小標不得重複換句話說同一賣點。

C2 runtime 預設 reserved：

- `src/lib/providers/systemPrompt.ts`
- 專用 verifier（只有真的需要時）

禁止把 C2 變成 shared prompt engine 重構。

## 6. 本週 Owner 目標

P0：

- Copy quality
- Shopify Go-Live audit
- ONE controlled Shopify smoke（只能在 Owner 明確授權的 Go-Live package）
- Showmore CSV audit / MVP

P1：

- 卡片區 UIUX：複製、HTML、按鈕
- 桌機 UIUX
- 輸入區 UIUX
- 手機跳轉順序
- 輸入區卡片
- 壹加壹螢光綠 Theme

P2：

- 新上架商品 GSC / indexing 流程
- SEO follow-up

Showmore CSV 目標架構：

Shopify 成功上架 → 使用 Shopify 媒體庫 → 生成 Showmore CSV → 記錄哪些 Shopify 商品已下載過 SM CSV → 導入 SM category mapping。

## 7. Production / Shopify safety

Production/default 預設 READ-ONLY。

未經 Owner 明確開包，禁止：

- merge PR #9
- Production deploy
- Shopify 真實商品 write / publish / unpublish
- DB migration
- broad data cleanup

舊 Pingu 有歷史 `spec_text` 污染；目前 existing-first 會保留舊資料。不要在 COPY package 偷做 DB cleanup。

## 8. 多 Agent 協作

Project Commander 管全局、roadmap、release、GitHub、CI、Vercel、copy、Shopify、CSV、GSC、Production safety 與 package coordination。

UIUX Commander 可平行設計 layout / spacing / hierarchy / interaction / mobile / responsive / theme，但不得自行修改 Shopify business logic、DB、copy prompt、SKU、CSV、GSC。

平行施工前必須登記 `docs/ACTIVE_TASKS.md` 的 Reserved files。兩包碰同一檔案時不可同時施工。

## 9. 最重要的 authority 規則

**文件告訴 Agent「應該去哪裡查」；GitHub / Vercel 告訴 Agent「現在真的在哪裡」。**

任何 branch、SHA、PR、deployment、CI、package status，只要要拿來當施工 gate，都必須 live re-check。不要因為聊天記憶或本文件寫過就直接相信。

## 10. Commander 回覆格式

先用 1–2 句白話講：

- 現在發生什麼
- 有沒有問題
- 下一步做什麼

之後再補：狀態 → 風險 → 下一步 → 技術證據。

沒有 Owner 明確說「可以合併」，就不 merge。