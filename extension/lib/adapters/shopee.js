/**
 * CAP-2: Shopee adapter (og + variation DOM).
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  function captureShopee(doc, baseHref, selectors) {
    var S = selectors || NestoryCap.SELECTORS.shopee;
    var G = NestoryCap.SELECTORS.generic;
    var dom = NestoryCap.domUtil;
    var warnings = [];
    var href = baseHref || "https://shopee.tw/";

    var title =
      dom.firstText(doc, S.title) ||
      dom.metaContent(doc, G.ogTitle) ||
      (doc.title ? String(doc.title).replace(/\s*\|.*$/, "").trim() : null);
    if (!title) warnings.push("title: 未抓到");

    var priceRaw =
      dom.firstText(doc, S.price) ||
      dom.metaContent(doc, G.ogPriceAmount) ||
      dom.metaContent(doc, 'meta[itemprop="price"]');
    var price_cny = NestoryCap.parsePrice(priceRaw);
    // Shopee often TWD — still send numeric as price_cny field per contract (server stores as cost CNY field; boss reviews)
    if (price_cny == null) warnings.push("price_cny: 未抓到");

    var list_price_cny = NestoryCap.parsePrice(dom.firstText(doc, S.listPrice));

    // SKU variations: group buttons under sections (best-effort)
    var axes = [];
    var valuesPerAxis = [];
    var roots = dom.allMatch(doc, S.skuRoot);
    if (roots.length) {
      roots.forEach(function (rootEl) {
        var labelEl = rootEl.querySelector && rootEl.querySelector(String((S.skuAxisLabel || ["label"])[0]));
        // try several labels
        if (!labelEl && S.skuAxisLabel) {
          for (var i = 0; i < S.skuAxisLabel.length; i++) {
            try {
              labelEl = rootEl.querySelector(S.skuAxisLabel[i]);
              if (labelEl) break;
            } catch (_e) {}
          }
        }
        var label = labelEl ? dom.textOf(labelEl) : "";
        if (!label) label = "規格" + (axes.length + 1);
        var btns = [];
        if (S.skuValue) {
          for (var j = 0; j < S.skuValue.length; j++) {
            try {
              var ns = rootEl.querySelectorAll(S.skuValue[j]);
              if (ns && ns.length) {
                for (var k = 0; k < ns.length; k++) btns.push(ns[k]);
                break;
              }
            } catch (_e2) {}
          }
        }
        var vals = [];
        btns.forEach(function (b) {
          var t = dom.textOf(b);
          if (t && t.length < 80) vals.push(t);
        });
        vals = NestoryCap.domUtil.uniqueUrls
          ? vals.filter(function (v, i, a) {
              return a.indexOf(v) === i;
            })
          : vals;
        var uniq = [];
        var seen = {};
        vals.forEach(function (v) {
          if (!seen[v]) {
            seen[v] = true;
            uniq.push(v);
          }
        });
        if (uniq.length) {
          axes.push(label.replace(/[:：]\s*$/, ""));
          valuesPerAxis.push(uniq);
        }
      });
    }

    var sku_table = null;
    var variants_flat = [];
    var sku_dimensions = 0;
    if (axes.length) {
      sku_table = NestoryCap.cartesianSkuTable(axes, valuesPerAxis, price_cny);
      var flat = NestoryCap.flattenSkuTable(sku_table);
      variants_flat = flat.variants_flat;
      sku_dimensions = flat.sku_dimensions;
      if (!sku_table.rows.length) {
        warnings.push("sku: 僅有規格軸無完整價表");
      }
    } else {
      warnings.push("sku: 未抓到");
    }

    var mainEls = dom.allMatch(doc, S.mainGallery);
    var mains = mainEls.map(function (el) {
      return dom.imgUrlFromEl(el, href);
    });
    var og = dom.absUrl(dom.metaContent(doc, G.ogImage), href);
    if (og) mains.unshift(og);
    var main_image_urls = dom.uniqueUrls(mains, 12);
    if (!main_image_urls.length) warnings.push("main_image_urls: 未抓到");

    var detail_image_urls = dom.uniqueUrls(
      dom.allMatch(doc, S.detailImages).map(function (el) {
        return dom.imgUrlFromEl(el, href);
      }),
      20
    );
    var mset = {};
    main_image_urls.forEach(function (u) {
      mset[u] = true;
    });
    detail_image_urls = detail_image_urls.filter(function (u) {
      return !mset[u];
    });
    if (!detail_image_urls.length) warnings.push("detail_image_urls: 未抓到");

    var video_urls = dom.uniqueUrls(
      dom.allMatch(doc, S.video).map(function (el) {
        var src = el.getAttribute && el.getAttribute("src");
        if (!src && el.querySelector) {
          var s = el.querySelector("source[src]");
          if (s) src = s.getAttribute("src");
        }
        return dom.absUrl(src, href);
      }),
      3
    );

    var params = {};
    dom.allMatch(doc, S.paramsTable).forEach(function (row) {
      var t = dom.textOf(row);
      var m = t.match(/^(.{1,24})[：:]\s*(.+)$/);
      if (m) params[m[1].trim()] = m[2].trim();
      var cells = row.querySelectorAll ? row.querySelectorAll("td, th") : [];
      if (cells.length >= 2) {
        var k = dom.textOf(cells[0]).replace(/[:：]\s*$/, "");
        var v = dom.textOf(cells[1]);
        if (k && v) params[k] = v;
      }
    });
    if (!Object.keys(params).length) warnings.push("params: 未抓到");

    return {
      title: title,
      price_cny: price_cny,
      list_price_cny: list_price_cny,
      sku_table: sku_table,
      variants_flat: variants_flat,
      main_image_urls: main_image_urls,
      detail_image_urls: detail_image_urls,
      video_urls: video_urls,
      params: Object.keys(params).length ? params : null,
      warnings: warnings,
      sku_dimensions: sku_dimensions
    };
  }

  NestoryCap.adapters = NestoryCap.adapters || {};
  NestoryCap.adapters.shopee = captureShopee;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { captureShopee: captureShopee };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
