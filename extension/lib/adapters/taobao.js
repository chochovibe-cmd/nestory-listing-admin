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

    // CAP-2.7: first matching skuAxis selector wins (ssr2025 skuItem-- before skuItemClipX).
    var groups = [];
    var axisSels =
      S.skuAxis && S.skuAxis.length
        ? S.skuAxis
        : ["dl.tb-prop", "[class*='skuItem']", "[class*='SkuItem']"];
    for (var ai = 0; ai < axisSels.length && !groups.length; ai++) {
      try {
        var dls = rootEl.querySelectorAll(axisSels[ai]);
        if (dls && dls.length) {
          for (var i = 0; i < dls.length; i++) groups.push(dls[i]);
        }
      } catch (_e) {}
    }

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
      if (/^(数量|數量|购买数量|購買數量)$/.test(label)) return;
      // 「分類」 is a fragment of 「顏色分類」 — not a second empty axis.
      if (
        axes.some(function (a) {
          return a !== label && a.indexOf(label) >= 0 && a.length > label.length;
        })
      ) {
        return;
      }

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
        var textChild =
          n.querySelector && n.querySelector("[class*='valueItemText']");
        var t =
          (n.getAttribute &&
            (n.getAttribute("data-value") || n.getAttribute("title"))) ||
          (textChild &&
            ((textChild.getAttribute && textChild.getAttribute("title")) ||
              dom.textOf(textChild))) ||
          dom.textOf(n);
        t = String(t || "")
          .replace(/\s+/g, " ")
          .trim();
        if (!t || t.length > 160) return;
        if (/^请选择|請選擇|选择|選擇/i.test(t)) return;
        if (/^(推荐|推薦|切换大图模式|切換大圖模式)$/i.test(t)) return;
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
        // ssr2025 emphasis chips: large title is the value, subtitle is the label
        var rowClass = (row.getAttribute && row.getAttribute("class")) || "";
        if (/emphasisParams/i.test(rowClass)) {
          var swapped = k2;
          k2 = v2.replace(/[:：]\s*$/, "");
          v2 = swapped;
        }
        if (k2 && v2) params[k2] = v2;
      }
    });
    return params;
  }

  /**
   * CAP-2.8: Tmall/Taobao SSR embeds full SKU in __ICE_APP_CONTEXT__.
   * Content scripts cannot read the page window (isolated world), so parse the
   * inline script. This is how size/color still exist when the size picker is
   * collapsed or image-only in the DOM.
   */
  function parseJsonObjectAt(text, braceIndex) {
    if (braceIndex < 0 || braceIndex >= text.length || text[braceIndex] !== "{") {
      return null;
    }
    var depth = 0;
    var inStr = false;
    var esc = false;
    var quote = "";
    for (var j = braceIndex; j < text.length; j++) {
      var ch = text[j];
      if (inStr) {
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          esc = true;
          continue;
        }
        if (ch === quote) inStr = false;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inStr = true;
        quote = ch;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(braceIndex, j + 1));
          } catch (_e) {
            return null;
          }
        }
      }
    }
    return null;
  }

  function findIceObjectBrace(text, from) {
    var slice = text.slice(from);
    var m = slice.match(/var\s+b\s*=\s*\{/);
    if (m && m.index >= 0) return from + m.index + m[0].length - 1;
    m = slice.match(/__ICE_APP_CONTEXT__\s*=\s*\{/);
    if (m && m.index >= 0) return from + m.index + m[0].length - 1;
    return -1;
  }

  function iceHasSku(parsed) {
    var res = iceResFromContext(parsed);
    return !!(res && res.skuBase && Array.isArray(res.skuBase.props) && res.skuBase.props.length);
  }

  function parseIceAppContext(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    var scripts = doc.querySelectorAll("script");
    var fallback = null;
    for (var i = 0; i < scripts.length; i++) {
      var t = scripts[i].textContent || scripts[i].innerText || "";
      if (!t || t.indexOf("__ICE_APP_CONTEXT__") < 0) continue;
      var searchFrom = 0;
      var guard = 0;
      while (guard++ < 8) {
        var brace = findIceObjectBrace(t, searchFrom);
        if (brace < 0) break;
        var parsed = parseJsonObjectAt(t, brace);
        if (parsed) {
          if (iceHasSku(parsed)) return parsed;
          if (!fallback) fallback = parsed;
        }
        searchFrom = brace + 1;
      }
    }
    return fallback;
  }

  function iceResFromContext(ice) {
    if (!ice || typeof ice !== "object") return null;
    var home = ice.loaderData && ice.loaderData.home;
    var res = home && home.data && home.data.res;
    if (res && typeof res === "object") return res;
    if (ice.res && typeof ice.res === "object") return ice.res;
    return null;
  }

  function iceParamsFromRes(res) {
    var params = {};
    var ind = res && res.plusViewVO && res.plusViewVO.industryParamVO;
    if (!ind) return params;
    function take(list) {
      if (!list || !list.length) return;
      for (var i = 0; i < list.length; i++) {
        var row = list[i] || {};
        var k = String(row.propertyName || "").trim();
        var v = String(row.valueName || "").trim();
        if (k && v) params[k] = v;
      }
    }
    take(ind.enhanceParamList);
    take(ind.basicParamList);
    return params;
  }

  function iceSkuFromRes(res) {
    var base = res && res.skuBase;
    if (!base || !Array.isArray(base.props) || !base.props.length) return null;
    var axes = [];
    var valuesPerAxis = [];
    var imageByValue = {};
    var pairToValue = {};
    for (var p = 0; p < base.props.length && axes.length < 3; p++) {
      var prop = base.props[p] || {};
      var axisName = String(prop.name || "").trim();
      if (!axisName) continue;
      var vals = [];
      var list = Array.isArray(prop.values) ? prop.values : [];
      for (var v = 0; v < list.length; v++) {
        var item = list[v] || {};
        var vn = String(item.name || "").trim();
        if (!vn) continue;
        vals.push(vn);
        pairToValue[String(prop.pid) + ":" + String(item.vid)] = {
          axis: axisName,
          name: vn
        };
        if (item.image && !imageByValue[vn]) imageByValue[vn] = String(item.image);
      }
      if (!vals.length) continue;
      if (
        axes.some(function (a) {
          return a !== axisName && a.indexOf(axisName) >= 0 && a.length > axisName.length;
        })
      ) {
        continue;
      }
      axes.push(axisName);
      valuesPerAxis.push(vals);
    }
    if (!axes.length) return null;

    var variants_flat = [];
    var skus = Array.isArray(base.skus) ? base.skus : [];
    var infoMap = (res.skuCore && res.skuCore.sku2info) || {};
    for (var s = 0; s < skus.length && variants_flat.length < 200; s++) {
      var sku = skus[s] || {};
      var parts = String(sku.propPath || "")
        .split(";")
        .map(function (x) {
          return x.trim();
        })
        .filter(Boolean);
      if (!parts.length) continue;
      var flat = {
        option1_name: null,
        option1_value: null,
        option2_name: null,
        option2_value: null,
        option3_name: null,
        option3_value: null,
        cny_price: null,
        sku: sku.skuId ? String(sku.skuId) : null,
        image_url: null
      };
      var ok = true;
      for (var d = 0; d < Math.min(parts.length, 3); d++) {
        var meta = pairToValue[parts[d]];
        if (!meta) {
          ok = false;
          break;
        }
        flat["option" + (d + 1) + "_name"] = meta.axis;
        flat["option" + (d + 1) + "_value"] = meta.name;
      }
      if (!ok || !flat.option1_value) continue;
      var info = infoMap[sku.skuId] || infoMap[String(sku.skuId)] || {};
      var priceText =
        (info.price && info.price.priceText) ||
        (info.subPrice && info.subPrice.priceText) ||
        null;
      if (priceText != null) {
        flat.cny_price = NestoryCap.parsePrice(priceText);
      }
      variants_flat.push(flat);
    }

    return {
      axes: axes,
      valuesPerAxis: valuesPerAxis,
      imageByValue: imageByValue,
      variants_flat: variants_flat
    };
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
    var ice = parseIceAppContext(doc);
    var iceRes = iceResFromContext(ice);
    var iceSku = iceSkuFromRes(iceRes);
    var iceParams = iceParamsFromRes(iceRes);
    var sku_table = null;
    var variants_flat = [];
    var sku_dimensions = 0;
    var usedIceSku = false;
    var iceHasValues =
      iceSku &&
      iceSku.axes.length &&
      iceSku.valuesPerAxis.some(function (vals) {
        return vals && vals.length;
      });
    if (iceHasValues) {
      usedIceSku = true;
      skuParts = {
        axes: iceSku.axes,
        valuesPerAxis: iceSku.valuesPerAxis,
        imageByValue: iceSku.imageByValue
      };
      sku_dimensions = iceSku.axes.length;
      sku_table = NestoryCap.cartesianSkuTable(
        iceSku.axes,
        iceSku.valuesPerAxis,
        price_cny
      );
      if (iceSku.variants_flat.length) {
        variants_flat = iceSku.variants_flat;
      } else {
        var iceFlat = NestoryCap.flattenSkuTable(sku_table);
        variants_flat = iceFlat.variants_flat;
      }
      if (NestoryCap.attachVariantImages) {
        variants_flat = NestoryCap.attachVariantImages(
          variants_flat,
          iceSku.imageByValue || {}
        );
      }
      if (NestoryCap.omitUniformVariantPrices) {
        variants_flat = NestoryCap.omitUniformVariantPrices(variants_flat, price_cny);
      }
    } else if (skuParts.axes.length) {
      sku_table = NestoryCap.cartesianSkuTable(
        skuParts.axes,
        skuParts.valuesPerAxis,
        price_cny
      );
      var flat = NestoryCap.flattenSkuTable(sku_table);
      variants_flat = flat.variants_flat;
      sku_dimensions = flat.sku_dimensions;
      if (NestoryCap.attachVariantImages) {
        variants_flat = NestoryCap.attachVariantImages(
          variants_flat,
          skuParts.imageByValue || {}
        );
      }
      if (NestoryCap.omitUniformVariantPrices) {
        variants_flat = NestoryCap.omitUniformVariantPrices(variants_flat, price_cny);
      }
      if (!sku_table.rows.length) {
        warnings.push("sku: 僅有規格軸無完整價表");
      }
    } else {
      warnings.push("sku: 未抓到");
    }
    if (usedIceSku) {
      warnings.push("sku: 使用頁面資料表（ICE）");
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
    var iceParamKeys = Object.keys(iceParams);
    if (iceParamKeys.length) {
      params = params && Object.keys(params).length ? Object.assign({}, iceParams, params) : iceParams;
    }
    if (!params || !Object.keys(params).length) {
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
