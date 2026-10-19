# SHOP-LISTING 施工規格（2026-10-19）

> 指揮：Claude（設計／驗收）。施工：Sonnet worker，在 worktree `C:/Users/s2491/Documents/nestory-shop-listing`、分支 `gpt/shop-listing`（從 `origin/handoff/20261008-golive-spec` a1f6d3d 開）。
> 本規格把位置、名稱、數值寫死；**規格沒寫的不要自己加**（不加 UI、不加 migration、不加 env、不改 sync）。遇到規格與程式碼對不上 → 停下回報，不要自己決定。

## 0. 老闆 10-19 拍板

| 題目 | 決定 |
|---|---|
| 上傳提速 | 瀏覽器先把原檔縮成最長邊 2048 WebP 再傳＋多檔同時傳；三個入口（新商品上傳、站 2 補圖、截圖辨識）都改 |
| 正方形圖 | 主圖（main）＋款式圖（variant）都做模糊延伸背景；本來就是正方形的不動；詳情圖（detail）、規格圖（spec）不動 |
| 類別 | 48 種固定「類型_」＋常見自由字對照；對不到就留空、不擋上架 |

量測依據（2026-10-17／18 正式資料，storage.objects 時間戳）：手動上傳 PNG 每張約 2.2MB；1 張圖（中圖→縮圖→原檔一個接一個）6.5–9 秒；5 張 20–30 秒；站 2 補圖逐張傳，5–6 張 14–18 秒。伺服器與 DB 都在雪梨（syd1／ap-southeast-2）。主因＝原檔太大＋串行。

## 1. 範圍（3 項）

- **A. Shopify 類別**：發布時帶 `category`（Standard Product Taxonomy gid）
- **B. 正方形主圖／款式圖**：sharp 處理時做模糊延伸背景
- **C. 上傳提速**：瀏覽器端縮圖＋並行

### 不做（寫在這裡防止擴張）
- 不改 `syncShopifyProduct.ts`／`fullSyncGraphQL.ts`／「以工具版本覆蓋」（歸 1.5 SHOPIFY-RECONCILE）
- 不回補已上架商品的類別或圖片（之後另議）
- 不改發布流程的圖片處理／時間預算（發布每件約 40 秒的問題已記入總表，另包）
- 不新增任何 UI、文案、CSS class；不新增 migration、env
- 不碰 `.tmp/` 底下任何東西

---

## 2. A — Shopify 類別

### 2.1 新檔 `src/lib/shopify/taxonomyCategory.ts`

```ts
import { normalizeProductTypeForTags } from "@/lib/productTypeLabels";

/** 固定類型（tag 引擎正式輸出的 類型_ 值）→ Shopify TaxonomyCategory gid */
export const SHOPIFY_CATEGORY_BY_TYPE: Readonly<Record<string, string>> = { /* 見 2.4 表 A */ };

/** 自由字關鍵字（product_type 原文子字串）→ gid；比對時長字優先 */
export const SHOPIFY_CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, string]> = [ /* 見 2.4 表 B */ ];

export function resolveShopifyCategoryId(input: {
  tags: readonly string[] | null | undefined;
  productType: string | null | undefined;
}): string | null;
```

`resolveShopifyCategoryId` 規則（照順序，第一個命中就回傳）：
1. 依 `tags` 原順序，找開頭是 `類型_` 的 tag；去掉前綴後先過 `normalizeProductTypeForTags`（讓「吊飾掛件」→「吊飾徽章」），在 `SHOPIFY_CATEGORY_BY_TYPE` 命中就回傳。
2. `productType` 去頭尾空白、過 `normalizeProductTypeForTags`：
   a. 完全等於 `SHOPIFY_CATEGORY_BY_TYPE` 的 key → 回傳；
   b. 否則把 `SHOPIFY_CATEGORY_KEYWORDS` 依 keyword 長度由長到短排序，第一個 `productType.includes(keyword)` 的 → 回傳。
3. 都沒有 → `null`。

純函式，不 import 任何 server-only 模組。

### 2.2 `src/lib/shopify/payload.ts`

