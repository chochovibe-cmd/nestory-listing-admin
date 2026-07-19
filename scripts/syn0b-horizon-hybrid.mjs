/**
 * SYN-0b (Horizon store style): no-text B2 base + brand template text.
 *
 * Style source: docs/合成詳情圖打樣/品牌風格-來自Horizon主題.md
 * Default: reuse existing no-text bases (already cream minimal) — $0 API.
 * Optional: --regen-base  force images/edits (budget $0.25, 1 shared retry).
 *
 * Usage:
 *   node scripts/syn0b-horizon-hybrid.mjs
 *   node scripts/syn0b-horizon-hybrid.mjs --regen-base
 */
import {
  writeFileSync,
  readFileSync,
  existsSync,
  copyFileSync,
  unlinkSync
} from "node:fs";
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
  getOpenAiKey,
  fetchImageBuffer,
  estimateImageCostUsd,
  escapeHtml,
  writeJson
} from "./syn0-shared.mjs";

ensureDirs();

const REGEN = process.argv.includes("--regen-base");
const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

/** Horizon scheme-1 tokens (boss store / 品牌風格-來自Horizon主題.md) */
const H = {
  bg: "#faf8f3",
  surface: "#faf8f3",
  surface2: "#f5f3f0",
  title: "#2a2a2a",
  body: "#4a4a4a",
  ink: "#2a2a2a",
  inkSolid: "#000000",
  lineSoft: "rgba(0,0,0,0.06)",
  lineInput: "#dfdfdf",
  onInk: "#ffffff"
};

const FONT_TITLE = '"Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Microsoft JhengHei", serif';
const FONT_BODY =
  '"Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", "Microsoft JhengHei UI", sans-serif';

const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
const SIZE = "1024x1536";
const QUALITY = "medium";
const UNIT = estimateImageCostUsd(QUALITY);
const BUDGET_USD = 0.25;

const JOBS = [
  {
    productKey: "miffy_lamp",
    baseName: "米菲臺燈-混合-底圖.png",
    outName: "米菲臺燈-混合-B2底A字.png"
  },
  {
    productKey: "razer_mouse",
    baseName: "Razer皮卡丘滑鼠-混合-底圖.png",
    outName: "Razer皮卡丘滑鼠-混合-B2底A字.png"
  }
];

function noTextBasePrompt() {
  return [
    "Edit this product photo into a clean vertical ecommerce hero plate.",
    "Atmosphere: cream-white minimal studio (#faf8f3 feel), lots of negative space, soft natural light, quiet premium Taiwan lifestyle store — NOT colorful Taobao promo.",
    "Composition: product centered in the middle band; generous empty cream zones TOP and BOTTOM for later typography (clean solid/soft gradient only).",
    "CRITICAL — ZERO TEXT anywhere: no Chinese, no English letters, no numbers, no watermarks, no stickers, no badges, no UI labels.",
    "Keep product shape/colors faithful. Soften any on-product printed words so the plate reads as a silent marketing background.",
    "No separate cartoon mascots. Photoreal product only. Tall portrait."
  ].join("\n");
}

async function callEdits({ apiKey, prompt, imageBuffer, mimeType }) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", SIZE);
  form.append("quality", QUALITY);
  const ext =
    mimeType.includes("jpeg") || mimeType.includes("jpg")
      ? "jpg"
      : mimeType.includes("webp")
        ? "webp"
        : "png";
  const blob = new Blob([new Uint8Array(imageBuffer)], {
    type: mimeType.startsWith("image/") ? mimeType : "image/png"
  });
  form.append("image", blob, `source.${ext}`);
  const response = await fetch("https://api.openai.com/v1/images/edits", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  });
  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`images/edits failed (${response.status}): ${errText.slice(0, 280)}`);
  }
  const payload = await response.json();
  const data = payload?.data?.[0];
  if (data?.b64_json) return Buffer.from(data.b64_json, "base64");
  if (data?.url) {
    const fetched = await fetchImageBuffer(data.url);
    return fetched.buffer;
  }
  throw new Error("images/edits: no image");
}

