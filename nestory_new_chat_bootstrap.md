# 新對話前情提要：潮巢 Nestory Shopify 自動上架系統

我正在做一個 Shopify 商品自動上架系統。  
我已經有一份 PWA 初版 `chochonest-listing-tool.html`，請先讀檔理解，不要推倒重做。

完整需求與背景請看：`nestory_codex_context_plan.md`

我希望你先幫我做：

1. 理解整體需求
2. 規劃總架構
3. 拆 Phase
4. 判斷今天 10 小時內最適合完成的版本
5. 列出需要我準備的帳號 / token / 環境變數
6. 提供資料庫 SQL、PWA 改造計畫、後端 API 設計、Shopify DRAFT 上架方案
7. 等我確認後再開始實作

請不要一開始只做 CSV 工具。  
我的目標是逐步做成：

PWA 商品輸入 → Supabase 草稿庫 → AI 產文案與處理圖片 → PWA 審核 → 一鍵建立 Shopify DRAFT 商品。
