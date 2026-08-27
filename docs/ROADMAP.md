# Nestory — Roadmap

> 更新基準：2026-08-27。
> 這是 Owner 目前方向；實際 package 開工前仍要重新確認 live state、scope 與 reserved files。

## 本週總目標

至少完成一個可安全每天使用的上架版本。

## P0 — 先完成

### 1. Copy quality

順序：

1. `COPY C2 — Description Quality`
2. `COPY C3 — Title Quality`
3. `COPY C4 — Metafield + FAQ Quality`

原則：
- 每包最多 1–3 adjustments。
- 不同 copy area 不混包。
- 不重做 shared system。
- 每包都要有真商品 Owner acceptance。

### 2. Shopify Go-Live audit

目標：正式檢查 Shopify API / lifecycle / env / publish safety 是否真的準備好。

先 audit，沒有 Owner 明確 Go-Live package 前不做真實商品 write。

### 3. ONE controlled Shopify smoke

只有在 Go-Live audit PASS 且 Owner 明確授權後：

- 使用 1 個測試商品。
- controlled publish。
- 驗證 Shopify 實際結果。
- controlled unpublish。
- 驗證 lifecycle。

任何 gate 失敗就 STOP。

### 4. Showmore CSV audit / MVP

目標架構：

Shopify 成功上架
→ 使用 Shopify 媒體庫
→ 生成 Showmore CSV
→ 記錄哪些 Shopify 商品已下載過 SM CSV
→ 導入 Showmore category mapping

先 audit 現有 CSV / Shopify media / data state，再拆 MVP package。

不要一開始就 broad migration / redesign。

## P1 — UIUX 平行

由獨立 UIUX Commander 設計，Project Commander 做全局 coordination。

Owner 想完成：

1. 卡片區 UIUX：複製、HTML、按鈕
2. 桌機 UIUX
3. 輸入區 UIUX
4. 手機跳轉順序
5. 輸入區卡片
6. 壹加壹螢光綠 Theme

UIUX Commander 可設計：layout、spacing、hierarchy、interaction、mobile flow、responsive、theme。

UIUX Commander 禁止自行修改：Shopify business logic、DB、copy prompt、SKU、CSV、GSC。

任何平行 package 開工前先登記 `docs/ACTIVE_TASKS.md` Reserved files。

## P2 — GSC / SEO

### 新上架商品 GSC / indexing 流程

目標：把新商品上架後的搜尋引擎 indexing 流程變成可重複、可檢查的操作。

先 audit 現況與實際資料流，再決定是否需要自動化。

### SEO follow-up

待 Copy C3 / C4 與實際上架流程穩定後再收斂，避免 SEO package 與 copy quality 同時改相同 prompt / fields。

## Package queue

### COPY C2 — Description Quality

狀態：NEXT / DESIGN APPROVED / RUNTIME NOT STARTED。

三個 adjustment：

1. 商品專屬購買理由。
2. 生活感寫法，降低 AI 萬用句與抽象稱讚。
3. 三段分工，不重複賣點。

預設 runtime reserved：
- `src/lib/providers/systemPrompt.ts`
- 專用 verifier（只有需要時）

### COPY C3 — Title Quality

狀態：PLANNED。

只處理 title quality；不混 description / FAQ / shared system。

具體 adjustment 等 C2 Owner acceptance 後再設計。

### COPY C4 — Metafield + FAQ Quality

狀態：PLANNED。

只處理 metafield / FAQ quality；不混 title / description。

具體 adjustment 等前兩包收斂後再設計。

### SHOPIFY G1 — Go-Live Audit

狀態：PLANNED / READ-ONLY FIRST。

先查：
- Production env / mock state
- publish / unpublish lifecycle
- idempotency
- media flow
- inventory / variant sync
- safe test preconditions

### SHOPIFY G2 — ONE Controlled Smoke

狀態：BLOCKED BY OWNER AUTHORIZATION + G1 PASS。

禁止預先執行真實 write。

### SM CSV A1 — Current-State Audit

狀態：PLANNED / READ-ONLY FIRST。

先找出現有 Shopify → CSV data path、媒體來源、category mapping、download tracking 缺口。

### SM CSV A2 — MVP

狀態：BLOCKED BY A1 DESIGN。

### GSC A1 — Indexing Audit

狀態：P2 / PLANNED。

## Done / freeze

- PR #8 UI package：merged。
- COPY C1 recovery / Preview layout：Owner PASS，但 PR #9 尚未 merge。
- Production/default：預設 freeze / READ-ONLY。

## Roadmap rules

1. P0 不代表可以一次全部施工。
2. package 最多 1–3 adjustments。
3. 發現其他問題先記錄，不施工。
4. shared files 衝突時由 Commander 排程。
5. 沒有 Owner merge approval 就不 merge。
6. 沒有 Owner Production / Shopify / DB authorization 就不做真實 write。