- 在 `product` 物件組好的地方（現在 `productType: draft.product_type || draft.category || "IP 周邊",` 那段，約 :173），用 **跟 `tags` 同一個變數**（`const tags = draft.shopify_tags?.length ? ...`）和 `draft.product_type` 呼叫 `resolveShopifyCategoryId`。
- `...generatedProduct` 目前展開在最後，可能夾帶 AI 產的 `category` 鍵 → **展開前把 `category` 從 generatedProduct 拿掉**，再在展開之後放 `...(categoryId ? { category: categoryId } : {})`。
- `productType` 原本的值**不變**（智慧商品系列可能依 productType／tag，別動）。

### 2.3 發布路徑檢查（必做，回報結果）
- 列出 `payload.product` 實際被送進 Shopify 的每一個 mutation（productCreate、republish 路徑的 productUpdate、其他），確認該 input type 在 API 2026-04 有 `category: ID` 欄位。若某條路徑的 input 沒有 `category` → 那條路徑送出前把 `category` 刪掉，並回報。
- mock／dry-run 模式照常產 payload（含 category），不得因此打到 Shopify。

### 2.4 對照表
（下方表格由指揮官用 Shopify 唯讀查詢驗過 gid，**照抄，不要自己改或補**。）

所有 gid 前綴都是 `gid://shopify/TaxonomyCategory/`，表中只寫後半段；程式裡要寫完整 gid。中文路徑只是註記，不進程式。

**表 A — `SHOPIFY_CATEGORY_BY_TYPE`（key＝tag 引擎正式輸出的類型值；「吊飾掛件」靠 normalize 變成吊飾徽章，不另列）**

