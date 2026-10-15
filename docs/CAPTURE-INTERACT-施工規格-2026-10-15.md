# CAPTURE-INTERACT 施工規格（總表 0.6：外掛逐款點選讀價）— 2026-10-15

> 主線基準：`origin/handoff/20261008-golive-spec` @ **6020242**（#51 VARIANT-CLEAN＋#52 PRICE-GUARD 已合併）。
> 行號以 6020242 為準；動手前先 `git fetch` 確認主線沒有再前進，有的話以實際行號為準。
> 本包**只做淘寶／天貓的「逐款價格」**。自動捲到底、问大家、廣告 DOM 過濾（總表 4a）和庫存（總表 4b STOCK）**不在本包**。

---

## 0. 一句話

淘寶／天貓頁面把各款價格藏起來（`hideOtherPrice=true`）時，外掛**自己逐一點每個款式、讀頁面上顯示的「優惠前」價格**，點兩輪互相驗證，讀得到就當該款成本；讀不到或對不上就照現在 PRICE-GUARD 的規矩標「需確認」。寧可多等幾秒，不准猜價。

---

## 1. 現況（Claude 已查證）

### 1.1 外掛現在怎麼抓價（全部是「讀」，從不點擊）

| 步驟 | 位置 | 行為 |
|---|---|---|
| 注入 | `extension/background.js:7-17, 260-263` | 工具列按一下 → `chrome.scripting.executeScript` 依序注入 `lib/*` ＋ `content/capture.js`（ISOLATED world），等它回傳 payload 再 POST `/api/import/product-page` |
| 進入點 | `extension/content/capture.js:64-128` | `buildCapturePayload()`；淘寶系詳情圖不足 5 張時每 300ms 重抓、最多等 2.4 秒。**這是唯一會等待的地方** |
| 商品價 | `taobao.js:1190 extractPrices()` | 讀 DOM 價格區（`优惠前`→成本、`券后/店铺优惠后`→促銷） |
| 頁面資料 | `taobao.js:1041 parseIceAppContext()` | 讀 `<script>` 內 `__ICE_APP_CONTEXT__`（伺服器端渲染時的靜態 JSON，**點款式後不會更新**） |
| 款式價 | `taobao.js:1091 iceSkuFromRes()` → `:283 structuredSkuPrices()` | 每款價格只從 `skuCore.sku2info[skuId]` 的 price 類欄位讀 |
| 款式節點 | `taobao.js:825 extractSkuFromRoot()` | DOM 款式軸／值（只讀文字和縮圖，不看選取／停用狀態） |
| 起價 | `taobao.js:1479-1507` | 商品成本＝各款結構化價最低值；沒有就用 `priceVO.price`（`优惠前 … 起`） |
| 單款補值 | `taobao.js:1455-1477` | 網址帶 `skuId` 時，把畫面價格填給「那一款」（`price_source="dom.selected_sku"`） |
| 缺價警告 | `taobao.js:1438-1445` | 任何一款沒價 → `"sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格"` |
| 版本 | `extension/lib/selectors.js:9` | `CAPTURE_BUILD = "capture-20261011-r6"` |

### 1.2 hideOtherPrice 的真實情況（正式 DB 抽查 10-14 事故 3 筆 raw_capture）

- `res.skuCore.skuItem.hideOtherPrice = "true"`。
- `sku2info[skuId]` 的 key 只剩 `moreQuantity, quantity, logisticsTime, limit, quantityDisplayValue, cartParam, quantityText, buyExParams`——**完全沒有 price**。
- 商品層只有 `componentsVO.priceVO.price`（`优惠前 169 起`）和 `extraPrice`（`店铺优惠后 129 起`）。
- 結果：每一款 `cny_price=null` → 外掛有警告 → 但當時後端沒擋、卡片又把「沿用」存成「已確認」→ 8 筆全同價上架（PRICE-GUARD #52 已補後端與卡片的洞）。
- 結論：**ICE 裡根本沒有各款價格，只能靠「選了那一款之後頁面顯示的價格」**。淘寶在選款後才顯示（推測會向淘寶另外要資料，所以畫面更新可能延遲 0.3–2 秒）。

### 1.3 後端現在怎麼吃（PRICE-GUARD 已上）