function buildHorizonHtml(bundle, heroName) {
  const d = bundle.draft;
  const title = d.title_zh || "未命名商品";
  const brand = d.product_brand || "";
  const ip = d.ip_name || d.character_name || "";
  const type = d.product_type || "";
  const highlights = bundle.highlights.slice(0, 4);
  const specs = bundle.specRows;

  const metaBits = [brand, ip, type].filter(Boolean);
  const metaHtml = metaBits
    .map((x) => `<span class="meta-item">${escapeHtml(x)}</span>`)
    .join('<span class="meta-dot">·</span>');

  const hlHtml = highlights.length
    ? highlights
        .map(
          (h, i) =>
            `<li class="hl"><span class="n">${String(i + 1).padStart(2, "0")}</span><span class="t">${escapeHtml(h)}</span></li>`
        )
        .join("")
    : `<li class="hl"><span class="t">（草稿尚無賣點）</span></li>`;

  const specHtml = specs.length
    ? specs
        .map((r) => {
          if (r.key) {
            return `<tr><th>${escapeHtml(r.key)}</th><td>${escapeHtml(r.value)}</td></tr>`;
          }
          return `<tr><td colspan="2">${escapeHtml(r.value)}</td></tr>`;
        })
        .join("")
    : `<tr><td colspan="2">（草稿尚無規格）</td></tr>`;

  return `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1080" />
<title>SYN-0b Horizon hybrid</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    background: ${H.bg};
    color: ${H.body};
    font-family: ${FONT_BODY};
    -webkit-font-smoothing: antialiased;
  }
  body { padding: 0 0 56px; }
  .wrap { width: 1080px; margin: 0 auto; position: relative; }
  .wm {
    position: absolute; top: 20px; right: 28px; z-index: 5;
    font-size: 11px; letter-spacing: .08em; color: ${H.body};
    background: rgba(250,248,243,.92);
    border: 1px solid ${H.lineInput};
    border-radius: 999px; padding: 6px 12px;
  }
  .badge {
    position: absolute; top: 20px; left: 28px; z-index: 5;
    font-size: 11px; letter-spacing: .1em; font-weight: 600;
    color: ${H.onInk}; background: ${H.ink};
    border-radius: 999px; padding: 6px 12px;
  }
  .topbar {
    padding: 28px 48px 12px;
    display: flex; align-items: baseline; gap: 14px;
  }
  .logo {
    font-family: ${FONT_TITLE};
    font-size: 22px; font-weight: 600; letter-spacing: .18em;
    color: ${H.title}; text-transform: none;
  }
  .logo em {
    font-style: normal; font-family: ${FONT_BODY};
    font-size: 11px; letter-spacing: .22em; color: ${H.body};
    margin-left: 10px; font-weight: 500;
  }
  .hero {
    width: 100%;
    background: ${H.surface2};
    min-height: 720px;
    display: flex; align-items: center; justify-content: center;
    border-top: 1px solid ${H.lineSoft};
    border-bottom: 1px solid ${H.lineSoft};
  }
  .hero img {
    width: 100%; max-height: 900px; display: block;
    object-fit: contain; object-position: center center;
    background: ${H.bg};
  }
  .section {
    margin: 0 48px;
    padding: 36px 0 8px;
  }
  .section + .section {
    border-top: 1px solid ${H.lineSoft};
  }
  .kicker {
    font-family: ${FONT_BODY};
    font-size: 11px; letter-spacing: .2em; text-transform: uppercase;
    color: ${H.body}; margin-bottom: 14px; font-weight: 500;
  }
  .meta {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px;
    margin-bottom: 16px; color: ${H.body}; font-size: 13px; letter-spacing: .04em;
  }
  .meta-dot { opacity: .35; }
  h1 {
    font-family: ${FONT_TITLE};
    font-size: 36px; line-height: 1.4; font-weight: 600;
    color: ${H.title}; letter-spacing: .02em;
    margin: 0 0 12px;
  }
  .lead {
    font-size: 14px; line-height: 1.7; color: ${H.body};
    max-width: 48em;
  }
  h2 {
    font-family: ${FONT_TITLE};
    font-size: 20px; font-weight: 600; color: ${H.title};
    letter-spacing: .06em; margin-bottom: 20px;
  }
  ul.hls { list-style: none; display: grid; gap: 18px; }
  .hl {
    display: grid; grid-template-columns: 48px 1fr; gap: 16px;
    align-items: start;
  }
  .hl .n {
    font-family: ${FONT_TITLE};
    font-size: 15px; color: ${H.title}; letter-spacing: .08em;
    padding-top: 4px;
  }
  .hl .t {
    font-size: 17px; line-height: 1.65; color: ${H.body};
    border-bottom: 1px solid ${H.lineSoft}; padding-bottom: 16px;
  }
  li.hl:last-child .t { border-bottom: none; }
  table.spec {
    width: 100%; border-collapse: collapse; font-size: 15px;
  }
  table.spec th, table.spec td {
    text-align: left; vertical-align: top;
    padding: 14px 8px; border-bottom: 1px solid ${H.lineSoft};
  }
  table.spec th {
    width: 30%; font-weight: 500; color: ${H.body};
    font-size: 13px; letter-spacing: .04em;
  }
  table.spec td {
    color: ${H.title}; font-weight: 500; word-break: break-word;
  }
  .brand-row {
    display: grid; grid-template-columns: 1fr auto; gap: 24px;
    align-items: center;
  }
  .brand-row .label {
    font-size: 11px; letter-spacing: .18em; color: ${H.body}; margin-bottom: 10px;
  }
  .brand-row .name {
    font-family: ${FONT_TITLE};
    font-size: 26px; color: ${H.title}; font-weight: 600; line-height: 1.35;
  }
  .brand-row .type {
    margin-top: 8px; font-size: 14px; color: ${H.body};
  }
  .seal {
    background: ${H.ink}; color: ${H.onInk};
    font-family: ${FONT_TITLE};
    font-size: 14px; letter-spacing: .12em; line-height: 1.5;
    padding: 18px 20px; text-align: center; min-width: 132px;
  }
  .notice p {
    font-size: 14px; line-height: 1.85; color: ${H.body};
    max-width: 52em;
  }
  .foot {
    margin: 36px 48px 0; text-align: center;
    font-size: 11px; letter-spacing: .12em; color: ${H.body}; opacity: .75;
  }
  .card {
    background: ${H.surface2};
    border: 1px solid ${H.lineInput};
    padding: 28px 28px 20px;
  }
</style>
</head>
<body>
  <div class="wrap">
    <div class="badge">混合 · Horizon</div>
    <div class="wm">${escapeHtml(WATERMARK)}</div>
    <div class="topbar">
      <div class="logo">潮巢<em>NESTORY</em></div>
    </div>
    <div class="hero">
      <img id="hero" src="/hero/${escapeHtml(heroName)}?v=h1" alt="" />
    </div>
    <section class="section">
      <div class="kicker">Product</div>
      <div class="meta">${metaHtml}</div>
      <h1>${escapeHtml(title)}</h1>
      <p class="lead">混合打樣：AI 無字底圖 ＋ 店面 Horizon 風格疊字（規格取自草稿，未改寫）</p>
    </section>
    <section class="section">
      <div class="card">
        <h2>商品賣點</h2>
        <ul class="hls">${hlHtml}</ul>
      </div>
    </section>
    <section class="section">
      <h2>規格一覽</h2>
      <table class="spec">${specHtml}</table>
    </section>
    <section class="section">
      <div class="brand-row">
        <div>
          <div class="label">BRAND / IP</div>
          <div class="name">${escapeHtml(brand)}${ip ? ` × ${escapeHtml(ip)}` : ""}</div>
          <div class="type">${escapeHtml(type || "精選選品")}</div>
        </div>
        <div class="seal">潮巢嚴選<br/>正版</div>
      </div>
    </section>
    <section class="section notice">
      <h2>購買提醒</h2>
      <p>${escapeHtml(FIXED_BUY_NOTICE)}</p>
    </section>
    <p class="foot">${escapeHtml(WATERMARK)} · SYN-0b · Horizon store tokens</p>
  </div>
  <script>
  async function waitHero() {
    const img = document.getElementById('hero');
    for (let i = 0; i < 60; i++) {
      if (img.complete && img.naturalWidth > 20) return;
      await new Promise(r => setTimeout(r, 100));
    }
  }
  waitHero().then(() => { document.title = "SYN0B_READY"; });
  setTimeout(() => { document.title = "SYN0B_READY"; }, 9000);
  </script>
</body>
</html>`;
}