| 類型 | gid 後段 | Shopify 中文路徑 |
|---|---|---|
| 公仔模型 | tg-5-8-1-1 | 玩具和遊戲 > 玩具 > 玩偶、套裝玩具組和公仔 > 公仔 > 動作玩偶 |
| 景品 | tg-5-8-1-1 | 同上 |
| PVC | tg-5-8-1-1 | 同上 |
| 一番賞大賞 | tg-5-8-1-1 | 同上 |
| 一番賞小賞 | tg-5-8-1-1 | 同上 |
| 盲盒 | tg-5-8-1-1 | 同上 |
| 扭蛋 | tg-5-8-1-1 | 同上 |
| 黏土人 | tg-5-8-1-1 | 同上 |
| 可動模型 | tg-5-8-1-1 | 同上 |
| 盒玩 | tg-5-8-1-1 | 同上 |
| 食玩 | tg-5-8-1-1 | 同上 |
| 模型套組 | ae-2-6 | 藝術/娛樂 > 嗜好和創作藝術 > 模型製作 |
| 娃娃抱枕 | tg-5-8-11 | 玩具和遊戲 > 玩具 > 玩偶、套裝玩具組和公仔 > 填充玩具 |
| 絨毛娃娃 | tg-5-8-11 | 同上 |
| 大型娃娃 | tg-5-8-11 | 同上 |
| 吊飾徽章 | aa-4-1 | 服飾與配件 > 手提包和皮夾配件 > 鑰匙圈 |
| 壓克力立牌 | hg-3-13 | 居家和庭園 > 裝飾用品 > 人型立牌 |
| 立牌 | hg-3-13 | 同上 |
| 桌面擺件 | hg-3-30 | 居家和庭園 > 裝飾用品 > 小雕像 |
| 展示收納 | hg-3-59 | 居家和庭園 > 裝飾用品 > 展示盒 |
| 複製畫海報 | hg-3-4-2-1 | 居家和庭園 > 裝飾用品 > 藝術品 > 海報/印刷品/視覺藝術品 > 海報 |
| 掛畫裝飾 | hg-3-4-2-4 | 同上路徑 > 畫作 |
| 燈具小物 | hg-13-9 | 居家和庭園 > 照明 > 燈具 |
| 杯具餐具 | hg-11-10-5 | 居家和庭園 > 廚房與餐廳 > 餐具 > 飲用杯具 |
| 毛巾毯子 | hg-15-4 | 居家和庭園 > 床包被套 > 毛巾 |
| 生活雜貨 | hg | 居家和庭園 |
| 手機殼 | el-4-8-4-13 | 電子器材 > 通訊設備 > 電話設備 > 手機和智慧型手機配件 > 手機保護套與貼膜 |
| 手機支架 | el-4-8-4-6 | 同上路徑 > 手機架 |
| 藍牙耳機 | el-2-2-7-1-3 | 電子器材 > 音訊設備 > 音訊元件 > 耳機與頭戴式耳機 > 耳機 > 入耳式耳機 |
| 藍牙音響 | el-2-2-10-4 | 電子器材 > 音訊設備 > 音訊元件 > 揚聲器 > 攜帶式藍牙揚聲器 |
| 滑鼠墊 | el-7-8-8 | 電子器材 > 電子配件 > 電腦配件 > 滑鼠墊 |
| 滑鼠 | el-7-9-12-11 | 電子器材 > 電子配件 > 電腦元件 > 輸入裝置 > 滑鼠和軌跡球 |
| 鍵盤 | el-7-9-12-8 | 同上路徑 > 鍵盤 |
| 鍵帽 | el-7-9-11-3-2 | 電子器材 > 電子配件 > 電腦元件 > 輸入裝置配件 > 鍵盤按鍵鍵帽 > 鍵盤鍵帽 |
| 手把控制器 | el-7-9-12-5-3 | 電子器材 > 電子配件 > 電腦元件 > 輸入裝置 > 遊戲控制器 > 遊戲手把 |
| 充電周邊 | el-7-15-5 | 電子器材 > 電子配件 > 電源 > 電源整流器/充電器 |
| 服飾 | aa-1 | 服飾與配件 > 衣著 |
| 包包 | aa-5-4 | 服飾與配件 > 手提包、皮夾和箱子 > 手提包 |
| 帽子 | aa-2-17 | 服飾與配件 > 衣著配件 > 帽子 |
| 襪子 | aa-1-18 | 服飾與配件 > 衣著 > 襪子 |
| 飾品配件 | aa-6 | 服飾與配件 > 珠寶 |
| 文具 | os-4 | 辦公室用品 > 一般事務用品 |
| 貼紙 | tg-5-2-10 | 玩具和遊戲 > 玩具 > 藝術與繪畫玩具 > 貼紙/貼紙機 |
| 筆記本 | os-4-9-9 | 辦公室用品 > 一般事務用品 > 紙製品 > 筆記本/便條本 |
| 卡片票卡 | ae-2-2-3 | 藝術/娛樂 > 嗜好和創作藝術 > 收藏品 > 集換式卡片 |
| 印章 | tg-5-2-8 | 玩具和遊戲 > 玩具 > 藝術與繪畫玩具 > 印章/印章墊組 |
| 保溫杯瓶 | hg-11-3-10 | 居家和庭園 > 廚房與餐廳 > 飲食盛裝用品 > 保溫/保冷瓶 |

（表 A 共 47 列＝`NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS` 去掉「吊飾掛件」＋「吊飾徽章」。測試要斷言：`NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS` 每個值經 `normalizeProductTypeForTags` 後都在表 A 有 key。）

**表 B — `SHOPIFY_CATEGORY_KEYWORDS`（product_type 自由字子字串；比對時依 keyword 長度由長到短）**

