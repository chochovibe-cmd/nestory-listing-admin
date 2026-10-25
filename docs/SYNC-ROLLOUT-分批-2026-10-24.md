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
| 第 2 批 FAQ／規格修正 | 6d2892a1 6be1bbf9 b46b94b2 fa524f0b d39a4057 ec18dfd8 a6fbb8f7 e4ba2299 b99aa408 3ac6ebe5 ea5bd6d2 8af27d57 0d6b7938 cbd2b41e 8c4b315a 89e1d171 46b677b1 56937cba ba05db9b ceb0c1e7 e7524531 | 21 | ✅ 10-24 完成 18 件；b46b94b2 ec18dfd8 8af27d57 移到第 5 批 |
| 第 3 批 比對表零差異（最多換描述範本） | 1b6d450e b4ac2e78 71672805 3f166233 31701317 b6d57a37 a450198e e98bc983 843a6045 4e44bfb1 32ea56ad fc859e0e 53cd80ee ae9a216a 4c7775b8 862841d8 ec179ebb 4fce5632 3169bffa 845e0303 c17c5f1d 02312886 1b20d978 415d30af 94cd9000 a90326c5 56c4ffea fdef6bd3 | 28 | ✅ 10-24 完成 21 件；7 件移到第 5 批 |
| 第 4 批 SKU `CHO-`→`NS-` | 3c67c42b 329f516c 5feb9b44 8b3a323e b9400278 8d2b744c 8b3a35b9（只差描述）ae962018（工具 SKU 空白，先查） | 8 | ✅ 10-24 老闆定改 NS-：完成 5feb9b44 8d2b744c 8b3a35b9（無 SKU 列，只換描述）；ae962018 部分同步（測試草稿，見 §5）；其餘 4 件＋同類 1 件移第 6 批 |
| 第 5 批 個別處理 | f2809032（標題兩邊不同，老闆選）、6ede08ef（工具多一個「購買須知…拍下不出貨」款式，先在工具排除）、58f00e61（先改成本）、b46b94b2 ec18dfd8 8af27d57＋第 3 批 b4ac2e78 3f166233（Shopify 封面是後台換的、工具沒有那張 → 老闆定以 Shopify 為準；先把 Shopify 封面收進工具當主圖 1 再同步）；ec179ebb 4fce5632 3169bffa 845e0303（主圖兩邊同檔，但工具列沒記 shopify_media_id、Shopify alt 被改 → 先補對應）；fc859e0e（工具款式圖 5 重新處理過，同步會換掉 Shopify 舊圖 → 以 Shopify 為準）。全部不可用 `confirmRemovals: true` | 13 | ✅ 10-24 完成 12 件；6ede08ef 移第 6 批 |
| 第 6 批 Shopify 圖庫有工具不送的圖 | 3c67c42b 329f516c 8b3a323e b9400278 8b3a35b9（10-08 前發布，詳情圖也放進 Shopify 圖庫）、6ede08ef（工具多 1 張主圖不在 Shopify） | 6 | ✅ 10-25 完成（SYNC-KEEP-MEDIA 上線後，`shopify_media_mode='shopify'`），見 §6 |

## 2. 第 1 批結果（10-24 08:37Z）
- 5 件 `shopify_sync_jobs` 全部 `completed`，工具端全部「已同步」＋有基準點，款式 2/2～6/6 連上。
- Shopify 前後比對：標題／網址／狀態／tags／SEO／款式／售價／成本／SKU／款式圖全部沒變；圖片原有的都在、順序不變。
- 有變的（都是預期）：FAQ 從「Q：問題／A：<問句>」變成正確問答（66332e2e 6c970009 27f42c00）；規格拿掉「項目:」（66332e2e 27f42c00）；描述「此為海外代購商品，預估約 14 天。」從第一段移到「購買提醒」；JSON-LD 的 FAQ 也一起修好（27f42c00 原本沒有，補上）。5f41b6a2 Shopify 完全沒寫（內容本來就一致）。
- 66332e2e 在 Shopify 是草稿、原本 0 張圖 → 同步補上 14 張（客人看不到）。
- 店面實看 chochonest.com/products/pingu-6c9700：「問與答 FAQ」顯示正確、價格 $1,880 不變。
- 文案小問題（不是同步的錯，記到 COPY 包）：購買提醒裡會出現兩句意思重複的「海外代購約 14 天」。