- `src/lib/import/mapCaptureFields.ts:537-562`：`price_source` 以 `dom.` 開頭的款式價**不算**「有自己的價」；`captureHidesVariantPrices()`（`src/lib/import/captureHiddenPrices.ts:38-47`）判定隱藏 → `price_requires_confirmation=true`＋警告「淘寶隱藏了各款價格，所有款式暫用最低價；發布前請逐款確認成本」。
- `src/lib/shopify/publishReadiness.ts:273-283` `hiddenPricesWithIdenticalCosts()`：有隱藏證據＋全部同價 → 發布擋（可確認）。**本包不准改這個保險**。
- `src/lib/import/captureVariantPrice.ts keepOrInheritVariantCny()`：有 `price_source` 的款式價一律保留為明確值。

---

## 2. 目標行為（老闆看得到的）

1. 抓一個淘寶／天貓商品，若 ICE 已有各款價格 → **跟現在一模一樣，不點、不變慢**。
2. 若有款式沒有價格（hideOtherPrice 或其他原因）→ 頁面右上角提示變成 `⏳ 逐款讀價 3/12…`，外掛自動在頁面上一款一款點，點兩輪。
3. 全部讀到且兩輪一致 → 草稿每款成本各自不同，**不再出現「淘寶隱藏了各款價格…」警告**，不需要逐款確認。
4. 有任何一款讀不到／兩輪不一致／被時間上限截斷 → 讀到的款照填，讀不到的維持空白，草稿照現在 PRICE-GUARD 標「需確認」，並多一行說明哪幾款沒讀到。
5. 最後提示：`✓ 已擷取：<標題>（逐款讀價 12/12）`；部分成功 `（逐款讀價 9/12，3 款請確認）`。

---

## 3. 施工範圍

### 3.1 新檔 `extension/lib/interactSku.js`（核心）

IIFE 寫法與其他 lib 相同（`(function (root) { … })(globalThis)`，掛 `NestoryCap.interactSkuPrices`，並 `module.exports` 給 node 測試）。**不准用任何 npm 套件、不准 fetch、不准讀寫 cookie／storage**。

```
NestoryCap.interactSkuPrices(doc, payload, opts) → Promise<InteractResult>
opts = {
  host,                       // location.hostname
  onProgress(done, total),    // 可選；capture.js 用來更新提示＋喚醒 service worker
  wait(ms) → Promise,         // 預設 setTimeout；測試注入假時鐘
  now() → number,             // 預設 Date.now
  limits: { maxCombos: 40, maxTotalMs: 90000 }   // 見 §6 決策 1
}
```

#### A. 何時啟動（`capture.js` 判斷，見 3.2）
`payload.source_platform` 是 `taobao` 或 `tmall`，且 `payload.variants_flat` 中至少一列 `cny_price == null`，且 `variants_flat.length >= 2`。單款或全部已有價 → 不呼叫。

#### B. 要點哪些款（targets）
- 只點 `cny_price == null` 的列。已有結構化價的列**不點、不改**。
- 列的 `sku`（淘寶 skuId）若在 ICE `sku2info[sku].quantity` 讀得到且數值為 0 → 不點，記 `status:"sold_out"`。（ICE 由 `parseIceAppContext` 取得；請把 `parseIceAppContext`／`iceResFromContext` 以 `NestoryCap.adapters.taobaoIce = { parse, res }` 匯出，不要複製一份。）
- targets 超過 `maxCombos` → 只點前 `maxCombos` 列（依 variants_flat 原順序），其餘 `status:"over_limit"`。

#### C. 找款式節點
新增匯出 `NestoryCap.adapters.taobaoSkuNodes(doc, host)`（寫在 `taobao.js`，**與 `extractSkuFromRoot` 共用同一組 selector 與同一個取字規則**；建議把 `extractSkuFromRoot` 裡「取值文字」那段抽成內部函式 `skuValueText(n, dom)` 兩邊共用，不得改變 `extractSkuFromRoot` 的輸出）：

```
[{ label: "顏色分類", values: [{ text, node, disabled, selected }] }, …]
```
- `selected`：`className` 符合 `/isSelected|selected|active|checked/i`，或 `aria-checked="true"`／`aria-selected="true"`。
- `disabled`：`className` 符合 `/isDisabled|disabled|soldOut|sold-out/i`，或 `aria-disabled="true"`。（fixture `tmall-ssr2025-sku.html` 已有 `isDisabled--BhZbtUdR`）
- 每次「點之前」都重新呼叫取節點（React 會重繪，舊節點可能失效）。

