/**
 * SYN-0b: safer Razer-only retry after safety block.
 * node scripts/syn0b-retry-razer.mjs
 */
import { writeFileSync, readFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  OUT_DIR,
  TMP_DIR,
  FIXED_BUY_NOTICE,
  WATERMARK,
  ensureDirs,
  loadProductBundle,
  getOpenAiKey,
  fetchImageBuffer,
  estimateImageCostUsd,
  escapeHtml,
  writeJson
} from "./syn0-shared.mjs";

ensureDirs();

const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const MODEL = "gpt-image-1";
const SIZE = "1024x1536";
const QUALITY = "medium";
const UNIT = estimateImageCostUsd(QUALITY);

const THEME = {
  bg: "#f4efe4",
  surface: "#fffdf6",
  surface2: "#eee7d8",
  border: "#1c1c1c",
  accent: "#58a9dc",
  accentFg: "#ffffff",
  accent3: "#f6ce45",
  text: "#1f1f1f",
  muted: "#777064",
  radius: "16px",
  shadow: "0 3px 0 rgba(26,26,26,.06)"
};

const apiKey = getOpenAiKey();
const bundle = await loadProductBundle("razer_mouse");
const src = await fetchImageBuffer(bundle.mainUrl);

const prompt = [
  "Edit this product photo into a clean vertical ecommerce hero plate.",
  "Soft Nordic light studio, warm off-white background, premium lifestyle store mood.",
  "Product large and centered in the upper 55-60%. Lower 35-40% is empty soft cream color block for later text overlay.",
  "CRITICAL: ZERO text — no letters, numbers, watermarks, stickers, captions, badges, UI.",
  "Keep the physical product appearance (yellow wireless mouse). Do not add cartoon characters or separate mascots.",
  "If packaging text is visible, soften so the plate feels text-free as a marketing background.",
  "Photoreal only. Tall portrait."
].join("\n");

async function callEdits(p) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", p);
  form.append("n", "1");
  form.append("size", SIZE);
  form.append("quality", QUALITY);
  const blob = new Blob([new Uint8Array(src.buffer)], {
    type: src.mimeType.startsWith("image/") ? src.mimeType : "image/png"
  });
  form.append("image", blob, "source.png");
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`edits ${response.status}: ${errText.slice(0, 280)}`);
  }
  const payload = await response.json();
  const data = payload?.data?.[0];
  if (data?.b64_json) return Buffer.from(data.b64_json, "base64");
  throw new Error("no b64");
}

