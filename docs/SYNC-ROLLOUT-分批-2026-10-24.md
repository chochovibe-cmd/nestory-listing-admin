# SYNC-ROLLOUT 分批表 — 2026-10-24（Claude 指揮）

> **誰做**：這包沒有程式變更，是在正式站工具畫面裡逐件按「比對 → 同步」。GPT 只能在雲端操作、登入不了工具網頁 → 由 Claude 派便宜小弟（subagent）用內建瀏覽器執行，Claude 驗收（看前後比對＋店面）。每批寫入前問老闆、先備份。（第 1 批是 Claude 自己做的，之後照這個分工。）
> 做法（等同畫面上「比對 → 全選工具版本 → 同步」）：內建瀏覽器登入正式站 → `GET /api/drafts/<id>/shopify-diff` → 每一列選 `tool` → `POST /api/drafts/<id>/shopify-resolve`（`confirmActiveUpdate` 依 Shopify 狀態、`confirmRemovals: false`）→ 一件一件做，遇到任何失敗就停。
> 備份：批前跑 `全部備份.mjs SYNC-ROLLOUT-第N批前`；該批每件存「工具資料列＋Shopify 商品」到 `Nestory備份/<日期>-SYNC-ROLLOUT-第N批-同步前／同步後`（Shopify 讀取用 client_credentials 換 token，本機 `SHOPIFY_ADMIN_ACCESS_TOKEN` 已失效）。
> 工具（本機，不在 repo）：`Nestory備份/_工具/商品快照.mjs <資料夾> <完整 draftId...>`、`Nestory備份/_工具/快照比對.js <前> <後> <id前8碼...>`，都只讀不寫。

## 小弟執行步驟（每批照做，遇錯就停）
1. 專案根目錄：`node C:/Users/s2491/Documents/Nestory備份/_工具/全部備份.mjs SYNC-ROLLOUT-第N批前`
2. `node …/商品快照.mjs C:/Users/s2491/Documents/Nestory備份/<日期>-SYNC-ROLLOUT-第N批-同步前 <該批完整 draftId>`（完整 UUID 從 `product_drafts` 用前 8 碼查）
3. 內建瀏覽器開 https://nestory-listing-admin.vercel.app（已登入），對每件依序：`GET /api/drafts/<id>/shopify-diff` → `choices` 每列都填 `"tool"` → `POST /api/drafts/<id>/shopify-resolve`，body `{remoteUpdatedAt, draftUpdatedAt, choices, confirmActiveUpdate: productStatus==="ACTIVE", confirmRemovals: false}`。**任何一件 `ok` 不是 true 就停**，不要重試、不要加 `confirmRemovals: true`。
4. 同步後快照存 `…-第N批-同步後`，跑 `快照比對.js`，把整段輸出交回 Claude。
5. 允許變的只有：FAQ、規格、描述（購買提醒段／JSON-LD）、補圖。標題、狀態、tags、SEO、款式、價格、成本、SKU 只要有變就回報。

## 0. 10-24 唯讀比對結果（正式站比對表，沒寫入）
- 有 Shopify ID 的 72 件：66 件在 Shopify 上；b45259ef 已被刪（remote_deleted）；29550fc3 0226e28c a35c179d ead131f6 84ef0cba 沒建到 Shopify → 不在範圍。
- 66 件的售價／劃線價兩邊全部相同；沒有任何商品是「有限庫存」（工具端 inventory_policy 全是 continue）→ 同步不會改庫存或售完狀態。
- 同步會寫成本（customer 看不到），所以 58f00e61 要等老闆改完成本。

## 1. 分組（65 件待做；6232c6b0 已在 SYNC-FIX 實測時同步）
| 組 | 內容 | 件數 | 狀態 |
|---|---|---|---|
| 第 1 批（試水溫） | 66332e2e 6c970009 27f42c00 5f41b6a2 6acbeb02 | 5 | ✅ 10-24 完成 |
| 第 2 批 FAQ／規格修正 | 6d2892a1 6be1bbf9 b46b94b2 fa524f0b d39a4057 ec18dfd8 a6fbb8f7 e4ba2299 b99aa408 3ac6ebe5 ea5bd6d2 8af27d57 0d6b7938 cbd2b41e 8c4b315a 89e1d171 46b677b1 56937cba ba05db9b ceb0c1e7 e7524531 | 21 | 待老闆同意 |
| 第 3 批 比對表零差異（最多換描述範本） | 1b6d450e b4ac2e78 71672805 3f166233 31701317 b6d57a37 a450198e e98bc983 843a6045 4e44bfb1 32ea56ad fc859e0e 53cd80ee ae9a216a 4c7775b8 862841d8 ec179ebb 4fce5632 3169bffa 845e0303 c17c5f1d 02312886 1b20d978 415d30af 94cd9000 a90326c5 56c4ffea fdef6bd3 | 28 | 待老闆同意 |
| 第 4 批 SKU `CHO-`→`NS-` | 3c67c42b 329f516c 5feb9b44 8b3a323e b9400278 8d2b744c 8b3a35b9（只差描述）ae962018（工具 SKU 空白，先查） | 8 | 等老闆決定 SKU |
| 第 5 批 個別處理 | f2809032（標題兩邊不同，老闆選）、6ede08ef（工具多一個「購買須知…拍下不出貨」款式，先在工具排除）、58f00e61（先改成本） | 3 | 等老闆 |

## 2. 第 1 批結果（10-24 08:37Z）
- 5 件 `shopify_sync_jobs` 全部 `completed`，工具端全部「已同步」＋有基準點，款式 2/2～6/6 連上。
- Shopify 前後比對：標題／網址／狀態／tags／SEO／款式／售價／成本／SKU／款式圖全部沒變；圖片原有的都在、順序不變。
- 有變的（都是預期）：FAQ 從「Q：問題／A：<問句>」變成正確問答（66332e2e 6c970009 27f42c00）；規格拿掉「項目:」（66332e2e 27f42c00）；描述「此為海外代購商品，預估約 14 天。」從第一段移到「購買提醒」；JSON-LD 的 FAQ 也一起修好（27f42c00 原本沒有，補上）。5f41b6a2 Shopify 完全沒寫（內容本來就一致）。
- 66332e2e 在 Shopify 是草稿、原本 0 張圖 → 同步補上 14 張（客人看不到）。
- 店面實看 chochonest.com/products/pingu-6c9700：「問與答 FAQ」顯示正確、價格 $1,880 不變。
- 文案小問題（不是同步的錯，記到 COPY 包）：購買提醒裡會出現兩句意思重複的「海外代購約 14 天」。
