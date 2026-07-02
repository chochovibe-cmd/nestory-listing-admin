# CHOCHONEST 上架工具 — Codex 交接文件
## 從 v5 → v6 的改動紀錄 + 下一步優化計畫

---

## 背景說明

這個工具是潮巢 Nestory（CHOCHONEST）的商品批次上架助手。
架構：單一 HTML 檔案（前端）+ Cloudflare Worker（後端代理）。
前端部署在 Cloudflare Pages，Worker 處理所有 API 呼叫（Anthropic、Cloudinary），前端不持有任何 secret。

---

## v5 → v6 改動清單

### 1. System Prompt 全面升級

v5 的 system prompt 只有約 3 行，品牌規則模糊。
v6 換成完整的品牌規則文件，對應老闆整理的 `潮巢 Nestory 商品上架工具規則 V1.0`。

新 prompt 涵蓋：
- 品牌語氣定義（親切但有品味的選物店語氣，不是蝦皮叫賣也不是冷淡潮牌）
- 完整禁忌詞列表（超值、爆款、必買、剁手、秒殺、全網最低⋯共 17 個）
- 簡體→繁體轉換對照表（手辦、摆件→擺件、钥匙扣→鑰匙圈、亚克力→壓克力⋯）
- 標題公式：`IP名稱 角色名稱 商品特色｜用途情境`
- 描述五段結構：A開頭介紹、B商品亮點、C適合誰、D商品資訊、E購買提醒
- FAQ 規則：3–5 題，依商品類型客製化
- SEO Title 格式：`IP+角色+類型｜潮巢 Nestory`
- Tags 四層帶前綴格式（見下方）
- Collection 歸類規則（四類）
- 商品狀態判斷（ready / need_review / blocked）

### 2. JSON 輸出欄位擴充

v5 輸出 5 個欄位。v6 擴充為：

```json
{
  "title": "標題（依公式，40–60字）",
  "seo_title": "SEO Title（IP+角色+類型+潮巢 Nestory）",
  "description": "五段描述，段落間空行分隔",
  "seo_description": "Meta 描述（70–110字）",
  "faq": [
    {"q": "問題", "a": "回答"},
    {"q": "問題", "a": "回答"},
    {"q": "問題", "a": "回答"}
  ],
  "tags": ["IP_作品名", "角色_角色名", "型態_品項", "用途_情境"],
  "collections": {
    "ip": ["IP Collection名"],
    "type": ["型態 Collection名"],
    "theme": ["情境 Collection名"],
    "promo": []
  },
  "status": "ready 或 need_review 或 blocked",
  "status_reason": "若非 ready 說明原因，否則 null"
}
```

### 3. Tags 格式改為四層帶前綴

v5：無格式限制，Claude 自由產出。
v6：強制四層結構：

- `IP_作品名`（例：IP_咒術迴戰、IP_三麗鷗）
- `角色_角色名`（例：角色_五條悟、角色_小八貓）
- `型態_品項`（從固定清單選：型態_公仔模型、型態_景品、型態_PVC、型態_盲盒、型態_扭蛋、型態_黏土人、型態_娃娃抱枕、型態_吊飾徽章、型態_壓克力立牌、型態_手機電腦小物、型態_文具小物）
- `用途_情境`（選 1–3 個：用途_桌面佈置、用途_房間佈置、用途_送禮推薦、用途_可愛療癒、用途_展示收納、用途_順手加購、用途_日常使用）

結果卡片的 Tags 顯示有顏色區分：IP 黃、角色紫、型態綠、用途橙。

### 4. 結果卡片新增欄位顯示

v5 結果卡片顯示：標題、描述、SEO、定價、圖片、Tags。
v6 新增：
- 商品狀態（ready / need_review / blocked）+ 顏色 badge
- status_reason 說明（need_review 和 blocked 時顯示）
- FAQ 完整顯示（每題 Q/A 格式）
- Collections 建議（IP、型態、情境、促銷 Collection 名稱）

### 5. Web Search 開關

每筆商品加入佇列前，可以勾選「Web Search 補充資訊」。

**開關位置**：輸入表單底部，上傳圖片區上方。預設關閉。

**開啟時的流程**：
1. 工具先 POST 商品標題到 Worker `/api/search`
2. Worker 呼叫 Anthropic API（帶 `web_search_20250305` tool）搜尋商品資訊
3. 回傳繁體中文摘要（IP 介紹、規格、補充資訊）
4. 摘要帶入產文 prompt 的 user message
5. 再呼叫 `/api/generate` 產文

**設計原則**：
- 預設關閉，適合冷門 IP 或資訊不足的商品才開
- 搜尋失敗不阻斷流程，靜默略過繼續產文
- 佇列列表中，有開啟 Web Search 的商品會顯示 🔍 標記

**Worker 新增路由** `/api/search`：
```javascript
// 呼叫 Claude with web_search tool，回傳 { summary: string }
tools: [{ type: 'web_search_20250305', name: 'web_search' }]
```

### 6. CSV 欄位更新

v6 CSV 新增以下欄位：

| 欄位 | 內容 |
|---|---|
| `Metafield: faq [json]` | FAQ 陣列的 JSON 字串 |
| `Metafield: collections_suggestion [string]` | 所有建議 Collection，`\|` 分隔 |
| `Metafield: listing_status [string]` | ready / need_review / blocked |
| `Metafield: status_reason [string]` | 狀態原因說明 |

