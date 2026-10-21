# CAPTURE-FIX 施工規格（總表 4.0）— 2026-10-20

> 指揮：Claude（設計／驗收）。施工：GPT。
> 基準：`origin/handoff/20261008-golive-spec` @ **25cbb05**（含 PR #58 WORKBENCH-UX）。本規格與 `scripts/fixtures/capture-fix/` 已在 `origin/docs/capture-fix-spec`（＝handoff 25cbb05＋規格＋fixtures）；GPT **從 `origin/docs/capture-fix-spec` 開 `gpt/capture-fix`**（規格與 fixtures 會跟著 PR 一起進 handoff），PR base＝`handoff/20261008-golive-spec`。開工時 handoff 若已前進（例如 SHOPIFY-RECONCILE 已合併），不用自己合併，Claude 驗收時處理。
> 行號以 25cbb05 為準，可能有 ±20 行漂移；以函式名／字串定位。**規格沒寫的不要自己加**：不加 UI、不加 CSS、不加 migration、不加 env、不改發布／同步流程。遇到規格與程式碼對不上（行號漂移可以，函式／變數不存在不行）→ 停下回報，不要自己決定。
> GPT 無法執行 npm：寫完自己逐條對 §8，PR 說明誠實寫「未執行」；Claude 在本機跑 `npx tsc --noEmit`、`node scripts/verify-capture-fix.mjs`、`npm run verify:all`、`npm run build` 後驗收。
> 範例程式碼已在 Claude 的暫存副本對兩個真實存檔頁面（見 §2、§7）跑過；照抄可以，改寫要自己負責。

## 0. 老闆 10-20 拍板

| 題目 | 決定 |
|---|---|
| 款式比對 | 用 `data-vid` ↔ ICE `skuBase.skus[].propPath`（pid:vid）；其次位置；最後才是現有的文字比對。軸：vid 命中的那一軸，沒有 vid 才用名稱，再用位置 |
| 頁面對不上 | 0 款能對上 → 立刻中止（新原因 `dom_mismatch`），不亂點；`capture_meta.interact` 留小樣本供事後診斷 |
| 來源售完 | 以 ICE `sku2info[skuId].quantity === 0` 為準：不點、狀態 `sold_out`；**不算「沒讀完」**，其餘款全讀到就是 `complete` |
| 庫存欄位 | 每列 `variants_flat` 新增 `source_quantity`（數字或 null）、`source_stock_status`（`in_stock`／`sold_out`／`unknown`） |
| 匯入處理 | 首次匯入把 `sold_out` 的款式**排除**（記 `source_sold_out`，沿用 VARIANT-CLEAN 的 `raw_capture.server.excluded_variants`）；**全部**都售完 → 一款都不排除，加警告 |
| 確認旗標 | 被排除的售完款不會造成「需確認」；interact 只有「非售完的款」缺價才算未完成 |
| 庫存狀態存放 | 留下來的款式存進既有 jsonb `product_variants.source_options.stock`，給之後的 STOCK 包讀。**本包沒有 migration** |
| 重新抓同一網址 | 變成「更新」：以 `source_sku_id` 對應。價格只補給「未上架＋成本未確認＋仍沿用商品成本」的款；庫存狀態**所有**草稿（含已上架）都更新；重算確認旗標；回 `refreshed`。不加回被排除的款、不推 Shopify |
| 卡片 | 規格頁籤「已排除 N 款來源售完」＋每款「加回」（≥2 款有「全部加回」）；留下來但來源已售完的款顯示唯讀徽章「來源售完」 |
| 版本 | `CAPTURE_BUILD = "capture-20261020-capturefix1"`、manifest `0.2.1`；老闆更新步驟見 §10 |

## 1. 範圍與不做

| 代號 | 內容 |
|---|---|
| CF-EXT | 外掛：vid 比對、dom_mismatch、sold_out 規則、庫存欄位、翻譯後的價格標籤、版本 |
| CF-IMP | 匯入：售完款排除、庫存狀態存放、確認旗標規則、型別 |
| CF-REF | 重新擷取同一網址＝更新（價格／庫存狀態） |
| CF-UI | 規格頁籤：售完款通知＋加回、「來源售完」徽章、重算提示 |
| CF-TEST | `verify:capture-fix` ＋ 兩個真實頁面的 fixtures |

### 不做（防止擴張，全部另包）
- 不把售完／庫存推到 Shopify（總表 4b STOCK；需要 Shopify app 的 `write_inventory`／`read_locations` scope）。不改 `src/lib/shopify/**`。
- 不攔截／呼叫淘寶的 API（mtop、fetch／XHR hook、`world:"MAIN"`）；不新增 manifest 權限。
- 不做 1688；不做多軸「選了一軸後另一軸變灰」的組合判斷（只信 ICE `quantity`）；不處理「互動逐款讀價」的時間／上限／驗證演算法（`interactSku.js` 的兩輪、抽查、`slow_page` 全不動）。
- 不改發布確認彈窗（`PublishPriceConfirmModal`）與 `publishReadiness.ts` 的任何擋板邏輯。
- 不新增 migration、env、CSS、class、顏色、`!important`；不動 `src/app/globals.css`。
- 不重算／不改商品層 `product_drafts.cny_price`、`twd_price`；不改已上架草稿的任何價格。
- 不做「被排除的款回貨了自動加回」；不做舊草稿（`source_sku_id` 為 NULL）的對應。
- 不動 `.tmp/`、不刪既有檔案。

---

## 2. 根因與證據（Claude 已查證，勿再研究）

兩個老闆在登入狀態、**點過非預設款式後**存下的真實頁面（`網頁，完整`），在 Claude 暫存副本用 linkedom 重現（fixtures 見 §7）：

| 頁面 | 款式 | ICE | DOM |
|---|---|---|---|
| taobao1（item.taobao.com id=1076251328835；草稿 6232c6b0） | 1 軸 `颜色分类`，4 款 | `hideOtherPrice:"true"`；`sku2info` 只有 quantity 類欄位，**完全沒有價格**；quantity＝2／**0**／2／2 | **頁面被瀏覽器翻譯成繁體**（`<html class="translated-ltr">`、`<font dir="auto">` 包字）：標籤 `顏色分類`、選項 `弗利薩／貝吉塔／孫悟空／賽亞人孫悟空`；ICE 是簡體 `弗利萨／贝吉塔／孙悟空／赛亚人孙悟空` |
| tmall1（detail.tmall.com id=915722142018；草稿 1c89667a） | 1 軸 `颜色分类`，15 款 | 同上；quantity 0 的有 3 款 | 存檔時未翻譯（簡體）；兩個存檔都有 `data-immersive-translate-page-theme`，老闆裝了翻譯外掛 |

**node_not_found 的根因（taobao1 完全重現）**：`interactSku.js:125-126` 用「文字完全相同／去空白後相同」找選項，ICE 是簡體、DOM 被翻成繁體 → 一款都對不上。軸名稱比對（`:119-121`）其實也對不上，但 `:122` 的「沒比到就用位置」把問題藏起來了，所以只有值文字會失敗。→ 每款 `node_not_found`，耗時 6–165 ms（根本沒點）。tmall1 的存檔是簡體，節點全部找得到（重現時只停在 linkedom 沒有 React 所以點不動），所以正式站那筆 12×`node_not_found` 推定是**抓取當下頁面被翻譯**（推論，不是事實）。

**對得上的客觀資料（兩頁都驗過）**：
- DOM 選項節點有 `data-vid`，**等於** ICE `skuBase.props[].values[].vid`，順序也一致；沒有 pid 屬性。
- 售完＝DOM `isDisabled--…` ＋ `data-disabled="true"`，**恰好等於** ICE `quantity:0`（taobao1：貝吉塔；tmall1：巴衛、奈奈生和巴衛A、鐳射票巴衛）。
- 點選後價格顯示在 `.normalPrice--` 的 `.highlightPrice--`（促銷）與 `.subPrice--`（優惠前），現有 `taobaoReadPrice` 讀得對（taobao1：base 49.9／promo 48.9；tmall1：25／24.25），沒有「起」字，翻譯不影響。
- 存檔頁的 URL 帶 `skuId=` 且等於畫面上選中的那款（推論：淘寶點選後會改網址，本包不使用）。
- 沒有其他資料來源帶各款價格（`priceMoney` 只出現在商品層 `priceVO`）。

**庫存被丟掉的位置**：`taobao.js:1221-1256`（`iceSkuFromRes` 組 `variants_flat` 時只讀價格，不讀 `quantity`）；`mapCaptureFields.ts:421-422`（每款一律 `inventory_quantity:0`、`inventory_policy:"continue"`）；發布端只在 `deny`＋整數時才送有限庫存（`shopifyVariants.ts:175-178`）。

**為什麼伺服器不能重算售價**：匯率／倍率只存在每台裝置的 localStorage（`src/lib/pricingSettingsStore.ts:6-24`；`priceResyncPlan.ts` 檔頭寫明 "the server never recomputes"）。所以 §5 的價格更新＝「寫成本、清掉售價」，由卡片用既有的「依公式重算售價」重算。

---

## 3. 外掛（CF-EXT）

### 3.1 `extension/lib/adapters/taobao.js`
1. `:21` `PROMO_LABEL_RE` 結尾加 `|平台加补后|平台加補後`：
   `/店铺优惠后|店鋪優惠後|优惠后|優惠後|券后|券後|到手价|到手價|促销价|促銷價|平台加补后|平台加補後/`