| keyword | gid 後段 | Shopify 中文路徑 |
|---|---|---|
| 手錶 | aa-6-11 | 服飾與配件 > 珠寶 > 手錶 |
| 電腦包 | lb-15 | 行李箱/袋 > 筆電包 |
| 耳機包 | el-2-1-2-3 | 電子器材 > 音訊設備 > 音響配件 > 耳機配件 > 耳機攜帶箱 |
| 文具包 | os-3-16 | 辦公室用品 > 收納整理用品 > 鉛筆盒 |
| 吹風機 | hb-3-10-12-6 | 保健與美容 > 個人保養 > 頭髮保養 > 髮型工具 > 吹風機 |
| 加濕器 | hg-9-1-9 | 居家和庭園 > 家用電器 > 空調設備 > 加濕器 |
| 按摩儀 | hb-3-11-8 | 保健與美容 > 個人保養 > 按摩和休閒 > 按摩器 |
| 相機 | co-2 | 相機和光學元件 > 相機 |
| 音箱 | el-2-2-10-4 | 攜帶式藍牙揚聲器（同表 A 藍牙音響） |
| 夜燈 | hg-13-10 | 居家和庭園 > 照明 > 夜燈 |
| 檯燈 | hg-13-5 | 居家和庭園 > 照明 > 檯燈/立燈 |
| 臺燈 | hg-13-5 | 同上 |
| 燈 | hg-13-9 | 居家和庭園 > 照明 > 燈具 |
| 浴巾 | hg-15-4-1-1 | 居家和庭園 > 床包被套 > 毛巾 > 浴巾和毛巾 > 浴巾 |
| 毛巾 | hg-15-4-1-2 | 同上路徑 > 洗臉毛巾 |
| 手鍊 | aa-6-3 | 服飾與配件 > 珠寶 > 手環 |
| 手環 | aa-6-3 | 同上 |
| 拖鞋 | aa-8-7 | 服飾與配件 > 鞋 > 拖鞋 |
| 冰箱貼 | hg-3-56 | 居家和庭園 > 裝飾用品 > 冰箱磁鐵 |
| 羽毛球拍 | sg-4-14-1-2-2 | 體育用品 > 室外休閒 > 戶外遊戲 > 羽球 > 羽球拍/組 > 羽球拍 |
| 保溫杯 | hg-11-3-10 | 同表 A 保溫杯瓶 |
| 鼠標 | el-7-9-12-11 | 同表 A 滑鼠 |
| 擺件 | hg-3-30 | 居家和庭園 > 裝飾用品 > 小雕像 |
| 擺飾 | hg-3-30 | 同上 |
| 掛飾 | aa-4-8 | 服飾與配件 > 手提包和皮夾配件 > 包包吊飾 |

註：刻意不放「握把」（現有商品是羽毛球拍握把套，會誤對到手機握把）、不放單字「包」（太寬）。注意 2.1 規則 2a 先比表 A 完整 key，所以 product_type「滑鼠」走表 A、「無線鼠標」走表 B。

### 2.5 測試（新檔 `scripts/verify-shop-listing.mjs`，加進 `scripts/verify-all.mjs` 清單最後）
- 用真模組測（可用 `typescript` 的 `transpileModule` 或既有 scripts 的作法載入 TS；不得只測複製出來的 mirror）。
- 案例：
  - tags `["類型_公仔模型"]` → 公仔模型的 gid
  - tags `["類型_吊飾掛件"]` → 吊飾徽章的 gid（正規化）
  - tags `["角色_孫悟空","類型_盲盒","類型_公仔模型"]` → 盲盒的 gid（第一個 類型_ 優先）
  - tags `[]`、productType `"手錶"` → 手錶的 gid
  - tags `[]`、productType `"絨毛娃娃鑰匙圈吊飾"` → 依「長字優先」規則命中的那個（測試寫死期望值並註明命中哪個 keyword）
  - tags `[]`、productType `"Runtime Test"` → `null`
  - tags `null`、productType `null` → `null`
- 表 A、表 B 每個 gid 都符合 `/^gid:\/\/shopify\/TaxonomyCategory\/[a-z]{2}(-\d+)*$/`。
- payload：建一個最小 draft 跑 `buildShopifyPayload`（或實際 export 名），確認 `product.category` 有值；generatedProduct 帶 `category: "bad"` 時最終仍是我們的 gid；對不到時 `product` 沒有 `category` 鍵。

---

## 3. B — 正方形（模糊延伸背景）

### 3.1 `src/lib/images/sharpProcess.ts`
- `SharpProcessOptions` 新增 `squareMode?: "none" | "cover" | "blur-extend"`。舊的 `square?: boolean` 保留相容：`square: true` 等於 `"cover"`；兩者都沒給＝`"none"`（現行行為，輸出位元組不得改變）。
- 新常數：`SQUARE_TOLERANCE = 0.02`、`SQUARE_BLUR_SIGMA_DIVISOR = 40`。
- `"blur-extend"` 流程：
  1. `sharp(input,{failOn:"none"}).rotate()` 後取得**轉正後**寬高 w、h（先 `.toBuffer({resolveWithObject:true})` 拿轉正圖再算，避免 EXIF 寬高對調算錯）。
  2. 若 `Math.abs(w - h) / Math.max(w, h) <= SQUARE_TOLERANCE` → 走跟 `"none"` 一樣的 inside 縮圖（不延伸）。
  3. `S = Math.min(maxLongEdge, Math.max(w, h))`（不放大）。
  4. 有透明通道 → 先 `flatten({ background: "#ffffff" })`。
  5. 背景：轉正圖 `resize(S, S, { fit: "cover", position: "centre" })` → `blur(Math.max(8, Math.round(S / SQUARE_BLUR_SIGMA_DIVISOR)))`。
  6. 前景：轉正圖 `resize(S, S, { fit: "inside", withoutEnlargement: true })`。
  7. 背景 `composite([{ input: 前景, gravity: "centre" }])` → `.webp({ quality })`。
  8. 回傳的 width/height 都是 S。

