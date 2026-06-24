# 潮巢自動上架小工具｜目前整理與團隊版轉向交接稿

更新日期：2026-06-24  
用途：給新的 Codex / ChatGPT 對話作為專案背景，方便從「原版 Claude 單頁原型」轉向「成熟、安全、可多人使用的前後台架構」。

---

## 1. 專案目標

原始目標是做一個「潮巢商品上架助手」，協助把淘寶商品資料轉成 Shopify / Matrixify 可匯入的商品草稿。

核心流程：

1. 輸入淘寶商品標題、人民幣成本、商品分類、補充備註。
2. 上傳主圖、詳情圖、規格圖。
3. 自動處理圖片並上傳到可公開讀取的圖片空間。
4. 用 AI 產生商品名稱、商品描述、SEO 標題、SEO 描述、標籤、規格文字。
5. 依照潮巢定價規則計算售價。
6. 輸出 Shopify / Matrixify CSV。
7. 商品先進 Shopify Draft，人工檢查後再正式發布。

目前想法已調整：  
原本先做個人版，現在希望改成「團隊版」方向，所以需要更成熟、安全的前後台架構，但仍以原版功能架構為基礎調整。

---

## 2. 目前專案資料夾內的重要檔案

目前工作資料夾：

```text
C:\Users\s2491\Documents\🛺潮巢自動上架｜上架系統小工具
```

已知重要檔案：

```text
chochonest-listing-tool.html
```

這是 Claude 產出的 v3 單頁 HTML 原型。

```text
如果我想要利用你跟Codex 做一個自動上架系統，可以怎麼做，之前都是.txt
```

這是與 Claude 的對話紀錄匯出檔，包含原本的設計推導。

---

## 3. 原版 HTML 原型目前已具備的能力

`chochonest-listing-tool.html` 是單頁式瀏覽器工具，已有不少可保留的產品邏輯。

目前已包含：

- 商品基本資料輸入：
  - 淘寶標題
  - 人民幣價格
  - 商品分類
  - 補充備註

- 圖片上傳區：
  - 主圖
  - 詳情圖
  - 規格圖

- 圖片處理：
  - 主圖處理成 1080 × 1080 白底圖
  - 詳情圖 / 規格圖壓縮成約 800px 寬

- Cloudinary 上傳：
  - Cloud Name：`dlcu13xnn`
  - Upload Preset：`chochonest`
  - 使用 Cloudinary unsigned upload 取得公開圖片網址

- AI 功能：
  - 規格圖 OCR / 辨識
  - 商品文案產生
  - SEO 產生
  - 標籤產生

- 價格計算：

```text
成本 = ceil(人民幣價格 × 匯率 × 成本係數)
售價 = ceil(成本 × 毛利倍率)
```

目前預設：

```text
匯率 = 4.50
成本係數 = 1.30
毛利倍率 = 1.40
最低售價 = 199
```

售價再依金額級距進位：

- 500 以下：進位到 10
- 2000 以下：進位到 50
- 2000 以上：進位到 100

- Matrixify CSV 匯出：
  - Handle
  - Title
  - Body HTML
  - Vendor
  - Type
  - Tags
  - Published
  - SEO Title
  - SEO Description
  - Variant Price
  - Variant Cost
  - Image Src
  - Image Position
  - Image Alt Text
  - Status = draft

---

## 4. 原版最大問題

原型能跑，但架構不適合團隊正式使用。

主要問題：

1. API Key 放在前端

   原版會把 AI API Key 存在瀏覽器 `localStorage`，而且直接從瀏覽器呼叫 AI API。這對個人 Demo 尚可，但不適合團隊版。

2. 原本是接 Claude API

   HTML 內直接呼叫：

   ```text
   https://api.anthropic.com/v1/messages
   ```

   目標要改成 OpenAI / GPT API。

3. 單頁 HTML 難以維護

   前端 UI、資料狀態、圖片處理、AI prompt、CSV 產生全部混在同一個 HTML 檔，後續加權限、任務佇列、紀錄、多人協作會很難維護。

4. 沒有使用者 / 權限 / 審核流

   團隊版需要知道：

   - 誰建立商品
   - 誰編輯商品
   - 誰審核
   - 誰匯出
   - 哪些商品已上架或等待處理

5. 缺少可靠的任務狀態

   大量上架時，需要商品佇列、失敗重試、局部重跑、錯誤紀錄、處理進度。目前單頁 HTML 比較像一次性工具。

---

## 5. 已討論過、應保留的產品決策

### 5.1 輸出目標

第一階段仍建議以 Matrixify CSV 為主，匯入 Shopify Draft。

原因：

