/**
 * CAPTURE-INTERACT: read the selected SKU's displayed, pre-discount price.
 * DOM clicks and DOM reads only; no network, storage, or product-page bypass.
 */
(function (root) {
  var Cap = root.NestoryCap || (root.NestoryCap = {});
  function shouldInteractSkuPrices(payload) {
    return !!(payload &&
      (payload.source_platform === "taobao" || payload.source_platform === "tmall") &&
      Array.isArray(payload.variants_flat) && payload.variants_flat.length >= 2 &&
      payload.variants_flat.some(function (row) {
        return row && row.cny_price == null && row.source_stock_status !== "sold_out";
      }));
  }

  function nameKey(v) {
    return String(v || "").replace(/[:：]\s*$/, "").replace(/\s+/g, "");
  }
  function valueKey(v) {
    return String(v || "").replace(/\s+/g, "");
  }
  function labelFor(row) {
    return [row.option1_value, row.option2_value, row.option3_value]
      .filter(function (v) { return v != null && String(v).trim(); })
      .join("／").slice(0, 60);
  }
  function sameReading(a, b) {
    return !!a && !!b && a.base === b.base && a.promo === b.promo && a.text === b.text;
  }
  // A DOM-only price (URL skuId → "dom.selected_sku") was read before any click; re-read it.
  function needsRead(row) {
    return !!row && (row.cny_price == null || /^dom./.test(String(row.price_source || "")));
  }
  function positive(value) {
    var n = Number(value);
    return value != null && Number.isFinite(n) && n > 0;
  }
  function sampleList(list, unique) {
    var out = [];
    for (var i = 0; i < list.length && out.length < 5; i++) {
      var text = String(list[i] == null ? "" : list[i]).slice(0, 40);
      if (!text || (unique && out.indexOf(text) >= 0)) continue;
      out.push(text);
    }
    return out;
  }
  function callProgress(fn, done, total) {
    if (typeof fn === "function") {
      try { fn(done, total); } catch (_e) { /* UI must not interrupt capture */ }
    }
  }

  async function interactSkuPrices(doc, payload, opts) {
    opts = opts || {};
    var adapters = Cap.adapters || {};
    var host = opts.host || "";
    var wait = typeof opts.wait === "function" ? opts.wait : function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    var now = typeof opts.now === "function" ? opts.now : Date.now;
    var limit = opts.limits || {};
    var maxCombos = Number.isFinite(limit.maxCombos) ? Math.max(0, limit.maxCombos) : 40;
    var maxTotalMs = Number.isFinite(limit.maxTotalMs) ? Math.max(0, limit.maxTotalMs) : 90000;
    var start = now(), stoppedForTime = false;
    var sourceRows = Array.isArray(payload && payload.variants_flat) ? payload.variants_flat : [];
    var targets = sourceRows.filter(needsRead);
    var ice = adapters.taobaoIce;
    var iceRes = ice && ice.res && ice.parse ? ice.res(ice.parse(doc)) : null;
    var info = iceRes && iceRes.skuCore && iceRes.skuCore.sku2info || {};
    var iceProps = iceRes && iceRes.skuBase && Array.isArray(iceRes.skuBase.props) ? iceRes.skuBase.props : [];
    var vidsBySku = {};
    (iceRes && iceRes.skuBase && Array.isArray(iceRes.skuBase.skus) ? iceRes.skuBase.skus : [])
      .forEach(function (s) {
        if (!s || s.skuId == null) return;
        vidsBySku[String(s.skuId)] = String(s.propPath || "").split(";").map(function (part) {
          var i = part.indexOf(":");
          return i >= 0 ? part.slice(i + 1).trim() : "";
        });
      });
    var states = targets.map(function (row, index) {
      return { row: row, index: index,
        report: { sku: row.sku == null ? null : String(row.sku),
          label: labelFor(row), status: "not_run",
          base: null, promo: null, pass1: null, pass2: null } };
    });
    var eligible = [];
    var allowed = 0;
    states.forEach(function (entry) {
      var skuInfo = entry.row.sku != null ? info[String(entry.row.sku)] : null;
      var soldOutByField = entry.row.source_stock_status === "sold_out";
      var soldOutByIce = entry.row.source_stock_status == null &&
        skuInfo && skuInfo.quantity != null && Number(skuInfo.quantity) === 0;
      if (soldOutByField || soldOutByIce) {
        entry.report.status = "sold_out";
      } else if (allowed >= maxCombos) {
        entry.report.status = "over_limit";
      } else {
        allowed++;
        eligible.push(entry);
      }
    });

    var result = {
      version: 2, status: "complete", abort_reason: null,
      targets: targets.length, ok: 0, sold_out: 0, readable: targets.length, elapsed_ms: 0,
      requires_confirmation: false, reasons: [], rows: []
    };
    function finalize() {
      var okRows = states.filter(function (e) { return e.report.status === "ok"; });
      result.ok = okRows.length;
      result.sold_out = states.filter(function (e) { return e.report.status === "sold_out"; }).length;
      result.readable = targets.length - result.sold_out;
      if (states.some(function (e) { return e.report.status !== "ok" && e.report.status !== "sold_out"; })) {
        if (result.status !== "aborted") result.status = "partial";
        result.reasons.push("incomplete");
      }
      if (okRows.length >= 2 && okRows.every(function (e) {
        return adapters.pricesClose(e.report.base, okRows[0].report.base);
      })) result.reasons.push("all_identical");
      var all = sourceRows.map(function (row) { return row && row.cny_price; })
        .filter(positive).map(Number);
      if (positive(payload.price_cny) && all.length &&
          !adapters.pricesClose(Math.min.apply(Math, all), payload.price_cny)) {
        result.reasons.push("min_mismatch");
      }
      result.requires_confirmation = result.reasons.length > 0;
      result.elapsed_ms = Math.max(0, now() - start);
      result.rows = states.slice(0, 60).map(function (e) { return e.report; });
      return result;
    }

    var initial = adapters.taobaoSkuNodes && adapters.taobaoSkuNodes(doc, host);
    if (!initial || !initial.length) {
      result.status = "aborted";
      result.abort_reason = "no_sku_nodes";
      return finalize();
    }
    if (eligible.length > 0) {
      var anyResolves = eligible.some(function (e) {
        var axesNow = adapters.taobaoSkuNodes(doc, host);
        for (var d = 1; d <= 3; d++) {
          var v = e.row["option" + d + "_value"];
          if (v == null || String(v).trim() === "") continue;
          if (!findOption(axesNow, e.row, d)) return false;
        }
        return true;
      });
      if (!anyResolves) {
        result.status = "aborted";
        result.abort_reason = "dom_mismatch";
        var sampleAxes = adapters.taobaoSkuNodes(doc, host) || [];
        result.dom_sample = {
          labels: sampleList(sampleAxes.map(function (axis) { return axis.label; })),
          values: sampleList((sampleAxes[0] ? sampleAxes[0].values : []).map(function (v) { return v.text; })),
          ice_labels: sampleList(eligible.map(function (e) { return e.row.option1_name; }), true),
          ice_values: sampleList(eligible.map(function (e) { return e.row.option1_value; }))
        };
        eligible.forEach(function (e) { e.report.status = "node_not_found"; });
        return finalize();
      }
    }
    var done = 0, total = eligible.length * 2, consecutiveClickFails = 0;
    callProgress(opts.onProgress, done, total);

    function findOption(axes, row, dimension) {
      var wantedVids = row.sku != null ? vidsBySku[String(row.sku)] : null;
      var wantedVid = wantedVids && wantedVids[dimension - 1] ? wantedVids[dimension - 1] : null;
      var preferred = axes[dimension - 1] || null;
      if (wantedVid) {
        var searchOrder = (preferred ? [preferred] : []).concat(axes.filter(function (a) { return a !== preferred; }));
        for (var si = 0; si < searchOrder.length; si++) {
          var hit = searchOrder[si].values.find(function (v) { return v.vid === wantedVid; });
          if (hit) return hit;
        }
      }
      var domAxis = axes[dimension - 1];
      var iceProp = iceProps[dimension - 1];
      var positionSafe = !wantedVid || (domAxis && domAxis.values.every(function (v) { return !v.vid; }));
      if (positionSafe && domAxis && iceProp && Array.isArray(iceProp.values) &&
          domAxis.values.length === iceProp.values.length) {
        var wantedText = valueKey(row["option" + dimension + "_value"]);
        for (var pi = 0; pi < iceProp.values.length; pi++) {
          if (wantedText && valueKey(iceProp.values[pi] && iceProp.values[pi].name) === wantedText) {
            return domAxis.values[pi] || null;
          }
        }
      }
      var expectedLabel = row["option" + dimension + "_name"];
      var expectedText = row["option" + dimension + "_value"];
      if (expectedText == null || String(expectedText).trim() === "") return null;
      var axis = expectedLabel ? axes.find(function (a) {
        return nameKey(a.label) === nameKey(expectedLabel);
      }) : null;
      if (!axis) axis = axes[dimension - 1];
      if (!axis) return null;
      var text = String(expectedText).trim();
      var value = axis.values.find(function (v) { return v.text === text; }) ||
        axis.values.find(function (v) { return valueKey(v.text) === valueKey(text); });
      return value || null;
    }
    async function waitForSelected(row, d, ms) {
      for (var elapsed = 0; elapsed < ms; elapsed += 100) {
        await wait(100);
        var current = findOption(adapters.taobaoSkuNodes(doc, host), row, d);
        if (current && current.selected) return true;
      }
      return false;
    }
    function dispatchFallback(node) {
      var win = doc.defaultView;
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (type) {
        var Ctor = type.indexOf("pointer") === 0 && win && win.PointerEvent
          ? win.PointerEvent : (win && win.MouseEvent) || (win && win.Event) || Event;
        node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: win }));
      });
    }
    async function selectCombo(row) {
      for (var d = 1; d <= 3; d++) {
        if (row["option" + d + "_value"] == null ||
            String(row["option" + d + "_value"]).trim() === "") continue;
        var option = findOption(adapters.taobaoSkuNodes(doc, host), row, d);
        if (!option) return "node_not_found";
        if (option.disabled) return "disabled";
        if (option.selected) continue; // Clicking a selected SKU can deselect it.
        option.node.click();
        if (await waitForSelected(row, d, 800)) continue;
        // The click may not have registered. Re-resolve after a React render.
        option = findOption(adapters.taobaoSkuNodes(doc, host), row, d);
        if (!option) return "node_not_found";
        if (option.disabled) return "disabled";
        if (option.selected) continue;
        dispatchFallback(option.node);
        if (!(await waitForSelected(row, d, 800))) return "click_failed";
      }
      return null;
    }
    // Slow pages keep showing the PREVIOUS variant's price for a while. A reading that still
    // equals the pre-click text is only trusted after SAME_PRICE_WAIT_MS (the price may
    // genuinely be the same); a changed reading is trusted once stable.
    var SAME_PRICE_WAIT_MS = 2000, READ_DEADLINE_MS = 4000, QUIET_TAIL_MS = 3000;
    async function readSettledPrice(clickedAt, minimumWait, beforeText) {
      await wait(minimumWait);
      var last = null, streak = 0;
      // Stable only when base, promo and the surrounding price text all match.
      while (now() - clickedAt <= READ_DEADLINE_MS) {
        var current = adapters.taobaoReadPrice(doc, host);
        if (sameReading(current, last)) streak++; else streak = 1;
        last = current;
        var changed = !!current && current.text !== beforeText;
        if (streak >= 4 && current && !/起/.test(current.text || "") &&
            (changed || now() - clickedAt >= SAME_PRICE_WAIT_MS)) {
          if (!positive(current.base)) {
            return { status: positive(current.promo) ? "promo_only" : "no_price" };
          }
          return { status: "ok", base: Number(current.base),
            promo: positive(current.promo) ? Number(current.promo) : null };
        }
        if (now() - clickedAt >= READ_DEADLINE_MS) break;
        await wait(100);
      }
      return { status: "timeout" };
    }
    async function runOne(entry, minWait) {
      var before = adapters.taobaoReadPrice(doc, host);
      var clickedAt = now();
      var fail = await selectCombo(entry.row);
      if (fail) return { status: fail };
      return readSettledPrice(clickedAt, minWait, before ? before.text : null);
    }
    function markRemainingOverLimit() {
      eligible.forEach(function (e) {
        if (e.report.status === "not_run" || e.report.status === "pending" || e.report.status === "pass1") {
          e.report.status = "over_limit";
        }
      });
      stoppedForTime = true;
    }
    function markAborted() {
      result.status = "aborted";
      result.abort_reason = "click_failed";
      eligible.forEach(function (e) {
        if (e.report.status === "pending" || e.report.status === "pass1") e.report.status = "not_run";
      });
    }
    function recordProgress() {
      done++;
      callProgress(opts.onProgress, done, total);
    }

    // First pass: original order. A failure in this pass is not retried.
    for (var i = 0; i < eligible.length; i++) {
      var entry = eligible[i];
      entry.report.status = "pending";
      var first = await runOne(entry, 500);
      entry.report.status = first.status;
      if (first.status === "ok") {
        entry.report.pass1 = first.base;
        entry.report.status = "pass1"; // Not trusted until reverse verification.
        entry._first = first;
        consecutiveClickFails = 0;
      } else if (first.status === "click_failed") {
        consecutiveClickFails++;
      } else {
        consecutiveClickFails = 0;
      }
      recordProgress();
      if (consecutiveClickFails >= 3) { markAborted(); break; }
      if (now() - start > maxTotalMs) { markRemainingOverLimit(); break; }
    }
    if (result.status === "aborted" || stoppedForTime) return finalize();

    // Second pass: reverse order. Do not revisit first-pass failures.
    var lastRead = null;
    for (var j = eligible.length - 1; j >= 0; j--) {
      var e = eligible[j];
      if (!e._first) continue;
      var second = await runOne(e, 500);
      lastRead = e;
      e.report.pass2 = second.status === "ok" ? second.base : null;
      e.report.status = second.status;
      if (second.status === "ok") {
        consecutiveClickFails = 0;
        if (adapters.pricesClose(e._first.base, second.base)) {
          e._verified = second;
        } else {
          // Disagreement: longer settle time, one final independent observation.
          var third = await runOne(e, 1500);
          if (third.status === "ok" &&
              (adapters.pricesClose(third.base, e._first.base) ||
               adapters.pricesClose(third.base, second.base))) {
            e._verified = third;
          } else {
            e.report.status = "mismatch";
          }
        }
      } else if (second.status === "click_failed") {
        consecutiveClickFails++;
      } else {
        consecutiveClickFails = 0;
      }
      if (e._verified) {
        e.report.status = "ok";
        e.report.base = e._verified.base;
        e.report.promo = e._verified.promo;
      }
      recordProgress();
      if (consecutiveClickFails >= 3) { markAborted(); break; }
      if (now() - start > maxTotalMs) { markRemainingOverLimit(); break; }
    }

    // Final spot-check: a slow page can feed every pass the same lagging stream of OLD prices.
    // Re-select up to two verified variants (never the one on screen) with a long settle; any
    // difference means no reading of this sweep can be trusted, so nothing is written.
    var verified = eligible.filter(function (x) { return !!x._verified; });
    if (verified.length && result.status !== "aborted") {
      var picks = [];
      [verified[verified.length - 1], verified[Math.floor(verified.length / 2)], verified[0]]
        .forEach(function (x) {
          if (x && x !== lastRead && picks.indexOf(x) < 0 && picks.length < 2) picks.push(x);
        });
      for (var k = 0; k < picks.length; k++) {
        var spot = await runOne(picks[k], 1500);
        lastRead = picks[k];
        if (spot.status !== "ok" || spot.base !== picks[k]._verified.base) {
          result.status = "aborted";
          result.abort_reason = "verify_failed";
          verified.forEach(function (x) {
            x.report.status = "verify_failed";
            x._verified = null;
          });
          break;
        }
      }
    }

    // Final quiet check: once we stop clicking, a healthy page never changes its price again.
    // A change here means answers were still arriving late, so readings may belong to other
    // variants → trust none of them.
    verified = eligible.filter(function (x) { return !!x._verified; });
    if (verified.length && result.status !== "aborted") {
      var settledText = (adapters.taobaoReadPrice(doc, host) || {}).text;
      for (var q = 0; q < QUIET_TAIL_MS; q += 100) {
        await wait(100);
        if ((adapters.taobaoReadPrice(doc, host) || {}).text !== settledText) {
          result.status = "aborted";
          result.abort_reason = "slow_page";
          verified.forEach(function (x) {
            x.report.status = "slow_page";
            x._verified = null;
          });
          break;
        }
      }
    }

    // Only now write prices back (never overwrite independently priced structured SKU evidence).
    eligible.forEach(function (x) {
      if (!x._verified || !needsRead(x.row)) return;
      var v = x._verified;
      x.row.cny_price = v.base;
      x.row.promo_price_cny = positive(v.promo) && v.promo !== v.base ? v.promo : null;
      x.row.price_source = "interact.selected_sku";
      x.row.promo_price_source = x.row.promo_price_cny == null ? null : "interact.selected_sku.promo";
      x.row.price_confidence = "interact_verified";
      x.row.price_candidates = (Array.isArray(x.row.price_candidates) ? x.row.price_candidates : [])
        .concat([{ source: "interact.selected_sku", kind: "base", value: v.base }]);
    });
    return finalize();
  }

  Cap.shouldInteractSkuPrices = shouldInteractSkuPrices;
  Cap.interactSkuPrices = interactSkuPrices;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { shouldInteractSkuPrices: shouldInteractSkuPrices,
      interactSkuPrices: interactSkuPrices };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