### 3.2 `src/lib/images/runSharpBatch.ts:255`
- 改成依圖種決定：`image_type` 是 `"main"` 或 `"variant"` → `squareMode: "blur-extend"`；其餘 → `squareMode: "none"`。
- 只有這一個呼叫點（已 grep 確認 `processImageBuffer(` 只在這裡被呼叫）；若你發現別處也在產要送 Shopify 的主圖／款式圖而沒經過這裡，**不要改，回報路徑**。

### 3.3 測試（同一支 `scripts/verify-shop-listing.mjs`，用真 sharp）
- 1000×500 → 1000×1000；左上角像素 alpha=255 且不是純黑
- 3000×1500 → 2048×2048
- 600×1200（直式）→ 1200×1200
- 800×800 → 800×800，且與 `"none"` 輸出位元組相同
- 1000×990（差 1%）→ 1000×990（不延伸）
- 帶 EXIF orientation=6 的 1000×500 → 視為 500×1000 後做成 1000×1000
- 透明 PNG 600×300 → 600×600，四角 alpha=255
- `squareMode` 未給 → 與改動前輸出相同（用 1000×500 比對）

---

## 4. C — 上傳提速

### 4.1 `src/lib/images/clientImageResize.ts`
- 新常數 `UPLOAD_MAX_EDGE = 2048`、`UPLOAD_WEBP_QUALITY = 0.9`、`UPLOAD_PASSTHROUGH_MAX_BYTES = 800 * 1024`。
- 新函式（只解碼一次，同一個 bitmap 產三種尺寸）：

```ts
export type UploadBlobs = {
  /** 要上傳當「原檔」的 blob（多半是 2048 WebP；不需縮時就是原 File） */
  upload: Blob;
  uploadExt: string;          // "webp" | 原副檔名
  uploadContentType: string;  // blob.type || file.type || "image/jpeg"
  shrunk: boolean;
  mid: Blob | null;           // 1280，同現行
  thumb: Blob | null;         // 320，同現行
};
export async function buildUploadBlobs(file: File, options?: { maxEdge?: number }): Promise<UploadBlobs>;
```

- `upload` 決定規則：
  - GIF、解碼失敗、瀏覽器不支援 WebP 編碼 → 原 File（shrunk=false）
  - 長邊 ≤ maxEdge **且** 類型是 jpeg/webp **且** size ≤ `UPLOAD_PASSTHROUGH_MAX_BYTES` → 原 File
  - 其餘 → 長邊縮到 ≤ maxEdge（不放大）、WebP quality 0.9
  - 縮完反而比原檔大 → 改用原 File
- `mid`／`thumb` 沿用現有尺寸與編碼規則（1280／320），只是改成共用同一個 bitmap。`buildDualSizeBlobs` 保留（其他地方若有用到不破壞）。
- 一律 try/catch，不 throw。

### 4.2 新檔 `src/lib/images/runWithConcurrency.ts`（client-safe）
```ts
export async function runWithConcurrency<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]>;
```
結果陣列順序＝輸入順序；單一項目 reject 不影響其他項目（每項自己 catch，或回傳 settled 形式——擇一，寫清楚）。常數 `UPLOAD_CONCURRENCY = 4` 放在 clientImageResize.ts。

