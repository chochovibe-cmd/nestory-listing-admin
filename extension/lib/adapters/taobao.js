/**
 * CAP-2: Taobao + Tmall adapter (same file; tmall selectors merge+fallback).
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

  function extractSkuFromRoot(rootEl, S, dom) {
    var axes = [];
    var valuesPerAxis = [];
    if (!rootEl) return { axes: axes, valuesPerAxis: valuesPerAxis };

    // Prefer dl.tb-prop style groups
    var groups = [];
    try {
      var dls = rootEl.querySelectorAll("dl.tb-prop, [class*='skuItem'], [class*='SkuItem']");
      if (dls && dls.length) {
        for (var i = 0; i < dls.length; i++) groups.push(dls[i]);
      }
    } catch (_e) {}

    if (!groups.length) {
      // treat whole root as one blob — try label/value pairs
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

    return { axes: axes, valuesPerAxis: valuesPerAxis };
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
      // class* InfoItem style: label + value children
      var children = row.children ? Array.prototype.slice.call(row.children) : [];
      if (children.length >= 2) {
        var k2 = dom.textOf(children[0]).replace(/[:：]\s*$/, "");
        var v2 = dom.textOf(children[1]);
        if (k2 && v2) params[k2] = v2;
      }
    });
    return params;
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

    var priceRaw = dom.firstText(doc, S.price);
    var price_cny = NestoryCap.parsePrice(priceRaw);
    if (price_cny == null) warnings.push("price_cny: 未抓到");

    var listRaw = dom.firstText(doc, S.listPrice);
    var list_price_cny = NestoryCap.parsePrice(listRaw);
    if (listRaw && list_price_cny == null) {
      /* omit */
    } else if (!listRaw) {
      warnings.push("list_price_cny: 未抓到");
    }

    var skuRoot = dom.firstMatch(doc, S.skuRoot);
    var skuParts = extractSkuFromRoot(skuRoot, S, dom);
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
      if (!sku_table.rows.length) {
        warnings.push("sku: 僅有規格軸無完整價表");
      } else if (sku_dimensions >= 2) {
        // informational only on client; server adds multidim warning
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
