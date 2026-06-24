# 潮巢 Nestory｜Shopify 自動上架系統前情提要與需求規格

> 給 Codex / 扣哥閱讀  
> 目的：請先理解整體目標、既有 PWA 初版、理想流程與技術限制，接著幫我規劃分 Phase 的實作方案。  
> 請不要一開始就只做局部修補，也不要直接假設我只要 CSV 工具；我想要的是一套可以逐步升級成「商品自動上架後台」的系統。

---

## 0. 目前情境

我正在做 Shopify 商店「潮巢 Nestory」的商品上架系統。

商品類型主要是：

- 動漫 / IP 周邊
- 公仔 / 手辦
- 吊飾 / 鑰匙圈
- 布娃娃
- 餐具 / 生活周邊
- 收納 / 文具 / 小物

我目前有一份 PWA 初版 HTML：

- 檔名：`chochonest-listing-tool.html`
- 功能大概包含：
  - 商品標題輸入
  - CNY 價格輸入
  - 商品類型選擇
  - 備註欄位
  - 主圖 / 詳情圖 / 規格圖上傳
  - Cloudinary 圖片上傳
  - AI 產生商品文案
  - 定價試算
  - SEO / Tags 產出
  - CSV 匯出

這份 PWA 的 UI / 入口框架我希望「沿用與改造」，不是完全重做。

---

## 1. 我真正想要的最終體驗

我希望未來每次上架商品時，我只要在一個 PWA 或 LINE 裡面丟入：

- 淘寶商品連結，或
- 淘寶原標題
- CNY 價格
- 商品分類
- 補充備註
- 商品圖片

系統就可以自動：

1. 把商品資料存進後台資料庫
2. 產生繁體中文商品標題
3. 產生商品描述
4. 產生 SEO Title / SEO Description
5. 產生 Tags
6. 估算台幣售價
7. 處理商品圖片
8. 回寫到 PWA 審核頁
9. 通知我審核
10. 我在 PWA 直接看草稿、改文案、確認圖片與價格
11. 按「核准」
12. 系統自動建立 Shopify 商品草稿
13. 回填 Shopify 商品 ID / 後台連結
14. PWA 顯示「已建立草稿 / 已上架」

我想要的感覺是：

```text
PWA 輸入商品
→ 後台自動產草稿
→ PWA 審核
→ 一鍵建立 Shopify 商品
```

也就是一條龍後台，不是每次都手動下載 CSV。

---

## 2. 我目前傾向的架構

目前暫定：

```text
PWA
  ↓
Supabase Database
  ↓
後端任務 / API Route / Edge Function / Server Function
  ↓
AI 文案生成 + 圖片處理
  ↓
Supabase 回寫草稿
  ↓
PWA 審核頁
  ↓
Shopify Admin API
  ↓
建立 Shopify DRAFT 商品
```

### 工具定位

| 工具 | 定位 |
|---|---|
| PWA | 商品輸入 + 草稿審核後台 |
| Supabase | 商品草稿資料庫 + 圖片儲存 |
| 後端任務 | 保管 API Key、呼叫 AI、處理圖片、呼叫 Shopify |
| Codex | 幫我規劃、寫程式、重構、除錯 |
| Shopify Admin API | 正式建立商品 |
| LINE Bot | 可做通知，不一定第一階段就做 |
| Make / n8n | 可當輔助自動化，不希望一開始過度依賴 |
| Apify / 淘寶爬蟲 | 未來可加入，不一定第一階段就做 |

---

## 3. 請先幫我判斷：Supabase 是否適合

我原本也考慮過：

- Google Sheet
- Notion
- Shopify Draft
- Make / n8n
- Supabase

目前我偏向 Supabase，原因：

- PWA 讀寫速度比較快
- 可以做真正的後台資料庫
- 比 Notion 更適合未來做審核頁、狀態流、圖片管理
- 未來可以擴充成完整商品上架系統
- 可以搭配 Storage 放圖片
- 可以搭配 Edge Functions / API Route 做後端安全處理