- 比直接打 Shopify API 安全
- 可以人工檢查
- 錯了也比較容易回頭修
- 適合大量商品但仍保留人工審核

### 5.2 商品狀態

建議保留「人工審核」為核心，不要一開始就全自動發布。

建議狀態：

```text
草稿 / 待處理 / AI 產生中 / 待審核 / 已核准 / 已匯出 / 失敗
```

### 5.3 批次佇列

使用者希望能大量上架，所以不是只做單品表單，而是商品佇列。

建議：

- 可逐筆加入商品
- 可批次執行 AI / 圖片處理
- 可逐筆重試失敗項目
- 可只匯出已核准商品

### 5.4 Web Research

曾討論過可加「搜尋資料」功能，但應該可開關。

建議：

- 預設可以開啟
- 每個商品保留資料來源
- 不要讓 AI 沒根據亂補 IP、角色、品牌資訊
- 若來源不足，文案要保守

### 5.5 詳情圖與規格圖

詳情圖：

- 放進 Shopify 圖庫
- 也嵌入 Body HTML 商品描述中

規格圖：

- 不直接發布原始規格圖
- 只拿來 OCR / 轉成繁體中文規格文字
- 未來若要圖片化規格表，應重新產生乾淨的繁中規格圖，而不是直接用淘寶原圖

### 5.6 多規格 / Variant

MVP 先支援 Option1。

每個款式至少要有：

- Option1 名稱 / 值
- Variant SKU
- Variant Price
- Variant Cost
- Variant Inventory Qty
- Variant Image
- Variant Inventory Policy

庫存政策：

- 預設：庫存 0 停止販售
- 可選：允許預購

未來資料模型要保留 Option2 / Option3 擴充空間。

---

## 6. 團隊版建議方向

既然現在方向改成團隊版，建議不要只把單頁 HTML 改大，而是重構成前後台架構。

### 6.1 建議架構

建議採用：

```text
前端 Web App
  ↓
後端 API
  ↓
資料庫
  ↓
外部服務：OpenAI / Cloudinary / Matrixify CSV / 未來 Shopify API
```

推薦技術方向：

- 前端：React / Next.js
- 後端：Next.js API Routes 或 Node.js + Express
- 資料庫：PostgreSQL
- 檔案 / 圖片：Cloudinary
- AI：OpenAI API
- 匯出：Matrixify CSV
- 身分驗證：Clerk / Auth.js / Supabase Auth 其中一種
- 部署：Vercel / Render / Railway / Fly.io / 自架 VPS 皆可評估

如果想「成熟且安全」，我會偏向：

```text
Next.js 全端架構 + PostgreSQL + Cloudinary + OpenAI + 角色權限
```

原因是前後台整合快，後續做團隊登入、審核頁、商品列表、匯出紀錄比較順。

### 6.2 前台 / 後台角色

團隊版至少可切三種角色：

1. Admin

   - 管理設定
   - 管理分類規則
   - 管理價格公式
   - 管理團隊成員
   - 匯出全部資料

2. Editor / Operator

   - 建立商品
   - 上傳圖片
   - 執行 AI
   - 修改文案
   - 送出審核

3. Reviewer

   - 查看待審商品
   - 修改或退回
   - 核准商品
   - 標記可匯出

### 6.3 建議後台頁面

MVP 團隊版可先做這些頁面：

1. 登入頁
2. 商品佇列頁
3. 新增 / 編輯商品頁
4. 圖片管理與預覽區
5. AI 產生結果審核頁
6. Variant / 款式設定頁
7. 匯出 Matrixify CSV 頁
8. 設定頁：
   - 價格公式
   - 商品分類
   - Prompt 規則
   - Cloudinary 設定
   - OpenAI 設定

---

## 7. OpenAI / GPT 替換方向

原版是 Claude API，現在要改 OpenAI。

建議不要讓前端直接呼叫 OpenAI，而是：

```text
前端送商品資料到後端
後端呼叫 OpenAI
後端把結構化結果存進資料庫
前端只讀取結果
```

建議用 Structured Outputs / JSON Schema 讓 AI 固定回傳格式，例如：

```json
{
  "title": "商品標題",
  "bodyHtml": "商品描述 HTML",
  "seoTitle": "SEO 標題",
  "seoDescription": "SEO 描述",
  "tags": ["標籤1", "標籤2"],
  "specText": "規格文字",
  "warnings": ["不確定或需要人工確認的地方"]
}
```

好處：

- 不容易跑版
- 可直接寫入資料庫
- 可穩定產 CSV
- 可做欄位級人工審核

---

## 8. 團隊版資料模型草案

### 8.1 users

```text
id
name
email
role
created_at
updated_at
```

### 8.2 products