圖片尺寸從 1080px 改為 1200px（符合老闆規格文件要求）。

### 7. 商品類型下拉選項更新

v5 用英文分類（figure、plush、keychain⋯）。
v6 改為老闆規格文件的中文分類：公仔模型、景品、PVC 手辦、黏土人、盲盒、扭蛋、一番賞大賞、一番賞小賞、娃娃抱枕、吊飾徽章、壓克力立牌、手機電腦小物、文具小物、服飾配件、生活用品。

---

## 下一步優化計畫（按優先順序）

### P1 — 高優先，直接影響上架效率

**① 變體支援（Variants）**

目前一筆商品只有一個 Variant。
需要支援：若商品有多個顏色或款式，輸入時可新增多個 Variant 列，CSV 匯出時每個 Variant 各一列（同 Handle）。

改動範圍：
- 輸入表單加「款式」區塊，可動態新增 Variant（款式名、SKU、價格覆蓋、庫存）
- `buildSingleCSV()` 依 Variant 數量產出多列
- Matrixify 格式：第一列含完整商品資料，後續列只有 Handle + Variant 欄位

CSV 新增欄位：
```
Option1 Name, Option1 Value
Variant SKU
Variant Price（可覆蓋主售價）
Variant Inventory Qty
Variant Image（對應圖片 URL）
```

**② Compare At Price（劃掉的原價）**

在定價區塊加「原價（選填）」欄位。
CSV 輸出 `Variant Compare At Price`，Shopify 商品頁會顯示原價劃掉的折扣樣式。

**③ Status → Published 欄位對應**

目前所有商品 `Published: FALSE`。
改為：
- `status: ready` → `Published: TRUE`（匯入後直接可見草稿）
- `status: need_review` → `Published: FALSE`
- `status: blocked` → `Published: FALSE`，且在 CSV 加警告備註

---

### P2 — 中期，流程更順

**④ 退回重跑按鈕**

結果卡片加「↩ 退回重改」按鈕。
點擊後：
- 彈出備註輸入框（說明要修改什麼）
- 把這筆商品加回佇列，`operator_note` 帶入備註
- 重新執行時，備註會進 user message，Claude 下次產出會考慮這個方向

**⑤ 圖片拖曳排序**

上傳圖片後，可以拖曳縮圖改變順序，第一張自動成為主圖（Image Position: 1）。
目前順序固定為上傳順序。

**⑥ 佇列持久化（localStorage）**

目前重新整理頁面會清空佇列和結果。
可以把 `queue` 和 `results` 序列化存到 localStorage（注意 File 物件不能序列化，圖片已上傳的商品存 URL，未上傳的需提示重新選圖）。

---

### P3 — 後期，進階功能

**⑦ PWA 化**

加 `manifest.json` 和 Service Worker，讓工具可以「安裝到桌面」。
iOS/Android 安裝後像 App 一樣開啟，不需要記住網址或開瀏覽器分頁。

**⑧ 審核狀態追蹤**

目前商品跑完就直接顯示結果，沒有「已審核」「待審核」的分類。
可以在結果卡片加審核狀態切換（✓ 已審核 / 待審核），並在下載 CSV 時只匯出已審核的商品。

**⑨ Apify 淘寶爬蟲整合**

目前商品資訊（標題、圖片）需要手動輸入和上傳。
未來可以加「貼淘寶連結」的輸入框，Worker 呼叫 Apify API 抓取：
- 商品原始標題
- 所有商品圖片（自動下載並上傳 Cloudinary）
- 規格資訊

這是最大的效率提升點，但也是最複雜的整合，建議等 P1/P2 都穩定後再做。

---

## 目前工具架構摘要

```
前端（Cloudflare Pages）
  chochonest-listing-tool-v6.html
  - 輸入表單（標題、價格、類型、備註、Web Search 開關、圖片上傳）
  - 佇列管理（加入、移除、清除、全部執行）
  - 結果卡片（標題、描述、FAQ、Tags、Collections、Status、圖片、定價）
  - CSV 匯出（單筆 / 全部合併）

後端（Cloudflare Worker）
  chochonest-worker.js
  路由：
    POST /api/generate   → 呼叫 Anthropic 產文
    POST /api/recognize  → 呼叫 Anthropic Vision 辨識規格圖
    POST /api/upload     → 圖片轉發到 Cloudinary
    POST /api/search     → 呼叫 Anthropic web_search tool 搜尋商品資訊
    GET  /api/ping       → 驗證 access token

環境變數（Cloudflare Worker Settings → Variables）：
  ANTHROPIC_API_KEY
  CLOUDINARY_CLOUD_NAME
  CLOUDINARY_PRESET
  ACCESS_TOKEN
```

---

## 注意事項

1. Worker 的 `ACCESS_TOKEN` 驗證用 `X-Access-Token` header，前端密碼輸入後存在 localStorage `cho_access_token`。

2. 定價公式：`TWD 售價 = CNY × 匯率 × 成本係數 × 利潤加成`，尾數取整（500 以下取10、500–2000 取50、2000以上取100）。

3. Web Search 需要 Worker 環境有權限使用 `web_search_20250305` tool，Anthropic API 目前有開放此 tool，不需要額外申請。

4. CSV 圖片欄位需要 Cloudinary 公開 URL（`secure_url`），Worker upload 路由已確保回傳此格式。

5. `max_tokens` 在 v6 從 1500 提升到 2500，因為完整格式（含 FAQ、Collections）輸出較長。
