/**
 * CAP-2: generic adapter — og: meta + common DOM fallbacks.
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  function pick(S, dom, doc, baseHref) {
    var warnings = [];
    var title =
      dom.metaContent(doc, S.ogTitle) ||
      dom.metaContent(doc, 'meta[name="title"]') ||
      dom.firstText(doc, S.itempropName ? [S.itempropName].concat(S.title || []) : S.title) ||
      (doc.title ? String(doc.title).trim() : null);

    if (title && /^\s*$/.test(title)) title = null;
    if (!title) warnings.push("title: 未抓到");

    var priceRaw =
      dom.metaContent(doc, S.ogPriceAmount) ||
      dom.metaContent(doc, 'meta[itemprop="price"]') ||
      dom.firstText(doc, S.price);
    var price_cny = NestoryCap.parsePrice(priceRaw);
    if (price_cny == null) warnings.push("price_cny: 未抓到");

    var listRaw = dom.firstText(doc, S.listPrice);
    var list_price_cny = NestoryCap.parsePrice(listRaw);
    // list price optional — only warn if we saw something unparsable? honest: omit if missing, no warn required
    if (listRaw && list_price_cny == null) {
      /* ignore garbage */
    }

    var mainEls = dom.allMatch(doc, S.mainGallery);
    var main_image_urls = dom.uniqueUrls(
      mainEls
        .map(function (el) {
          return dom.imgUrlFromEl(el, baseHref);
        })
        .concat([dom.metaContent(doc, S.ogImage)].map(function (u) {
          return dom.absUrl(u, baseHref);
        })),
      12
    );
    if (!main_image_urls.length) warnings.push("main_image_urls: 未抓到");

    var detailEls = dom.allMatch(doc, S.detailImages);
    var detail_image_urls = dom.uniqueUrls(
      detailEls.map(function (el) {
        return dom.imgUrlFromEl(el, baseHref);
      }),
      20
    );
    // filter out mains
    var mainSet = {};
    main_image_urls.forEach(function (u) {
      mainSet[u] = true;
    });
    detail_image_urls = detail_image_urls.filter(function (u) {
      return !mainSet[u];
    });
    if (!detail_image_urls.length) warnings.push("detail_image_urls: 未抓到");

    var videoEls = dom.allMatch(doc, S.video);
    var video_urls = [];
    videoEls.forEach(function (el) {
      var src =
        (el.getAttribute && (el.getAttribute("src") || el.getAttribute("content"))) ||
        "";
      if (!src && el.querySelector) {
        var source = el.querySelector("source[src]");
        if (source) src = source.getAttribute("src") || "";
      }
      var u = dom.absUrl(src, baseHref);
      if (u) video_urls.push(u);
    });
    video_urls = dom.uniqueUrls(video_urls, 3);

    var params = {};
    var paramRows = dom.allMatch(doc, S.paramsTable);
    paramRows.forEach(function (row) {
      var th = row.querySelector && (row.querySelector("th") || row.querySelector("dt"));
      var td = row.querySelector && (row.querySelector("td") || row.querySelector("dd"));
      if (th && td) {
        var k = dom.textOf(th).replace(/[:：]\s*$/, "");
        var v = dom.textOf(td);
        if (k && v) params[k] = v;
        return;
      }
      var t = dom.textOf(row);
      var m = t.match(/^(.{1,20})[：:]\s*(.+)$/);
      if (m) params[m[1].trim()] = m[2].trim();
    });
    if (!Object.keys(params).length) warnings.push("params: 未抓到");

    warnings.push("adapter: 使用通用後備規則");

    return {
      title: title,
      price_cny: price_cny,
      list_price_cny: list_price_cny,
      sku_table: null,
      variants_flat: [],
      main_image_urls: main_image_urls,
      detail_image_urls: detail_image_urls,
      video_urls: video_urls,
      params: Object.keys(params).length ? params : null,
      warnings: warnings,
      sku_dimensions: 0
    };
  }

  function captureGeneric(doc, baseHref, selectors) {
    var S = selectors || NestoryCap.SELECTORS.generic;
    var dom = NestoryCap.domUtil;
    return pick(S, dom, doc, baseHref || "https://example.com/");
  }

  NestoryCap.adapters = NestoryCap.adapters || {};
  NestoryCap.adapters.generic = captureGeneric;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { captureGeneric: captureGeneric };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