```text
id
handle
source_title
source_url
cny_price
category
note
status
generated_title
body_html
seo_title
seo_description
tags
spec_text
created_by
reviewed_by
created_at
updated_at
```

### 8.3 product_images

```text
id
product_id
image_type     // main, detail, spec, variant
original_url
cloudinary_url
position
alt_text
status
created_at
```

### 8.4 variants

```text
id
product_id
option1_name
option1_value
option2_name
option2_value
option3_name
option3_value
sku
cny_cost
computed_price
manual_price
inventory_qty
inventory_policy   // deny or continue
variant_image_id
created_at
updated_at
```

### 8.5 ai_runs

```text
id
product_id
run_type       // copy, spec, research, full
input_payload
output_payload
model
status
error_message
created_by
created_at
```

### 8.6 exports

```text
id
export_type    // matrixify_csv
file_url or file_path
product_count
created_by
created_at
```

---

## 9. Matrixify CSV 團隊版應支援欄位

建議最少支援：

```text
Command
Handle
Title
Body HTML
Vendor
Type
Tags
Published
Status
SEO Title
SEO Description
Option1 Name
Option1 Value
Variant SKU
Variant Price
Variant Cost
Variant Inventory Tracker
Variant Inventory Qty
Variant Inventory Policy
Variant Requires Shipping
Variant Image
Image Src
Image Position
Image Alt Text
```

預設：

```text
Command = NEW
Vendor = CHOCHONEST
Published = FALSE
Status = Draft
Variant Inventory Tracker = shopify
Variant Requires Shipping = TRUE
```

---

## 10. 團隊版安全重點

團隊版一定要避免：

- OpenAI API Key 出現在前端
- Cloudinary API Secret 出現在前端
- 使用者可以越權看別人的操作
- 未審核商品被直接匯出或上架
- AI 產生內容沒有紀錄
- 大量操作失敗後無法追蹤

建議加入：

- 後端環境變數管理 API Keys
- 使用者登入
- 角色權限
- 操作紀錄 audit log
- AI 執行紀錄
- CSV 匯出紀錄
- 商品狀態流
- 錯誤重試機制

---

## 11. 建議 MVP 範圍：團隊版第一階段

第一階段不要一次做太大，建議以「團隊可登入、可共同處理、可安全匯出」為核心。

### 第一階段必做

- 登入 / 使用者角色
- 商品佇列
- 單品新增 / 編輯
- 主圖 / 詳情圖 / 規格圖上傳
- Cloudinary 圖片處理與網址保存
- OpenAI 商品文案產生
- OpenAI 規格圖辨識 / 規格文字整理
- 價格公式
- Option1 Variant
- 人工審核狀態
- 匯出 Matrixify CSV
- AI 執行紀錄
- 匯出紀錄

### 第一階段先不要做

- 直接自動發布 Shopify 商品
- 自動排程上架
- 完整商品生命週期 ERP
- 複雜任務分派
- AI 自動畫規格圖
- 手機 App
- 多店鋪管理

---

## 12. 後續可擴充

第二階段可以考慮：

- Shopify Admin API 直接建立 Draft Product
- Google Sheet 同步
- 任務指派
- 批量從淘寶連結抓資料
- 更完整的 Web Research
- IP / 品牌風險提示
- 商品重複檢查
- 版本紀錄
- Prompt 規則後台化
- Option2 / Option3
- 匯入歷史商品作為風格範例

---

## 13. 給新對話的建議開場 Prompt

可以把這段貼給新對話：

```text
我正在做「潮巢自動上架系統」。

目前已有一個 Claude 產出的單頁 HTML 原型，檔案是 chochonest-listing-tool.html。
它已經具備：淘寶商品資料輸入、圖片上傳、Cloudinary 圖片上傳、Claude API 文案產生、規格圖辨識、價格公式、Matrixify CSV 匯出。

但我現在想改方向，不先做個人版，而是以原型功能為基礎，重構成成熟、安全的團隊版前後台系統。

請先閱讀這份 MD 整理，並以「團隊版 MVP」為目標，幫我設計：
1. 最適合的技術架構
2. 資料庫 schema
3. 前後台頁面
4. API 路由
5. 權限與安全設計
6. OpenAI 取代 Claude API 的實作方式
7. Matrixify CSV 匯出規格
8. 第一階段開發順序

請保留原版工具的商品上架流程，但不要沿用前端直接放 API Key 的做法。
```

---

## 14. 一句話總結

原版可以視為「功能原型」，不是正式產品架構。  
新的方向應該把它升級成「有登入、有資料庫、有審核流程、有 AI 執行紀錄、有安全後端的團隊商品上架工作台」。 
