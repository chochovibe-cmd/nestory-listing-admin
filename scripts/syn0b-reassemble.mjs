/**
 * SYN-0b: re-assemble hybrid finals from existing bases (no OpenAI call).
 * Fixes empty-hero / load-race. Uses object-fit:contain.
 * node scripts/syn0b-reassemble.mjs
 */
import { writeFileSync, readFileSync, existsSync, copyFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  OUT_DIR,
  TMP_DIR,
  PRODUCTS,
  FIXED_BUY_NOTICE,
  WATERMARK,
  ensureDirs,
  loadProductBundle,
  escapeHtml
} from "./syn0-shared.mjs";

ensureDirs();

const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const THEME = {
  bg: "#f4efe4",
  surface: "#fffdf6",
  border: "#1c1c1c",
  accent: "#58a9dc",
  accentFg: "#ffffff",
  accent3: "#f6ce45",
  text: "#1f1f1f",
  muted: "#777064",
  radius: "16px",
  shadow: "0 3px 0 rgba(26,26,26,.06)"
};

function buildHtml(bundle, heroName) {
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
.hero{width:100%;background:${t.surface};border-bottom:2px solid ${t.border};min-height:700px;display:flex;align-items:center;justify-content:center}
.hero img{width:100%;max-height:920px;display:block;object-fit:contain;object-position:center center}
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
  <div class="hero"><img id="hero" src="/hero/${heroName}?v=2" alt="product" /></div>
  <section class="panel">
    <div class="brand-row">
      ${brand ? `<span class="chip"><strong>${escapeHtml(brand)}</strong></span>` : ""}
      ${ip ? `<span class="chip">${escapeHtml(ip)}</span>` : ""}
      ${type ? `<span class="chip">${escapeHtml(type)}</span>` : ""}
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
        <div class="name">${escapeHtml(brand)}${ip ? ` × ${escapeHtml(ip)}` : ""}</div>
        <div class="ip">${escapeHtml(type || "精選選品")}</div>
      </div>
      <div class="seal">潮巢嚴選<br/>正版</div>
    </div>
  </section>
  <section class="panel notice">
    <h2><span class="dot"></span>購買提醒</h2>
    <p>${escapeHtml(FIXED_BUY_NOTICE)}</p>
  </section>
  <p class="foot">${escapeHtml(WATERMARK)} · SYN-0b hybrid</p>
</div>
<script>
// wait until hero has non-zero natural size
async function waitHero() {
  const img = document.getElementById('hero');
  for (let i = 0; i < 50; i++) {
    if (img.complete && img.naturalWidth > 20) return;
    await new Promise(r => setTimeout(r, 100));
  }
}
waitHero().then(() => { document.title = "SYN0B_READY"; });
setTimeout(() => { document.title = "SYN0B_READY"; }, 8000);
</script>
</body></html>`;
}

async function assemble(productKey, baseFile, outName) {
  const bundle = await loadProductBundle(productKey);
  const basePath = join(OUT_DIR, baseFile);
  if (!existsSync(basePath)) throw new Error("missing base " + baseFile);

  const heroName = `${PRODUCTS[productKey].fileStem}-base-re.png`;
  const heroPath = join(TMP_DIR, heroName);
  // ensure PNG readable
  const norm = await sharp(basePath).resize({ width: 1080 }).png().toBuffer();
  writeFileSync(heroPath, norm);

  const html = buildHtml(bundle, heroName);
  writeFileSync(
    join(OUT_DIR, "templates", `${PRODUCTS[productKey].fileStem}-hybrid.html`),
    html,
    "utf8"
  );

  const outPng = join(OUT_DIR, outName);
  if (existsSync(outPng)) unlinkSync(outPng);

  const heroBytes = readFileSync(heroPath);
  const server = createServer((req, res) => {
    const u = new URL(req.url || "/", "http://127.0.0.1");
    if (u.pathname === "/" || u.pathname === "/index.html") {
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(html);
      return;
    }
    if (u.pathname.startsWith("/hero/")) {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "no-store"
      });
      res.end(heroBytes);
      return;
    }
    res.writeHead(404);
    res.end("no");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  await new Promise((r) => setTimeout(r, 300));

  await new Promise((resolve, reject) => {
    const userData = join(TMP_DIR, `chrome-re-${Date.now()}-${productKey}`);
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userData}`,
        "--window-size=1080,4000",
        `--screenshot=${outPng}`,
        "--virtual-time-budget=20000",
        `http://127.0.0.1:${port}/?ts=${Date.now()}`
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.on("close", (code) =>
      existsSync(outPng) ? resolve() : reject(new Error(`no shot ${code}`))
    );
  });
  server.close();

  const trimmed = await sharp(outPng)
    .trim({ threshold: 12 })
    .toBuffer({ resolveWithObject: true });
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
  console.log("reassembled", outName, "hero base bytes", norm.length);
}

await assemble("miffy_lamp", "米菲臺燈-混合-底圖.png", "米菲臺燈-混合-B2底A字.png");
await assemble(
  "razer_mouse",
  "Razer皮卡丘滑鼠-混合-底圖.png",
  "Razer皮卡丘滑鼠-混合-B2底A字.png"
);
console.log("done reassemble (no API cost)");
