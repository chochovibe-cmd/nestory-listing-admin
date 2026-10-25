# 4a-2 CAPTURE-SCROLL 施工規格 — 2026-10-25（Claude 指揮）

> 施工：GPT（`gpt/capture-scroll`）。**4a（PR #76）合併上線之後才開工**，從 `docs/capture-scroll-spec` 開分支（這個分支已包含 4a 的程式）。
> 驗收測試：`scripts/verify-capture-scroll.mjs`（Claude 先寫好，**不准改弱、不准刪**）。
> `extension/lib/autoScroll.js` **Claude 已寫好，不准改**。Claude 用參考接線跑過：15 項全綠、`verify:all` 全綠。
> 只改外掛（加上舊測試的版本字串），**沒有後台程式、沒有 UI、沒有 migration**。

## 1. 為什麼要做（白話）
原本 4a 列的「外掛自動捲到底」，寫 4a 規格時被 Claude 誤刪，這包補回來。
淘寶／天貓的詳情圖和評價區要捲到那裡才會長出來。正式資料 103 筆抓取中，15 筆詳情圖 0 張、4 筆只有 1～4 張；外掛自己也留了警告「可能需要頁面互動／捲動才會完整載入」。做法學 AliPrice：按下擷取後，先把頁面往下捲到底，讓內容載入，再捲回原位才開始抓。

## 2. 改哪些檔（只准動這些）
| 檔案 | 改什麼 |
|---|---|
| `extension/lib/autoScroll.js` | 已寫好，不准改 |
| `extension/background.js` | 注入清單在 `"lib/interactSku.js",` 下一行加 `"lib/autoScroll.js",` |
| `extension/content/capture.js` | §3 |
| `extension/manifest.json` | `version` 改 `"0.2.3"`，其他不動 |
| `extension/lib/selectors.js` | `CAPTURE_BUILD` 改 `"capture-20261025-scroll"` |
| `extension/README.md` | 版本 `0.2.2` 改 `0.2.3`；更新紀錄加一行：`- 0.2.3（2026-10-25）：淘寶／天貓擷取前先自動捲到底再捲回來，詳情圖和評價抓得比較完整（約多 2～6 秒）。` |
| `package.json`、`scripts/verify-all.mjs` | 註冊 `verify:capture-scroll`（放在 `verify:capture-4a` 下一行；verify-all 清單最後加） |

舊測試的版本字串 Claude 已經在這個分支改好（`verify-cap2.mjs`、`verify-capture-fix.mjs`、`verify-capture-4a.mjs`），不用再動。

## 3. `capture.js`（照抄，位置寫死）
**(a)** 在 `var payload = buildNow();` 這一行**前面**插入：
```js
    // 4a-2: scroll Taobao/Tmall to the bottom first so lazy description images / reviews render.
    var autoScroll = null;
    if (/(^|\.)(taobao\.com|tmall\.com|tmall\.hk)$/i.test(location.hostname) &&
        typeof NestoryCap.autoScrollForLazyContent === "function") {
      if (typeof globalThis.__nestoryShowCaptureToast === "function") {
        globalThis.__nestoryShowCaptureToast("⏳ 捲動頁面載入詳情圖…", "loading");
      }
      autoScroll = await NestoryCap.autoScrollForLazyContent(globalThis, document);
      if (typeof globalThis.__nestoryShowCaptureToast === "function") {
        globalThis.__nestoryShowCaptureToast("⏳ 擷取中…", "loading");
      }
    }
```
**(b)** 緊接在 `var payload = buildNow();` **後面**插入：
```js
    if (autoScroll && payload) {
      payload.capture_meta = payload.capture_meta || {};
      payload.capture_meta.auto_scroll = autoScroll;
    }
```
**(c)** 把警告字串 `"detail_image_urls: 等待 lazy-load 後仍偏少，可能需要頁面互動/捲動才會完整載入"` 換成
`"detail_image_urls: 已自動捲到底仍偏少，可能這頁本來就沒有詳情圖，或請手動捲到底再抓一次"`。
其他行一行都不准動（原本「詳情圖少於 5 張再等 2.4 秒」那段保留）。

## 4. 不要做
- 不准在 `autoScroll.js` 以外寫捲動邏輯；不准點任何按鈕、不准發請求。
- 不准加權限、不准加 `content_scripts`。
- 蝦皮和一般網站不捲（測試 E2 會檢查）。

## 5. 驗收（Claude，上線後）
1. 本機 `verify:capture-scroll`／`verify:all`／`tsc`／`build`，逐檔審 diff。
2. 外掛 0.2.3 覆蓋老闆的外掛資料夾（先備份），老闆按「重新載入」。
3. 實機：老闆抓一件天貓商品 → Claude 唯讀查 `raw_capture.client_meta.auto_scroll`（steps、reached_bottom）和詳情圖張數。