對應規則（列 → 節點）：第 d 軸先用 `option{d}_name` 比 `label`（去掉結尾冒號、去空白後完全相同），比不到再用位置 d；值用 `option{d}_value` 比 `text` 完全相同，比不到再比「去掉所有空白」後相同。仍找不到 → 該列 `status:"node_not_found"`。
**注意**：`variants_flat` 的 option 值是**外掛原始文字**（款式整理在伺服器端 `cleanVariantRows` 才做），所以可以直接比。

#### D. 選一款（selectCombo）
對該列的每一軸依序：
1. 重新取節點；目標值 `selected` → 跳過（**已選的不准再點，淘寶再點一次會取消選取**）。
2. 目標值 `disabled` → 整列 `status:"disabled"`，換下一列。
3. `node.click()`；每 100ms 檢查一次，最多 800ms 等它變 `selected`。
4. 沒變 → 依序 dispatch `pointerdown`、`mousedown`、`pointerup`、`mouseup`、`click`（`bubbles:true, cancelable:true, view: doc.defaultView`），再等最多 800ms。
5. 還是沒變 → 該列 `status:"click_failed"`。**連續 3 列 click_failed → 整個逐款讀價中止**（`result.status="aborted"`，`abort_reason:"click_failed"`），其餘未點列 `status:"not_run"`。

#### E. 讀價（readSettledPrice）
在 `taobao.js` 新增匯出 `NestoryCap.adapters.taobaoReadPrice(doc, host)`：內部呼叫既有 `extractPrices(doc, S, dom)`，另外回傳價格區原文：
```
{ base, promo, text }   // base = extractPrices().price_cny；promo = promo_price_cny；text = S.price 第一個節點往上找最多 3 層父元素的 textContent（去多餘空白，截 200 字）
```
選完一款後：
1. 先等 **500ms**（最少等待，避開「畫面還是上一款」）。
2. 之後每 100ms 讀一次；當**連續 4 次（≈300ms）`base`、`promo`、`text` 完全相同**，且 `text` **不含「起」字** → 視為穩定，取這次結果。
3. 從點擊起算 3000ms 還沒穩定 → `status:"timeout"`。
4. 穩定但 `base == null`（例如只看到促銷價）→ `status:"promo_only"`，不填成本。
5. `base` 必須是 >0 的有限數字，否則 `status:"no_price"`。

#### F. 兩輪驗證
- **第一輪**依原順序讀一遍；**第二輪**用**反向順序**再讀一遍（同一列前後鄰居不同，畫面延遲造成的「讀到上一款的價」會兩輪不一致）。
- 兩輪 `base` 用 `pricesClose`（`taobao.js:25`，請一併匯出）判斷一致 → `status:"ok"`，成本取第二輪值。
- 不一致 → 該列再單獨重讀一次，最少等待改 **1500ms**；重讀值與兩輪任一值一致 → `ok`（取重讀值），否則 `status:"mismatch"`。
- 第一輪就失敗（timeout／click_failed／…）的列，第二輪不再點。
- 時間：每點完一列檢查 `now() - start > maxTotalMs` → 停，剩下的列 `status:"over_limit"`，`result.status="partial"`。

#### G. 回寫 payload（只改 `cny_price == null` 的列）
`status:"ok"` 的列：
```
cny_price          = 讀到的 base
promo_price_cny    = 讀到的 promo（與 base 不同時；否則 null）
price_source       = "interact.selected_sku"      // 不可以 dom. 開頭，否則後端不算數
promo_price_source = promo 有值時 "interact.selected_sku.promo"
price_confidence   = "interact_verified"
price_candidates   = 原陣列 concat [{ source:"interact.selected_sku", kind:"base", value: base }]
```
其餘列一律**不動**（維持 `cny_price:null`）。

#### H. 一致性檢查 → `requires_confirmation`
以下任一成立 → `result.requires_confirmation = true`，並附對應 `reasons`（字串代碼）：
| 代碼 | 條件 |
|---|---|
| `incomplete` | 有任何 target 列不是 `ok`（含 sold_out／over_limit） |
| `all_identical` | `ok` 的列 ≥2 且**全部**價格 pricesClose 相同（最像「一直讀到同一個畫面」） |
| `min_mismatch` | `payload.price_cny` 有值，且「全部款式（原本有價＋讀到的）最低值」與它不 pricesClose |