2. `taobaoSkuNodes`（`:846-907`）的 `nodes.forEach`（`:891-903`）整段換成：
```js
nodes.forEach(function (n) {
  var t = skuValueText(n, dom);
  var vid = (n.getAttribute && n.getAttribute("data-vid")) || null;
  var seenKey = vid ? "vid:" + vid : "text:" + t;
  if (!t || seen[seenKey]) return;
  seen[seenKey] = true;
  var cls = (n.getAttribute && n.getAttribute("class")) || "";
  values.push({
    text: t, node: n, vid: vid,
    selected: /isSelected|selected|active|checked/i.test(cls) ||
      n.getAttribute("aria-checked") === "true" || n.getAttribute("aria-selected") === "true",
    disabled: /isDisabled|disabled|soldOut|sold-out/i.test(cls) ||
      n.getAttribute("aria-disabled") === "true" || n.getAttribute("data-disabled") === "true"
  });
});
```
   （只多了 `vid`、去重鍵改用 vid、`disabled` 多認 `data-disabled="true"`；其餘不動。）
3. 在 `function iceSkuFromRes(res) {`（`:1172`）**正上方**加：
```js
function readSourceQuantity(info) {
  if (!info || typeof info !== "object" || info.quantity == null || info.quantity === "") return null;
  var n = Number(info.quantity);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}
```
4. `iceSkuFromRes` 的 `var flat = {…}`（`:1221-1233`）在 `image_url: null` 後面加兩個欄位（記得補逗號）：
   `source_quantity: null, source_stock_status: "unknown"`
   緊接 `var info = infoMap[sku.skuId] || …`（`:1248`）之後、`var skuPrices` 之前加：
```js
flat.source_quantity = readSourceQuantity(info);
flat.source_stock_status =
  flat.source_quantity == null ? "unknown" : flat.source_quantity === 0 ? "sold_out" : "in_stock";
```
   DOM-only 後備路徑（沒有 ICE）**不加**這兩個欄位（後端把「沒有欄位」視為 unknown）。

### 3.2 `extension/lib/interactSku.js`
1. `shouldInteractSkuPrices`（`:7-12`）最後那個 `.some` 換成（沒價格且**不是售完**才需要讀）：
```js
payload.variants_flat.some(function (row) {
  return row && row.cny_price == null && row.source_stock_status !== "sold_out";
}));
```
2. `:58` `var info = …` 之後加（ICE 的 vid 對照）：
```js
var iceProps = iceRes && iceRes.skuBase && Array.isArray(iceRes.skuBase.props) ? iceRes.skuBase.props : [];
var vidsBySku = {};
(iceRes && iceRes.skuBase && Array.isArray(iceRes.skuBase.skus) ? iceRes.skuBase.skus : [])
  .forEach(function (s) {
    if (!s || s.skuId == null) return;
    vidsBySku[String(s.skuId)] = String(s.propPath || "").split(";").map(function (part) {
      var i = part.indexOf(":");
      return i >= 0 ? part.slice(i + 1).trim() : "";
    });
  });
```
3. 售完判斷（`:68-70`）：`if (skuInfo && skuInfo.quantity != null && Number(skuInfo.quantity) === 0) {` 換成（欄位優先，沒有欄位才看 ICE，保留給舊 payload／既有測試）：
```js
var soldOutByField = entry.row.source_stock_status === "sold_out";
var soldOutByIce = entry.row.source_stock_status == null &&
  skuInfo && skuInfo.quantity != null && Number(skuInfo.quantity) === 0;
if (soldOutByField || soldOutByIce) {
```
   區塊內容（`entry.report.status = "sold_out"`）不變。
4. `result` 初始值（`:79-83`）：`version: 1` 改 `version: 2`；`ok: 0` 後面加 `sold_out: 0, readable: targets.length,`。
5. `finalize()`（`:84-104`）：把
```js
result.ok = okRows.length;
if (states.some(function (e) { return e.report.status !== "ok"; })) {
```
   換成：
```js
result.ok = okRows.length;
result.sold_out = states.filter(function (e) { return e.report.status === "sold_out"; }).length;
result.readable = targets.length - result.sold_out;
if (states.some(function (e) { return e.report.status !== "ok" && e.report.status !== "sold_out"; })) {
```
   `all_identical`／`min_mismatch` 與 `result.requires_confirmation = result.reasons.length > 0` 不動。→ 非售完的款全 `ok`＝`status:"complete"`、`reasons:[]`；全部都售完（`eligible` 為空）＝`complete`、`ok:0`、`readable:0`。
6. `function findOption(axes, row, dimension) {`（`:115`）：在函式**最前面**（`var expectedLabel` 之前）插入下面這段，原本的名稱／文字比對邏輯**整段保留在後面當第三層**：
```js
var wantedVids = row.sku != null ? vidsBySku[String(row.sku)] : null;
var wantedVid = wantedVids && wantedVids[dimension - 1] ? wantedVids[dimension - 1] : null;
var preferred = axes[dimension - 1] || null;
if (wantedVid) {                       // 1) vid：先找同位置的軸，再找其他軸
  var searchOrder = (preferred ? [preferred] : []).concat(axes.filter(function (a) { return a !== preferred; }));
  for (var si = 0; si < searchOrder.length; si++) {
    var hit = searchOrder[si].values.find(function (v) { return v.vid === wantedVid; });
    if (hit) return hit;
  }
}
var domAxis = axes[dimension - 1];     // 2) 位置：只在「沒有 vid 可比」或「這一軸的 DOM 選項都沒有 vid」且數量一致時
var iceProp = iceProps[dimension - 1];
var positionSafe = !wantedVid || (domAxis && domAxis.values.every(function (v) { return !v.vid; }));
if (positionSafe && domAxis && iceProp && Array.isArray(iceProp.values) &&
    domAxis.values.length === iceProp.values.length) {
  var wantedText = valueKey(row["option" + dimension + "_value"]);
  for (var pi = 0; pi < iceProp.values.length; pi++) {
    if (wantedText && valueKey(iceProp.values[pi] && iceProp.values[pi].name) === wantedText) {
      return domAxis.values[pi] || null;
    }
  }
}
// 3) 以下是原本的名稱／文字比對（不改）
```
   > 規格原本寫「軸先用 pid」：DOM 沒有 pid 屬性，所以改成「vid 命中的軸」；有 vid 就一定對得到軸，不需要 pid。
7. 在 `function callProgress`（`:36`）**前面**加：
```js
function sampleList(list, unique) {
  var out = [];
  for (var i = 0; i < list.length && out.length < 5; i++) {
    var text = String(list[i] == null ? "" : list[i]).slice(0, 40);
    if (!text || (unique && out.indexOf(text) >= 0)) continue;
    out.push(text);
  }
  return out;
}
```
8. **pre-flight**：在 `var done = 0, total = eligible.length * 2, consecutiveClickFails = 0;`（`:112`）**正上方**加（`findOption` 是函式宣告，會提升，可在此呼叫）：
```js
if (eligible.length > 0) {
  var anyResolves = eligible.some(function (e) {
    var axesNow = adapters.taobaoSkuNodes(doc, host);
    for (var d = 1; d <= 3; d++) {
      var v = e.row["option" + d + "_value"];
      if (v == null || String(v).trim() === "") continue;
      if (!findOption(axesNow, e.row, d)) return false;
    }
    return true;
  });
  if (!anyResolves) {
    result.status = "aborted";
    result.abort_reason = "dom_mismatch";
    var sampleAxes = adapters.taobaoSkuNodes(doc, host) || [];
    result.dom_sample = {
      labels: sampleList(sampleAxes.map(function (axis) { return axis.label; })),
      values: sampleList((sampleAxes[0] ? sampleAxes[0].values : []).map(function (v) { return v.text; })),
      ice_labels: sampleList(eligible.map(function (e) { return e.row.option1_name; }), true),
      ice_values: sampleList(eligible.map(function (e) { return e.row.option1_value; }))
    };
    eligible.forEach(function (e) { e.report.status = "node_not_found"; });
    return finalize();
  }
}
```
   有一部分能對上＝照舊往下跑（對不上的列各自 `node_not_found`，整體 `partial`）。`dom_sample` 只在 `dom_mismatch` 時出現，欄位固定為 `labels`／`values`（DOM，各 ≤5 筆、每筆 ≤40 字）與 `ice_labels`／`ice_values`（ICE，同上限）。

### 3.3 `extension/content/capture.js`
1. `:147-151`「所有列都有價就移除『個別未優惠價未完整取得』」的條件換成**忽略售完款**：
```js
if (flats.length && flats.filter(function (r) { return r.source_stock_status !== "sold_out"; })
      .every(function (r) { return r.cny_price != null; })) {
```
2. `:152-173` 整個 `if (interact.ok < interact.targets) {…}` 區塊換成下面這段（`names` 對照表**原樣保留**；舊格式 `result` 沒有 `readable` 時退回 `targets` 並照舊把 `sold_out` 算進原因，既有測試 CI13 不能壞）：
```js
var readable = typeof interact.readable === "number" ? interact.readable : interact.targets;
var skipSoldOutRows = typeof interact.readable === "number";
var domMismatch = interact.status === "aborted" && interact.abort_reason === "dom_mismatch";
if (!domMismatch && interact.ok < readable) {
  var names = { /* 原樣：sold_out: "來源缺貨", over_limit: "超過上限", … slow_page: "頁面太慢" */ };
  var counts = {};
  (interact.rows || []).forEach(function (r) {
    if (r.status === "ok" || (skipSoldOutRows && r.status === "sold_out")) return;
    counts[r.status] = (counts[r.status] || 0) + 1;
  });
  // Interaction metadata intentionally contains at most 60 rows.
  var hidden = Math.max(0, interact.targets - (interact.rows || []).length);
  if (hidden) counts.over_limit = (counts.over_limit || 0) + hidden;
  var reasons = Object.keys(counts).map(function (status) {
    return (names[status] || status) + " " + counts[status];
  }).join("、");
  warns.push("逐款讀價：" + (readable - interact.ok) +
    " 款沒讀到價格（" + reasons + "），請逐款確認");
}
```
3. 中止原因警告（新增，放在 `all_identical` 判斷之前）。新增常數表並在 `interact.status === "aborted"` 時各加一行：
```js
var ABORT_REASON_TEXT = {
  dom_mismatch: "頁面上的款式文字和資料對不上（可能是淘寶改版，或翻譯外掛改寫了頁面），請關閉這個網站的翻譯後重新擷取；仍失敗請回報",
  click_failed: "連續點不到款式按鈕",
  no_sku_nodes: "找不到款式面板",
  verify_failed: "抽查讀到的價格不一致，整批讀價作廢",
  slow_page: "頁面回應太慢，整批讀價作廢"
};
if (interact.status === "aborted" && ABORT_REASON_TEXT[interact.abort_reason]) {
  warns.push("逐款讀價中止：" + ABORT_REASON_TEXT[interact.abort_reason]);
}
```
   （上面第 2 點已排除 `dom_mismatch` 的「N 款沒讀到價格」重複訊息；其餘中止原因照舊兩行都出現。）