### 4.3 `src/components/listing/ImageUploader.tsx`
- `uploadOneFile`：改用 `buildUploadBlobs(file)`；原檔路徑 `${userId}/${resolvedDraftId}/${type}/${baseId}-orig.${uploadExt}`（**保留 `-orig` 命名**），contentType 用 `uploadContentType`。
- 中圖、縮圖、原檔三個 upload **用 Promise.all 同時傳**（現在是一個接一個）。失敗語意不變：原檔失敗 → 刪掉已成功的中圖／縮圖 → 標 failed＋toast（文字不變）；中圖／縮圖失敗 → 該 URL 為 null（同現行）。
- `uploadFiles`：`Promise.all(pending.map(...))` 改成 `runWithConcurrency(pending, UPLOAD_CONCURRENCY, ...)`。
- 失敗後「重試」那條（`patchPreview(... "uploading")` 後呼叫 `uploadOneFile`）不需改，自然走新流程。
- 所有提示文字、toast、class **一字不改**。

### 4.4 `src/components/listing/Station2ImagePanel.tsx`（站 2 補圖，約 :330–392）
- 每個 file 先 `buildUploadBlobs(file)`，上傳 `upload` blob（路徑仍是 `${userId}/${draftId}/${imageType}/${uuid}.${uploadExt}`，contentType 用 `uploadContentType`）；`mid/thumb` 這裡**不上傳**（維持現狀）。
- 逐張 for-loop 改成 `runWithConcurrency(files, UPLOAD_CONCURRENCY, ...)`；`sort_order` 在並行前就照檔案順序算好（`baseSort + index`），不要在並行中 `nextSort += 1`。
- `added` 依檔案原順序組回（失敗的跳過），`onImagesChange`、toast 文字不變。
- insert 欄位不變（`original_file_url` 與 `processed_file_url` 都是上傳後的公開網址、`processing_status: "uploaded"`）。

### 4.5 `src/components/listing/WorkspaceInputPanel.tsx` `uploadTempScreenshots`（約 :950）
- 截圖要給辨識用，字要清楚 → `buildUploadBlobs(file, { maxEdge: 3072 })`，上傳 `upload` blob。
- 逐張改並行（數量本來就 ≤ `MAX_SCREENSHOT_IMAGES`=4，直接 `Promise.all` 即可），`urls`／`paths` 維持檔案原順序；任一張失敗照現行 throw 同樣訊息，並把已上傳的刪掉（現行 :974 的 remove 邏輯若在呼叫端，確認仍涵蓋）。

### 4.6 測試
- `scripts/verify-shop-listing.mjs` 加靜態檢查：ImageUploader 用 `buildUploadBlobs`＋`runWithConcurrency`、保留 `-orig.`；Station2 不再有 `nextSort += 1` 在並行區；三處都不再直接 `.upload(..., file, ...)` 傳原 File（passthrough 情況經 `upload` 變數）。
- `runWithConcurrency`：用真模組測「同時最多 4 個」「結果順序＝輸入順序」「一項失敗其他照跑」。
- `buildUploadBlobs` 需要瀏覽器 API，不強求 node 測；決策邏輯若抽成純函式（例如 `decideUploadPassthrough({type,size,longEdge,maxEdge})`）就測它。

---

## 5. 施工規則
- 小 commit，訊息格式 `feat(shop-listing): ...`／`test(shop-listing): ...`；**不要 push、不要開 PR、不要 deploy**。
- 不新增 `!important`、不動 globals.css。
- `src/app/api/**/route.ts` 只能 export HTTP method。
- 收工前必跑並貼結果：`npm run typecheck`、`node scripts/verify-shop-listing.mjs`、`npm run verify:all`、`npm run build`。任何一項失敗要寫原因，不得跳過。
- 回報格式：每項（A/B/C）改了哪些檔案、2.3 的路徑檢查結果、3.2 有沒有發現其他路徑、測試輸出摘要。

## 6. 上線後驗收（指揮官做，唯讀）
- 老闆照常上傳 → 查 `storage.objects`：新上傳 `-orig.webp` 大小 ≈ 0.2–0.6MB；同一批從第一個到最後一個檔案的時間差明顯縮短（目標：5 張 ≤ 8 秒）。
- 新發布商品 → Shopify 唯讀查 `product.category` 有值；非正方形來源的主圖／款式圖 media 寬＝高。