#### I. 回傳
```
InteractResult = {
  version: 1,
  status: "complete" | "partial" | "aborted",
  abort_reason: null | "click_failed" | "no_sku_nodes",
  targets: 12, ok: 9, elapsed_ms: 23140,
  requires_confirmation: true, reasons: ["incomplete"],
  rows: [{ sku: "6117127890619", label: "粉色／大號", status: "ok", base: 189, promo: 159, pass1: 189, pass2: 189 }, …]   // 最多 60 筆，label 截 60 字
}
```
`taobaoSkuNodes` 回空陣列 → `status:"aborted"`, `abort_reason:"no_sku_nodes"`，不點任何東西。

### 3.2 `extension/content/capture.js`

在現有 `return payload;`（:122）**之前**、詳情圖等待之後加入：
1. 判斷 §3.1-A 的條件；成立才跑 `await NestoryCap.interactSkuPrices(document, payload, {...})`。整段包 `try/catch`；例外 → 不影響原 payload，`capture_meta.interact = { version:1, status:"aborted", abort_reason:"threw", message }`。
2. `onProgress(done, total)`：
   - 呼叫 `globalThis.__nestoryShowCaptureToast("⏳ 逐款讀價 " + done + "/" + total + "…", "loading")`。`total` = 兩輪合計要讀的次數，`done` = 已讀次數。
   - `chrome.runtime.sendMessage({ type: "NESTORY_CAPTURE_PROGRESS" })`（包 try/catch、忽略回應）——作用是讓 MV3 service worker 不會在長時間等待中被回收。
3. 跑完：
   - `payload.capture_meta.interact = result`（`rows` 照 §3.1-I）。
   - 若所有列都有 `cny_price` 了 → 從 `capture_meta.warnings_from_client` 移除「`sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格`」那一行（完全相同字串比對）。
   - 若 `result.ok < result.targets` → 加一行 warning：`"逐款讀價：" + (targets-ok) + " 款沒讀到價格（" + 各原因中文彙總 + "），請逐款確認"`。原因中文：sold_out=來源缺貨、over_limit=超過上限、timeout=頁面沒反應、click_failed=點不到、node_not_found=找不到款式按鈕、disabled=無法選取、promo_only=只看到促銷價、no_price=沒有價格、mismatch=兩次讀到不同、not_run=中止未讀。彙總格式：`來源缺貨 2、頁面沒反應 1`。
   - `reasons` 含 `all_identical` → 加 warning `"逐款讀價：每款讀到的價格都一樣，可能沒讀到真正價格，請逐款確認"`。
   - `reasons` 含 `min_mismatch` → 加 warning `"逐款讀價：最低款 ¥" + 最低值 + " 和頁面起價 ¥" + payload.price_cny + " 不同，請確認"`。
   - `payload.price_cny == null` 且有讀到價 → `payload.price_cny = 最低值`、`capture_meta.price_source = "interact.min_sku_price"`、`capture_meta.price_confidence = "structured_min"`。**`payload.price_cny` 已有值時不准改它。**
4. 不准改變：詳情圖等待邏輯、Shopee／一般官網流程、`__nestory_error` 回傳格式。

### 3.3 `extension/background.js`

1. `CAPTURE_FILES`（:7-17）在 `lib/adapters/taobao.js` 之後、`lib/buildPayload.js` 之前加入 `"lib/interactSku.js"`。
2. `chrome.runtime.onMessage` listener（:410）加：`msg.type === "NESTORY_CAPTURE_PROGRESS"` → `sendResponse({ ok: true })`，不做別的事。
3. 成功提示（:352 `created`、`updated` 那段）字尾加上逐款結果，用新函式 `interactSuffix(payload)`：
   - 沒有 `capture_meta.interact` → `""`
   - `ok === targets` → `"（逐款讀價 " + ok + "/" + targets + "）"`
   - 否則 → `"（逐款讀價 " + ok + "/" + targets + "，" + (targets-ok) + " 款請確認）"`
   - 例：`✓ 已擷取：大耳狗天使燈（逐款讀價 9/12，3 款請確認）`。`exists`／錯誤提示不加。
4. `setLastResult` 的 `line` 同樣加上這段字尾。

### 3.4 `extension/lib/selectors.js`

只改 `CAPTURE_BUILD = "capture-20261015-interact1"`。selector 陣列**不准改**。