### 3.4 `extension/background.js`
1. `interactSuffix`（`:130-136`）整個換成：
```js
function interactSuffix(payload) {
  var i = payload && payload.capture_meta && payload.capture_meta.interact;
  if (!i || typeof i.targets !== "number" || typeof i.ok !== "number") return "";
  if (i.abort_reason === "dom_mismatch") {
    return "（逐款讀價沒做：頁面文字對不上，請關閉瀏覽器翻譯後重抓）";
  }
  var readable = typeof i.readable === "number" ? i.readable : i.targets;
  var soldOut = typeof i.sold_out === "number" ? i.sold_out : 0;
  var soldText = soldOut > 0 ? "，" + soldOut + " 款來源售完" : "";
  if (readable === 0) return soldOut > 0 ? "（款式全部來源售完）" : "";
  return i.ok === readable
    ? "（逐款讀價 " + i.ok + "/" + readable + soldText + "）"
    : "（逐款讀價 " + i.ok + "/" + readable + soldText + "，" + (readable - i.ok) + " 款請確認）";
}
```
2. 在 `updated` 分支（`:365-381`）之後、`exists` 分支（`:383`）之前加：
```js
if (json.ok && json.status === "refreshed") {
  await setLastResult({
    ok: true,
    status: "refreshed",
    line: (json.message || "已更新這個網址的草稿") + interactSuffix(payload),
    draft_id: json.draft_id,
    open_path: json.open_path,
    at: new Date().toISOString()
  });
  await setBadge("ok", "✓");
  await showPageToast(
    tab.id,
    "ok",
    "✓ 這個網址之前已抓過，" + (json.message || "已更新") + "：" + capturedTitle + interactSuffix(payload)
  );
  return;
}
```
   `json.message` 由伺服器產生，例：`已更新 2 款價格、1 款庫存狀態`（格式見 §5.2 第 8 點）。

### 3.5 版本、說明
- `extension/lib/selectors.js:9`：`NestoryCap.CAPTURE_BUILD = "capture-20261020-capturefix1";`
- `extension/manifest.json:4`：`"version": "0.2.1"`；`permissions`／`host_permissions`／`optional_host_permissions` **一字不動**。
- `scripts/verify-cap2.mjs:215`：期望值同步改成 `"capture-20261020-capturefix1"`（**這是唯一允許改的既有測試**）。
- `extension/README.md`：在 `## 抓不到某些欄位？`（約 `:127`）**前面**新增 `## 更新外掛版本`，內容就是 §10 的「老闆更新步驟」（原文照放）；並在「圖示上可能出現」的清單（約 `:105`）再加一條：`- **綠 ✓＋「已更新…」**：之前抓過的草稿，已補上最新的價格或庫存狀態`。其他 README 不動。

---

## 4. 匯入（CF-IMP）

### 4.1 型別與小工具
1. `src/lib/variants/types.ts`：`VariantSourceOptions`（`:42-45`）上方新增，並讓它多一個可選欄位：
```ts
export type SourceStockStatus = "in_stock" | "sold_out" | "unknown";
/** CAPTURE-FIX: 來源網站（淘寶／天貓）庫存狀態；之後 STOCK 包讀這裡。 */
export type VariantSourceStock = { status: SourceStockStatus; quantity: number | null; checked_at: string };
export type VariantSourceOptions = {
  names: Array<string | null>;
  values: Array<string | null>;
  stock?: VariantSourceStock | null;
};
```
   `src/types/domain.ts:369` 與 `src/components/listing/ResultCard.tsx:202` 的行內型別 `{ names…; values… } | null` 都改成 `VariantSourceOptions | null`（兩檔各加 `import type { VariantSourceOptions } from "@/lib/variants/types";`）。
2. 新檔 `src/lib/variants/sourceStock.ts`（client-safe、純函式、不 import 其他東西，只 `import type` 自 `./types`）：
```ts
export function normalizeSourceStockStatus(value: unknown): SourceStockStatus | null;
export function parseFlatSourceStock(flat: { source_stock_status?: unknown; source_quantity?: unknown } | null | undefined, checkedAt: string): VariantSourceStock | null;
export function readSourceStock(sourceOptions: unknown): VariantSourceStock | null;
export function isSourceSoldOut(row: { sourceOptions?: unknown } | null | undefined): boolean;
export function withSourceStock(sourceOptions: unknown, stock: VariantSourceStock, fallbackNames?: Array<string | null>, fallbackValues?: Array<string | null>): VariantSourceOptions;
```
   - `normalizeSourceStockStatus`：只接受字串 `"in_stock"｜"sold_out"｜"unknown"`，其他一律 `null`。
   - `parseFlatSourceStock`：`status = normalizeSourceStockStatus(flat?.source_stock_status)`，為 `null`（欄位不存在／亂填）→ 回 `null`；`quantity = typeof flat.source_quantity === "number" && Number.isInteger(...) && >= 0 ? 該值 : null`；回 `{ status, quantity, checked_at: checkedAt }`。
   - `readSourceStock`：`sourceOptions` 是物件且有物件 `stock`、`stock.status` 合法 → 回 `{ status, quantity: 整數≥0 或 null, checked_at: 字串或 "" }`，否則 `null`。
   - `isSourceSoldOut`：`readSourceStock(row?.sourceOptions)?.status === "sold_out"`。
   - `withSourceStock`：`sourceOptions` 是（非陣列）物件 → `{ ...sourceOptions, names: Array.isArray(sourceOptions.names) ? sourceOptions.names : (fallbackNames ?? [null, null, null]), values: …同理, stock }`；否則 `{ names: fallbackNames ?? [null,null,null], values: fallbackValues ?? [null,null,null], stock }`。
3. 新檔 `src/lib/import/captureSourceStock.ts`：
```ts
export const WARNING_ALL_SOURCE_SOLD_OUT =
  "來源網站上所有款式都已售完，這次沒有排除任何款式；請確認這件商品還要不要上架";
/** 已排除 2 款來源售完：「A」「B」（可在規格頁籤加回）；超過 6 款只列前 6 款再加「…」 */
export function formatSoldOutExcludedWarning(labels: string[]): string;
```
   格式：`` `已排除 ${labels.length} 款來源售完：${labels.slice(0, 6).map((l) => `「${l}」`).join("")}${labels.length > 6 ? "…" : ""}（可在規格頁籤加回）` ``。
4. `src/lib/import/captureTypes.ts`：
   - `CaptureVariantFlat`（`:6-27`）加：
     `source_quantity?: number | null;`、`source_stock_status?: "in_stock" | "sold_out" | "unknown";`
   - `CaptureMeta.interact`（`:28-38`）加：`sold_out?: number;`、`readable?: number;`、`dom_sample?: { labels?: string[]; values?: string[]; ice_labels?: string[]; ice_values?: string[] } | null;`
   - 新增型別並加進 `CaptureImportResponse`（`:137` 的 union）：
```ts
/** CAPTURE-FIX: 同網址重新擷取＝更新價格／庫存狀態。 */
export type CaptureImportRefreshed = {
  ok: true;
  status: "refreshed";
  draft_id: string;
  open_path: string;
  message: string;
  refreshed: { prices: number; stock: number; price_skipped_reason: "published" | "confirmed" | null };
};
```
   `src/lib/import/createCaptureDraft.ts:22` 的 `CreateCaptureDraftResult` union 也加 `CaptureImportRefreshed`。

### 4.2 `src/lib/import/mapCaptureFields.ts`
1. `ExcludedCaptureVariant.reason`（`:71`）改 `"non_product_option" | "source_sold_out"`。
2. `mapVariantRows`（`:341`）簽名加第 4 參數：`opts?: { stockCheckedAt?: string }`；回傳多一個欄位 `allSourceSoldOut: boolean`。內部：
   - `const checkedAt = opts?.stockCheckedAt ?? new Date().toISOString();`
   - 在 `flats.forEach` 裡，組好 `row`（`:407-425`）之後：`const stock = parseFlatSourceStock(v, checkedAt);`。
   - **假款式判斷（`:429-436`）維持第一關，原樣不動**（假款式永遠是 `non_product_option`，即使它也標售完）。
   - 假款式判斷之後，**不要**立刻做圖片紀錄／`rows.push`；改成 `pending.push({ row, stock, imageUrl, label })`（`label` 沿用 `:431` 的 `[o1v, o2v, o3v].filter(Boolean).join("／")`）。
   - `flats.forEach` 結束後：