function runChromeScreenshot({ url, outPng, height }) {
  return new Promise((resolve, reject) => {
    const userData = join(
      TMP_DIR,
      `chrome-hz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    );
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        `--user-data-dir=${userData}`,
        `--window-size=1080,${height}`,
        `--screenshot=${outPng}`,
        "--virtual-time-budget=20000",
        url
      ],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    child.on("close", (code) => {
      if (!existsSync(outPng)) {
        reject(new Error(`Chrome screenshot missing code=${code}`));
        return;
      }
      resolve();
    });
  });
}

async function serveAndCapture({ html, heroPath, heroName, outPng }) {
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
  try {
    await new Promise((r) => setTimeout(r, 250));
    await runChromeScreenshot({
      url: `http://127.0.0.1:${port}/?ts=${Date.now()}`,
      outPng,
      height: 4200
    });
  } finally {
    server.close();
  }
}

async function trimPng(path) {
  const trimmed = await sharp(path)
    .trim({ threshold: 10 })
    .toBuffer({ resolveWithObject: true });
  let pipeline = sharp(trimmed.data);
  const m = trimmed.info;
  if (m.width !== 1080) {
    const left = Math.max(0, Math.floor((1080 - m.width) / 2));
    pipeline = pipeline.extend({
      top: 0,
      bottom: 32,
      left,
      right: Math.max(0, 1080 - m.width - left),
      background: H.bg
    });
  } else {
    pipeline = pipeline.extend({
      top: 0,
      bottom: 32,
      left: 0,
      right: 0,
      background: H.bg
    });
  }
  writeFileSync(
    path,
    await pipeline.resize({ width: 1080 }).png().toBuffer()
  );
}

