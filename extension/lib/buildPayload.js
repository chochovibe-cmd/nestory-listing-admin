/**
 * CAP-2: route host → adapter → CaptureImportBody shape.
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  /**
   * @returns {{ adapter: string, source_platform: string | null }}
   */
  function detectAdapter(host, href) {
    var h = String(host || "").toLowerCase();
    var url = String(href || "").toLowerCase();
    if (
      h.indexOf("taobao.com") !== -1 ||
      h.indexOf("tmall.com") !== -1 ||
      h.indexOf("tmall.hk") !== -1 ||
      /taobao\.com|tmall\.com|tmall\.hk/.test(url)
    ) {
      var platform = h.indexOf("tmall") !== -1 || url.indexOf("tmall") !== -1 ? "tmall" : "taobao";
      return { adapter: "taobao", source_platform: platform };
    }
    if (h.indexOf("shopee.") !== -1 || /\.shopee\./.test(h) || url.indexOf("shopee.") !== -1) {
      return { adapter: "shopee", source_platform: "shopee" };
    }
    return { adapter: "generic", source_platform: null };
  }

  function omitNulls(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) {
      var v = obj[k];
      if (v === undefined) return;
      // keep null only for explicit optional? CAP-1: missing = not captured — omit nulls
      if (v === null) return;
      if (Array.isArray(v) && v.length === 0 && (k === "variants_flat" || k === "video_urls")) {
        // empty variants can omit; empty videos omit
        return;
      }
      if (k === "params" && v && typeof v === "object" && !Object.keys(v).length) return;
      out[k] = v;
    });
    return out;
  }

  /**
   * @param {Document} doc
   * @param {{ href?: string, host?: string }} page
   * @returns {object} CaptureImportBody-like
   */
  function buildCapturePayload(doc, page) {
    var href = (page && page.href) || "";
    var host = (page && page.host) || "";
    try {
      if (!host && href) {
        host = new URL(href).host;
      }
    } catch (_e) {}

    var det = detectAdapter(host, href);
    var partial;
    if (det.adapter === "taobao") {
      partial = NestoryCap.adapters.taobao(doc, href, host);
    } else if (det.adapter === "shopee") {
      partial = NestoryCap.adapters.shopee(doc, href);
    } else {
      partial = NestoryCap.adapters.generic(doc, href);
    }

    var warnings = (partial.warnings || []).slice();
    var sku_dimensions =
      typeof partial.sku_dimensions === "number"
        ? partial.sku_dimensions
        : partial.sku_table && Array.isArray(partial.sku_table.axes)
          ? partial.sku_table.axes.length
          : 0;

    var capture_meta = {
      adapter: det.adapter,
      page_host: host || undefined,
      sku_dimensions: sku_dimensions,
      warnings_from_client: warnings
    };
    // CAP-2.6 / 86: promo after discount → meta only (not price_cny)
    if (partial.promo_price_cny != null && Number.isFinite(Number(partial.promo_price_cny))) {
      capture_meta.promo_price_cny = Number(partial.promo_price_cny);
    }

    var body = {
      source_url: href || undefined,
      source_platform: det.source_platform,
      title: partial.title || undefined,
      price_cny: partial.price_cny != null ? partial.price_cny : undefined,
      list_price_cny: partial.list_price_cny != null ? partial.list_price_cny : undefined,
      sku_table: partial.sku_table || undefined,
      variants_flat:
        partial.variants_flat && partial.variants_flat.length
          ? partial.variants_flat
          : undefined,
      main_image_urls:
        partial.main_image_urls && partial.main_image_urls.length
          ? partial.main_image_urls
          : undefined,
      detail_image_urls:
        partial.detail_image_urls && partial.detail_image_urls.length
          ? partial.detail_image_urls
          : undefined,
      video_urls:
        partial.video_urls && partial.video_urls.length ? partial.video_urls : undefined,
      params: partial.params || undefined,
      spec_text: undefined,
      captured_at: new Date().toISOString(),
      capture_meta: capture_meta
    };

    return omitNulls(body);
  }

  NestoryCap.detectAdapter = detectAdapter;
  NestoryCap.buildCapturePayload = buildCapturePayload;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      detectAdapter: detectAdapter,
      buildCapturePayload: buildCapturePayload
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