```ts
const allSourceSoldOut = pending.length > 0 && pending.every((p) => p.stock?.status === "sold_out");
const rowStocks: Array<VariantSourceStock | null> = [];
for (const p of pending) {
  if (!allSourceSoldOut && p.stock?.status === "sold_out") {
    excluded.push({
      label: p.label,
      reason: "source_sold_out",
      row: {
        ...p.row,
        source_options: {
          names: [p.row.option1_name ?? null, p.row.option2_name ?? null, p.row.option3_name ?? null],
          values: [p.row.option1_value ?? null, p.row.option2_value ?? null, p.row.option3_value ?? null],
          stock: p.stock
        }
      }
    });
    continue;                       // 被排除的款不記圖片、不進維度、不進 rows
  }
  if (p.imageUrl && !seenImg.has(p.imageUrl)) { seenImg.add(p.imageUrl); imageUrls.push(p.imageUrl); }
  rows.push(p.row);
  rowStocks.push(p.stock);
}
```
   - 原 `:446` 之後的 `rows.forEach((row, i) => { row.source_options = {names, values} … })` 改成：`row.source_options = { names: […], values: […], ...(rowStocks[i] ? { stock: rowStocks[i] } : {}) };`（**沒有欄位就不要出現 `stock` key**，不可寫 `stock: undefined`——既有 `verify-variant-clean.mjs:451` 用 deepEqual 比 `{names, values}`）。
3. `mapCaptureToDraftFields`：
   - 把 `const receivedAt = opts.receivedAt ?? new Date().toISOString();`（`:619`）**搬到** `flats` 宣告之前（`:~526`），原位置刪掉；呼叫改 `mapVariantRows(flats, body.sku_table, price, { stockCheckedAt: receivedAt })`，並多接 `allSourceSoldOut`。
   - 取代 `:534-538`：
```ts
const nonProductExcluded = excludedVariants.filter((e) => e.reason === "non_product_option");
const soldOutExcluded = excludedVariants.filter((e) => e.reason === "source_sold_out");
if (nonProductExcluded.length > 0) {
  warnings.push(`已排除 ${nonProductExcluded.length} 個非商品款式：${nonProductExcluded.map((e) => `「${e.label}」`).join("")}（可在規格頁籤恢復）`);
}
if (soldOutExcluded.length > 0) warnings.push(formatSoldOutExcludedWarning(soldOutExcluded.map((e) => e.label)));
if (allSourceSoldOut) warnings.push(WARNING_ALL_SOURCE_SOLD_OUT);
```
   - `ownPricedFlats` / `domOnlyPricedFlats`（`:543-548`）改用 `keptFlats`：`const keptFlats = allSourceSoldOut ? flats : flats.filter((v) => parseFlatSourceStock(v, receivedAt)?.status !== "sold_out");`（被排除的售完款不能灌水「有價款數」）。
   - 價格區間交叉檢查（`:575-594`）：定義 `const hasSoldOutExcluded = soldOutExcluded.length > 0;`、`const tol = (a: number, b: number) => Math.max(0.5, Math.max(Math.abs(a), Math.abs(b)) * 0.015);`。flag 條件：沒有被排除的售完款＝照舊（`outside(min, low) || outside(max, high)`）；**有**被排除的售完款＝只在「留下來的最低價比頁面低端還低」或「最高價比頁面高端還高」時才標：`min < pageRange.low - tol(min, pageRange.low) || max > pageRange.high + tol(max, pageRange.high)`（頁面區間可能包含售完款的價格，不能因為少了它就誤報）。警告文字不變。
   - 其餘（`interactRequiresConfirmation(body.capture_meta)` 的呼叫位置 `:568`、`rawCapture.server.excluded_variants`〔`:649`〕）不動。

### 4.3 `src/lib/import/captureHiddenPrices.ts`：`interactRequiresConfirmation`（`:53-58`）整個換成
```ts
export function interactRequiresConfirmation(clientMeta: unknown): boolean {
  if (!clientMeta || typeof clientMeta !== "object" || Array.isArray(clientMeta)) return false;
  const interact = (clientMeta as Record<string, unknown>).interact;
  if (!interact || typeof interact !== "object" || Array.isArray(interact)) return false;
  const data = interact as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const rows = Array.isArray(data.rows) ? (data.rows as Array<Record<string, unknown> | null>) : [];
  const soldOut = num(data.sold_out) ?? rows.filter((r) => r?.status === "sold_out").length;
  const targets = num(data.targets);
  const ok = num(data.ok);
  // 沒讀到價格、而且不是來源售完的款數；算不出來 → null
  const pending = targets != null && ok != null ? Math.max(0, targets - ok - soldOut) : null;
  if (data.status === "aborted") return true;
  if (Array.isArray(data.reasons)) {
    const effective = (data.reasons as unknown[]).filter(
      (r) => typeof r === "string" && !(r === "incomplete" && pending === 0)
    );
    if (effective.length > 0) return true;
  } else if (data.requires_confirmation === true) {
    return true; // 舊格式沒有 reasons
  }
  if (data.status === "partial") return pending == null ? true : pending > 0;
  return false;
}
```
（舊版外掛 0.2.0 把售完也算「未完成」，這樣伺服器也能自己扣掉；最多只認 rows 前 60 筆，這是舊版的限制。）`captureHidesVariantPrices`（`:38-47`）與 `WARNING_*` 常數不動。

### 4.4 還原（加回）— `src/lib/variants/restoreExcludedVariant.ts` 與 route
1. `planRestoreExcludedVariant`（`:79` 起）：在算出 `base`（`:87-92`）之後、組 `draft`（`:94`）之前加：
```ts
if (entry.reason === "source_sold_out") {
  base.cny_price = null;            // 加回的款成本一律「沿用商品成本」，讓確認旗標誠實生效
  base.cost_is_inherited = true;
}
```
   並把 `draft.source_options`（`:99-102`）改成保留庫存狀態：
```ts
const priorStock = (entry.row.source_options as { stock?: unknown } | undefined)?.stock;
source_options: {
  names: [raw.option1_name ?? null, raw.option2_name ?? null, raw.option3_name ?? null],
  values: [raw.option1_value ?? null, raw.option2_value ?? null, raw.option3_value ?? null],
  ...(priorStock ? { stock: priorStock } : {})
}
```
2. 同檔新增並匯出：
```ts
export type RestoreAllPlan =
  | { ok: true; rows: Array<Record<string, unknown>>; remaining: ExcludedVariantEntry[]; dimensions: Dimension[] }
  | { ok: false; status: number; error: string };
export function planRestoreAllExcludedVariants(input: {
  draftId: string; excluded: ExcludedVariantEntry[]; reason: string;
  existing: ExistingVariantLite[]; dimensions: Dimension[];
}): RestoreAllPlan;
```
   演算法：`rows=[]`；迴圈：`idx = excluded.findIndex(e => e.reason === input.reason)`，找不到就結束；對 `idx` 呼叫 `planRestoreExcludedVariant({ …, excluded, index: idx, existing, dimensions })`，失敗就整個回傳那個失敗（**不寫任何東西**）；成功就 `rows.push(plan.row)`，`existing` 追加 `{ id: "pending-" + rows.length, sku: plan.row.sku, sort_order: plan.row.sort_order, option1_value…option3_value }`，`excluded = plan.remaining`，`dimensions = plan.dimensions`。`rows` 為空 → `{ ok:false, status:404, error:"沒有可加回的款式" }`。
3. `src/app/api/drafts/[id]/excluded-variants/restore/route.ts`：
   - body 改為 `{ index?: number; all?: boolean; reason?: string }`。`all === true` 時 `reason` 只接受 `"source_sold_out"`，其他回 400 `{ error: "不支援的加回類型" }`。
   - `all`：用 `planRestoreAllExcludedVariants`，一次 `insert(plan.rows)`（缺欄位的 fallback 同現有寫法，對陣列用 `omitVariantOverrideColumns(plan.rows, msg)`）；單筆維持現狀。
   - 成功後更新 `product_drafts`：`variant_dimensions` 與 `raw_capture.server.excluded_variants` 照舊；**若被加回的款裡有 `reason === "source_sold_out"`**，`server` 另外設 `price_requires_confirmation: true`、`variant_price_confirmed_at: null`、`variant_price_confirmed_by: null`（成本是沿用的，必須重新確認）。
   - 回傳 `{ ok: true, remaining: number, restored: number, price_unconfirmed: boolean }`。route 仍只 export `POST`。

---

## 5. 重新擷取同一網址＝更新（CF-REF）

### 5.1 新檔 `src/lib/import/refreshCapture.ts`（不 import createCaptureDraft／supabase；可被 client 引用）
```ts
export type RefreshDraftInput = { id: string; shopify_product_id: string | null; cny_price: number | null; warnings: string[] | null; raw_capture: unknown };
export type RefreshVariantInput = {
  id: string; source_sku_id: string | null;
  option1_name: string | null; option1_value: string | null; option2_name: string | null; option2_value: string | null; option3_name: string | null; option3_value: string | null;
  cny_price: number | null; twd_price: number | null; compare_at_price: number | null;
  cost_is_inherited: boolean | null; sell_price_locked: boolean | null; compare_at_locked: boolean | null; price_locked: boolean | null;
  source_options: unknown;
};
export type RefreshPlan = {
  priceAllowed: boolean;
  priceSkippedReason: "published" | "confirmed" | null;
  variantUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
  prices: number; stock: number;
  draftPatch: { raw_capture: Record<string, unknown>; warnings?: string[]; updated_at: string } | null;
  message: string;                 // prices === 0 && stock === 0 時為 ""
};
export function planCaptureRefresh(input: { draft: RefreshDraftInput; variants: RefreshVariantInput[]; flats: CaptureVariantFlat[]; now: string }): RefreshPlan;
export function formatRefreshMessage(input: { prices: number; stock: number; skipped: "published" | "confirmed" | null }): string;
export function readPriceRefreshSkuIds(rawCapture: unknown): string[];
export async function refreshExistingCaptureDraft(input: { serviceSupabase: any; draftId: string; body: CaptureImportBody; now?: string }): Promise<{ draft_id: string; message: string; refreshed: CaptureImportRefreshed["refreshed"] } | null>;
```

