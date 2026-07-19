/**
 * SYN-0b hybrid samples: B2-style no-text base (images/edits) + A typography overlay.
 *
 * Budget: medium × 2 ≈ $0.14, hard cap $0.25 (one retry shared).
 * Usage: node scripts/syn0b-run-hybrid.mjs
 *
 * Never logs OPENAI_API_KEY. Does not write product_images / no push.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync,
  copyFileSync
} from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
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

const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
const SIZE = "1024x1536";
const QUALITY = "medium";
const UNIT = estimateImageCostUsd(QUALITY);
const BUDGET_USD = 0.25;

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

function noTextBasePrompt(bundle) {
  const d = bundle.draft;
  const brand = d.product_brand || "";
  const type = d.product_type || "";
  return [
    "Edit this product photo into a clean vertical ecommerce HERO / background plate.",
    "Style: soft Nordic light studio, warm off-white and gentle gradients, premium Taiwan lifestyle store mood (Nestory).",
    "Composition: product large and centered in the UPPER 55–60% of the frame.",
    "LOWER 35–40%: soft empty clean color-block zone (warm cream / soft white) for later text overlay — no objects, no logos there.",
    "Optional very soft empty band at the very top margin too.",
    "CRITICAL — ZERO TEXT:",
    "- The image must contain NO text of any kind: no Chinese, no English letters, no numbers, no watermarks, no price tags, no brand wordmarks as readable type, no labels, no captions.",
    "- If the source product has printed words/logos on the physical product, keep product shape/colors but minimize or soften on-product text so the plate feels text-free for marketing background use.",
    "- Do NOT invent packaging text, slogans, UI chrome, badges, or stickers.",
    "No cartoon mascot illustrations separate from the product. Photoreal product focus.",
    `Product category hint only (do not render as text): ${brand} ${type}`.trim(),
    "Output a tall portrait image suitable as a silent background under typography."
  ]
    .join("\n")
    .slice(0, 3000);
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
  throw new Error("images/edits: no b64_json or url");
}

/**
 * Lightweight heuristic: if too many high-frequency edges in lower band,
 * may still have text. Not perfect — worker also visual-checks.
 * Returns { suspectText: boolean, note }.
 */
