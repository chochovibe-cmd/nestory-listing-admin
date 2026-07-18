/**
 * CAP-2 popup: API URL + capture token → storage + host permission.
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

async function load() {
  var res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  if (!res || !res.ok) return;
  if (res.apiBaseUrl) $("apiBaseUrl").value = res.apiBaseUrl;
  if (res.captureTokenFull) $("captureToken").value = res.captureTokenFull;
  renderLast(res.lastResult);
}

$("saveBtn").addEventListener("click", async function () {
  setMsg("儲存中…（若跳出授權視窗請按「允許」）", true);
  var res = await chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    apiBaseUrl: $("apiBaseUrl").value,
    captureToken: $("captureToken").value
  });
  if (!res || !res.ok) {
    setMsg((res && res.message) || "儲存失敗", false);
    return;
  }
  setMsg(res.message || "已儲存", true);
});

$("openSettingsMode").addEventListener("click", async function () {
  await chrome.action.setPopup({ popup: "popup/popup.html" });
  setMsg("已固定為設定頁。改完後可按下面「改回直接擷取」。", true);
});

$("backToCapture").addEventListener("click", async function () {
  await chrome.action.setPopup({ popup: "" });
  setMsg("已改回：按工具列圖示＝直接擷取。要再開設定，到擴充管理頁按「詳細資料」或重新載入後用安裝步驟。", true);
});

// Double-click title to re-open settings mode is overkill; expose via chrome.action
// Add: when user opens popup, we're already here.

load();