### 5.2 `planCaptureRefresh` 規則（逐條照做）
1. **對應**：只處理 `flats` 裡 `sku`（trim 後非空）能對到 `variants[].source_sku_id`（trim 後完全相同）的列；同一個 sku 只處理第一次出現；對不到的忽略（包含被排除的款、來源新增的款）。
2. `priceAllowed = !draft.shopify_product_id && !isVariantPriceConfirmed(draft.raw_capture)`（`isVariantPriceConfirmed` 從 `@/lib/shopify/publishReadiness` import）。
3. **庫存狀態（所有草稿都做）**：`stock = parseFlatSourceStock(flat, now)`；`stock == null` 或 `stock.status === "unknown"` → 不動（不可用「未知」蓋掉已知）。`old = readSourceStock(variant.source_options)`；`old == null || old.status !== stock.status || old.quantity !== stock.quantity` → patch 加 `source_options: withSourceStock(variant.source_options, stock, [option1_name, option2_name, option3_name], [option1_value, option2_value, option3_value])`，`stock` 計數 +1。
4. **價格（只在 `priceAllowed`）**：同時符合才更新——`variant.cost_is_inherited === true`（嚴格等於）、`Number.isFinite(flat.cny_price) && flat.cny_price > 0`、`flat.price_source` 是非空字串且 **不以 `dom.` 開頭**。patch：
   - `cny_price: flat.cny_price`、`cost_is_inherited: false`；
   - 售價：`sellLocked = variant.sell_price_locked ?? variant.price_locked ?? false`；**未鎖定** → `twd_price: null`（伺服器沒有裝置的匯率設定，不能重算；清空後由卡片「依公式重算售價」算）；鎖定 → patch 不放 `twd_price`；
   - 定價：`compareLocked = variant.compare_at_locked ?? variant.price_locked ?? false`；未鎖定 → `compare_at_price: null`，鎖定 → 不放。
   - `prices` 計數 +1，該款的 `source_sku_id` 記進 `touchedSkuIds`。不符合條件的（`cost_is_inherited` 不是 `true`＝老闆填過成本／已獨立）**完全不碰價格欄位**。
   - 不論 `priceAllowed`，符合上述條件的款數記為 `wouldUpdate`。
5. `priceSkippedReason = (!priceAllowed && wouldUpdate > 0) ? (draft.shopify_product_id ? "published" : "confirmed") : null`。
6. **確認旗標（只在 `prices > 0` 時重算，否則完全不動）**：先把所有 patch 套到變數副本上，`unresolved = 變數副本.filter(v => v.cost_is_inherited !== false && readSourceStock(v.source_options)?.status !== "sold_out").length`（來源已售完的款不需要價格）。同時符合才清旗標：`server.price_requires_confirmation === true`、`unresolved === 0`、`!isPricePlaceholderCny(draft.cny_price)`、`server.price_confidence !== "conflict"`。清旗標時：
   - `server.price_requires_confirmation = false`；
   - 從 `draft.warnings` 與 `server.warnings`（陣列，若存在）移除：等於 `WARNING_HIDDEN_VARIANT_PRICES`、等於 `WARNING_INTERACT_NEEDS_CONFIRMATION`、以 `逐款讀價：` 開頭、以 `sku: 個別未優惠價` 開頭的項目；`price_confidence` 不動。
   - 條件不符＝旗標與警告都不動（**只會清、不會新增**）。
7. **紀錄**：只要 `prices > 0 || stock > 0`，`draftPatch` 就存在：`raw_capture`＝舊 `raw_capture` 全部保留，`server` 內加 `last_refresh: { at: now, prices, stock, price_skipped: priceSkippedReason }`，`prices > 0` 時另加 `price_refresh: { at: now, count: prices, source_sku_ids: touchedSkuIds }`（整個覆蓋舊值）；`warnings` 只在第 6 點真的移除了東西時才放；`updated_at: now`。
8. `message = formatRefreshMessage(...)`：
   - `prices>0 && stock>0` → `已更新 ${prices} 款價格、${stock} 款庫存狀態`
   - 只有 `prices>0` → `已更新 ${prices} 款價格`
   - 只有 `stock>0` → `已更新 ${stock} 款庫存狀態`，後面接：`skipped === "published"` → `（已上架，價格沒動）`；`skipped === "confirmed"` → `（成本已確認，價格沒動）`；`null` → 不接。
   - 兩者皆 0 → `""`。
9. `readPriceRefreshSkuIds(rawCapture)`：回 `rawCapture.server.price_refresh.source_sku_ids` 中的字串（不是陣列／不存在 → `[]`）。

### 5.3 `refreshExistingCaptureDraft`（同檔，只能用下列 supabase 呼叫，驗證腳本的假資料庫就是這幾條）
```ts
db.from("product_drafts").select("id, shopify_product_id, cny_price, warnings, raw_capture").eq("id", draftId).maybeSingle()   // → { data, error }
db.from("product_variants").select("id, source_sku_id, option1_name, option1_value, option2_name, option2_value, option3_name, option3_value, cny_price, twd_price, compare_at_price, cost_is_inherited, sell_price_locked, compare_at_locked, price_locked, source_options").eq("draft_id", draftId)   // 直接 await → { data, error }
db.from("product_variants").update(patch).eq("id", id)    // 每款一次，依序，await → { error }
db.from("product_drafts").update(draftPatch).eq("id", draftId)   // 最後一次，await → { error }
```
- 流程：讀草稿 → 讀款式 → `planCaptureRefresh({ …, flats: body.variants_flat ?? [], now: input.now ?? new Date().toISOString() })` → `prices === 0 && stock === 0` 回 `null` → 依序寫款式 → 最後寫草稿 → 回 `{ draft_id, message, refreshed: { prices, stock, price_skipped_reason } }`。
- **任何錯誤（讀、寫、拋例外）一律回 `null`，絕不丟出**（擷取請求不能因為更新失敗而失敗；呼叫端會回原本的 `exists`）。款式寫到一半失敗就停止、不寫草稿（已寫的不回滾，屬已知限制）。
- 全程不呼叫任何 Shopify、不寫 `product_images`、不新增／刪除款式、不改 `product_drafts.cny_price`／`twd_price`。

### 5.4 `src/lib/import/createCaptureDraft.ts`
`if (existing) {…}`（`:263-277`）改成：先照舊 `refillEmptyCaptureFields`，`refill` 有回傳就直接回（行為不變）；`refill` 為 `null` 時：
```ts
const refreshed = await refreshExistingCaptureDraft({ serviceSupabase: input.serviceSupabase, draftId: existing.id, body: input.body });
if (refreshed) {
  return { ok: true, status: "refreshed", draft_id: existing.id, open_path: openPathForDraft(existing.id), message: refreshed.message, refreshed: refreshed.refreshed };
}
// 否則維持原本的 { status: "exists", … }
```
`src/app/api/import/product-page/route.ts:67`：`if (result.status === "exists")` 改成 `if (result.status === "exists" || result.status === "refreshed")`（回 200，不跑 `after()` 補圖）。

---

## 6. 卡片 UI（CF-UI）

### 6.1 `src/components/listing/result-card/ResultCardSpecsPanel.tsx`
props 新增：`restoreAllBusy: boolean`、`onRestoreAllSoldOut: () => void`、`priceRecalcPending: number`（預設 0）。`excludedVariants` 仍傳**完整清單**（含原順序），面板內自己分兩組並**保留原 index**：
```ts
const soldOutExcluded = excludedVariants.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.reason === "source_sold_out");
const otherExcluded = excludedVariants.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.reason !== "source_sold_out");
```
1. **既有「已排除的款式」區塊**（`:120-146`）：改用 `otherExcluded`（`summary`、`title` 數字用它的長度；`onRestoreExcluded(index)` 用保留的原 index；文字、按鈕「恢復」不變）。
2. **新增通知（放在 `unconfirmedLabels` 那段 `<p>`〔`:92-98`〕之後、「尚未建立款式」提示之前）**，`soldOutExcluded.length > 0` 才渲染，用既有 `CollapsibleSection`（`className="vc-excluded"`），新 state `const [soldOutOpen, setSoldOutOpen] = useState(soldOutExcluded.length <= 3);`：
```tsx
<CollapsibleSection
  className="vc-excluded"
  onToggle={() => setSoldOutOpen((open) => !open)}
  open={soldOutOpen}
  summary={soldOutExcluded.slice(0, 3).map(({ entry }) => `「${entry.label}」`).join("") + (soldOutExcluded.length > 3 ? "…" : "")}
  title={`已排除 ${soldOutExcluded.length} 款來源售完`}
>
  <p className="vc-note">這些款式在來源網站已經沒有庫存，匯入時先排除，避免上架賣不到的款式。補貨了可以加回；加回的款式成本會暫用商品成本，發布前請確認。</p>
  {restoreDisabledReason ? <p className="price-soft-warn">{restoreDisabledReason}</p> : null}
  <ul className="vc-list">
    {soldOutExcluded.map(({ entry, index }) => (
      <li className="vc-excluded-row" key={`${entry.label}-${index}`}>
        <span className="vc-excluded-label">{entry.label}</span>
        <Button disabled={Boolean(restoreDisabledReason) || restoreBusyIndex !== null || restoreAllBusy}
          loading={restoreBusyIndex === index} onClick={() => onRestoreExcluded(index)} size="sm" type="button">加回</Button>
      </li>
    ))}
  </ul>
  {soldOutExcluded.length >= 2 ? (
    <div className="vc-toolbar">
      <Button disabled={Boolean(restoreDisabledReason) || restoreBusyIndex !== null || restoreAllBusy}
        loading={restoreAllBusy} onClick={onRestoreAllSoldOut} size="sm" type="button">全部加回</Button>
    </div>
  ) : null}
</CollapsibleSection>
```
   手機 ≤960px 的 44px 觸控高度已由既有 `.vc-excluded-row .nb-btn`／`.result-card .vc-toolbar .nb-btn` 規則涵蓋，不用新 CSS。
