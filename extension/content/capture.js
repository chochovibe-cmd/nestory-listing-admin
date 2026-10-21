/**
 * CAP-2: one-shot content script. Loaded via executeScript after lib/*.
 * Returns CaptureImportBody for the current page.
 */

(function installNestoryCaptureToast() {
  if (globalThis.__nestoryCaptureToastInstalled) return;
  globalThis.__nestoryCaptureToastInstalled = true;

  var toastEl = null;
  var hideTimer = null;

  function ensureToast() {
    if (toastEl && toastEl.isConnected) return toastEl;

    toastEl = document.createElement("div");
    toastEl.id = "__nestory_capture_toast";

    var style = toastEl.style;
    style.position = "fixed";
    style.top = "18px";
    style.right = "18px";
    style.zIndex = "2147483647";
    style.maxWidth = "min(420px, calc(100vw - 36px))";
    style.padding = "10px 14px";
    style.borderRadius = "10px";
    style.background = "rgba(20, 20, 20, 0.94)";
    style.color = "#fff";
    style.font = "600 14px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    style.boxShadow = "0 8px 24px rgba(0, 0, 0, 0.24)";
    style.pointerEvents = "none";
    style.opacity = "0";
    style.transform = "translateY(-6px)";
    style.transition = "opacity 120ms ease, transform 120ms ease";
    style.wordBreak = "break-word";

    (document.body || document.documentElement).appendChild(toastEl);
    return toastEl;
  }

  function showToast(message, kind) {
    var el = ensureToast();
    el.textContent = String(message || "");
    el.style.opacity = "1";
    el.style.transform = "translateY(0)";

    if (hideTimer) clearTimeout(hideTimer);
    var delay = kind === "loading" ? 65000 : kind === "err" ? 4500 : 3200;
    hideTimer = setTimeout(function () {
      if (!el || !el.isConnected) return;
      el.style.opacity = "0";
      el.style.transform = "translateY(-6px)";
    }, delay);
  }

  globalThis.__nestoryShowCaptureToast = showToast;

  chrome.runtime.onMessage.addListener(function (msg) {
    if (!msg || msg.type !== "NESTORY_CAPTURE_TOAST") return;
    showToast(msg.message, msg.kind);
  });
})();

