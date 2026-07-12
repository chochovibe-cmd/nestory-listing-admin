/**
 * B15 headless style probe — one Chrome dump per theme.
 * Usage: node scripts/b15-style-probe.mjs [--out path.json]
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";

const root = resolve(import.meta.dirname || ".", "..");
const rootFixed = resolve(process.cwd());
const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

function ctype(file) {
  switch (extname(file)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function buildHtml(theme) {
  return `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8" />
  <link rel="stylesheet" href="/src/app/globals.css" />
</head>
<body data-theme="${theme}">
  <div class="pill-group"><button type="button" class="pill-btn active" id="p1">pill</button></div>
  <button type="button" class="tone-card active" id="p2"><span class="tone-title">tone</span></button>
  <span class="rc-status done" id="p3a">ok</span>
  <span class="rc-status generating" id="p3b">run</span>
  <span class="rc-status error" id="p3c">err</span>
  <div class="result-card" id="p4">card</div>
  <div class="result-card active" id="p5">card+</div>
  <input id="p6" type="text" value="x" />
  <header class="topbar" id="p7"><div class="brand">Nestory</div></header>
  <div class="status-pill status-ok" id="p8"><strong>ok</strong>ready</div>
  <pre id="out"></pre>
  <script>
    const KEYS = ["borderTopWidth","borderTopColor","boxShadow","backgroundColor","color","borderRadius"];
    function snap(el) {
      const cs = getComputedStyle(el);
      const o = {};
      for (const k of KEYS) o[k] = cs[k];
      o.borderBottomWidth = cs.borderBottomWidth;
      o.borderBottomColor = cs.borderBottomColor;
      return o;
    }
    const ids = ["p1","p2","p3a","p3b","p3c","p4","p5","p6","p7","p8"];
    const report = { theme: document.body.getAttribute("data-theme") };
    for (const id of ids) report[id.toUpperCase()] = snap(document.getElementById(id));
    const focusEl = document.getElementById("p6");
    focusEl.focus();
    report.P6_FOCUS = snap(focusEl);
    focusEl.blur();
    // token snapshot
    const b = getComputedStyle(document.body);
    report.tokens = {
      border: b.getPropertyValue("--border").trim(),
      accent: b.getPropertyValue("--accent").trim(),
      frameW: b.getPropertyValue("--frame-w-panel").trim(),
      headerBg: b.getPropertyValue("--header-bg").trim(),
      chipBg: b.getPropertyValue("--chip-bg").trim(),
    };
    document.getElementById("out").textContent = JSON.stringify(report);
    document.title = "READY";
  </script>
</body>
</html>`;
}

function decode(pre) {
  return pre
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();
}

async function probeTheme(theme, port) {
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${join(rootFixed, ".tmp-b15-chrome-" + theme)}`,
      "--virtual-time-budget=8000",
      "--dump-dom",
      `http://127.0.0.1:${port}/?t=${theme}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  let stdout = "";
  child.stdout.on("data", (d) => (stdout += d.toString("utf8")));
  const code = await new Promise((r) => child.on("close", r));
  const m = stdout.match(/<pre id="out">([\s\S]*?)<\/pre>/);
  if (!m) throw new Error(`theme ${theme} failed code=${code}`);
  return JSON.parse(decode(m[1]));
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const theme = url.searchParams.get("t") || "dark";
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(buildHtml(theme));
    return;
  }
  const file = resolve(rootFixed, decodeURIComponent(url.pathname.slice(1)));
  if (!file.startsWith(rootFixed) || !existsSync(file)) {
    res.writeHead(404);
    res.end("missing");
    return;
  }
  res.writeHead(200, { "Content-Type": ctype(file) });
  res.end(readFileSync(file));
});

await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();

const report = {};
for (const theme of ["dark", "nordic", "kitty"]) {
  report[theme] = await probeTheme(theme, port);
}

server.close();

const outIdx = process.argv.indexOf("--out");
if (outIdx >= 0 && process.argv[outIdx + 1]) {
  const outPath = resolve(rootFixed, process.argv[outIdx + 1]);
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log("wrote", outPath);
}

for (const theme of ["dark", "nordic", "kitty"]) {
  const t = report[theme];
  console.log(`\n=== ${theme} tokens ${JSON.stringify(t.tokens)} ===`);
  for (const id of ["P1", "P2", "P3A", "P4", "P5", "P6_FOCUS", "P7", "P8"]) {
    const s = t[id];
    if (!s) continue;
    const bw = id === "P7" ? s.borderBottomWidth : s.borderTopWidth;
    const bc = id === "P7" ? s.borderBottomColor : s.borderTopColor;
    console.log(
      `${id}: bw=${bw} bc=${bc} bg=${s.backgroundColor} color=${s.color} shadow=${(s.boxShadow || "").slice(0, 50)}`
    );
  }
}