async function heuristicTextSuspect(pngBuf) {
  const { data, info } = await sharp(pngBuf)
    .resize(256, 384, { fit: "fill" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;
  // Sample lower 40% for sharp local contrast (text strokes)
  let edge = 0;
  let n = 0;
  const y0 = Math.floor(h * 0.58);
  for (let y = y0; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const dx = Math.abs(data[i] - data[i - 1]);
      const dy = Math.abs(data[i] - data[i - w]);
      if (dx + dy > 40) edge++;
      n++;
    }
  }
  const ratio = n ? edge / n : 0;
  // Threshold tuned loosely; visual check is authority
  return {
    suspectText: ratio > 0.12,
    edgeRatio: Number(ratio.toFixed(4)),
    note:
      ratio > 0.12
        ? "lower-band edge density high (possible residual text/detail)"
        : "lower-band relatively smooth"
  };
}

function buildHybridHtml(bundle, heroLocalName) {
  const t = THEME;
  const d = bundle.draft;
  const title = d.title_zh || "未命名商品";
  const brand = d.product_brand || "—";
  const ip = d.ip_name || d.character_name || "";
  const type = d.product_type || "";
  const highlights = bundle.highlights.slice(0, 4);
  const specs = bundle.specRows;

  const hlHtml = highlights.length
    ? highlights
        .map(
          (h, i) =>
            `<li class="hl"><span class="n">${i + 1}</span><span class="t">${escapeHtml(h)}</span></li>`
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
<title>SYN-0b hybrid</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    background: ${t.bg};
    color: ${t.text};
    font-family: "Microsoft JhengHei", "Segoe UI", "Noto Sans TC", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body { padding: 0 0 40px; }
  .wrap { width: 1080px; margin: 0 auto; position: relative; }
  .wm {
    position: absolute; top: 18px; right: 24px; z-index: 5;
    font-size: 13px; letter-spacing: .04em;
    color: ${t.muted}; background: color-mix(in srgb, ${t.surface} 90%, transparent);
    border: 1.5px solid ${t.border}; border-radius: 999px;
    padding: 6px 14px; opacity: .92;
  }
  .badge-mix {
    position: absolute; top: 18px; left: 24px; z-index: 5;
    font-size: 12px; font-weight: 800; letter-spacing: .06em;
    color: ${t.accentFg}; background: ${t.accent};
    border: 1.5px solid ${t.border}; border-radius: 999px;
    padding: 6px 12px;
  }
  .hero {
    width: 100%; background: ${t.surface2};
    border-bottom: 2px solid ${t.border};
    min-height: 620px;
  }
  .hero {
    min-height: 700px; display: flex; align-items: center; justify-content: center;
  }
  .hero img {
    width: 100%; display: block; max-height: 920px; object-fit: contain; object-position: center center;
    background: ${t.surface};
  }
  .panel {
    margin: 24px 40px 0;
    background: ${t.surface};
    border: 1.5px solid ${t.border};
    border-radius: ${t.radius};
    box-shadow: ${t.shadow};
    padding: 26px 30px;
  }
  .brand-row { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 12px; }
  .chip {
    display: inline-flex; border: 1.5px solid ${t.border};
    border-radius: 999px; padding: 6px 14px; font-size: 14px; color: ${t.muted};
  }
  .chip strong { color: ${t.text}; }
  .chip.accent { background: ${t.accent}; color: ${t.accentFg}; }
  h1 { font-size: 32px; line-height: 1.35; font-weight: 800; margin: 6px 0; }
  .sub { color: ${t.muted}; font-size: 14px; }
  h2 {
    font-size: 18px; font-weight: 800; margin-bottom: 14px;
    padding-bottom: 10px; border-bottom: 2px solid ${t.border};
    display: flex; align-items: center; gap: 10px;
  }
  h2 .dot {
    width: 10px; height: 10px; border-radius: 50%; background: ${t.accent};
    box-shadow: 0 0 0 3px color-mix(in srgb, ${t.accent} 28%, transparent);
  }
  ul.hls { list-style: none; display: grid; gap: 12px; }
  .hl { display: grid; grid-template-columns: 36px 1fr; gap: 12px; }
  .hl .n {
    width: 36px; height: 36px; border-radius: 12px;
    background: ${t.accent}; color: ${t.accentFg};
    font-weight: 800; display: flex; align-items: center; justify-content: center;
  }
  .hl .t { font-size: 19px; line-height: 1.5; padding-top: 4px; }
  table.spec { width: 100%; border-collapse: collapse; font-size: 17px; }
  table.spec th, table.spec td {
    text-align: left; padding: 12px 10px; vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, ${t.border} 55%, transparent);
  }
  table.spec th { width: 32%; color: ${t.muted}; font-weight: 700; font-size: 14px; }
  table.spec td { font-weight: 600; word-break: break-word; }
  .brand-block {
    display: grid; grid-template-columns: 1fr auto; gap: 16px; align-items: center;
  }
  .brand-block .label { font-size: 12px; color: ${t.muted}; font-weight: 700; letter-spacing: .08em; }
  .brand-block .name { font-size: 24px; font-weight: 800; margin-top: 6px; }
  .brand-block .ip { margin-top: 6px; color: ${t.muted}; font-size: 15px; }
  .seal {
    border: 2.5px solid ${t.border};
    background: color-mix(in srgb, ${t.accent3} 55%, ${t.surface});
    font-weight: 800; font-size: 15px; padding: 14px 16px; border-radius: 14px;
    text-align: center; line-height: 1.4;
    box-shadow: 4px 4px 0 color-mix(in srgb, ${t.border} 40%, transparent);
  }
  .notice p { font-size: 15px; line-height: 1.7; }
  .foot { margin: 22px 40px 0; text-align: center; color: ${t.muted}; font-size: 12px; }
  .logo {
    font-weight: 800; font-size: 20px; letter-spacing: .12em;
    margin: 0 40px; padding: 18px 0 0;
  }
  .logo span { color: ${t.accent}; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="badge-mix">混合 · B2底 + A字</div>
    <div class="wm">${escapeHtml(WATERMARK)}</div>
    <div class="logo">潮巢 <span>NESTORY</span></div>
    <div class="hero">
      <img src="/hero/${escapeHtml(heroLocalName)}" alt="" />
    </div>
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
    <p class="foot">${escapeHtml(WATERMARK)} · SYN-0b hybrid · nordic text panels</p>
  </div>
  <script>
    function done(){ document.title = "SYN0B_READY"; }
    const imgs = [...document.images];
    if (!imgs.length) done();
    else {
      let left = imgs.length;
      const tick = () => { left -= 1; if (left <= 0) done(); };
      imgs.forEach(img => {
        if (img.complete) tick();
        else { img.onload = tick; img.onerror = tick; }
      });
      setTimeout(done, 12000);
    }
  </script>
</body>
</html>`;
}

function runChromeScreenshot({ url, outPng, height }) {
  return new Promise((resolvePromise, reject) => {
    const userData = join(
      TMP_DIR,
      `chrome-0b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    );
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--user-data-dir=${userData}`,
      `--window-size=1080,${height}`,
      `--screenshot=${outPng}`,
      "--virtual-time-budget=15000",
      url
    ];
    const child = spawn(chrome, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString("utf8");
    });
    child.on("close", (code) => {
      if (!existsSync(outPng)) {
        reject(
          new Error(
            `Chrome screenshot missing (code=${code}). ${err.slice(0, 280) || "no stderr"}`
          )
        );
        return;
      }
      resolvePromise({ code });
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
    if (u.pathname === `/hero/${heroName}`) {
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
    await new Promise((r) => setTimeout(r, 200));
    await runChromeScreenshot({
      url: `http://127.0.0.1:${port}/?ts=${Date.now()}`,
      outPng,
      height: 3600
    });
  } finally {
    server.close();
  }
}