3. **重算提示**（放在 `unconfirmedLabels` 那段 `<p>` 之後、上面第 2 點通知之前），`priceRecalcPending > 0` 才渲染：
```tsx
<p className="price-soft-warn" style={{ margin: "0 0 8px" }}>
  ⚠ 重新擷取更新了成本，有 {priceRecalcPending} 款的售價還是空的；請按下方「依公式重算售價」重新計算，再按儲存。
</p>
```

### 6.2 `src/components/listing/ResultCard.tsx`
1. 型別：`:202` 見 §4.1。`:498` `excludedVariants` 不變（完整清單）。
2. 新 state `const [restoreAllBusy, setRestoreAllBusy] = useState(false);`。
3. `restoreExcludedVariant`（`:501-519`）成功分支 toast 改為：`payload?.price_unconfirmed ? "已加回這個款式（成本暫用商品成本，發布前請確認）" : "已恢復這個款式"`；其餘不變。
4. 新函式 `restoreAllSoldOutVariants`（放在 `restoreExcludedVariant` 後面，寫法比照它）：`POST /api/drafts/${draft.id}/excluded-variants/restore`，body `{ all: true, reason: "source_sold_out" }`；`setRestoreAllBusy` 包 try/finally；失敗 `showToast(payload?.error ?? "加回款式失敗", "error")`、連線失敗 `showToast("加回款式連線失敗", "error")`；成功 `showToast(\`已加回 ${payload.restored} 款（成本暫用商品成本，發布前請確認）\`, "success")` 然後 `scheduleRouterRefresh(() => router.refresh())`。
5. 新變數（放在 `excludedVariants` 附近）：
```ts
const priceRefreshSkuIds = useMemo(() => new Set(readPriceRefreshSkuIds(draft.raw_capture)), [draft.raw_capture]);
const priceRecalcPending = variantRows.filter((row) => isVariantRowFilled(row) && row.sourceSkuId && priceRefreshSkuIds.has(row.sourceSkuId) && !row.sellPrice.trim()).length;
```
   （`readPriceRefreshSkuIds` 從 `@/lib/import/refreshCapture` import。）
6. `<ResultCardSpecsPanel>`（`:3171` 起）多傳 `restoreAllBusy`、`onRestoreAllSoldOut={() => void restoreAllSoldOutVariants()}`、`priceRecalcPending`。

### 6.3 「來源售完」徽章 — `src/components/listing/VariantEditorRender.tsx`
`import { isSourceSoldOut } from "@/lib/variants/sourceStock";`，兩處、同一顆唯讀徽章（用既有 `rc-tag warned`；不新增 class）：
- **桌機**：`vgrid-sub` 的 `<span className="twd">`（`:585`）裡，`{formatVariantPriceLine(row, priceMode, { productCost })}` **後面**：
```tsx
{isSourceSoldOut(row) ? <>{" · "}<span className="rc-tag warned" title="來源網站這款已經沒有庫存（最近一次擷取的結果）">來源售完</span></> : null}
```
- **手機**：`v-mobile-price-cell--sell` 裡（`:466-469`），`v-mobile-price-value` 那個 `<span>` **後面**：
```tsx
{isSourceSoldOut(row) ? <span className="rc-tag warned" title="來源網站這款已經沒有庫存（最近一次擷取的結果）">來源售完</span> : null}
```
- 徽章純顯示：不可點、不影響庫存欄、不影響發布（STOCK 包才處理）。

---

## 7. Fixtures（Claude 已放好，**不要修改、不要重新產生**）

`scripts/fixtures/capture-fix/`（由老闆登入狀態存下的真實頁面裁出，已去掉圖片網址、tracking 屬性、cartParam／buyExParams、賣家與 token；只留 SKU 面板與 ICE 子集）：

| 檔案 | 內容 |
|---|---|
| `taobao1-sku-panel.html` | `#SkuPanel_tbpcDetail_ssr2025`：價格區（店鋪優惠後 48.9／優惠前 49.9／TWD 估價）＋ `#skuOptionsArea`，**保留翻譯後的繁體 DOM 與 `<font dir="auto">`**；4 個選項，選中＝賽亞人孫悟空，disabled＝貝吉塔 |
| `taobao1-ice-subset.json` | `skuBase`（pid 1627207，4 個 vid／skuId）＋ `skuCore`（`hideOtherPrice:"true"`、`sku2info` 只有 quantity 類欄位）＋ `componentsVO.priceVO`（49.9／48.9） |
| `tmall1-sku-panel.html` | 同結構，簡體；15 個選項，選中＝【色紙】瑞希（140*172mm），disabled 3 個；價格區 平台加补后 24.25／优惠前 25 |
| `tmall1-ice-subset.json` | 同上，15 款；`priceVO` 為 10 起／9.7 起 |

觀察值（測試期望值的唯一來源）：

**taobao1**（`colorPid=1627207`）：

| ICE 名（簡） | DOM 文字（繁） | vid | skuId | quantity | DOM |
|---|---|---|---|---|---|
| 弗利萨 | 弗利薩 | 120435789 | 6290326899775 | 2 | 一般 |
| 贝吉塔 | 貝吉塔 | 15854208 | 6290326899776 | **0** | `isDisabled`＋`data-disabled="true"` |
| 孙悟空 | 孫悟空 | 3910076 | 6290326899777 | 2 | 一般（有 `cornerText` 徽章） |
| 赛亚人孙悟空 | 賽亞人孫悟空 | 59400361 | 6290326899778 | 2 | `isSelected` |

`sku2info["0"]`：quantity 6。頁面顯示（選中 …778）：優惠前 49.9、店鋪優惠後 48.9；`priceVO` 49.9／48.9（沒有「起」）；`price_cny`（商品層）＝49.9。

**tmall1**（15 款，皆 `【…】`前綴，vid 依序 38011069350／…353／…355／…356／…357／…358／…359／…360／…361／38437122115／…116／…117／…118／…119／…120；skuId 依序 5784136669434／…437／…439／…440／…441／…442／…443／…444／…445／5802933752742／…743／…744／…745／…746／…747）：
- 選項順序與 quantity：隨機1包 200、隨機8包 148、整盒24包 49、奈奈生 27、**巴衛 0**、**奈奈生和巴衛A 0**、奈奈生和巴衛B 17、奈奈生和瑞希 84、巴衛和惡羅王 34、色紙奈奈生 44、色紙巴衛 11、**色紙瑞希 29（選中）**、鐳射票奈奈生 99、**鐳射票巴衛 0**、鐳射票瑞希 84。
- quantity 0 的 3 款＝DOM 的 3 個 `isDisabled`；`sku2info["0"]` quantity 200。商品層 `price_cny`＝10（`priceVO` 10 起）。

### fixtures → 頁面的組法（`verify:capture-fix` 共用，照抄）
```js
function buildPage(tag, mutate) {
  let panel = fs.readFileSync(FIX + tag + "-sku-panel.html", "utf8");
  if (mutate) panel = mutate(panel);
  const ice = JSON.parse(fs.readFileSync(FIX + tag + "-ice-subset.json", "utf8"));
  const body = { appData: null, loaderData: { home: { data: { res: ice } } } };
  return "<!doctype html><html><body>" + panel +
    "<script>!(function () {var a = window.__ICE_APP_CONTEXT__ || {};var b = " + JSON.stringify(body) + ";})();</script></body></html>";
}
```
點擊模擬 `installClickSim(document, { priceByVid, delay = 200 })`（寫法照 `scripts/verify-capture-interact.mjs` 的 `makeFixture`：假時鐘 `time`、`pending`、`wait(ms)`、`click` polyfill）：對每個 `[class*='valueItem--']` 加 click listener——取 `data-vid`（沒有就取 `data-sim-vid`）；記錄 `clicks[vid]++`；若節點有 `isDisabled--BhZbtUdR` 就不動；否則把所有選項的 `isSelected--_a9zOp7C` 拿掉，已選的再點＝取消，沒選的加上去並排一筆 `{ at: time + delay, value: priceByVid[vid] }`。`wait(ms)` 時間到了就改價格：每個 `.subPrice--KfQ0yn4v` 最後一個 `[class*='text--']` 的文字＝`value`；每個 `.highlightPrice--LlVWiXXs` 最後一個 `[class*='text--']`＝`value - 1`。
測試用價格（編的，只用在模擬）：taobao1 `{120435789: 49.9, 3910076: 55.5, 59400361: 60.1}`；tmall1 的 12 個非售完 vid 依序 `10, 11, 12, …, 21`（最低 10＝商品層 `price_cny`，不會觸發 `min_mismatch`）。

---

## 8. 測試：新檔 `scripts/verify-capture-fix.mjs`

- `package.json` 加 `"verify:capture-fix": "node scripts/verify-capture-fix.mjs"`（放在 `verify:workbench-ux` 後面）；`scripts/verify-all.mjs` 清單最後（`verify-workbench-ux.mjs` 後）加 `"scripts/verify-capture-fix.mjs"`，上方註解 `// CAPTURE-FIX: vid matching, dom_mismatch, source stock, sold-out exclusion, refresh.`
- 載入方式照 `scripts/verify-capture-interact.mjs:1-45`（`linkedom`、`NestoryCap` 腳本載入順序、`register(publish-guard-loader.mjs)`、`check()` 計數、失敗 `process.exitCode = 1`）。**用真模組，不准測複製出來的 mirror。**
- 每個案例一個 `check("CFnn …")`，編號固定：