### 3.5 `extension/manifest.json`

`version` 改 `"0.2.0"`。權限**不准新增**（點擊只用既有 `activeTab`／`scripting`）。

### 3.6 後端（小）

1. `src/lib/import/captureTypes.ts`
   - `CaptureVariantFlat.price_confidence`（:19）加 `"interact_verified"`。
   - `CaptureMeta` 加：
     ```ts
     /** CAPTURE-INTERACT: extension clicked each variant and read the displayed price. */
     interact?: {
       version?: number;
       status?: "complete" | "partial" | "aborted";
       abort_reason?: string | null;
       targets?: number;
       ok?: number;
       elapsed_ms?: number;
       requires_confirmation?: boolean;
       reasons?: string[];
       rows?: Array<{ sku?: string | null; label?: string; status?: string; base?: number | null; promo?: number | null; pass1?: number | null; pass2?: number | null }>;
     } | null;
     ```
2. `src/lib/import/captureHiddenPrices.ts`：新增並匯出
   ```ts
   export const WARNING_INTERACT_NEEDS_CONFIRMATION =
     "外掛逐款讀價沒有全部確認，發布前請逐款確認成本";
   export function interactRequiresConfirmation(clientMeta: unknown): boolean
   ```
   `clientMeta.interact.requires_confirmation === true` 或 `clientMeta.interact.status` 是 `"partial"`／`"aborted"` → true。其餘（含沒有 interact）→ false。
3. `src/lib/import/mapCaptureFields.ts`（緊接 :546-562 PRICE-GUARD 區塊之後）：
   - `variantRows.length >= 2 && interactRequiresConfirmation(body.capture_meta)` → `priceRequiresConfirmation = true`；`priceConfidence` 非 `"conflict"` 時改 `"needs_confirmation"`；`warnings` 與 `serverPriceWarnings` 加 `WARNING_INTERACT_NEEDS_CONFIRMATION`（若 `hiddenVariantPrices` 已經加過 `WARNING_HIDDEN_VARIANT_PRICES` 也照加，兩句意思不同）。
   - **價格區間交叉檢查**：從 `capture_meta.price_debug.price_paths` 取第一個符合 `PRICE_RANGE_RE` 的字串（可用現有 `textHasPriceRange` 同一條 regex，請把解析 low/high 的部分抽成 `publishReadiness.ts` 匯出的 `parsePriceRange(text): {low, high} | null`，不要複製 regex）。若有區間、且所有款式 `cny_price` 都非 null、且 `min/max` 與 `low/high` 任一端差距 > `max(0.5, 1.5%)` → 同上標需確認，warning 用 `"外掛讀到的款式價格 ¥{min}–{max} 和頁面價格區間 ¥{low}–{high} 對不上，請逐款確認"`。
   - `price_source` 以 `interact.` 開頭的列**算**「有自己的價」（現有 `/^dom./` 規則自然成立，不用改，但請加測試鎖住）。
4. **不准改**：`publishReadiness.ts` 的 `hiddenPricesWithIdenticalCosts`、`checkPublishReadiness` 任何擋板邏輯；`createCaptureDraft.ts` 的 exists／refill 行為（見 §6 決策 4）；資料庫 schema（**本包沒有 migration**）。

### 3.7 UI

**本包不新增、不修改任何網頁 UI**（不動 `src/app/**`、`src/components/**`、CSS）。老闆看到的變化只有：外掛頁面提示文字、草稿既有的警告清單多／少幾行字。規格沒寫到的 UI 一律不准做，有疑問先停下回報。

---

## 4. 測試（新增 `scripts/verify-capture-interact.mjs`，加進 `package.json` 的 `verify:capture-interact`，並加入 `scripts/verify-all.mjs` 清單）

用 linkedom（verify-cap2 已在用）建假的淘寶頁：款式面板節點 class 用 `valueItem--x`／`isSelected--x`／`isDisabled--x`，價格區用 `subPrice--x`（优惠前）＋`highlightPrice--x`（券后）。在測試裡對節點 `addEventListener("click")` 模擬淘寶行為，用注入的假時鐘 `opts.wait/now` 跑（測試不准真的 sleep 超過 1 秒）。若 linkedom 沒有 `HTMLElement.prototype.click`，在測試裡 polyfill 成 `dispatchEvent(new Event("click", {bubbles:true}))`，**不准**為了測試改產品程式的點擊寫法。

