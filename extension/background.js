/**
 * CAP-2: MV3 service worker — toolbar click → inject → POST CAP-1.
 * CORS: API origin host permission is requested in popup (user gesture).
 * Background only chrome.permissions.contains — never request() from SW.
 */

var CAPTURE_FILES = [
  "lib/selectors.js",
  "lib/domUtil.js",
  "lib/parsePrice.js",
  "lib/flattenSku.js",
  "lib/adapters/generic.js",
  "lib/adapters/shopee.js",
  "lib/adapters/taobao.js",
  "lib/interactSku.js",
  "lib/buildPayload.js",
  "content/capture.js"
];

// Per-tab guard: a slow capture must not be started twice by repeated clicks.
var captureInFlightByTab = Object.create(null);

function normalizeApiBase(url) {
  var s = String(url || "").trim();
  if (!s) return "";
  s = s.replace(/\/+$/, "");
  return s;
}

function originPatternFromBase(apiBaseUrl) {
  try {
    var u = new URL(apiBaseUrl);
    // Chrome match pattern: scheme://host/*
    var port = u.port ? ":" + u.port : "";
    return u.protocol + "//" + u.hostname + port + "/*";
  } catch (_e) {
    return null;
  }
}

/** Check only — host grant must run in popup user gesture, not here. */
async function hasHostPermission(matchPattern) {
  if (!matchPattern) {
    return { ok: false, message: "網址格式不正確" };
  }
  try {
    var has = await chrome.permissions.contains({ origins: [matchPattern] });
    if (has) return { ok: true };
    return {
      ok: false,
      message:
        "尚未允許連到 Nestory。請打開擴充設定，再按一次「儲存設定」，並在權限視窗按「允許」。"
    };
  } catch (err) {
    return {
      ok: false,
      message: "權限檢查失敗：" + ((err && err.message) || String(err))
    };
  }
}

async function getSettings() {
  var data = await chrome.storage.local.get([
    "apiBaseUrl",
    "captureToken",
    "vercelProtectionBypass",
    "lastResult"
  ]);
  return {
    apiBaseUrl: normalizeApiBase(data.apiBaseUrl || ""),
    captureToken: String(data.captureToken || "").trim(),
    vercelProtectionBypass: String(data.vercelProtectionBypass || "").trim(),
    lastResult: data.lastResult || null
  };
}

var PRODUCTION_API_HOSTS = [
  "nestory-listing-admin.vercel.app",
  "nestory-listing-admin-chocho-nestory.vercel.app"
];

/** 正式站 / 預覽 / 本機 label so the owner always sees where a capture went. */
function apiTargetInfo(apiBaseUrl) {
  var host = "";
  try {
    host = new URL(apiBaseUrl).hostname.toLowerCase();
  } catch (_e) {
    return { label: "未設定", host: "" };
  }
  if (PRODUCTION_API_HOSTS.indexOf(host) !== -1) return { label: "正式站", host: host };
  if (host === "localhost" || host === "127.0.0.1") return { label: "本機", host: host };
  if (/\.vercel\.app$/.test(host)) return { label: "預覽", host: host };
  return { label: "其他", host: host };
}

async function currentApiTarget() {
  var data = await chrome.storage.local.get(["apiBaseUrl"]);
  return apiTargetInfo(normalizeApiBase(data.apiBaseUrl || ""));
}

async function setLastResult(result) {
  var target = await currentApiTarget();
  await chrome.storage.local.set({
    lastResult: Object.assign({}, result, {
      api_target: target.label,
      api_host: target.host
    })
  });
}