async function ensureBase(job, state) {
  const basePath = join(OUT_DIR, job.baseName);
  if (!REGEN && existsSync(basePath)) {
    return {
      path: basePath,
      reused: true,
      costUsd: 0,
      note: "reused prior SYN-0b no-text base (cream minimal; no API)"
    };
  }

  const apiKey = getOpenAiKey();
  const bundle = await loadProductBundle(job.productKey);
  if (!bundle.mainUrl) throw new Error(`${job.productKey}: no mainUrl`);
  const src = await fetchImageBuffer(bundle.mainUrl);

  // Safer product-only prompt for Razer (IP safety history)
  let prompt = noTextBasePrompt();
  if (job.productKey === "razer_mouse") {
    prompt +=
      "\nProduct is a yellow wireless gaming mouse only. Do not draw separate characters or franchise art beyond what is on the product itself.";
  }

  while (true) {
    if (state.spent + UNIT > BUDGET_USD + 1e-9) {
      throw new Error(
        `Budget stop: spent=${state.spent.toFixed(2)} budget=${BUDGET_USD}`
      );
    }
    console.log(`  edits ${job.productKey} attempt...`);
    try {
      const buf = await callEdits({
        apiKey,
        prompt:
          state.retriesUsed > 0
            ? `${prompt}\nRETRY: remove ALL residual letters/numbers. More empty cream margins.`
            : prompt,
        imageBuffer: src.buffer,
        mimeType: src.mimeType
      });
      state.spent += UNIT;
      const norm = await sharp(buf).resize({ width: 1080 }).png().toBuffer();
      writeFileSync(basePath, norm);
      return {
        path: basePath,
        reused: false,
        costUsd: UNIT,
        note: "fresh edits base"
      };
    } catch (e) {
      const msg = String(e.message || e);
      console.error("  edit fail:", msg.slice(0, 200));
      if (state.retriesLeft > 0) {
        state.retriesLeft -= 1;
        state.retriesUsed += 1;
        // safer retry
        prompt =
          "Edit into cream-white minimal product hero plate, lots of empty space top and bottom. ZERO text/letters/numbers/watermarks. Photoreal product only, soft studio light. Tall portrait.";
        console.log("  retry with safer prompt...");
        continue;
      }
      throw e;
    }
  }
}

