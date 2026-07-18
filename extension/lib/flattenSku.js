/**
 * CAP-2: sku_table → variants_flat + sku_dimensions (honest flatten).
 * Shape mirrors scripts/fixtures/cap1-sample.json.
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});
  var parsePrice =
    (NestoryCap.parsePrice) ||
    function (x) {
      var n = Number(x);
      return Number.isFinite(n) && n > 0 ? n : null;
    };

  /**
   * @param {{ axes?: string[], rows?: Array<Record<string, unknown>> } | null | undefined} skuTable
   * @returns {{ variants_flat: Array<object>, sku_dimensions: number }}
   */
  function flattenSkuTable(skuTable) {
    if (!skuTable || typeof skuTable !== "object") {
      return { variants_flat: [], sku_dimensions: 0 };
    }
    var axes = Array.isArray(skuTable.axes)
      ? skuTable.axes.map(function (a) {
          return String(a || "").trim();
        }).filter(Boolean)
      : [];
    var rows = Array.isArray(skuTable.rows) ? skuTable.rows : [];
    var dims = axes.length;
    var variants_flat = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {};
      var flat = {
        option1_name: null,
        option1_value: null,
        option2_name: null,
        option2_value: null,
        option3_name: null,
        option3_value: null,
        cny_price: null,
        sku: null
      };
      for (var d = 0; d < Math.min(axes.length, 3); d++) {
        var name = axes[d];
        var val = row[name];
        if (val == null || String(val).trim() === "") {
          // try positional keys
          var keys = Object.keys(row).filter(function (k) {
            return k !== "price" && k !== "cny_price" && k !== "sku";
          });
          val = keys[d] != null ? row[keys[d]] : null;
        }
        flat["option" + (d + 1) + "_name"] = name || null;
        flat["option" + (d + 1) + "_value"] =
          val != null && String(val).trim() !== "" ? String(val).trim() : null;
      }
      var priceRaw = row.price != null ? row.price : row.cny_price;
      var p =
        typeof NestoryCap.parsePrice === "function"
          ? NestoryCap.parsePrice(priceRaw)
          : parsePrice(priceRaw);
      flat.cny_price = p;
      if (row.sku != null && String(row.sku).trim()) {
        flat.sku = String(row.sku).trim();
      } else {
        flat.sku = null;
      }
      // skip completely empty rows
      if (
        !flat.option1_value &&
        !flat.option2_value &&
        !flat.option3_value &&
        flat.cny_price == null
      ) {
        continue;
      }
      variants_flat.push(flat);
    }

    return { variants_flat: variants_flat, sku_dimensions: dims };
  }

  /**
   * Build cartesian rows from axes values when only axes known.
   * @param {string[]} axes
   * @param {string[][]} valuesPerAxis
   */
  function cartesianSkuTable(axes, valuesPerAxis, priceHint) {
    var cleanAxes = (axes || []).map(String).map(function (s) {
      return s.trim();
    }).filter(Boolean);
    if (!cleanAxes.length) {
      return { axes: [], rows: [] };
    }
    var lists = cleanAxes.map(function (_a, i) {
      var vs = (valuesPerAxis && valuesPerAxis[i]) || [];
      return vs
        .map(function (v) {
          return String(v || "").trim();
        })
        .filter(Boolean);
    });
    if (lists.some(function (l) {
      return l.length === 0;
    })) {
      return { axes: cleanAxes, rows: [] };
    }

    var rows = [];
    function walk(depth, acc) {
      if (depth >= cleanAxes.length) {
        var row = {};
        for (var k = 0; k < cleanAxes.length; k++) {
          row[cleanAxes[k]] = acc[k];
        }
        if (priceHint != null) row.price = priceHint;
        rows.push(row);
        return;
      }
      for (var i = 0; i < lists[depth].length; i++) {
        walk(depth + 1, acc.concat([lists[depth][i]]));
      }
    }
    walk(0, []);
    // cap explosion
    if (rows.length > 200) rows = rows.slice(0, 200);
    return { axes: cleanAxes, rows: rows };
  }

  NestoryCap.flattenSkuTable = flattenSkuTable;
  NestoryCap.cartesianSkuTable = cartesianSkuTable;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      flattenSkuTable: flattenSkuTable,
      cartesianSkuTable: cartesianSkuTable
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