至少要有這些案例（每個一個 `check()`）：
1. ICE 已有各款價 → `interactSkuPrices` 不被呼叫（測 capture.js 的啟動條件函式；請把條件抽成 `NestoryCap.shouldInteractSkuPrices(payload)` 方便測）。
2. 2 軸 3×2＝6 款，點後 200ms 更新價格 → 6/6 ok、每款價格正確、`price_source="interact.selected_sku"`、`requires_confirmation=false`。
3. **延遲 900ms 才更新**（> 500ms 最少等待）→ 第一輪會讀到上一款，兩輪不一致 → 重讀後 ok；若模擬永遠延遲 2000ms，則該列 `mismatch`。
4. 已選的值不會被再點（模擬「再點一次會取消選取」→ 最終價格仍正確）。
5. `isDisabled` 值 → `disabled`；`sku2info.quantity=0` → `sold_out` 且沒被點過。
6. 點了不會變 selected → `click_failed`；連續 3 列 → `aborted`，其餘 `not_run`。
7. 價格區一直含「起」→ `timeout`。
8. 只有券后沒有优惠前 → `promo_only`，`cny_price` 仍 null。
9. 所有款讀到同一價 → `reasons` 含 `all_identical`。
10. 最低值和 `payload.price_cny` 不同 → `min_mismatch`。
11. `maxCombos=3`、6 款 → 3 款 `over_limit`、`status="partial"`；`maxTotalMs` 用假時鐘觸發同樣結果。
12. 原本已有價的列不被改動（mixed：3 款有 sku2info 價、3 款沒有）。
13. capture.js 收尾：全部讀到 → 移除「個別未優惠價未完整取得」警告；部分 → 加「逐款讀價：N 款沒讀到價格（…）」且原因彙總文字正確。
14. 後端：`mapCaptureToDraftFields` 吃「hideOtherPrice＋全部 interact.ok」→ `price_requires_confirmation=false`、無 `WARNING_HIDDEN_VARIANT_PRICES`；吃 `interact.status="partial"` → `true`＋`WARNING_INTERACT_NEEDS_CONFIRMATION`；價格區間對不上 → `true`＋區間 warning。
15. 回歸：`hiddenPricesWithIdenticalCosts` 行為不變（hideOtherPrice＋全部同價仍擋）。
16. 回歸：`verify:cap2`、`verify:price-guard`、`verify:variant-clean`、`verify:publish-guard` 全過，且 `extractSkuFromRoot` 對既有 fixture 的輸出與改動前完全相同。

---

## 5. 驗收（Claude 本機＋老闆實機）

- Claude：`npx tsc --noEmit`、`npm run verify:all`、`npm run build` 全過；逐條對 §3、§4。
- 老闆實機（GPT 做不到，要老闆在自己的 Chrome）：Claude 把新版外掛資料夾放好 → 老闆在 `chrome://extensions` 按「重新載入」→ 抓下面 3 個 10-14 事故商品的淘寶頁（新網址或先刪舊草稿，見 §6 決策 4）：
  - 大耳狗天使燈（實際 169–338）、兒童數碼相機（329–418）、寶可夢（10.9–189.9）。
  - 通過標準：提示有出現 `逐款讀價 x/y`；草稿各款成本與淘寶頁面逐款點選看到的「优惠前」一致（抽 3 款）；沒有「淘寶隱藏了各款價格」警告；總時間 12 款內 ≤ 45 秒（見 §9）。
- 再抓 1 個**沒有**隱藏價格的商品，確認速度與結果跟以前一樣（沒有逐款讀價提示）。

---

## 6. 需要老闆拍板（規格內已先寫「建議值」）

