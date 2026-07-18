/**
 * CAP-2 popup: API URL + capture token.
 * permissions.request MUST run in this click handler (user gesture) — not via background.
 */

function $(id) {
  return document.getElementById(id);
}

function setMsg(text, ok) {
  var el = $("saveMsg");
  el.textContent = text || "";
  el.className = "msg " + (ok ? "ok" : text ? "err" : "");
}

function renderLast(last) {
  var line = $("lastResult");
  var at = $("lastAt");
  if (!last || !last.line) {
    line.textContent = "尚無擷取紀錄";
    line.className = "result-line";
    at.textContent = "";
    return;
  }
  line.textContent = last.line;
  line.className = "result-line " + (last.ok ? "ok" : "err");
  if (last.at) {
    try {
      at.textContent = "時間：" + new Date(last.at).toLocaleString();
    } catch (_e) {
      at.textContent = "時間：" + last.at;
    }
  } else {
    at.textContent = "";
  }
}

function normalizeApiBase(url) {
  var s = String(url || "").trim();
  if (!s) return "";
  return s.replace(/\/+$/, "");
}

function originPatternFromBase(apiBaseUrl) {
  try {
    var u = new URL(apiBaseUrl);
    var port = u.port ? ":" + u.port : "";
    return u.protocol + "//" + u.hostname + port + "/*";
  } catch (_e) {
    return null;
  }
}

/**
 * Request host permission for API origin during user gesture (save click).
 * @returns {{ ok: boolean, message?: string }}
 */
async function requestApiHostPermission(apiBaseUrl) {
  var pattern = originPatternFromBase(apiBaseUrl);
  if (!pattern) {
    return { ok: false, message: "API 網址格式不正確" };
  }
  try {
    var has = await chrome.permissions.contains({ origins: [pattern] });
    if (has) return { ok: true };
    var granted = await chrome.permissions.request({ origins: [pattern] });
    if (!granted) {
      return {
        ok: false,
        message: "未允許連線權限。請在跳出的視窗按「允許」，否則無法送到 Nestory。"
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      message: "權限請求失敗：" + ((err && err.message) || String(err))
    };
  }
}

async function load() {
  var data = await chrome.storage.local.get([
    "apiBaseUrl",
    "captureToken",
    "lastResult"
  ]);
  if (data.apiBaseUrl) $("apiBaseUrl").value = data.apiBaseUrl;
  if (data.captureToken) $("captureToken").value = data.captureToken;
  renderLast(data.lastResult || null);
}

$("saveBtn").addEventListener("click", async function () {
  setMsg("儲存中…（權限視窗會在此時跳出，請按「允許」）", true);

  var apiBaseUrl = normalizeApiBase($("apiBaseUrl").value);
  var captureToken = String($("captureToken").value || "").trim();

  if (!apiBaseUrl) {
    setMsg("請填 API 網址（例如 https://你的站.vercel.app）", false);
    return;
  }
  if (!/^https?:\/\//i.test(apiBaseUrl)) {
    setMsg("API 網址要以 http:// 或 https:// 開頭", false);
    return;
  }
  if (!captureToken) {
    setMsg("請貼上擷取 Token（ncap_ 開頭）", false);
    return;
  }
  if (!/^ncap_/i.test(captureToken)) {
    setMsg("Token 格式不像 Nestory 擷取 token（應以 ncap_ 開頭）", false);
    return;
  }

  // Must stay in this click stack — do not sendMessage to background first
  var perm = await requestApiHostPermission(apiBaseUrl);
  if (!perm.ok) {
    setMsg(perm.message || "權限未取得", false);
    return;
  }

  await chrome.storage.local.set({
    apiBaseUrl: apiBaseUrl,
    captureToken: captureToken
  });

  // Prefer toolbar click → capture
  try {
    await chrome.action.setPopup({ popup: "" });
  } catch (_e) {}

  setMsg("已儲存。現在開商品頁，再按工具列圖示即可擷取。", true);
});

$("openSettingsMode").addEventListener("click", async function () {
  await chrome.action.setPopup({ popup: "popup/popup.html" });
  setMsg("已固定為設定頁。改完後可按下面「改回直接擷取」。", true);
});

$("backToCapture").addEventListener("click", async function () {
  await chrome.action.setPopup({ popup: "" });
  setMsg(
    "已改回：按工具列圖示＝直接擷取。要再開設定，到擴充管理頁「詳細資料」→「擴充功能選項」。",
    true
  );
});

load();
