/**
 * 4a-2 CAPTURE-SCROLL: scroll a Taobao/Tmall page to the bottom before capturing so
 * lazy-rendered description images and the review block exist in the DOM, then scroll back.
 * Never throws; time and step bounded. Clock / sleep are injectable for verify-capture-scroll.
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  var DEFAULTS = { stepWaitMs: 250, settleMs: 400, maxMs: 6000, maxSteps: 40 };

  function num(value) {
    var n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  function pageHeight(doc) {
    var el = doc && doc.documentElement;
    var body = doc && doc.body;
    return Math.max(num(el && el.scrollHeight), num(body && body.scrollHeight));
  }

  async function autoScrollForLazyContent(win, doc, opts) {
    var o = opts || {};
    var sleep = o.sleep || function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };
    var now = o.now || function () { return Date.now(); };
    var stepWaitMs = o.stepWaitMs != null ? o.stepWaitMs : DEFAULTS.stepWaitMs;
    var settleMs = o.settleMs != null ? o.settleMs : DEFAULTS.settleMs;
    var maxMs = o.maxMs != null ? o.maxMs : DEFAULTS.maxMs;
    var maxSteps = o.maxSteps != null ? o.maxSteps : DEFAULTS.maxSteps;

    var started = now();
    var out = { steps: 0, ms: 0, reached_bottom: false, restored: false, page_height: 0, error: null };
    if (!win || typeof win.scrollTo !== "function" || !doc) {
      out.error = "no_window";
      return out;
    }
    var startY = num(win.scrollY != null ? win.scrollY : win.pageYOffset);
    var view = Math.max(300, num(win.innerHeight) || 800);
    var step = Math.max(600, Math.floor(view * 0.9));
    var y = startY;
    try {
      while (out.steps < maxSteps && now() - started < maxMs) {
        var bottom = pageHeight(doc) - view;
        if (y >= bottom) {
          out.reached_bottom = true;
          break;
        }
        y = Math.min(y + step, bottom);
        win.scrollTo(0, y);
        out.steps += 1;
        await sleep(stepWaitMs);
      }
      if (!out.reached_bottom && out.steps < maxSteps && now() - started < maxMs) {
        out.reached_bottom = y >= pageHeight(doc) - view;
      }
      if (out.steps > 0) await sleep(settleMs);
    } catch (err) {
      out.error = (err && err.message) || String(err);
    }
    try {
      win.scrollTo(0, startY);
      out.restored = true;
    } catch (_e) {}
    out.page_height = pageHeight(doc);
    out.ms = now() - started;
    return out;
  }

  NestoryCap.AUTO_SCROLL_DEFAULTS = DEFAULTS;
  NestoryCap.autoScrollForLazyContent = autoScrollForLazyContent;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { autoScrollForLazyContent: autoScrollForLazyContent, AUTO_SCROLL_DEFAULTS: DEFAULTS };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