請你幫我確認這個選擇是否合理，或你有更好的架構建議。

---

## 4. 既有 PWA 初版需要注意的地方

目前 HTML 初版裡有一些功能可以保留，也有一些需要改掉。

### 可以保留的方向

- 整體深色 UI 風格
- 左邊輸入 / 右邊結果的結構
- 商品標題、價格、分類、備註欄位
- 主圖 / 詳情圖 / 規格圖分區上傳
- 圖片預覽
- 文案 / 定價 / SEO / Tags 分頁
- 定價規則設定
- CSV 匯出可保留為備援功能

### 需要修正的地方

目前初版有：

- 前台 localStorage 存 Anthropic API Key
- 瀏覽器直接呼叫 AI API
- Cloudinary unsigned preset
- 以 CSV 匯出為主要終點

這些在正式版都需要調整。

### 安全要求

請務必注意：

- AI API Key 不可以放前端
- Shopify Admin Token 不可以放前端
- Supabase service role key 不可以放前端
- 任何 `.env` 不可以 commit 到 GitHub
- 前台只能使用可公開的 anon key，且要搭配 RLS / policies
- 真正敏感操作都應該放在後端

---

## 5. 商品狀態流程

我希望資料庫裡每筆商品有狀態流，方便追蹤。

建議狀態如下：

```text
pending_input       資料尚未完整
pending_copy        等待 AI 產文案
processing          AI / 圖片處理中
ready_for_review    草稿已完成，等待我審核
needs_revision      我退回修改
approved            我已核准
publishing          建立 Shopify 商品中
draft_created       Shopify DRAFT 已建立
active_published    Shopify 已正式發布（未來）
failed              流程失敗，待重跑
archived            不處理 / 放棄
```

請你幫我檢查這個 status 是否合理，是否需要簡化。

---

## 6. 資料表初步想法

不一定要一次做完整，但希望架構不要一開始就寫死到以後很難擴充。

### product_drafts

商品草稿主表。

可能欄位：

- id
- source_type
- taobao_url
- taobao_title
- original_title
- cny_price
- twd_price
- pricing_formula
- category
- vendor
- product_type
- title_zh
- description_html
- description_plain
- seo_title
- seo_description
- tags
- collection_suggestion
- note
- status
- shopify_product_id
- shopify_admin_url
- error_message
- created_at
- updated_at

### product_images

商品圖片表。

可能欄位：

- id
- draft_id
- image_type
  - main
  - detail
  - spec
  - generated_detail
- original_file_url
- processed_file_url
- shopify_media_id
- alt_text
- sort_order
- ocr_text
- translated_text
- processing_status
- created_at

### product_variants

之後處理多規格用。

可能欄位：

- id
- draft_id
- option1_name
- option1_value
- option2_name
- option2_value
- sku
- cny_price
- twd_price
- inventory_quantity
- image_id
- created_at

### automation_logs

記錄流程。

可能欄位：

- id
- draft_id
- action
- status
- message
- raw_payload
- created_at

### review_logs

記錄審核。

可能欄位：

- id
- draft_id
- action
- reviewer
- comment
- created_at

請你幫我判斷：今天第一階段是否需要全部建，或先建核心表，其他預留。

---

## 7. 圖片處理需求

我會上傳商品圖片，包含：

- 主圖
- 詳情圖
- 規格圖

我希望系統可以：

### 主圖

- 裁切 / 補白成 Shopify 適合的比例
- 建議 1:1，像 1080x1080
- 保留乾淨商品展示圖
- 寫入圖片網址與 alt text

### 詳情圖

- 統一寬度，例如 800px 或 1200px
- 如果有簡體文字，希望可以轉成繁體
- 如果圖片文字太多，希望之後可以：
  - 去掉原本圖片上的文字
  - 或重新生成一張繁中詳情圖
  - 或產出乾淨版商品資訊圖

### 規格圖

