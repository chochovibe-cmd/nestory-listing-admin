/**
 * SYN-0 Route A: Nestory-style HTML template → Chrome headless PNG (1080 wide).
 * Usage: node scripts/syn0-run-a.mjs
 *
 * Outputs under docs/合成詳情圖打樣/
 * Does not write product_images / does not push.
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  writeFileSync,
  readFileSync,
  existsSync,
  unlinkSync
} from "node:fs";
import { join, resolve } from "node:path";
import {
  ROOT,
  OUT_DIR,
  TMP_DIR,
  PRODUCTS,
  FIXED_BUY_NOTICE,
  WATERMARK,
  ensureDirs,
  loadProductBundle,
  escapeHtml,
  writeJson
} from "./syn0-shared.mjs";

const chrome =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const THEMES = {
  nordic: {
    name: "nordic",
    bg: "#f4efe4",
    surface: "#fffdf6",
    surface2: "#eee7d8",
    border: "#1c1c1c",
    accent: "#58a9dc",
    accentFg: "#ffffff",
    accent2: "#d9272e",
    accent3: "#f6ce45",
    text: "#1f1f1f",
    muted: "#777064",
    success: "#3b8f83",
    radius: "16px",
    shadow: "0 3px 0 rgba(26,26,26,.06)"
  },
  dark: {
    name: "dark",
    bg: "#0d0d0f",
    surface: "#141418",
    surface2: "#1c1c22",
    border: "#2a2a38",
    accent: "#c8ff00",
    accentFg: "#0e0e12",
    accent2: "#ff6b9d",
    accent3: "#c8a8ff",
    text: "#f0edf8",
    muted: "#a09ab8",
    success: "#3ecfb0",
    radius: "16px",
    shadow: "0 3px 10px rgba(0,0,0,.18)"
  }
};

function buildHtml(bundle, themeKey) {
  const t = THEMES[themeKey];
  const d = bundle.draft;
  const title = d.title_zh || "未命名商品";
  const brand = d.product_brand || "—";
  const ip = d.ip_name || d.character_name || "";
  const type = d.product_type || "";
  const highlights = bundle.highlights.slice(0, 4);
  const specs = bundle.specRows;
  const hero = bundle.mainUrl || "";

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
<title>SYN-0 ${escapeHtml(title)} · ${themeKey}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: 1080px;
    background: ${t.bg};
    color: ${t.text};
    font-family: "Microsoft JhengHei", "Segoe UI", "Noto Sans TC", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  body { padding: 0 0 48px; }
  .wrap { width: 1080px; margin: 0 auto; position: relative; }
  .wm {
    position: absolute; top: 18px; right: 24px; z-index: 5;
    font-size: 13px; letter-spacing: .04em;
    color: ${t.muted}; background: color-mix(in srgb, ${t.surface} 88%, transparent);
    border: 1.5px solid ${t.border}; border-radius: 999px;
    padding: 6px 14px; opacity: .92;
  }
  .hero {
    width: 100%; background: ${t.surface2};
    min-height: 720px; display: flex; align-items: center; justify-content: center;
    border-bottom: 2px solid ${t.border};
  }
  .hero img {
    width: 100%; max-height: 900px; object-fit: contain; display: block;
    background: ${t.surface};
  }
  .panel {
    margin: 28px 40px 0;
    background: ${t.surface};
    border: 1.5px solid ${t.border};
    border-radius: ${t.radius};
    box-shadow: ${t.shadow};
    padding: 28px 32px;
  }
  .brand-row {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    margin-bottom: 14px;
  }
  .chip {
    display: inline-flex; align-items: center; gap: 6px;
    border: 1.5px solid ${t.border};
    border-radius: 999px; padding: 6px 14px;
    font-size: 14px; color: ${t.muted}; background: transparent;
  }
  .chip strong { color: ${t.text}; font-weight: 700; }
  .chip.accent {
    background: ${t.accent}; color: ${t.accentFg}; border-color: ${t.border};
  }
  h1 {
    font-size: 34px; line-height: 1.35; font-weight: 800;
    letter-spacing: .01em; margin: 8px 0 6px;
  }
  .sub { color: ${t.muted}; font-size: 15px; margin-bottom: 4px; }
  h2 {
    font-size: 18px; font-weight: 800; margin-bottom: 16px;
    padding-bottom: 10px; border-bottom: 2px solid ${t.border};
    display: flex; align-items: center; gap: 10px;
  }
  h2 .dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: ${t.accent}; box-shadow: 0 0 0 3px color-mix(in srgb, ${t.accent} 28%, transparent);
  }
  ul.hls { list-style: none; display: grid; gap: 14px; }
  .hl {
    display: grid; grid-template-columns: 36px 1fr; gap: 14px; align-items: start;
  }
  .hl .n {
    width: 36px; height: 36px; border-radius: 12px;
    background: ${t.accent}; color: ${t.accentFg};
    font-weight: 800; font-size: 16px;
    display: flex; align-items: center; justify-content: center;
  }
  .hl .t { font-size: 20px; line-height: 1.5; padding-top: 4px; }
  table.spec { width: 100%; border-collapse: collapse; font-size: 18px; }
  table.spec th, table.spec td {
    text-align: left; padding: 14px 12px; vertical-align: top;
    border-bottom: 1px solid color-mix(in srgb, ${t.border} 55%, transparent);
  }
  table.spec th {
    width: 32%; color: ${t.muted}; font-weight: 700; font-size: 15px;
  }
  table.spec td { font-weight: 600; word-break: break-word; }
  .brand-block {
    display: grid; grid-template-columns: 1fr auto; gap: 18px; align-items: center;
  }
  .brand-block .label { font-size: 13px; color: ${t.muted}; font-weight: 700; letter-spacing: .08em; }
  .brand-block .name { font-size: 26px; font-weight: 800; margin-top: 6px; }
  .brand-block .ip { margin-top: 8px; color: ${t.muted}; font-size: 16px; }
  .seal {
    border: 2.5px solid ${t.border};
    background: color-mix(in srgb, ${t.accent3} 55%, ${t.surface});
    color: ${t.text};
    font-weight: 800; font-size: 15px; letter-spacing: .06em;
    padding: 16px 18px; border-radius: 14px; text-align: center;
    min-width: 140px; line-height: 1.4;
    box-shadow: 4px 4px 0 color-mix(in srgb, ${t.border} 40%, transparent);
  }
  .notice p { font-size: 16px; line-height: 1.7; color: ${t.text}; }
  .foot {
    margin: 28px 40px 0; text-align: center;
    color: ${t.muted}; font-size: 13px; letter-spacing: .04em;
  }
  .logo {
    font-weight: 800; font-size: 22px; letter-spacing: .12em;
    margin: 0 40px; padding: 22px 0 0; color: ${t.text};
  }
  .logo span { color: ${t.accent}; }
</style>
</head>
<body data-theme="${themeKey}">
  <div class="wrap" id="root">
    <div class="wm">${escapeHtml(WATERMARK)}</div>
    <div class="logo">潮巢 <span>NESTORY</span></div>
    <div class="hero">
      ${
        hero
          ? `<img src="${escapeHtml(hero)}" alt="${escapeHtml(title)}" />`
          : `<div style="padding:80px;color:${t.muted}">（無主圖）</div>`
      }
    </div>
    <section class="panel">
      <div class="brand-row">
        ${brand ? `<span class="chip"><strong>${escapeHtml(brand)}</strong></span>` : ""}
        ${ip ? `<span class="chip">${escapeHtml(ip)}</span>` : ""}
        ${type ? `<span class="chip">${escapeHtml(type)}</span>` : ""}
        <span class="chip accent">潮巢嚴選</span>
      </div>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">商品資訊整理自草稿欄位 · 規格數字未改寫</p>
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
    <p class="foot">${escapeHtml(WATERMARK)} · route A · theme ${themeKey}</p>
  </div>
  <script>
    // signal ready after images load (or timeout)
    function done() { document.title = "SYN0_READY"; }
    const imgs = [...document.images];
    if (!imgs.length) { done(); }
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
    const userData = join(TMP_DIR, `chrome-a-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
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
            `Chrome screenshot missing (code=${code}). ${err.slice(0, 300) || "no stderr"}`
          )
        );
        return;
      }
      resolvePromise({ code, err: err.slice(0, 200) });
    });
  });
}

async function measureContentHeight(port, path) {
  // Use dump-dom + title READY, then approximate from fixed sections.
  // Chrome CLI cannot easily return height; we use a generous fixed canvas
  // and crop later if needed. For SYN-0, 3600 is usually enough.
  return 3600;
}

async function serveAndCapture(htmlPath, outPng, height) {
  const html = readFileSync(htmlPath);
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
    res.writeHead(404);
    res.end("no");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/?ts=${Date.now()}`;
  try {
    // Wait a beat so server is ready
    await new Promise((r) => setTimeout(r, 200));
    await runChromeScreenshot({ url, outPng, height });
  } finally {
    server.close();
  }
}

async function main() {
  if (!existsSync(chrome)) {
    throw new Error(`Chrome not found at ${chrome}. Set CHROME_PATH.`);
  }
  ensureDirs();

  const jobs = [
    { productKey: "miffy_lamp", theme: "nordic", outName: "米菲臺燈-A-模板合成-nordic.png" },
    { productKey: "miffy_lamp", theme: "dark", outName: "米菲臺燈-A-模板合成-dark.png" },
    { productKey: "razer_mouse", theme: "nordic", outName: "Razer皮卡丘滑鼠-A-模板合成-nordic.png" }
  ];

  const report = { route: "A", startedAt: new Date().toISOString(), items: [] };

  for (const job of jobs) {
    const t0 = Date.now();
    console.log(`A render ${job.productKey} theme=${job.theme}...`);
    const bundle = await loadProductBundle(job.productKey);
    if (!bundle.mainUrl) {
      console.warn(`  warn: no main image for ${job.productKey}`);
    }
    const html = buildHtml(bundle, job.theme);
    const htmlName = `${PRODUCTS[job.productKey].fileStem}-A-${job.theme}.html`;
    const htmlPath = join(OUT_DIR, "templates", htmlName);
    writeFileSync(htmlPath, html, "utf8");

    const outPng = join(OUT_DIR, job.outName);
    if (existsSync(outPng)) unlinkSync(outPng);

    const height = await measureContentHeight();
    await serveAndCapture(htmlPath, outPng, height);

    const ms = Date.now() - t0;
    const item = {
      productKey: job.productKey,
      theme: job.theme,
      file: job.outName,
      html: `templates/${htmlName}`,
      draftId: bundle.draft.id,
      title: bundle.draft.title_zh,
      mainUrlPresent: Boolean(bundle.mainUrl),
      durationMs: ms,
      costUsd: 0,
      specNumbers: bundle.specNumbers,
      highlights: bundle.highlights,
      specText: bundle.draft.spec_text
    };
    report.items.push(item);
    console.log(`  wrote ${job.outName} in ${ms}ms`);
  }

  report.finishedAt = new Date().toISOString();
  writeJson(join(OUT_DIR, "syn0-a-report.json"), report);
  console.log("A done. report → docs/合成詳情圖打樣/syn0-a-report.json");
}

main().catch((e) => {
  console.error("syn0-run-a failed:", e.message || e);
  process.exit(1);
});