function buildHtml(heroName) {
  const t = THEME;
  const d = bundle.draft;
  const title = d.title_zh || "";
  const brand = d.product_brand || "";
  const ip = d.ip_name || d.character_name || "";
  const type = d.product_type || "";
  const highlights = bundle.highlights.slice(0, 4);
  const specs = bundle.specRows;
  const hlHtml = highlights
    .map(
      (h, i) =>
        `<li class="hl"><span class="n">${i + 1}</span><span class="t">${escapeHtml(h)}</span></li>`
    )
    .join("");
  const specHtml = specs
    .map((r) =>
      r.key
        ? `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value)}</td></tr>`
        : `<tr><td colspan="2">${escapeHtml(r.value)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8" />
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1080px;background:${t.bg};color:${t.text};font-family:"Microsoft JhengHei","Segoe UI",sans-serif}
body{padding:0 0 40px}
.wrap{width:1080px;position:relative}
.wm{position:absolute;top:18px;right:24px;z-index:5;font-size:13px;color:${t.muted};background:${t.surface};border:1.5px solid ${t.border};border-radius:999px;padding:6px 14px}
.badge-mix{position:absolute;top:18px;left:24px;z-index:5;font-size:12px;font-weight:800;color:${t.accentFg};background:${t.accent};border:1.5px solid ${t.border};border-radius:999px;padding:6px 12px}
.hero{width:100%;border-bottom:2px solid ${t.border}}
.hero img{width:100%;display:block;max-height:980px;object-fit:cover;object-position:center top}
.panel{margin:24px 40px 0;background:${t.surface};border:1.5px solid ${t.border};border-radius:${t.radius};box-shadow:${t.shadow};padding:26px 30px}
.brand-row{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px}
.chip{border:1.5px solid ${t.border};border-radius:999px;padding:6px 14px;font-size:14px;color:${t.muted}}
.chip strong{color:${t.text}}.chip.accent{background:${t.accent};color:${t.accentFg}}
h1{font-size:32px;line-height:1.35;font-weight:800;margin:6px 0}
.sub{color:${t.muted};font-size:14px}
h2{font-size:18px;font-weight:800;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid ${t.border};display:flex;align-items:center;gap:10px}
h2 .dot{width:10px;height:10px;border-radius:50%;background:${t.accent}}
ul.hls{list-style:none;display:grid;gap:12px}
.hl{display:grid;grid-template-columns:36px 1fr;gap:12px}
.hl .n{width:36px;height:36px;border-radius:12px;background:${t.accent};color:${t.accentFg};font-weight:800;display:flex;align-items:center;justify-content:center}
.hl .t{font-size:19px;line-height:1.5;padding-top:4px}
table.spec{width:100%;border-collapse:collapse;font-size:17px}
table.spec th,table.spec td{text-align:left;padding:12px 10px;border-bottom:1px solid rgba(28,28,28,.25)}
table.spec th{width:32%;color:${t.muted};font-weight:700;font-size:14px}
table.spec td{font-weight:600;word-break:break-word}
.brand-block{display:grid;grid-template-columns:1fr auto;gap:16px;align-items:center}
.brand-block .label{font-size:12px;color:${t.muted};font-weight:700}
.brand-block .name{font-size:24px;font-weight:800;margin-top:6px}
.brand-block .ip{margin-top:6px;color:${t.muted}}
.seal{border:2.5px solid ${t.border};background:color-mix(in srgb,${t.accent3} 55%,${t.surface});font-weight:800;font-size:15px;padding:14px 16px;border-radius:14px;text-align:center;line-height:1.4}
.notice p{font-size:15px;line-height:1.7}
.foot{margin:22px 40px 0;text-align:center;color:${t.muted};font-size:12px}
.logo{font-weight:800;font-size:20px;letter-spacing:.12em;margin:0 40px;padding:18px 0 0}
.logo span{color:${t.accent}}
</style></head>
<body>
<div class="wrap">
  <div class="badge-mix">混合 · B2底 + A字</div>
  <div class="wm">${escapeHtml(WATERMARK)}</div>
  <div class="logo">潮巢 <span>NESTORY</span></div>
  <div class="hero"><img src="/hero/${heroName}" alt="" /></div>
  <section class="panel">
    <div class="brand-row">
      <span class="chip"><strong>${escapeHtml(brand)}</strong></span>
      <span class="chip">${escapeHtml(ip)}</span>
      <span class="chip">${escapeHtml(type)}</span>
      <span class="chip accent">潮巢嚴選</span>
    </div>
    <h1>${escapeHtml(title)}</h1>
    <p class="sub">混合打樣：AI 無字底圖 + 草稿欄位原文疊字（規格未改寫）</p>
  </section>
  <section class="panel">
    <h2><span class="dot"></span>商品賣點</h2>
    <ul class="hls">${hlHtml}</ul>
  </section>
  <section class="panel">
    <h2><span class="dot"></span>規格一覽</h2>
    <table class="spec">${specHtml}</table>
  </section>
  <section class="panel">
    <div class="brand-block">
      <div>
        <div class="label">BRAND / IP</div>
        <div class="name">${escapeHtml(brand)} × ${escapeHtml(ip)}</div>
        <div class="ip">${escapeHtml(type)}</div>
      </div>
      <div class="seal">潮巢嚴選<br/>正版</div>
    </div>
  </section>
  <section class="panel notice">
    <h2><span class="dot"></span>購買提醒</h2>
    <p>${escapeHtml(FIXED_BUY_NOTICE)}</p>
  </section>
  <p class="foot">${escapeHtml(WATERMARK)} · SYN-0b hybrid · safer Razer retry</p>
</div>
<script>
function done(){ document.title = "SYN0B_READY"; }
const imgs = [...document.images];
let left = imgs.length;
if (!left) done();
imgs.forEach(img => {
  if (img.complete) { left--; if (!left) done(); }
  else { img.onload = img.onerror = () => { left--; if (!left) done(); }; }
});
setTimeout(done, 12000);
</script>
</body></html>`;
}

console.log("Razer safer edits...");
const t0 = Date.now();
const baseBuf = await callEdits(prompt);
console.log("base ok", Date.now() - t0, "ms");

const basePath = join(OUT_DIR, "Razer皮卡丘滑鼠-混合-底圖.png");
const baseNorm = await sharp(baseBuf).resize({ width: 1080 }).png().toBuffer();
writeFileSync(basePath, baseNorm);

const heroName = "Razer-base.png";
const heroPath = join(TMP_DIR, heroName);
copyFileSync(basePath, heroPath);

const html = buildHtml(heroName);
writeFileSync(join(OUT_DIR, "templates", "Razer皮卡丘滑鼠-hybrid.html"), html, "utf8");

const outPng = join(OUT_DIR, "Razer皮卡丘滑鼠-混合-B2底A字.png");
if (existsSync(outPng)) unlinkSync(outPng);

const heroBytes = readFileSync(heroPath);
const server = createServer((req, res) => {
  const u = new URL(req.url || "/", "http://127.0.0.1");
  if (u.pathname === "/" || u.pathname === "/index.html") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }
  if (u.pathname === `/hero/${heroName}`) {
    res.writeHead(200, { "Content-Type": "image/png" });
    res.end(heroBytes);
    return;
  }
  res.writeHead(404);
  res.end("no");
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const { port } = server.address();
await new Promise((r) => setTimeout(r, 200));
await new Promise((resolve, reject) => {
  const userData = join(TMP_DIR, `chrome-razer-${Date.now()}`);
  const child = spawn(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${userData}`,
      "--window-size=1080,3600",
      `--screenshot=${outPng}`,
      "--virtual-time-budget=15000",
      `http://127.0.0.1:${port}/?ts=${Date.now()}`
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
  child.on("close", (code) =>
    existsSync(outPng) ? resolve() : reject(new Error(`no shot ${code}`))
  );
});
server.close();

const trimmed = await sharp(outPng).trim({ threshold: 12 }).toBuffer({ resolveWithObject: true });
let pipeline = sharp(trimmed.data);
const m = trimmed.info;
if (m.width !== 1080) {
  const left = Math.max(0, Math.floor((1080 - m.width) / 2));
  pipeline = pipeline.extend({
    top: 0,
    bottom: 28,
    left,
    right: Math.max(0, 1080 - m.width - left),
    background: THEME.bg
  });
} else {
  pipeline = pipeline.extend({
    top: 0,
    bottom: 28,
    left: 0,
    right: 0,
    background: THEME.bg
  });
}
writeFileSync(outPng, await pipeline.resize({ width: 1080 }).png().toBuffer());
console.log("wrote", outPng);

const reportPath = join(OUT_DIR, "syn0b-report.json");
const report = JSON.parse(readFileSync(reportPath, "utf8"));
report.items = (report.items || []).filter(
  (x) => !(x.productKey === "razer_mouse" && x.ok === false)
);
const prevTotal = Number(report.totalEstimateUsd || 0.07);
report.items.push({
  productKey: "razer_mouse",
  ok: true,
  file: "Razer皮卡丘滑鼠-混合-B2底A字.png",
  baseFile: "Razer皮卡丘滑鼠-混合-底圖.png",
  draftId: bundle.draft.id,
  title: bundle.draft.title_zh,
  attempts: 1,
  costUsd: UNIT,
  spentEstimateUsd: prevTotal + UNIT,
  baseNote:
    "first call safety-blocked; safer product-only prompt succeeded (counts as the one allowed retry)",
  safetyRetry: true,
  textSource: "draft fields via A-style HTML (100% copy)",
  assemble: "Chrome headless + sharp trim"
});
report.totalEstimateUsd = prevTotal + UNIT;
report.finishedAt = new Date().toISOString();
writeJson(reportPath, report);
console.log("report total_est=$" + report.totalEstimateUsd.toFixed(2));