1. **上限**：最多點幾款／最多等幾秒？建議 **40 款、90 秒**（兩輪×每次約 0.7 秒，12 款約 20 秒、40 款約 60 秒）。超過的款留空白＋標需確認。
2. **觸發時機**：建議**只在有款式缺價時才點**（平常的商品速度不變）。另一選項是「每次都點來核對」——更保險但每個商品都多等 10–60 秒。
3. **讀到的價要不要還得人工確認**：建議**兩輪一致＋最低價對得上起價＋（有區間時）對得上區間 → 直接採用，不用再確認**；任何一項不過才標需確認。發布前「隱藏價格＋全部同價就擋」的保險照留。
4. **事故那 6 筆／舊草稿**：目前同一網址再抓一次只會顯示「之前已抓過」，**不會更新價格**。建議本包**不做**「重抓補價」（要分辨哪些款是人工改過的，牽涉資料安全，另開小包較穩）；那 3 筆已上架錯價（大耳狗燈、兒童相機、Pingu 音箱）請老闆在卡片手動改成本→依公式重算→重同步；3 筆 Shopify DRAFT（拍拍燈、寶可夢×2）可刪草稿後用新外掛重抓。
5. **缺貨款**：建議本包**只標「來源缺貨，沒讀到價」**（照需確認處理），**不自動排除**；正式的缺貨處理（上架設售完）留給 STOCK 包，避免兩包規則打架。

---

## 7. 不要做清單

- 不准用 fetch／XHR 直接打淘寶 API（mtop 等）取價；只能「點畫面＋讀畫面」。
- 不准碰 CAPTCHA／登入／滑塊驗證；頁面跳出驗證 → 該次讀價會 timeout／click_failed，照規則中止即可。
- 不准改 Shopee、generic adapter。
- 不准改 selector 陣列、`extractSkuFromRoot` 輸出、`structuredSkuPrices`、PRICE-GUARD 擋板。
- 不准新增 UI、CSS、`!important`、migration、env。
- 不准把讀不到的款填成商品價或任何猜測值。
- 不准 deploy、不准手動 redeploy、不准合併 PR。

---

## 8. 交付

- 分支：`gpt/capture-interact`（從最新 `origin/handoff/20261008-golive-spec` 開；`gpt/**` 不會觸發 Vercel 部署）。
- 本規格檔一起放進分支 `docs/CAPTURE-INTERACT-施工規格-2026-10-15.md`。
- 一次 push（不要每個小 commit 就推）；開 PR，base＝`handoff/20261008-golive-spec`，標題 `feat(capture): CAPTURE-INTERACT click-through per-variant prices`。
- PR 說明列：改了哪些檔、§4 每個測試案例對應的 check 名稱、沒跑過的驗證（GPT 環境若跑不了 npm 要明講）、任何偏離規格的地方＋理由。

---

## 9. Claude 驗收修正（2026-10-15，PR #53）

模擬「頁面回應慢」時發現原規格 §3.1-E/F 有洞：頁面延遲 ≥1 秒時，兩輪都可能讀到「上一款」的價格；若相鄰款價格剛好相同（例如價格只跟尺寸有關），兩輪會「一致地讀錯」而被採用。已修正為：

1. **讀價要看到變化**：點之前先記下價格區原文；點完後若價格區和點之前一模一樣，要等滿 **2000ms** 仍不變才採用（價格可能真的相同）；有變化則照原規則穩定 300ms 即採用。單次讀價上限由 3000ms 改 **4000ms**。
2. **網址帶 skuId 的那一款**（`price_source="dom.selected_sku"`）也列入逐款讀價並覆寫（原本只點 `cny_price==null` 的款，那一款會未經驗證直接被當成真價）。
3. **兩輪結束後才寫回**；寫回前做兩道總檢查：
   - **抽查**：重新選最多 2 款已通過的款（不選畫面上當前那款），最少等 1500ms 再讀，必須與採用值完全相同；任一不同 → 全部作廢（`status:"aborted"`, `abort_reason:"verify_failed"`，各列 `verify_failed`）。
   - **收尾靜止檢查**：停止點擊後觀察 3000ms，價格區若還在變 → 代表頁面回應落後，全部作廢（`abort_reason:"slow_page"`，各列 `slow_page`）。
4. 新原因中文：`verify_failed`＝抽查不一致、`slow_page`＝頁面太慢。
5. 測試新增 CI17（延遲 1000–8000ms × 兩種價格排列，任何被採用的價格都必須正確）、CI18（skuId 那款會被重讀）；CI03 改為「900/2000ms 讀對、5000ms 不得採用錯價」。

模擬實測（假時鐘）：頁面 0.2–0.6 秒回應 → 12 款全對、約 30 秒；1.2 秒回應 → 12 款全對、約 44 秒；3 秒回應 → 全部作廢（標需確認），沒有任何錯價；全部同價 12 款約 54 秒並標 `all_identical`。§5 驗收時間標準改為「12 款 ≤ 45 秒」。
