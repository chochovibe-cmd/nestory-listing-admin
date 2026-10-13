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

    return payload;
  } catch (err) {
    return {
      __nestory_error: "capture_threw",
      message: (err && err.message) || String(err)
    };
  }
})();