function truncate(s, n) {
  s = String(s || "");
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function formatCreatedLine(json, payload) {
  var title = truncate((payload && payload.title) || "（無標題）", 24);
  var mains = (json.filled && json.filled.main_images) || 0;
  var details = (json.filled && json.filled.detail_images) || 0;
  var imgs =
    mains + details ||
    ((payload.main_image_urls || []).length + (payload.detail_image_urls || []).length);
  var variants =
    (json.filled && json.filled.variants) ||
    (payload.variants_flat ? payload.variants_flat.length : 0);
  return "已建草稿：" + title + "×圖 " + imgs + "×款式 " + variants;
}

function interactSuffix(payload) {
  var i = payload && payload.capture_meta && payload.capture_meta.interact;
  if (!i || typeof i.targets !== "number" || typeof i.ok !== "number") return "";
  if (i.abort_reason === "dom_mismatch") {
    return "（逐款讀價沒做：頁面文字對不上，請關閉瀏覽器翻譯後重抓）";
  }
  var readable = typeof i.readable === "number" ? i.readable : i.targets;
  var soldOut = typeof i.sold_out === "number" ? i.sold_out : 0;
  var soldText = soldOut > 0 ? "，" + soldOut + " 款來源售完" : "";
  if (readable === 0) return soldOut > 0 ? "（款式全部來源售完）" : "";
  return i.ok === readable
    ? "（逐款讀價 " + i.ok + "/" + readable + soldText + "）"
    : "（逐款讀價 " + i.ok + "/" + readable + soldText + "，" + (readable - i.ok) + " 款請確認）";
}

async function setBadge(kind, text) {
  try {
    if (kind === "ok") {
      await chrome.action.setBadgeBackgroundColor({ color: "#1a7f37" });
      await chrome.action.setBadgeText({ text: text || "✓" });
    } else if (kind === "warn") {
      await chrome.action.setBadgeBackgroundColor({ color: "#9a6700" });
      await chrome.action.setBadgeText({ text: text || "!" });
    } else if (kind === "err") {
      await chrome.action.setBadgeBackgroundColor({ color: "#cf222e" });
      await chrome.action.setBadgeText({ text: text || "!" });
    } else {
      await chrome.action.setBadgeText({ text: "" });
    }
  } catch (_e) {
    /* ignore */
  }
}

async function showPageToast(tabId, kind, message) {
  try {
    var target = await currentApiTarget();
    await chrome.tabs.sendMessage(tabId, {
      type: "NESTORY_CAPTURE_TOAST",
      kind: kind,
      message: "［" + target.label + "］" + message
    });
  } catch (_e) {
    // The page helper may not be injected yet; badge/lastResult remain as fallback.
  }
}

async function openPopupHint() {
  // MV3: no guaranteed openPopup on all channels; set badge is enough.
  // Try openPopup when available (Chrome 127+).
  try {
    if (chrome.action && typeof chrome.action.openPopup === "function") {
      await chrome.action.openPopup();
    }
  } catch (_e) {
    /* user can click again to open popup if we temporarily set default_popup — skip */
  }
}

async function captureActiveTab() {
  var settings = await getSettings();
  if (!settings.apiBaseUrl || !settings.captureToken) {
    var line = "失敗：請先點擴充圖示旁的設定，填 API 網址與擷取 Token";
    // Without default_popup, user opens via chrome://extensions details — we set lastResult
    // and use a temporary popup by writing storage; also try to show badge.
    await setLastResult({
      ok: false,
      line: line,
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    // Enable popup so next click on icon area can open settings — actually action click is capture.
    // Document in README: right-click extension → 選項 is not set; use popup.html via setPopup temporarily.
    try {
      await chrome.action.setPopup({ popup: "popup/popup.html" });
      await openPopupHint();
      // keep popup for settings access; capture still on... wait, if popup is set, click opens popup not capture.
      // Design F: toolbar = capture. Settings via right-click "選項" or separate.
      // Re-read design: popup for settings. F says: direct capture on toolbar; if no token badge + popup guide.
      // Common pattern: setPopup only when need settings, else clear popup so click fires onClicked.
      setTimeout(function () {
        chrome.action.setPopup({ popup: "popup/popup.html" });
      }, 0);
    } catch (_e2) {}
    return;
  }

  // Ensure click goes to onClicked (no popup) when configured
  try {
    await chrome.action.setPopup({ popup: "" });
  } catch (_e3) {}

  var apiPattern = originPatternFromBase(settings.apiBaseUrl);
  var perm = await hasHostPermission(apiPattern);
  if (!perm.ok) {
    await setLastResult({
      ok: false,
      line: "失敗：" + perm.message,
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    try {
      await chrome.action.setPopup({ popup: "popup/popup.html" });
    } catch (_e4) {}
    return;
  }

  var tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  var tab = tabs && tabs[0];
  if (!tab || !tab.id) {
    await setLastResult({
      ok: false,
      line: "失敗：找不到當前分頁",
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    return;
  }

  if (!tab.url || /^(chrome|chrome-extension|edge|about|devtools):/i.test(tab.url)) {
    await setLastResult({
      ok: false,
      line: "失敗：此頁無法擷取（請開商品頁再按）",
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    return;
  }

  if (captureInFlightByTab[tab.id]) {
    await setLastResult({
      ok: false,
      line: "擷取中，請稍候",
      at: new Date().toISOString()
    });
    await setBadge("warn", "…");
    await showPageToast(tab.id, "warn", "擷取中，請稍候");
    return;
  }

  captureInFlightByTab[tab.id] = true;
  try {
  // Page inject relies on activeTab (toolbar click gesture) + pre-granted e‑commerce hosts.
  // Do not request host grants here (no optional-host gesture in SW).
  var injected;
  try {
    injected = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: CAPTURE_FILES
    });
  } catch (err) {
    await setLastResult({
      ok: false,
      line:
        "失敗：無法讀取此頁（" +
        ((err && err.message) || "權限不足") +
        "）。請確認是商品頁；一般官網請用工具列圖示點一次擷取（靠 activeTab）。",
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    return;
  }

  var payload = injected && injected[0] && injected[0].result;
  if (!payload || payload.__nestory_error) {
    var payloadError = (payload && payload.message) || "頁面解析失敗";
    await setLastResult({
      ok: false,
      line: "失敗：" + payloadError,
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    await showPageToast(tab.id, "err", "✗ 擷取失敗：" + payloadError);
    return;
  }

  var capturedTitle = truncate(payload.title || "（無標題）", 36);
  await showPageToast(tab.id, "loading", "⏳ 擷取中：" + capturedTitle);

  var endpoint = settings.apiBaseUrl + "/api/import/product-page";
  var res;
  var json;
  var requestHeaders = {
    "Content-Type": "application/json",
    Authorization: "Bearer " + settings.captureToken
  };
  if (settings.vercelProtectionBypass) {
    requestHeaders["x-vercel-protection-bypass"] = settings.vercelProtectionBypass;
  }
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(payload)
    });
    json = await res.json().catch(function () {
      return null;
    });
  } catch (err) {
    await setLastResult({
      ok: false,
      line:
        "失敗：連不上 API（" +
        ((err && err.message) || "網路錯誤") +
        "）。請檢查 API 網址與是否已按允許授權。",
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    await showPageToast(
      tab.id,
      "err",
      "✗ 擷取失敗：" + ((err && err.message) || "網路錯誤")
    );
    return;
  }

  if (!json) {
    await setLastResult({
      ok: false,
      line: "失敗：伺服器回應不是 JSON（HTTP " + res.status + "）",
      at: new Date().toISOString()
    });
    await setBadge("err", "!");
    await showPageToast(tab.id, "err", "✗ 擷取失敗：伺服器回應異常");
    return;
  }

  if (json.ok && json.status === "created") {
    var createdLine = formatCreatedLine(json, payload) + interactSuffix(payload);
    await setLastResult({
      ok: true,
      status: "created",
      line: createdLine,
      draft_id: json.draft_id,
      open_path: json.open_path,
      at: new Date().toISOString()
    });
    await setBadge("ok", "✓");
    await showPageToast(tab.id, "ok", "✓ 已擷取：" + capturedTitle + interactSuffix(payload));
    return;
  }

  if (json.ok && json.status === "updated") {
    await setLastResult({
      ok: true,
      status: "updated",
      line: (json.message || "已補上空白規格／款式") + interactSuffix(payload),
      draft_id: json.draft_id,
      open_path: json.open_path,
      at: new Date().toISOString()
    });
    await setBadge("ok", "✓");
    await showPageToast(
      tab.id,
      "warn",
      "⚠ 這個網址之前已抓過，已補上缺少資料：" + capturedTitle + interactSuffix(payload)
    );
    return;
  }

  if (json.ok && json.status === "refreshed") {
    await setLastResult({
      ok: true,
      status: "refreshed",
      line: (json.message || "已更新這個網址的草稿") + interactSuffix(payload),
      draft_id: json.draft_id,
      open_path: json.open_path,
      at: new Date().toISOString()
    });
    await setBadge("ok", "✓");
    await showPageToast(
      tab.id,
      "ok",
      "✓ 這個網址之前已抓過，" + (json.message || "已更新") + "：" + capturedTitle + interactSuffix(payload)
    );
    return;
  }

  if (json.ok && json.status === "exists") {
    await setLastResult({
      ok: true,
      status: "exists",
      line: "已存在：" + (json.message || "此網址已有草稿，未重複建立"),
      draft_id: json.draft_id,
      open_path: json.open_path,
      at: new Date().toISOString()
    });
    await setBadge("warn", "1");
    await showPageToast(tab.id, "warn", "⚠ 這個網址之前已抓過：" + capturedTitle);
    return;
  }

  await setLastResult({
    ok: false,
    line: "失敗：" + (json.message || json.error || "未知錯誤"),
    at: new Date().toISOString()
  });
  await setBadge("err", "!");
  await showPageToast(
    tab.id,
    "err",
    "✗ 擷取失敗：" + (json.message || json.error || "未知錯誤")
  );
  } finally {
    delete captureInFlightByTab[tab.id];
  }
}

// Toolbar click = capture when no popup is set
chrome.action.onClicked.addListener(function () {
  captureActiveTab();
});

// Optional messages (settings + host grant are done in popup click handler)
chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (!msg || !msg.type) return;

  if (msg.type === "NESTORY_CAPTURE_PROGRESS") {
    sendResponse({ ok: true });
    return;
  }

  if (msg.type === "GET_STATE") {
    (async function () {
      var s = await getSettings();
      sendResponse({
        ok: true,
        apiBaseUrl: s.apiBaseUrl,
        captureToken: s.captureToken ? "••••" + s.captureToken.slice(-4) : "",
        captureTokenFull: s.captureToken,
        vercelProtectionBypass: s.vercelProtectionBypass ? "••••" : "",
        lastResult: s.lastResult
      });
    })();
    return true;
  }

  if (msg.type === "RUN_CAPTURE") {
    captureActiveTab().then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }
});

// Context menu alternative? skip per spec.

// On install: set popup so boss can configure first
chrome.runtime.onInstalled.addListener(function () {
  chrome.action.setPopup({ popup: "popup/popup.html" });
});

// If already configured on startup, clear popup for one-click capture
chrome.storage.local.get(["apiBaseUrl", "captureToken"], function (data) {
  if (data.apiBaseUrl && data.captureToken) {
    chrome.action.setPopup({ popup: "" });
  } else {
    chrome.action.setPopup({ popup: "popup/popup.html" });
  }
});