## 3. 第 2 批結果（10-24 12:47–12:52Z）
- 小弟（subagent）送寫入被 Claude 自動安全檢查擋（修改共用資源）→ 老闆同意後由指揮在主對話直接逐件送。另：內建瀏覽器要老闆另外登入一次（跟 Chrome 分開）。
- 18 件 `ok: true`：6d2892a1 6be1bbf9 fa524f0b d39a4057 a6fbb8f7 e4ba2299 b99aa408 3ac6ebe5 ea5bd6d2 0d6b7938 cbd2b41e 8c4b315a 89e1d171 46b677b1 56937cba ba05db9b ceb0c1e7 e7524531。
- 前後比對：只有 `custom.product_faq`（16 件）、`custom.product_specs`（7 件）＋描述「海外代購約 14 天」移到購買提醒；標題／網址／狀態／tags／SEO／款式／售價／成本／SKU／款式圖全部沒變，原有圖片都在、順序不變。0d6b7938 是 Shopify 草稿，原 0 張圖 → 補 29 張（客人看不到）。工具端 18 件全部 synced＋有基準點、款式全連上。
- 3 件被 `removal_confirmation_required`（media: 1）擋下、沒寫入：b46b94b2 ec18dfd8 8af27d57。原因：Shopify 第一張圖（無 alt 的 PNG）是後台手動換的封面，工具裡沒有 → 同步會刪掉它、換回工具舊主圖 1。
- 店面實看：pok-mon-center-jyol-d39a40 問與答正確、$199 不變；sanrio-hello-kitty-card-holder-keychain-e75245 規格無「項目:」、問與答正確、$229 不變。
- 腳本加的保險：比對表只要有 faq／specs／description 以外的列、或有工具獨有／Shopify 獨有款式就不送出。備份：`2026-10-24-SYNC-ROLLOUT-第2批前.zip`、`…-第2批-同步前／同步後`。

## 4. 第 3 批結果（10-24 12:58–13:02Z）
- 先用快照模擬配圖（規則同 `syncShopifyProduct`：先比 shopify_media_id → 再比唯一 alt → 「整件沒有任何已連結圖片」才按順序配；換過來源的圖算「替換」＝也會被刪）。模擬抓到 6 件、實送時再被擋 1 件（fc859e0e，替換類模擬沒算 hash），全部 409 沒寫入。
- 21 件 `ok`／`completed`：1b6d450e 71672805 31701317 b6d57a37 a450198e e98bc983 843a6045 4e44bfb1 32ea56ad 53cd80ee ae9a216a 4c7775b8 862841d8 c17c5f1d 02312886 1b20d978 415d30af 94cd9000 a90326c5 56c4ffea fdef6bd3。
- 前後比對：metafield 全部沒變；13 件描述完全沒變；7 件只是「海外代購約 14 天」移到購買提醒；1b6d450e 購買提醒新增「此為台灣現貨商品，約 1–3 個工作天出貨。」（工具 sale_status＝台灣現貨、Shopify tag 銷售_臺灣現貨，符合）。標題／狀態／tags／SEO／款式／價格／成本／SKU／圖片全部沒變。
- 店面實看 dick-bruna-nijntje-1b6d45：購買提醒正確、$299（原價 $349）不變。
- 注意：一次送 12 件會超過瀏覽器工具 45 秒上限（腳本仍在頁面跑完）→ 之後一組最多 7 件；逾時就查 `shopify_sync_jobs`，不要重送。

## 5. 第 4／5 批結果（10-24 13:45–13:58Z，老闆同意「照建議」：SKU 改 NS-、f2809032 用 Shopify 標題、刪 6ede08ef 假款式、圖片以 Shopify 為準）
- 備份：`2026-10-24-SYNC-ROLLOUT-第4-5批前.zip`、`…-第4-5批-同步前／同步後`；工具端每筆改動的前後值在 `…-同步前/_工具端修補紀錄.json`、`_工具端修補紀錄-第二輪.json`。
- 工具端修補（每筆先核對目前值才改，共 92 筆）：
  - 圖片 87 筆（對應＋封面＋排序）：Shopify 圖檔名含工具圖片的 UUID → 精確補 `shopify_media_id`。5 件後台換封面的（b46b94b2 ec18dfd8 8af27d57 b4ac2e78 3f166233）把被換掉的那張工具主圖改指向 Shopify 封面（`processed_file_url`＝Shopify 圖、hash 清空），8af27d57 b4ac2e78 另把它跟原主圖 1 對調排序。fc859e0e 款式圖（variant#9）改回 Shopify 上那張。
  - ae962018 3 款補 `NS-AE9620-01～03`；6ede08ef 刪「【購買須知】…拍下不出貨」款式列並從 `variant_dimensions` 拿掉（`raw_capture` 保留原樣）。
