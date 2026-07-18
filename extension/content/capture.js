/**
 * CAP-2: one-shot content script. Loaded via executeScript after lib/*.
 * Returns CaptureImportBody for the current page.
 */
(function () {
  var NestoryCap = globalThis.NestoryCap;
  if (!NestoryCap || typeof NestoryCap.buildCapturePayload !== "function") {
    return {
      __nestory_error: "capture_libs_missing",
      message: "擷取程式未正確載入，請重新載入擴充後再試"
    };
  }
  try {
    return NestoryCap.buildCapturePayload(document, {
      href: location.href,
      host: location.hostname
    });
  } catch (err) {
    return {
      __nestory_error: "capture_threw",
      message: (err && err.message) || String(err)
    };
  }
})();