(async function () {
  var NestoryCap = globalThis.NestoryCap;
  if (typeof globalThis.__nestoryShowCaptureToast === "function") {
    globalThis.__nestoryShowCaptureToast("⏳ 擷取中…", "loading");
  }

  if (!NestoryCap || typeof NestoryCap.buildCapturePayload !== "function") {
    return {
      __nestory_error: "capture_libs_missing",
      message: "擷取程式未正確載入，請重新載入擴充後再試"
    };
  }
  try {
    function buildNow() {
      return NestoryCap.buildCapturePayload(document, {
        href: location.href,
        host: location.hostname
      });
    }

    function detailCount(payload) {
      return payload && Array.isArray(payload.detail_image_urls)
        ? payload.detail_image_urls.length
        : 0;
    }

    var payload = buildNow();
    var isTaobaoFamily =
      payload &&
      (payload.source_platform === "taobao" || payload.source_platform === "tmall");

    // Modern Taobao/Tmall descriptions can lazy-render shortly after the rest
    // of the product page. Do not slow the normal path: only retry when the
    // first pass has sparse usable detail images.
    if (isTaobaoFamily && detailCount(payload) < 5) {
      var started = Date.now();
      var deadline = started + 2400;
      while (Date.now() < deadline && detailCount(payload) < 5) {
        await new Promise(function (resolve) {
          setTimeout(resolve, 300);
        });
        var next = buildNow();
        if (detailCount(next) > detailCount(payload)) payload = next;
      }
      if (payload.capture_meta) {
        payload.capture_meta.detail_wait_ms = Date.now() - started;
        if (detailCount(payload) < 5) {
          var warnings = Array.isArray(payload.capture_meta.warnings_from_client)
            ? payload.capture_meta.warnings_from_client.slice()
            : [];
          warnings.push(
            "detail_image_urls: 等待 lazy-load 後仍偏少，可能需要頁面互動/捲動才會完整載入"
          );
          payload.capture_meta.warnings_from_client = warnings;
        }
      }
    }

    if (NestoryCap.shouldInteractSkuPrices &&
        NestoryCap.shouldInteractSkuPrices(payload)) {
      payload.capture_meta = payload.capture_meta || {};
      try {
        var interact = await NestoryCap.interactSkuPrices(document, payload, {
          host: location.hostname,
          limits: { maxCombos: 40, maxTotalMs: 90000 },
          onProgress: function (done, total) {
            if (typeof globalThis.__nestoryShowCaptureToast === "function") {
              globalThis.__nestoryShowCaptureToast(
                "⏳ 逐款讀價 " + done + "/" + total + "…", "loading"
              );
            }
            try {
              chrome.runtime.sendMessage({ type: "NESTORY_CAPTURE_PROGRESS" }, function () {
                // MV3 wakeup only: a missing listener / lastError must not fail capture.
                void chrome.runtime.lastError;
              });
            } catch (_e) {}
          }
        });
        payload.capture_meta.interact = interact;
        var warns = Array.isArray(payload.capture_meta.warnings_from_client)
          ? payload.capture_meta.warnings_from_client.slice() : [];
        var flats = payload.variants_flat || [];
        if (flats.length && flats.filter(function (r) { return r.source_stock_status !== "sold_out"; })
              .every(function (r) { return r.cny_price != null; })) {
          warns = warns.filter(function (w) {
            return w !== "sku: 個別未優惠價未完整取得；未以商品價假裝 SKU 價格";
          });
        }
        var readable = typeof interact.readable === "number" ? interact.readable : interact.targets;
        var skipSoldOutRows = typeof interact.readable === "number";
        var domMismatch = interact.status === "aborted" && interact.abort_reason === "dom_mismatch";
        if (!domMismatch && interact.ok < readable) {
          var names = {
            sold_out: "來源缺貨", over_limit: "超過上限", timeout: "頁面沒反應",
            click_failed: "點不到", node_not_found: "找不到款式按鈕",
            disabled: "無法選取", promo_only: "只看到促銷價",
            no_price: "沒有價格", mismatch: "兩次讀到不同",
            not_run: "中止未讀", verify_failed: "抽查不一致",
            slow_page: "頁面太慢"
          };
          var counts = {};
          (interact.rows || []).forEach(function (r) {
            if (r.status === "ok" || (skipSoldOutRows && r.status === "sold_out")) return;
            counts[r.status] = (counts[r.status] || 0) + 1;
          });
          // Interaction metadata intentionally contains at most 60 rows.
          var hidden = Math.max(0, interact.targets - (interact.rows || []).length);
          if (hidden) counts.over_limit = (counts.over_limit || 0) + hidden;
          var reasons = Object.keys(counts).map(function (status) {
            return (names[status] || status) + " " + counts[status];
          }).join("、");
          warns.push("逐款讀價：" + (readable - interact.ok) +
            " 款沒讀到價格（" + reasons + "），請逐款確認");
        }
        var ABORT_REASON_TEXT = {
          dom_mismatch: "頁面上的款式文字和資料對不上（可能是淘寶改版，或翻譯外掛改寫了頁面），請關閉這個網站的翻譯後重新擷取；仍失敗請回報",
          click_failed: "連續點不到款式按鈕",
          no_sku_nodes: "找不到款式面板",
          verify_failed: "抽查讀到的價格不一致，整批讀價作廢",
          slow_page: "頁面回應太慢，整批讀價作廢"
        };
        if (interact.status === "aborted" && ABORT_REASON_TEXT[interact.abort_reason]) {
          warns.push("逐款讀價中止：" + ABORT_REASON_TEXT[interact.abort_reason]);
        }
        if ((interact.reasons || []).indexOf("all_identical") >= 0) {
          warns.push("逐款讀價：每款讀到的價格都一樣，可能沒讀到真正價格，請逐款確認");
        }
        var priced = flats.map(function (r) { return r.cny_price; })
          .filter(function (v) { return v != null && Number.isFinite(Number(v)) && Number(v) > 0; })
          .map(Number);
        var lowest = priced.length ? Math.min.apply(Math, priced) : null;
        if ((interact.reasons || []).indexOf("min_mismatch") >= 0 && lowest != null) {
          warns.push("逐款讀價：最低款 ¥" + lowest +
            " 和頁面起價 ¥" + payload.price_cny + " 不同，請確認");
        }
        if (payload.price_cny == null && lowest != null && interact.ok > 0) {
          payload.price_cny = lowest;
          payload.capture_meta.price_source = "interact.min_sku_price";
          payload.capture_meta.price_confidence = "structured_min";
        }
        payload.capture_meta.warnings_from_client = warns;
      } catch (err) {
        payload.capture_meta.interact = {
          version: 1, status: "aborted", abort_reason: "threw",
          message: (err && err.message) || String(err)
        };
      }
    }

    return payload;
  } catch (err) {
    return {
      __nestory_error: "capture_threw",
      message: (err && err.message) || String(err)
    };
  }
})();
