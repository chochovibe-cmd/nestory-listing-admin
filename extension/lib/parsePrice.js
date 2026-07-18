/**
 * CAP-2: parse display price strings → number | null (never invent).
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  /**
   * @param {unknown} raw
   * @returns {number | null}
   */
  function parsePrice(raw) {
    if (raw == null) return null;
    if (typeof raw === "number") {
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    }
    var s = String(raw)
      .replace(/,/g, "")
      .replace(/￥|¥|元|CNY|RMB|USD|\$|NT\$|TWD|約/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!s) return null;
    // range "29.9-39.9" or "29.9~39.9" → take first (售價常見下限)
    var range = s.match(/(\d+(?:\.\d+)?)\s*[-~～—]\s*\d+(?:\.\d+)?/);
    if (range) {
      var a = Number(range[1]);
      return Number.isFinite(a) && a > 0 ? a : null;
    }
    var m = s.match(/(\d+(?:\.\d+)?)/);
    if (!m) return null;
    var n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  NestoryCap.parsePrice = parsePrice;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parsePrice: parsePrice };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
