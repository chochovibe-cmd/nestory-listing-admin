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
        sku: null,
        image_url: null
      };
      for (var d = 0; d < Math.min(axes.length, 3); d++) {
        var name = axes[d];
        var val = row[name];
        if (val == null || String(val).trim() === "") {
          // try positional keys
          var keys = Object.keys(row).filter(function (k) {
            return (
              k !== "price" &&
              k !== "cny_price" &&
              k !== "sku" &&
              k !== "image_url" &&
              k !== "image"
            );
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
      var imgRaw = row.image_url != null ? row.image_url : row.image;
      if (imgRaw != null && String(imgRaw).trim()) {
        flat.image_url = String(imgRaw).trim();
      } else {
        flat.image_url = null;
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
   * CAP-2.6 / 87: 列成本若等於商品層 price_cny 則留空（表單跟隨上方成本）。
   * C1：有差異的列保留數字；同價列一律 null。
   * @param {Array<object>} variants
   * @param {number|null|undefined} productPrice
   * @returns {Array<object>}
   */
  function omitUniformVariantPrices(variants, productPrice) {
    if (!Array.isArray(variants) || !variants.length) return variants || [];
    var product =
      productPrice != null && Number.isFinite(Number(productPrice))
        ? Number(productPrice)
        : null;
    if (product == null || product <= 0) {
      return variants.map(function (v) {
        return stripNullVariantFields(v);
      });
    }
    return variants.map(function (v) {
      var next = Object.assign({}, v);
      if (next.cny_price != null && Number.isFinite(Number(next.cny_price))) {
        if (Math.abs(Number(next.cny_price) - product) < 0.001) {
          next.cny_price = null;
        }
      }
      return stripNullVariantFields(next);
    });
  }

  /** Drop null/undefined keys on a variant row (payload cleanliness). */
  function stripNullVariantFields(v) {
    var out = {};
    if (!v || typeof v !== "object") return out;
    Object.keys(v).forEach(function (k) {
      if (v[k] != null && v[k] !== "") out[k] = v[k];
    });
    return out;
  }

  /**
   * CAP-2.6 / 88: attach image_url from value→url map (first matching option wins).
   * @param {Array<object>} variants
   * @param {Record<string, string>} imageByValue
   */
  function attachVariantImages(variants, imageByValue) {
    if (!Array.isArray(variants) || !imageByValue) return variants || [];
    return variants.map(function (v) {
      if (v.image_url) return v;
      var vals = [v.option1_value, v.option2_value, v.option3_value];
      for (var i = 0; i < vals.length; i++) {
        var key = vals[i] != null ? String(vals[i]) : "";
        if (key && imageByValue[key]) {
          return Object.assign({}, v, { image_url: imageByValue[key] });
        }
      }
      return v;
    });
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
  NestoryCap.omitUniformVariantPrices = omitUniformVariantPrices;
  NestoryCap.attachVariantImages = attachVariantImages;
  NestoryCap.stripNullVariantFields = stripNullVariantFields;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      flattenSkuTable: flattenSkuTable,
      cartesianSkuTable: cartesianSkuTable,
      omitUniformVariantPrices: omitUniformVariantPrices,
      attachVariantImages: attachVariantImages,
      stripNullVariantFields: stripNullVariantFields
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
