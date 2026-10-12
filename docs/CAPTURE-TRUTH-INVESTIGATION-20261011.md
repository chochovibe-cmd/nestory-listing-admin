# CAPTURE-TRUTH Investigation — 2026-10-11

> Status: **HOLD / investigation handoff**
>
> Detailed evidence pack for Taobao/Tmall per-SKU price capture and detail-image completeness. Do not merge PR #40 or PR #41 based only on CI; Owner runtime acceptance is still pending.

## Owner live retest

Owner reported:
1. Tmall detail images now capture.
2. Taobao Miffy detail images are still incomplete.
3. Per-SKU prices still do not capture correctly.

These are separate failure domains.

## Tmall detail-image evidence

Latest successful Tmall draft:
- draft: `a44d0060-f479-44a6-81d4-0f7225dfc6c0`
- title: HOLLYBOX 三麗鷗小露台夜燈
- main images: 5
- detail images: 19
- variants: 13
- product original/base: CNY 39.9
- promo evidence: CNY 35.1

Earlier failing Hollybox draft:
- draft: `14698ba6-3e49-4172-a002-dfd276a1005a`
- main images: 5
- detail images: 0
- variants: 7

## Taobao Miffy incomplete-detail root cause

Latest Miffy draft:
- draft: `00e8b774-abd8-4f18-8c58-5db6bd4340c4`
- main images: 5
- reported detail images: 4
- variants: 17

The four reported detail URLs are false/incomplete evidence:
- two are Taobao platform TPS assets (`!!600000000...-2-tps-`)
- two are transformed SKU thumbnails

Old behavior interpreted any non-zero detail count as success, which suppressed fallback. Modern Taobao detail roots/lazy image timing were also incomplete.

PR #41 current head:
`5f4b133f6c02c10f6affbbc03b2f5b21a96bf589`

PR #41 now includes:
- modern roots: `#imageTextInfo-content`, `#J_DivItemDesc`, `.desc-root`, `.descV8-container`, `.tb-desc-content`
- lazy URL sources: `data-src`, `data-ks-lazyload`, `data-original`, `data-lazy-src`, last `srcset`, `currentSrc`, `src`
- platform/placeholder filtering
- canonical Alibaba URL comparison so transformed SKU thumbs do not count as details
- ICE rich-detail fallback when usable DOM detail count is sparse (<5)
- bounded lazy retry only on sparse Taobao/Tmall pages: ~300ms polling, max ~2.4s
- runtime stamp: `capture_meta.extension_build = capture-20261011-r5`

CI at this head: **PASS**.
Owner runtime re-test of this exact build is still pending.

## Per-SKU price root cause

Tested modern Miffy/Hollybox page shape exposes:
- SKU ids/names/images
- `res.skuCore.skuItem.hideOtherPrice = true`
- currently selected SKU price
- product-level starting/range price

But each `res.skuCore.sku2info[skuId]` only contains keys such as:
- `moreQuantity`
- `quantity`
- `logisticsTime`
- `cartParam`
- `quantityDisplayValue`
- `quantityText`
- `buyExParams`

There is no direct complete per-SKU `price/subPrice` map in the captured initial ICE.

Miffy evidence includes:
- displayed product range: `¥38-316`
- current/selected SKU id: `6058080553603`
- current price: CNY 38
- 17 SKU ids/names/images exist

This differs from other Taobao/Tmall page shapes where `sku2info[skuId].price.priceText` and sometimes `subPrice.priceText` exist for every SKU. Nestory already supports that page shape.

Conclusion:
**SKU identity is not proof that the initial page contains a complete SKU price table.**

## Critical QA finding: latest live rows did not run final PR #40 extension

PR #40 validated head:
`8fd8026ec07f0ad5740e1947476cd4e696adcf7b`

That final code:
- builds synthetic SKU-table rows with null price
- never copies product price into every SKU row
- warns: `sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格`
- parses already-loaded `cartParam / buyExParams` for explicit original/list/promo/coupon fields

But Owner's latest live Miffy/Hollybox rows still contain:
- product price copied into every synthetic SKU row (38 / 39.9)
- no final missing-SKU-price warning

Therefore the practical capture used an **intermediate unpacked extension build**, not final PR #40.

Do not claim "final PR #40 parser was tested and failed." It was not.

PR #41 now adds `capture_meta.extension_build=capture-20261011-r5` so future QA can prove the exact running build.

## PR #40 status

PR #40 can guarantee:
- non-discount/original price remains cost basis
- promo/coupon price is evidence only
- true locally available per-SKU prices are captured
- missing SKU prices are not manufactured from product price
- local embedded params are parsed where explicit price fields exist
- normal path adds no extra network/AI

PR #40 does not yet guarantee:
- full per-SKU prices on `hideOtherPrice=true` pages when initial page data does not contain a full map

PR #40 remains Draft / HOLD.

## Recommended next package if build-stamped smoke still lacks SKU prices

Proposed: `CAPTURE-SKU-PRICE-SWEEP`

Design:
1. Keep normal capture fast.
2. Detect variants with incomplete individual base prices, especially `hideOtherPrice=true`.
3. Only then run an optional/controlled completion pass:
   - select SKU combinations in the already-open logged-in page
   - wait for selected SKU/original-price panel update
   - capture selected SKU id + pre-promo/original price + promo evidence
   - restore original selection
4. Cap SKU count/time.
5. Consider user action: `17 款個別原價未取得｜補抓各款價格`.

Do not silently make every capture slower.

Alternative for later investigation:
- browser-authenticated Taobao internal request flow

Do not implement naive server-side MTop as a quick fix; it needs a separate design/security/reliability review.

## External cross-checks

Useful references found during investigation:
- Chrome scripting API (Promise returned by injected script is awaited):
  https://developer.chrome.com/docs/extensions/reference/api/scripting
- Recent GreasyFork image tool using modern detail roots and waiting for detail rendering:
  https://greasyfork.org/zh-CN/scripts/586245-%E5%95%86%E5%9B%BE%E6%89%B9%E5%AD%98-%E4%BA%AC%E4%B8%9C-%E5%A4%A9%E7%8C%AB-%E6%B7%98%E5%AE%9D
- GreasyFork SKU price tool reading current selected SKU:
  https://greasyfork.org/en/scripts/553424-%E6%B7%98%E5%AE%9D%E5%9E%8B%E5%8F%B7%E4%BB%B7%E6%A0%BC%E5%AF%BC%E5%87%BA-csv%E9%AB%98%E5%85%BC%E7%89%88v9-8
- YingDao example joining `skuBase.skus` to `skuCore.sku2info` when full prices are present:
  https://www.yingdao.com/community/detaildiscuss?id=940811759993765888

## Next Commander instructions

1. Recheck live PR #40 / #41 heads.
2. Do not merge either PR without Owner approval.
3. Any next live capture must contain `capture_meta.extension_build = capture-20261011-r5` (or a later explicitly documented build).
4. Re-test one Taobao Miffy-type page and one Tmall/Hollybox page.
5. If the build-stamped Taobao page still lacks per-SKU prices, stop parser-only work and design `CAPTURE-SKU-PRICE-SWEEP`.
6. Do not conflate image completeness with SKU-price completeness.