- OCR / AI 辨識圖片文字
- 簡體轉繁體
- 整理成商品描述裡的「商品規格」
- 可存回 product_images.ocr_text / translated_text

### 圖片處理階段建議

請你判斷哪些今天可以做、哪些應該放後面。

我的直覺：

- 今天先做：
  - 上傳
  - 統一尺寸
  - alt text
  - 規格圖 OCR / 簡轉繁文字
  - 圖片網址寫回資料庫
- 後續再做：
  - 圖片去字
  - 圖片文字改繁體
  - 重新生成詳情圖

但如果你覺得今天可以更快做到其中一部分，也可以提出。

---

## 8. AI 文案生成需求

AI 需要根據輸入資料產出：

- 繁體中文商品標題
- 商品描述 HTML
- 商品規格區塊
- SEO Title
- SEO Description
- Tags
- Collection 建議
- Image Alt Text
- 價格試算

### 文案語氣

品牌：潮巢 Nestory  
定位：台灣日系動漫 IP 選物店  
語氣：精準、活潑、有收藏感，但不要太浮誇。  
文字：繁體中文，以台灣用語為主。  
商品標題：SEO 友善，但不要像淘寶直翻。  
商品描述：要適合 Shopify 商品頁。

### 商品描述建議格式

```html
<h3>收藏亮點</h3>
<ul>
  <li>...</li>
</ul>

<h3>商品規格</h3>
<ul>
  <li>...</li>
</ul>

<h3>適合你如果</h3>
<ul>
  <li>...</li>
</ul>

<h3>購買提醒</h3>
<p>...</p>
```

### 定價規則

沿用初版概念，但可調整：

```text
成本 = CNY 價格 × 匯率 × 成本係數
售價 = 成本 × 利潤係數
尾數可改成 9 / 50 / 100 等方便售價
```

希望定價公式可在設定中調整。

---

## 9. 淘寶資料來源問題

我有思考兩種方式：

### 方式 A：我手動填淘寶原標題 + 價格 + 圖片

優點：

- 最穩
- 最快
- 不需要爬蟲
- 不容易被擋
- 省 token / 省算力

缺點：

- 人工多一點

### 方式 B：貼淘寶連結，自動抓資料

可能透過：

- 淘寶 API
- Apify
- 第三方 scraper
- 自寫爬蟲

優點：

- 較自動
- 可以抓圖、價格、規格

缺點：

- 可能被擋
- 可能有費用
- 失敗率較高
- 比較耗時間
- 可能有反爬限制

### 我希望你幫我判斷

請你評估：

1. 今天是否先做方式 A 比較合理？
2. 是否可以先預留 taobao_url 欄位，未來再加 Apify？
3. 如果要加 Apify，應該放在哪個 Phase？
4. 如果現在不加爬蟲，是否會影響之後擴充？

---

## 10. Shopify 上架需求

我希望核准後建立 Shopify 商品。

### 第一階段

- 建立 Shopify DRAFT 商品
- 不直接 ACTIVE
- 回填 Shopify Product ID
- 回填 Shopify 後台連結
- PWA 顯示「已建立草稿」

### 後續階段

- 可以選擇直接 ACTIVE
- 可以更新商品
- 可以同步圖片
- 可以處理 variant
- 可以處理 collections
- 可以處理 inventory
- 可以處理 metafields

請你幫我判斷第一階段 Shopify API 要做哪些欄位就好，不要一次過度複雜。

---

## 11. LINE Bot / 通知需求

我希望之後有 LINE 通知：

- 草稿生成完成 → 通知我審核
- 上架成功 → 通知我
- 上架失敗 → 通知我錯誤原因

但我不確定第一階段要不要做。

我的想法：

- PWA 是主要操作介面
- LINE 只是通知
- 不希望主要審核流程依賴 LINE

請你幫我判斷 LINE Bot 應放在哪個 Phase。

---

## 12. Codex / Automation / MCP 的角色

我知道 Codex 可能可以做 automation，也可以用 MCP。

但我希望你幫我判斷：