**外掛（fixtures＋click 模擬＋假時鐘）**
- **CF01** fixtures 檔都存在；內容不含 `mi_id`、`cartParam`、`buyExParams`、`旗舰店`、`nick`、`sign=`；taobao1 面板含 `<font dir="auto"` 與 `顏色分類`；兩份 ICE 子集的 `hideOtherPrice` 為 `"true"` 且 `sku2info` 內沒有任何 key 符合 `/price/i`（`priceVO` 在 `componentsVO` 不算）。
- **CF02** `buildCapturePayload` taobao1：4 列，`source_stock_status` ＝ `["in_stock","sold_out","in_stock","in_stock"]`、`source_quantity` ＝ `[2,0,2,2]`；tmall1：15 列、3 列 `sold_out`（skuId …441／…442／…746），抽查 `5784136669434`→200、`5802933752744`→29；兩者 `cny_price` 全是 `null`。
- **CF03** `taobaoSkuNodes`：taobao1 回 1 軸 `顏色分類`、4 值，每值有 `vid`，貝吉塔 `disabled:true`、賽亞人孫悟空 `selected:true`；tmall1 1 軸、15 值、3 個 `disabled`、瑞希 `selected`。兩頁 DOM 的 `vid` 清單（順序也要）都**等於**各自 ICE `skuBase.props[0].values[].vid`（tmall1 的 15 款全部對得上）。
- **CF04** taobao1（翻譯 DOM）互動：`ok=3`、`sold_out=1`、`readable=3`、`status:"complete"`、`reasons:[]`、`requires_confirmation:false`；`rows` 狀態 `[ok, sold_out, ok, ok]`，`base` 為 `[49.9, null, 55.5, 60.1]`；`clicks["15854208"]` 為 `undefined`（售完款從沒被點）；三款 `price_source==="interact.selected_sku"`。
- **CF05** tmall1 互動：`targets=15`、`ok=12`、`sold_out=3`、`readable=12`、`complete`、`reasons:[]`；3 個售完 vid 沒被點；`elapsed_ms < 90000`。
- **CF06** vid 優先於文字：taobao1 把每個選項的 `title`／文字都改成 `?`（保留 `data-vid`）→ 仍 `ok=3`。
- **CF07** 位置比對：taobao1 把 `data-vid` 全部改名 `data-sim-vid`（DOM 數量 4＝ICE 4，文字仍是繁體；模擬器靠 `data-sim-vid` 認款）→ `ok=3`、`status:"complete"`，各款價格對得上 `priceByVid`。
- **CF08** 文字比對仍有效：用 `scripts/verify-capture-interact.mjs` 的簡體 `makeFixture`（沒有 vid、沒有 ICE skuBase）→ 行為與 `CI02` 相同（6/6 ok）。（可直接在新腳本複製該 helper。）
- **CF09** `dom_mismatch`：taobao1 拿掉所有 `data-vid`、`remove()` 第一個節點（DOM 3 ≠ ICE 4）、文字維持繁體 → `status:"aborted"`、`abort_reason:"dom_mismatch"`、`ok=0`、沒有任何點擊（`clicks` 為空）、非售完列都 `node_not_found`、`reasons` 含 `incomplete`、`requires_confirmation:true`；`dom_sample` 的 `labels`／`values`／`ice_labels`／`ice_values` 各 ≤5 筆、每筆 ≤40 字，且 `ice_labels` 等於 `["颜色分类"]`、`labels` 等於 `["顏色分類"]`。
- **CF10** 部分對得上不中止：同 CF09，但把「孫悟空」節點的 `title` 與文字改回簡體 `孙悟空` → `status:"partial"`、`abort_reason:null`、孙悟空 `ok`、弗利萨與赛亚人孙悟空 `node_not_found`、贝吉塔 `sold_out`。
- **CF11** 狀態規則：(a) 有售完款但其餘全 ok → `complete`、`reasons` 不含 `incomplete`；(b) taobao1 把每個 `.subPrice--KfQ0yn4v` 的文字改成 `優惠前 ￥49.9 起` → 3 個非售完款都 `timeout`、`ok:0`、`status:"partial"`、`reasons:["incomplete"]`、`requires_confirmation:true`（售完那款仍是 `sold_out`）；(c) 全部款都 `source_stock_status:"sold_out"` → `eligible` 為空：`complete`、`ok:0`、`readable:0`、`sold_out` 等於總數、完全沒點擊、不拋例外。
- **CF12** `shouldInteractSkuPrices`：兩列以上、無價的都是 `sold_out` → `false`；有一列無價且 `in_stock`／沒有欄位 → `true`；其餘條件（平台、≥2 款）照舊。
- **CF13** 標籤：商品層 `priceVO.extraPrice.priceTitle` 為「平台加补后」與「平台加補後」時，`price_candidates` 出現 `kind:"promo"`、`source:"ice.componentsVO.priceVO.extraPrice"`，且 `capture_meta.promo_price_cny===9.7`（用最小頁面：`priceVO.price` 10 起、`extraPrice` 9.7 起、`sku2info` 空、`skuBase` 空；沒改 `PROMO_LABEL_RE` 時兩者都不會出現）。
- **CF14** `capture.js` 收尾（用 `verify-capture-interact.mjs` 的 `captureWith` 寫法）：(a) `result:{ status:"aborted", abort_reason:"dom_mismatch", targets:4, ok:0, sold_out:1, readable:3, rows:[…] }` → `warnings_from_client` 含 `逐款讀價中止：頁面上的款式文字和資料對不上`，且**不含**「款沒讀到價格」；(b) 初始 payload 6 列都沒價（會觸發互動）；假的 `interactSkuPrices` 回寫 `variants_flat`：5 列有價、1 列 `source_stock_status:"sold_out"` 且無價，`result:{ status:"complete", targets:6, ok:5, sold_out:1, readable:5, rows:[…], reasons:[] }` → 「個別未優惠價未完整取得」被移除、沒有「沒讀到價格」；(c) 舊格式（沒有 `readable`）`rows` 含 1 個 `sold_out` ＋ `timeout` ＋ `over_limit` → 仍出現 `3 款沒讀到價格（來源缺貨 1、頁面沒反應 1、超過上限 1）`（即既有 CI13）。
- **CF15** `background.js`／版本（讀原始碼）：含 `status === "refreshed"` 分支與 `json.message`；`interactSuffix` 含 `款式全部來源售完`、`頁面文字對不上`；`selectors.js` 的 `CAPTURE_BUILD` ＝ `capture-20261020-capturefix1`；`manifest.json` 的 `version` ＝ `0.2.1`，且 `permissions` ＝ `["activeTab","scripting","storage"]`、沒有 `content_scripts`、沒有任何 `world` 字樣。

**匯入（真模組）**
- **CF16** `parseFlatSourceStock`／`readSourceStock`／`withSourceStock`／`isSourceSoldOut`：合法值、亂填值（`"x"`、數字當狀態）→ `null`；`quantity` 負數／小數／字串 → `null`；`withSourceStock(null, stock, names, values)` 帶出 names/values；`withSourceStock({names,values}, stock)` 保留原 names/values。
- **CF17** `mapCaptureToDraftFields`：用 taobao1 的 4 列（`variants_flat` 帶 `sku`、`source_stock_status`、`source_quantity`、`option*_name/_value` 取 ICE 簡體）→ `variantRows` 3 列、`excludedVariants` 1 筆且 `reason:"source_sold_out"`、`label:"贝吉塔"`；`rawCapture.server.excluded_variants[0].row.source_options.stock.status==="sold_out"`；`variantDimensions[0].values.join()` 不含 `贝吉塔`、`variantRows` 的 `option1_value` 也都不含；`warnings` 含 `已排除 1 款來源售完：「贝吉塔」（可在規格頁籤加回）`，且**不含**「非商品款式」。
- **CF18** 留下的 3 列 `source_options.stock` ＝ `{ status:"in_stock", quantity:2, checked_at:<receivedAt> }`；舊格式（`variants_flat` 沒有兩個新欄位）→ `source_options` 深比對等於 `{ names, values }`、不含 `stock` key、不排除任何款。
- **CF19** 全部售完：4 列都 `sold_out` → `variantRows` 4 列、`excludedVariants` 空、`warnings` 含 `WARNING_ALL_SOURCE_SOLD_OUT`、每列 `source_options.stock.status==="sold_out"`。
- **CF20** 假款式優先：一列 `勿拍` 且標 `sold_out`、其他正常 → 該列 `reason:"non_product_option"`（不是 source_sold_out）。混合時兩種警告各出現一次，互不混。
- **CF21** `interactRequiresConfirmation` 矩陣：新版 `{status:"complete",targets:15,ok:12,sold_out:3,readable:12,reasons:[],requires_confirmation:false}`→`false`；舊版 `{status:"partial",targets:4,ok:3,reasons:["incomplete"],requires_confirmation:true,rows:[{status:"sold_out"},{status:"ok"},{status:"ok"},{status:"ok"}]}`→`false`；舊版同上但 rows 有 `timeout`→`true`；`{status:"aborted",abort_reason:"dom_mismatch"}`→`true`；`{status:"complete",reasons:["all_identical"]}`→`true`；`{status:"partial",targets:2,ok:1,requires_confirmation:true}`（既有 CI14 形狀）→`true`；`{status:"complete",targets:2,ok:2,requires_confirmation:false}`→`false`；沒有 `interact`→`false`。
- **CF22** 旗標整合（body 形狀照 `verify-capture-interact.mjs` 的 `serverBody`，`price_debug.price_paths` 放 `hideOtherPrice: true`）：隱藏價格頁＋`interact` 完成（含 3 款被排除的售完）＋留下來的款全有 interact 價 → `price_requires_confirmation:false`、無 `WARNING_HIDDEN_VARIANT_PRICES`、無 `WARNING_INTERACT_NEEDS_CONFIRMATION`；留下來的款有一款缺價 → `true`。
- **CF23** 價格區間＋售完：頁面區間 `¥10-25`，留下 `[20,25]`、有被排除的售完款 → **不**標；留下 `[20,30]` → 標（`max` 超出）；沒有售完款的舊情境（`[20,25]` 對 `¥10-25`）→ 標（行為不變）。
- **CF24** 還原：`planRestoreExcludedVariant` 對 `source_sold_out` 條目 → `row.cny_price===null`、`row.cost_is_inherited===true`、`row.source_options.stock.status==="sold_out"`、SKU 重新指派；`planRestoreAllExcludedVariants(reason:"source_sold_out")` 一次還原所有售完條目、`remaining` 只剩 `non_product_option` 的、`dimensions` 補回值；有重名 → `ok:false` 且不產生部分結果；沒有可還原 → 404。
- **CF25** restore route 原始碼：只 export `POST`；含 `source_sold_out`、`price_requires_confirmation`、`variant_price_confirmed_at`、`restored`、`price_unconfirmed`、`不支援的加回類型`。