- 同步 14 件 `ok`：b46b94b2 ec18dfd8 8af27d57 b4ac2e78 3f166233 ec179ebb 4fce5632 3169bffa 845e0303 fc859e0e 5feb9b44 8d2b744c f2809032 58f00e61。前後比對：圖片張數與順序全部不變（含老闆換的封面）、價格／成本／款式不變；FAQ（b46b94b2 8af27d57 58f00e61）、規格（b46b94b2 ec18dfd8 58f00e61）修好；SKU 5feb9b44 8d2b744c 改 NS-；f2809032 標題維持 Shopify 版並寫回工具；5feb9b44 購買提醒新增「台灣現貨 1–3 個工作天」（tag 銷售_臺灣現貨，符合）。工具端全部 synced＋有基準點。
- 店面實看 pingu-b46b94：封面仍是老闆換的 Pingu 圖、$1,180 不變、問與答是正確問句。
- **ae962018 部分同步（502 readback_mismatch）**：它是測試草稿（example 圖網址＋YouTube 測試影片），Shopify 上也是草稿、客人看不到。SKU、描述已寫入，另新增一支 YouTube 外部影片；回讀時影片網址跟工具不一致而報錯。→ 程式問題：外部影片回讀比對（Shopify 會改寫 YouTube 網址）要容許正規化，排進小修合集；這件測試商品之後可整件從 Shopify 刪掉（要老闆同意）。
- **第 6 批（6 件，未寫入）**：3c67c42b 送出時被 409 擋（會刪 20 張），沒有改動。原因：10-08 前發布的商品把詳情圖也放進 Shopify 圖庫，現在同步只送主圖＋款式圖 → 會被當成要刪。6ede08ef 則是工具多 1 張主圖、Shopify 沒有 → 同步會補上去（老闆原則以 Shopify 為準，不補）。需要程式加一個選項：同步時保留 Shopify 獨有圖、不上傳工具獨有圖。這 5 件 SKU 仍是 CHO-。
- 58f00e61「端盒【6款不重複】」店上 $699、成本 600，跟單個盲盒一樣 → 疑似賣錯價，等老闆確認（同步沒改價格）。

## 6. 第 6 批結果（10-25 04:02–04:03Z，老闆同意）
- 前置：SYNC-KEEP-MEDIA（PR #74，合併 247cdcb，production `dpl_6SQ4EZBRd2WDu2dDZv95HqGcy3BX`）上線；GPT 套 migration `20261025100000_shopify_media_mode`，Claude 唯讀複核：6 件 `shopify`、其他 131 件 `tool`。
- 備份：`Nestory備份/2026-10-25-SYNC-ROLLOUT-第6批前.zip`（雲端硬碟也有）；每件快照 `2026-10-25-SYNC-ROLLOUT-第6批-同步前／同步後`。
- 結果：6 件全部 `ok`，都帶警告「圖片以 Shopify 為準：這次沒有新增、刪除或修改 Shopify 圖片／影片」。
  - 3c67c42b 329f516c 8b3a323e b9400278：SKU `CHO-…`→`NS-…`、描述更新；圖片 32／26／14／11 張，張數與順序不變。
  - 8b3a35b9：只換描述；10 張不變。6ede08ef：無差異列，12 款、16 張不變。
  - 價格、成本、款式都沒變。
- ae962018（測試草稿，`tool` 模式）重送：`ok`、狀態「已同步」；Shopify 2 張圖＋1 支影片，沒有重複加影片（YouTube 比對修正生效）。
- SYNC-ROLLOUT 累計 64 件完成＋ae962018。
- 10-25 05:26Z（老闆授權「能改就直接改」）：58f00e61 端盒款原本跟單個一樣賣 NT$699（來源藏價、各款繼承單個價）。改為 6×單個來源價 ¥479.4、售價 NT$3,680（工具公式 `beautify` 後成本 3,600 會高於 3,599，取下一階）、`sell_price_locked`；同步 ok，Shopify 只有這款售價 699→3680、成本 600→3600。備份 `Nestory備份/2026-10-25-58f00e61端盒改價-同步前／同步後`。其他商品唯讀掃過「端盒／整盒／套裝／N 入」款式，沒有同樣問題（只有「禮盒裝」包裝）。
- 10-25：ae962018 測試商品用工具「封存」（`shopify-lifecycle` archive），Shopify 狀態 ARCHIVED、可恢復；沒有永久刪除。
- 已查：`20261022100000` 的觸發器內容在正式庫已是新版（含略過 `source_options`），只是當時在 SQL Editor 貼、沒登記 ledger；舊 migration 的 ledger version 也都是套用時間（如 20261021030901 shopify_sync_baseline），不影響功能，不補登。