async function main() {
  if (!existsSync(chrome)) {
    throw new Error(`Chrome not found: ${chrome}`);
  }

  const fontReport = {
    title: "Noto Serif TC (installed)",
    body: "Noto Sans TC (installed)",
    fallback: "Microsoft JhengHei available as CSS fallback"
  };

  const state = { spent: 0, retriesLeft: 1, retriesUsed: 0 };
  const report = {
    package: "SYN-0b-Horizon",
    styleSource: "docs/合成詳情圖打樣/品牌風格-來自Horizon主題.md",
    tokens: H,
    fonts: fontReport,
    regenBase: REGEN,
    budgetUsd: BUDGET_USD,
    unitEstimateUsd: UNIT,
    startedAt: new Date().toISOString(),
    items: []
  };

  for (const job of JOBS) {
    console.log(`\n=== ${job.productKey} ===`);
    const bundle = await loadProductBundle(job.productKey);
    const base = await ensureBase(job, state);
    console.log("  base:", base.note);

    const heroName = `${PRODUCTS[job.productKey].fileStem}-hz-base.png`;
    const heroPath = join(TMP_DIR, heroName);
    const norm = await sharp(base.path).resize({ width: 1080 }).png().toBuffer();
    writeFileSync(heroPath, norm);

    const html = buildHorizonHtml(bundle, heroName);
    writeFileSync(
      join(OUT_DIR, "templates", `${PRODUCTS[job.productKey].fileStem}-hybrid-horizon.html`),
      html,
      "utf8"
    );

    const outPng = join(OUT_DIR, job.outName);
    if (existsSync(outPng)) unlinkSync(outPng);
    await serveAndCapture({ html, heroPath, heroName, outPng });
    await trimPng(outPng);

    report.items.push({
      productKey: job.productKey,
      ok: true,
      file: job.outName,
      baseFile: job.baseName,
      baseReused: base.reused,
      baseNote: base.note,
      costUsd: base.costUsd,
      draftId: bundle.draft.id,
      title: bundle.draft.title_zh,
      textSource: "draft fields 100% via Horizon HTML template (no LLM rewrite)",
      style: "Horizon scheme-1 cream minimal"
    });
    console.log("  wrote", job.outName);
  }

  report.finishedAt = new Date().toISOString();
  report.totalEstimateUsd = state.spent;
  report.retriesUsed = state.retriesUsed;
  writeJson(join(OUT_DIR, "syn0b-horizon-report.json"), report);
  console.log(
    `\nHorizon hybrid done. API est $${state.spent.toFixed(2)} / budget $${BUDGET_USD}`
  );
  console.log("Fonts:", fontReport.title, "+", fontReport.body);
}

main().catch((e) => {
  console.error("syn0b-horizon-hybrid failed:", e.message || e);
  process.exit(1);
});