**重新擷取（真模組 `refreshCapture.ts`＋假資料庫）**
- 假資料庫 `makeFakeDb({ draft, variants })`：支援且僅支援 §5.3 的四條呼叫鏈，記錄 `updates: [{ table, id, patch }]`；可注入錯誤。
- **CF26** 價格規則（a）：未上架＋未確認；v1（inherited、未鎖）flat 價 20 `interact.selected_sku`→ `cny_price:20, cost_is_inherited:false, twd_price:null, compare_at_price:null`；v2（`cost_is_inherited:false`）flat 價 25 → **patch 不含任何價格欄位**；v3（inherited、`sell_price_locked:true`、`twd_price:777`）flat 價 40 → `cny_price:40, cost_is_inherited:false`，patch **沒有** `twd_price` 這個 key；v4（inherited）flat 價 50 但 `price_source:"dom.selected_sku"` → 不更新；另一個對不到的 sku 被忽略；`prices===2`。
- **CF27** 略過：`shopify_product_id` 有值 → `prices===0`、`priceSkippedReason:"published"`、庫存照更新；`variant_price_confirmed_at` 有值 → `"confirmed"`；沒有任何可更新的價格時 `priceSkippedReason===null`（即使已上架）。
- **CF28** 庫存（b）：新狀態寫進 `source_options.stock`，保留原 `names/values`（`source_options` 為 `null` 時用款式欄位補 names/values）；`unknown` 不蓋掉已知；狀態與數量都沒變 → 不產生 patch、`stock` 不計；已上架草稿也會更新庫存。
- **CF29** 旗標（c）：舊旗標 `true`、更新後所有留下的款（排除 `sold_out` 的）都 `cost_is_inherited:false` → 旗標變 `false`、`draft.warnings` 與 `server.warnings` 裡 4 種字串被移除、其他警告保留；仍有一款 inherited 且 `in_stock` → 旗標與警告都不動；那一款若 `sold_out` → 視為已解決；`draft.cny_price===0.01`（placeholder）或 `price_confidence==="conflict"` → 不動；`prices===0` → 完全不動。`draftPatch.raw_capture.server.price_refresh.source_sku_ids` ＝ 實際更新的 sku；`readPriceRefreshSkuIds` 讀得回來。
- **CF30** 訊息與整合：`formatRefreshMessage` 六種組合字串與 §5.2-8 完全一致；`refreshExistingCaptureDraft`：成功 → 回物件且 DB 寫入順序＝款式（依序）→ 草稿；`prices===0&&stock===0` → `null` 且零寫入；讀取錯誤／款式寫入錯誤／丟例外 → `null`、不丟出、錯誤時不寫草稿；原始碼斷言：`createCaptureDraft.ts` 在 `refill` 為 `null` 之後呼叫 `refreshExistingCaptureDraft`、route.ts 對 `refreshed` 回 200 且不跑 `after(`；`refreshCapture.ts` 不含 `product_images`、`.delete(`、`.insert(`、`graphql`、`fetch(`、`syncShopifyProduct`、`productVariants`（不分大小寫）。

**UI（讀原始碼）**
- **CF31** `ResultCardSpecsPanel.tsx`：含 `已排除 ${`、`款來源售完`、`加回`、`全部加回`、`priceRecalcPending`、`reason !== "source_sold_out"`、`reason === "source_sold_out"`；新區塊用到的每個 className（`vc-excluded`、`vc-note`、`vc-list`、`vc-excluded-row`、`vc-excluded-label`、`vc-toolbar`、`price-soft-warn`）都在 `globals.css` 找得到 `.` + 名稱；`VariantEditorRender.tsx` 含 `isSourceSoldOut(` 兩處、`rc-tag warned` 兩處、`來源售完`；`globals.css` 不含 `source-sold`／`capture-fix` 字樣；`ResultCard.tsx` 含 `restoreAllSoldOutVariants`、`readPriceRefreshSkuIds`、`all: true, reason: "source_sold_out"`。
- **CF32** 回歸：以子行程跑 `verify-capture-interact.mjs`、`verify-cap2.mjs`、`verify-price-guard.mjs`、`verify-variant-clean.mjs`、`verify-publish-guard.mjs`、`verify-cap1.mjs`，全部 exit 0（寫法照 `verify-capture-interact.mjs` 的 `CI16`）。

### 既有測試的影響（GPT 必讀）
- 只允許改 `verify-cap2.mjs:215`（build 字串）。其他既有案例**必須原樣通過**：`CI05`（`sold_out`／`disabled` 計數；它的 fixture 沒有新欄位，走「欄位沒有才看 ICE quantity」）、`CI13`（舊格式 `result` 沒有 `readable`）、`CI14`（`interact` 沒有 `rows`）、`verify-variant-clean.mjs:451`（`source_options` 深比對）。

---

## 9. 施工規則

- commit 訊息：`feat(capture-fix): …`／`fix(capture-fix): …`／`test(capture-fix): …`；分段建議：① 外掛 §3 ② 型別＋匯入 §4 ③ 重新擷取 §5 ④ UI §6 ⑤ 測試與 fixtures 登錄 §8。
- 不新增 `!important`、不動 `globals.css`、不新增 class；`src/app/api/**/route.ts` 只能 export HTTP method。
- 外掛檔（`extension/**`）維持 ES5 `var`／`function` 寫法與既有縮排，不用 ES module、不加 `fetch`。
- 不改 `src/lib/shopify/**`、不改 `publishReadiness.ts`、不加 migration、不 deploy、不合併 PR。
- PR 說明列：改了哪些檔、§8 每個 CF 對應的 check 名稱、沒跑過的驗證（GPT 無法執行 npm 要明講）、任何偏離規格的地方＋理由。回報格式：CF-EXT／CF-IMP／CF-REF／CF-UI／CF-TEST 各改了什麼。

## 10. 指揮官驗收＋老闆更新步驟（Claude）

**Claude 本機**：`npx tsc --noEmit`、`node scripts/verify-capture-fix.mjs`、`npm run verify:all`、`npm run build`；逐條對 §3–§6；`git diff --stat` 確認沒碰 `globals.css`、`src/lib/shopify/**`、`supabase/`。

**老闆更新外掛步驟（原文放進 `extension/README.md` 的「更新外掛版本」）**
1. 把新版 `extension` 資料夾裡的檔案，複製、覆蓋進你現在 Chrome 載入的那個外掛資料夾（覆蓋前先把舊資料夾複製一份當備份）。
2. 打開 Chrome，網址列輸入 `chrome://extensions` 按 Enter。
3. 找到「Nestory 商品擷取」，按它的「重新載入」（圓形箭頭）。版本顯示 **0.2.1** 就完成了；API 網址和擷取 Token 會保留，不用重填。
4. 測試：到任一淘寶或天貓商品頁按一下圖示。**抓之前請先把瀏覽器的自動翻譯關掉**（網址列右邊的翻譯圖示 → 不要翻譯這個網站；翻譯外掛也一樣）。新版就算頁面被翻譯也找得到款式，但翻譯可能讓價格顯示不跟著更新，關掉最穩。看到頁面右上角提示有「逐款讀價」就是新版在跑。
5. （備用）也可以把新版放到新資料夾，用「載入未封裝項目」載入；這樣外掛會變成新的一個，要重新填 **API 網址**和**擷取 Token**（Token 找不到就到 Nestory 設定頁「重新產生」），並把舊的那個「移除」。

> Claude 註：本次由 Claude 在老闆同意後，直接把新版覆蓋到老闆目前載入的資料夾（`C:/Users/s2491/Documents/Nestory外掛-0.2.0`，先備份成 `Nestory外掛-0.2.0-備份`），老闆只做第 2–4 步。

**老闆實機驗收（Claude 引導）**
- 用兩個存檔對應的商品重抓（taobao 1076251328835、tmall 915722142018）：兩者都應顯示 `逐款讀價 x/y`；草稿規格頁籤出現「已排除 N 款來源售完」（taobao 1 款、tmall 3 款）；留下的款成本各自不同、沒有「淘寶隱藏了各款價格」警告。
- 重抓一個已建好的舊草稿網址：圖示提示「已更新 N 款…」；已上架的商品只更新庫存狀態並顯示「來源售完」徽章。
- （選做）開著瀏覽器翻譯再抓一次：款式應該都找得到（用 vid，不再整排 `node_not_found`）；若翻譯讓價格顯示不更新，結果應是「需確認」而**不是錯價**。`dom_mismatch` 只會在頁面完全沒有 `data-vid` 且數量對不上時出現（Claude 事後查 `raw_capture.client_meta.interact` 確認）。

## 11. 已知限制（不是 bug，別去修）
- 重新擷取更新價格後，伺服器只寫成本並清空未鎖定的售價；售價要在卡片用「依公式重算售價」算（匯率只存在每台裝置）。清空的售價會被既有的 `VARIANT_NO_PRICE` 擋板擋住發布，直到重算並儲存。
- 重新擷取時，如果有人同時開著舊的卡片沒重新整理就按儲存，卡片的舊 `source_options` 會蓋掉剛更新的庫存狀態；下次重新擷取會補回。
- 舊版外掛 0.2.0 不會送 `source_stock_status`，所以不會排除售完款，也不會更新庫存狀態。
- 加回的售完款成本沿用商品成本（可能低估），所以一律標「需確認」。
- 排除售完款後若只剩 1 款，商品仍是帶 1 個選項值的規格商品（沿用既有行為）。