- 哪些適合用 Codex 幫我寫成固定程式？
- 哪些適合用 Codex Automation？
- 哪些適合用 MCP？
- 哪些應該直接寫成後端 API / Edge Function？
- 正式上架流程是否應避免依賴 AI Agent 常駐？

我的初步理解：

| 項目 | 角色 |
|---|---|
| Codex | 幫我寫系統、拆 Phase、改 PWA、建 API、除錯 |
| Skill | 固定商品文案規則 / 上架規則 |
| Automation | 可以做輔助批次任務，但需評估穩定性 |
| MCP | 可以輔助開發與測試，但不一定是正式上架主線 |
| 後端 API | 正式處理 AI、圖片、Shopify 的安全執行層 |

請你幫我修正這個理解。

---

## 13. 今天時間與工作方式

我今天大約有 10 小時可以處理，希望進度快一點，不要過度保守。

但我也希望不要一開始就把系統做爆，重點是：

1. 先理解完整願景
2. 你幫我拆 Phase
3. 先做今天最值得做、最能跑通的一版
4. 每個 Phase 都要能預覽 / 測試
5. 不要直接動正式 Shopify 上架，除非我確認
6. 不要直接 push / deploy，除非我確認
7. 敏感 token 不要寫死在前端或 repo

---

## 14. 我希望你先輸出的內容

請你先不要直接開始大改。

請先輸出：

1. 你對我需求的理解
2. 你建議的總架構
3. 你建議的 Phase 拆法
4. 今天 10 小時內最合理完成到哪裡
5. 哪些功能今天做、哪些延後
6. 需要我準備哪些帳號 / token / 環境變數
7. 你會怎麼改現有 HTML / PWA
8. 你會新增哪些檔案
9. 你建議 Supabase 資料表 SQL
10. 你建議 Shopify API 第一階段欄位
11. 風險與安全注意事項
12. 等我確認後，再開始執行第一個 Phase

---

## 15. 我手上目前可能可提供的東西

- 既有 PWA 初版 HTML：`chochonest-listing-tool.html`
- Shopify 商店後台
- 商品來源資料：淘寶標題 / 價格 / 圖片
- 之後可提供 Supabase 專案資訊
- 之後可提供 Shopify Admin API token
- 之後可提供 AI API key
- 之後可提供 LINE Bot token（如需要）

---

## 16. 成功標準

第一個可用版本完成時，我希望能做到：

1. 打開 PWA
2. 輸入一筆商品資料
3. 上傳商品圖片
4. 點擊送出
5. 資料進 Supabase
6. 後端產生商品草稿
7. PWA 審核頁看到文案、圖片、價格、SEO、Tags
8. 我可以修改草稿
9. 我按核准
10. Shopify 後台出現一個 DRAFT 商品
11. PWA 顯示 Shopify 商品 ID / 後台連結
12. 若失敗，有錯誤訊息與重試方式

---

## 17. 請特別注意

- 我不是只要 CSV 工具，我是要逐步做成商品上架後台。
- 但 CSV 匯出可以保留作為備援。
- 請沿用現有 PWA 的視覺與操作邏輯，不要直接變成普通表單。
- 請把圖片處理納入規劃，不要只規劃文字。
- 請把 Shopify DRAFT 上架納入規劃，不要只停在 Supabase。
- 請把安全性納入規劃，不要讓 key 暴露在前端。
- 請用今天可以快速推進的方式拆階段。

---

## 18. 給你的第一個任務

請根據上述需求與我提供的 `chochonest-listing-tool.html`，先提出完整實作規劃。

請用以下格式回答：

```markdown
# 我對需求的理解

# 建議總架構

# Phase 拆法

# 今日 10 小時衝刺建議

# 需要準備的帳號 / Token / 環境變數

# 資料庫設計

# PWA 改造計畫

# 後端 / API 設計

# 圖片處理方案

# Shopify 上架方案

# 風險與注意事項

# 我建議先執行的第一步
```

請先規劃，等我確認後再實作。