async function trimPng(path) {
  const trimmed = await sharp(path)
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
  const out = await pipeline
    .resize({ width: 1080, withoutEnlargement: false })
    .png()
    .toBuffer();
  writeFileSync(path, out);
}

async function main() {
  if (!existsSync(chrome)) {
    throw new Error(`Chrome not found at ${chrome}. Set CHROME_PATH.`);
  }
  ensureDirs();
  const apiKey = getOpenAiKey();

  const jobs = [
    {
      productKey: "miffy_lamp",
      outName: "米菲臺燈-混合-B2底A字.png",
      baseName: "米菲臺燈-混合-底圖.png"
    },
    {
      productKey: "razer_mouse",
      outName: "Razer皮卡丘滑鼠-混合-B2底A字.png",
      baseName: "Razer皮卡丘滑鼠-混合-底圖.png"
    }
  ];

  let spent = 0;
  let retriesLeft = 1;
  const report = {
    package: "SYN-0b",
    model: MODEL,
    size: SIZE,
    quality: QUALITY,
    unitEstimateUsd: UNIT,
    budgetUsd: BUDGET_USD,
    startedAt: new Date().toISOString(),
    items: []
  };

  for (const job of jobs) {
    console.log(`\n=== hybrid ${job.productKey} ===`);
    const bundle = await loadProductBundle(job.productKey);
    if (!bundle.mainUrl) throw new Error(`${job.productKey}: no mainUrl`);

    const src = await fetchImageBuffer(bundle.mainUrl);
    const prompt = noTextBasePrompt(bundle);

    let baseBuf = null;
    let attempts = 0;
    let baseNote = "";
    let heuristic = null;

    while (true) {
      if (spent + UNIT > BUDGET_USD + 1e-9) {
        throw new Error(
          `Budget stop before edit: spent_est=${spent.toFixed(2)} budget=${BUDGET_USD}`
        );
      }
      attempts += 1;
      const t0 = Date.now();
      console.log(`  edits attempt ${attempts}...`);
      try {
        baseBuf = await callEdits({
          apiKey,
          prompt:
            attempts === 1
              ? prompt
              : `${prompt}\nRETRY: previous output still had text. Remove ALL remaining letters/numbers. More empty cream zone at bottom.`,
          imageBuffer: src.buffer,
          mimeType: src.mimeType
        });
      } catch (e) {
        console.error(`  edit fail: ${String(e.message || e).slice(0, 200)}`);
        report.items.push({
          productKey: job.productKey,
          ok: false,
          stage: "edits",
          error: String(e.message || e).slice(0, 400),
          attempts,
          costUsd: 0
        });
        break;
      }
      spent += UNIT;
      const ms = Date.now() - t0;
      heuristic = await heuristicTextSuspect(baseBuf);
      console.log(
        `  base ok ${ms}ms est$${UNIT} spent_est$${spent.toFixed(2)} edge=${heuristic.edgeRatio} suspect=${heuristic.suspectText}`
      );

      if (!heuristic.suspectText) {
        baseNote = "heuristic clean lower band";
        break;
      }
      if (retriesLeft > 0) {
        retriesLeft -= 1;
        baseNote = "heuristic suspect residual text → retry once";
        console.log("  " + baseNote);
        continue;
      }
      baseNote =
        "heuristic still suspects text after retry — delivering as-is (visual check required)";
      console.log("  " + baseNote);
      break;
    }

    if (!baseBuf) continue;

    const basePath = join(OUT_DIR, job.baseName);
    // Normalize base to PNG width 1080 for stable hero crop via sharp
    const baseNorm = await sharp(baseBuf)
      .resize({ width: 1080, withoutEnlargement: false })
      .png()
      .toBuffer();
    writeFileSync(basePath, baseNorm);

    const heroName = `${PRODUCTS[job.productKey].fileStem}-base.png`;
    const heroPath = join(TMP_DIR, heroName);
    copyFileSync(basePath, heroPath);

    const html = buildHybridHtml(bundle, heroName);
    const htmlPath = join(
      OUT_DIR,
      "templates",
      `${PRODUCTS[job.productKey].fileStem}-hybrid.html`
    );
    writeFileSync(htmlPath, html, "utf8");

    const outPng = join(OUT_DIR, job.outName);
    if (existsSync(outPng)) unlinkSync(outPng);
    await serveAndCapture({ html, heroPath, heroName, outPng });
    await trimPng(outPng);

    report.items.push({
      productKey: job.productKey,
      ok: true,
      file: job.outName,
      baseFile: job.baseName,
      draftId: bundle.draft.id,
      title: bundle.draft.title_zh,
      attempts,
      costUsd: attempts * UNIT,
      spentEstimateUsd: spent,
      baseHeuristic: heuristic,
      baseNote,
      textSource: "draft fields via A-style HTML (100% copy, no LLM rewrite)",
      assemble: "Chrome headless screenshot of A panels over AI base hero + sharp trim"
    });
    console.log(`  wrote ${job.outName}`);
  }

  report.finishedAt = new Date().toISOString();
  report.totalEstimateUsd = spent;
  report.retriesRemaining = retriesLeft;
  writeJson(join(OUT_DIR, "syn0b-report.json"), report);
  console.log(
    `\nSYN-0b done. total_est=$${spent.toFixed(2)} / budget $${BUDGET_USD}`
  );
}

main().catch((e) => {
  console.error("syn0b-run-hybrid failed:", e.message || e);
  process.exit(1);
});
