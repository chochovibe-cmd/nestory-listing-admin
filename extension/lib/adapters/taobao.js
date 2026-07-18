/**
 * CAP-2: Taobao + Tmall adapter (same file; tmall selectors merge+fallback).
 * CAP-2.6: 原價優先 price_cny、促銷進 meta、款式同價省略、SKU 縮圖 image_url。
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  function isTmallHost(host) {
    return /\.tmall\./i.test(host || "") || /^detail\.tmall/i.test(host || "");
  }

  function resolveSelectors(host) {
    var base = NestoryCap.SELECTORS.taobao;
    if (isTmallHost(host)) {
      return NestoryCap.mergeSelectors(NestoryCap.SELECTORS.tmall, base);
    }
    return base;
  }

  var ORIGIN_LABEL_RE = /优惠前|優惠前|划线价|劃線價|原价|原價|吊牌价|吊牌價/;
  var PROMO_LABEL_RE = /店铺优惠后|店鋪優惠後|优惠后|優惠後|券后|券後|到手价|到手價|促销价|促銷價/;

  /**
   * Best-effort thumb URL from a SKU value node (img / data-* / background).
   */
  function thumbFromSkuNode(n, baseHref, dom) {
    if (!n) return null;
    if (n.querySelector) {
      var imgs = n.querySelectorAll("img");
      for (var i = 0; i < imgs.length; i++) {
        var u = dom.imgUrlFromEl(imgs[i], baseHref);
        if (u) return u;
      }
    }
    var selfImg = dom.imgUrlFromEl(n, baseHref);
    if (selfImg) return selfImg;
    var dataImg =
      (n.getAttribute &&
        (n.getAttribute("data-img") ||
          n.getAttribute("data-image") ||
          n.getAttribute("data-src") ||
          n.getAttribute("data-lazy-src"))) ||
      null;
    var abs = dom.absUrl(dataImg, baseHref);
    if (abs) return abs;
    var style = (n.getAttribute && n.getAttribute("style")) || "";
    var bg = style.match(/background(?:-image)?\s*:\s*url\(\s*['"]?([^'")\s]+)/i);
    if (bg && bg[1]) {
      var bu = dom.absUrl(bg[1], baseHref);
      if (bu) return bu;
    }
    return null;
  }

  function extractSkuFromRoot(rootEl, S, dom, baseHref) {
    var axes = [];
    var valuesPerAxis = [];
    var imageByValue = {};
    if (!rootEl) return { axes: axes, valuesPerAxis: valuesPerAxis, imageByValue: imageByValue };

    // Prefer dl.tb-prop style groups
    var groups = [];
    try {
      var dls = rootEl.querySelectorAll("dl.tb-prop, [class*='skuItem'], [class*='SkuItem']");
      if (dls && dls.length) {
        for (var i = 0; i < dls.length; i++) groups.push(dls[i]);
      }
    } catch (_e) {}

    if (!groups.length) {
      groups = [rootEl];
    }

    groups.forEach(function (g) {
      var label = null;
      if (S.skuAxisLabel) {
        for (var i = 0; i < S.skuAxisLabel.length; i++) {
          try {
            var le = g.querySelector(S.skuAxisLabel[i]);
            if (le) {
              label = dom.textOf(le);
              if (label) break;
            }
          } catch (_e2) {}
        }
      }
      if (!label) {
        var dt = g.querySelector && g.querySelector("dt");
        if (dt) label = dom.textOf(dt);
      }
      if (!label) return;

      label = label.replace(/[:：]\s*$/, "").trim();
      if (!label || label.length > 40) return;

      var vals = [];
      var valueNodes = [];
      if (S.skuValue) {
        for (var j = 0; j < S.skuValue.length; j++) {
          try {
            var ns = g.querySelectorAll(S.skuValue[j]);
            if (ns && ns.length) {
              for (var k = 0; k < ns.length; k++) valueNodes.push(ns[k]);
              if (valueNodes.length) break;
            }
          } catch (_e3) {}
        }
      }
      if (!valueNodes.length) {
        try {
          var lis = g.querySelectorAll("li");
          for (var x = 0; x < lis.length; x++) valueNodes.push(lis[x]);
        } catch (_e4) {}
      }
      valueNodes.forEach(function (n) {
        var t =
          (n.getAttribute && (n.getAttribute("data-value") || n.getAttribute("title"))) ||
          dom.textOf(n);
        t = String(t || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!t || t.length > 60) return;
        if (/^请选择|請選擇|选择|選擇/i.test(t)) return;
        vals.push(t);
        var thumb = thumbFromSkuNode(n, baseHref, dom);
        if (thumb && !imageByValue[t]) {
          imageByValue[t] = thumb;
        }
      });
      var uniq = [];
      var seen = {};
      vals.forEach(function (v) {
        if (!seen[v]) {
          seen[v] = true;
          uniq.push(v);
        }
      });
      if (uniq.length) {
        axes.push(label);
        valuesPerAxis.push(uniq);
      }
    });

    return { axes: axes, valuesPerAxis: valuesPerAxis, imageByValue: imageByValue };
  }

  function extractParams(doc, S, dom) {
    var params = {};
    var rows = dom.allMatch(doc, S.paramsTable);
    rows.forEach(function (row) {
      var tag = row.tagName ? String(row.tagName).toLowerCase() : "";
      if (tag === "li") {
        var t = dom.textOf(row);
        var m = t.match(/^(.{1,30}?)[：:]\s*(.+)$/);
        if (m) {
          params[m[1].trim()] = m[2].trim();
        }
        return;
      }
      var th = row.querySelector && (row.querySelector("th") || row.querySelector("td:first-child"));
      var td =
        row.querySelector &&
        (row.querySelector("td:last-child") || row.querySelectorAll("td")[1]);
      if (th && td && th !== td) {
        var k = dom.textOf(th).replace(/[:：]\s*$/, "");
        var v = dom.textOf(td);
        if (k && v && k !== v) params[k] = v;
        return;
      }
      var children = row.children ? Array.prototype.slice.call(row.children) : [];
      if (children.length >= 2) {
        var k2 = dom.textOf(children[0]).replace(/[:：]\s*$/, "");
        var v2 = dom.textOf(children[1]);
        if (k2 && v2) params[k2] = v2;
      }
    });
    return params;
  }

  /**
   * CAP-2.6 / 86: scan common price nodes for labeled 优惠前 / 券后 text.
   * @returns {{ original: number|null, promo: number|null, onlyPromo: boolean }}
   */
  function extractPrices(doc, S, dom) {
    var original = null;
    var promo = null;
    var saleDisplay = null;

    // Selector-based candidates
    var originalRaw =
      dom.firstText(doc, S.originalPrice) || dom.firstText(doc, S.listPrice);
    original = NestoryCap.parsePrice(originalRaw);

    var promoRaw = dom.firstText(doc, S.promoPrice);
    promo = NestoryCap.parsePrice(promoRaw);

    var saleRaw = dom.firstText(doc, S.price);
    saleDisplay = NestoryCap.parsePrice(saleRaw);

    // Labeled text walk (honest: only when label clearly present)
    try {
      var walk = doc.querySelectorAll
        ? doc.querySelectorAll(
            "[class*='Price'], [class*='price'], .price-box, .tb-detail-hd, del, strong"
          )
        : [];
      for (var i = 0; i < walk.length && i < 80; i++) {
        var el = walk[i];
        var txt = dom.textOf(el);
        if (!txt || txt.length > 80) continue;
        var p = NestoryCap.parsePrice(txt);
        if (p == null) continue;
        if (ORIGIN_LABEL_RE.test(txt) && original == null) {
          original = p;
        }
        if (PROMO_LABEL_RE.test(txt) && promo == null) {
          promo = p;
        }
      }
    } catch (_e) {}

    // del / line-through as original when still empty
    if (original == null) {
      try {
        var dels = doc.querySelectorAll("del, [class*='lineThrough'], .tb-price-original");
        for (var d = 0; d < dels.length; d++) {
          var dp = NestoryCap.parsePrice(dom.textOf(dels[d]));
          if (dp != null) {
            original = dp;
            break;
          }
        }
      } catch (_e2) {}
    }

    /**
     * Decision (A1/B1):
     * - original + promo/sale → price_cny=original, promo_price_cny=promo||sale
     * - only original → price_cny=original
     * - only sale/promo → price_cny=that, onlyPromo warning
     */
    var price_cny = null;
    var promo_price_cny = null;
    var onlyPromo = false;

    if (original != null && (promo != null || saleDisplay != null)) {
      price_cny = original;
      // Prefer explicitly labeled promo; else sale display if different from original
      if (promo != null && Math.abs(promo - original) >= 0.001) {
        promo_price_cny = promo;
      } else if (saleDisplay != null && Math.abs(saleDisplay - original) >= 0.001) {
        promo_price_cny = saleDisplay;
      } else if (promo != null) {
        promo_price_cny = promo;
      }
    } else if (original != null) {
      price_cny = original;
      if (promo != null && Math.abs(promo - original) >= 0.001) {
        promo_price_cny = promo;
      }
    } else if (promo != null) {
      price_cny = promo;
      onlyPromo = true;
    } else if (saleDisplay != null) {
      // No original found: sale display is the only number (may be promo)
      price_cny = saleDisplay;
      // If sale came from highlight/promo-ish selector, treat as only-promo when
      // no del/original existed — honest B1 warning when promoRaw matched or
      // we never saw original selectors.
      onlyPromo = true;
    }

    return {
      price_cny: price_cny,
      promo_price_cny: promo_price_cny,
      onlyPromo: onlyPromo
    };
  }

  function captureTaobao(doc, baseHref, host, selectorsOverride) {
    var href = baseHref || "https://item.taobao.com/";
    var h = host || "";
    var S = selectorsOverride || resolveSelectors(h);
    var dom = NestoryCap.domUtil;
    var warnings = [];

    var title =
      dom.firstText(doc, S.title) ||
      (doc.title
        ? String(doc.title)
            .replace(/-淘宝网|-淘寶網|-天猫|-天貓.*$/i, "")
            .trim()
        : null);
    if (!title) warnings.push("title: 未抓到");

    var prices = extractPrices(doc, S, dom);
    var price_cny = prices.price_cny;
    var promo_price_cny = prices.promo_price_cny;
    if (price_cny == null) {
      warnings.push("price_cny: 未抓到");
    } else if (prices.onlyPromo) {
      warnings.push(
        "只看到促銷價 ¥" +
          price_cny +
          "，可能低於原價——成本請自行確認"
      );
    }

    // A1: list_price_cny optional; do not force when price_cny already holds original
    var list_price_cny = null;

    var skuRoot = dom.firstMatch(doc, S.skuRoot);
    var skuParts = extractSkuFromRoot(skuRoot, S, dom, href);
    var sku_table = null;
    var variants_flat = [];
    var sku_dimensions = 0;
    if (skuParts.axes.length) {
      sku_table = NestoryCap.cartesianSkuTable(
        skuParts.axes,
        skuParts.valuesPerAxis,
        price_cny
      );
      var flat = NestoryCap.flattenSkuTable(sku_table);
      variants_flat = flat.variants_flat;
      sku_dimensions = flat.sku_dimensions;
      // 88: attach SKU thumbs by option value
      if (NestoryCap.attachVariantImages) {
        variants_flat = NestoryCap.attachVariantImages(
          variants_flat,
          skuParts.imageByValue || {}
        );
      }
      // 87: omit cny_price when equals product price_cny
      if (NestoryCap.omitUniformVariantPrices) {
        variants_flat = NestoryCap.omitUniformVariantPrices(variants_flat, price_cny);
      }
      if (!sku_table.rows.length) {
        warnings.push("sku: 僅有規格軸無完整價表");
      }
    } else {
      warnings.push("sku: 未抓到");
    }

    var main_image_urls = dom.uniqueUrls(
      dom.allMatch(doc, S.mainGallery).map(function (el) {
        return dom.imgUrlFromEl(el, href);
      }),
      12
    );
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

    var video_urls = [];
    dom.allMatch(doc, S.video).forEach(function (el) {
      var src = el.getAttribute && el.getAttribute("src");
      if (!src && el.querySelector) {
        var s = el.querySelector("source[src]");
        if (s) src = s.getAttribute("src");
      }
      var u = dom.absUrl(src, href);
      if (u) video_urls.push(u);
    });
    video_urls = dom.uniqueUrls(video_urls, 3);
    if (!video_urls.length) warnings.push("video_urls: 未抓到");

    var params = extractParams(doc, S, dom);
    if (!Object.keys(params).length) {
      warnings.push("params: 未抓到");
      params = null;
    }

    return {
      title: title,
      price_cny: price_cny,
      list_price_cny: list_price_cny,
      promo_price_cny: promo_price_cny,
      sku_table: sku_table,
      variants_flat: variants_flat,
      main_image_urls: main_image_urls,
      detail_image_urls: detail_image_urls,
      video_urls: video_urls,
      params: params,
      warnings: warnings,
      sku_dimensions: sku_dimensions
    };
  }

  NestoryCap.adapters = NestoryCap.adapters || {};
  NestoryCap.adapters.taobao = captureTaobao;
  NestoryCap.adapters.resolveTaobaoSelectors = resolveSelectors;
  NestoryCap.adapters.isTmallHost = isTmallHost;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      captureTaobao: captureTaobao,
      resolveSelectors: resolveSelectors,
      isTmallHost: isTmallHost
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
