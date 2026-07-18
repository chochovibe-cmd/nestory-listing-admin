/**
 * CAP-2: DOM helpers (browser document or linkedom).
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  function textOf(el) {
    if (!el) return "";
    var t =
      el.getAttribute &&
      (el.getAttribute("content") ||
        el.getAttribute("data-title") ||
        el.getAttribute("title") ||
        el.getAttribute("alt") ||
        "");
    if (t && String(t).trim()) return String(t).trim();
    return String(el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function firstMatch(doc, selectors) {
    if (!doc || !selectors) return null;
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      var sel = list[i];
      if (!sel) continue;
      try {
        var el = doc.querySelector(sel);
        if (el) return el;
      } catch (_e) {
        /* invalid selector — skip */
      }
    }
    return null;
  }

  function firstText(doc, selectors) {
    var el = firstMatch(doc, selectors);
    if (!el) return null;
    var t = textOf(el);
    return t || null;
  }

  function allMatch(doc, selectors) {
    if (!doc || !selectors) return [];
    var list = Array.isArray(selectors) ? selectors : [selectors];
    for (var i = 0; i < list.length; i++) {
      var sel = list[i];
      if (!sel) continue;
      try {
        var nodes = doc.querySelectorAll(sel);
        if (nodes && nodes.length) {
          var arr = [];
          for (var j = 0; j < nodes.length; j++) arr.push(nodes[j]);
          return arr;
        }
      } catch (_e) {
        /* skip */
      }
    }
    return [];
  }

  function absUrl(raw, baseHref) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || s.indexOf("data:") === 0) return null;
    if (s.indexOf("//") === 0) s = "https:" + s;
    try {
      return new URL(s, baseHref || "https://example.com/").href;
    } catch (_e) {
      return null;
    }
  }

  function imgUrlFromEl(el, baseHref) {
    if (!el) return null;
    if (el.tagName && String(el.tagName).toLowerCase() === "meta") {
      return absUrl(el.getAttribute("content"), baseHref);
    }
    var candidates = [
      el.getAttribute && el.getAttribute("data-src"),
      el.getAttribute && el.getAttribute("data-lazy-src"),
      el.getAttribute && el.getAttribute("data-ks-lazyload"),
      el.getAttribute && el.getAttribute("data-old-src"),
      el.getAttribute && el.getAttribute("src"),
      el.getAttribute && el.getAttribute("content")
    ];
    var srcset = el.getAttribute && el.getAttribute("srcset");
    if (srcset) {
      var part = String(srcset).split(",")[0];
      if (part) candidates.unshift(part.trim().split(/\s+/)[0]);
    }
    for (var i = 0; i < candidates.length; i++) {
      var u = absUrl(candidates[i], baseHref);
      if (u && !/pixel|1x1|spacer|placeholder|blank\./i.test(u)) return u;
    }
    return null;
  }

  function uniqueUrls(urls, max) {
    var seen = {};
    var out = [];
    for (var i = 0; i < urls.length; i++) {
      var u = urls[i];
      if (!u || seen[u]) continue;
      seen[u] = true;
      out.push(u);
      if (max && out.length >= max) break;
    }
    return out;
  }

  function metaContent(doc, selector) {
    try {
      var el = doc.querySelector(selector);
      if (!el) return null;
      var c = el.getAttribute("content") || textOf(el);
      return c && String(c).trim() ? String(c).trim() : null;
    } catch (_e) {
      return null;
    }
  }

  NestoryCap.domUtil = {
    textOf: textOf,
    firstMatch: firstMatch,
    firstText: firstText,
    allMatch: allMatch,
    absUrl: absUrl,
    imgUrlFromEl: imgUrlFromEl,
    uniqueUrls: uniqueUrls,
    metaContent: metaContent
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = NestoryCap.domUtil;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
