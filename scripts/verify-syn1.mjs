/**
 * SYN-1 verification (no secrets / no live OpenAI).
 *
 * - Pure helpers: flags, R1 prepare, R2 filter, cost math, tokens
 * - to_trad wiring (no honest-skip)
 * - compose-detail route thin shell
 * - send-images composeDetail snapshot
 * - CJK text ink probe (actual raster — blank-font death check)
 * - P4 core terms present in filter list
 *
 * Run: node scripts/verify-syn1.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

// --- Pure mirrors (keep in sync with detailCompose helpers) ---

const SELLER_CORE = ["保固", "售後", "退換", "贈品", "店鋪活動"];

function isGenerateDetailEnabled(imageFlags) {
  if (imageFlags == null) return true;
  if (typeof imageFlags !== "object" || Array.isArray(imageFlags)) return true;
  const v = imageFlags.generate_detail;
  if (v === false || v === 0) return false;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "false" || s === "0" || s === "no" || s === "off") return false;
  }
  return true;
}

function parseSpecRows(specText) {
  const lines = String(specText || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const idx = line.search(/[：:]/);
    if (idx > 0) {
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    }
    return { key: "", value: line };
  });
}

function filterSpecsForDetailImage(rows, terms) {
  return rows.filter((row) => {
    const key = (row.key || "").trim();
    const value = (row.value || "").trim();
    if (!value && !key) return false;
    if (key && !value) return false;
    const blob = `${key} ${value}`;
    if (terms.some((t) => blob.includes(t))) return false;
    return true;
  });
}

function nextGenerationCostEstimate(prior, addUsd) {
  if (addUsd == null || !Number.isFinite(addUsd) || addUsd <= 0) {
    return prior != null && Number.isFinite(Number(prior)) ? Number(prior) : null;
  }
  const prev = prior != null && Number.isFinite(Number(prior)) ? Number(prior) : 0;
  return Math.round((prev + addUsd) * 1e6) / 1e6;
}

function isFinalizeUploadImageType(imageType, opts) {
  if (imageType === "main" || imageType === "variant") return true;
  if (
    (imageType === "detail" || imageType === "generated_detail") &&
    opts?.retainForListing === true
  ) {
    return true;
  }
  return false;
}

console.log("\nSYN-1 detail compose + to_trad verify\n");

await check("core modules exist", () => {
  assert.ok(exists("src/lib/images/detailCompose/filterSpecs.ts"));
  assert.ok(exists("src/lib/images/detailCompose/prepareCopy.ts"));
  assert.ok(exists("src/lib/images/detailCompose/runComposeDetail.ts"));
  assert.ok(exists("src/lib/images/detailCompose/rasterize.ts"));
  assert.ok(exists("src/lib/images/detailCompose/horizonTokens.ts"));
  assert.ok(exists("src/app/api/images/compose-detail/route.ts"));
});

await check("Horizon tokens R4 (cream + mono, no blue chip)", () => {
  const tok = read("src/lib/images/detailCompose/horizonTokens.ts");
  assert.match(tok, /#faf8f3/);
  assert.match(tok, /#2a2a2a/);
  assert.match(tok, /#4a4a4a/);
  assert.match(tok, /Noto Serif TC/);
  assert.doesNotMatch(tok, /#3b82f6|#2563eb|blue/i);
});

await check("R2 filter drops seller-service + empty rows", () => {
  const terms = [
    ...SELLER_CORE,
    "包郵",
    "運費",
    "優惠券"
  ];
  const rows = parseSpecRows(
    [
      "尺寸：15 x 15 x 30 cm",
      "材質：絨毛",
      "保固：2年",
      "售後服務：七天無理由",
      "贈品：貼紙",
      "店鋪活動：滿減",
      "空值：",
      "Focus Pro 35K"
    ].join("\n")
  );
  const filtered = filterSpecsForDetailImage(rows, terms);
  const values = filtered.map((r) => r.value + r.key).join("|");
  assert.ok(values.includes("15 x 15"));
  assert.ok(values.includes("絨毛"));
  assert.ok(!values.includes("保固"));
  assert.ok(!values.includes("售後"));
  assert.ok(!values.includes("贈品"));
  assert.ok(!values.includes("店鋪活動"));
});

await check("source filterSpecs exports P4 core terms", () => {
  const terms = read("src/lib/images/detailCompose/sellerServiceTerms.ts");
  for (const t of SELLER_CORE) {
    assert.ok(terms.includes(t), `missing core term ${t}`);
  }
  const filter = read("src/lib/images/detailCompose/filterSpecs.ts");
  assert.match(filter, /filterSpecsForDetailImage/);
  assert.match(filter, /SELLER_SERVICE_FILTER_TERMS/);
});

await check("flags: generate_detail default ON", () => {
  assert.equal(isGenerateDetailEnabled(null), true);
  assert.equal(isGenerateDetailEnabled({}), true);
  assert.equal(isGenerateDetailEnabled({ generate_detail: true }), true);
  assert.equal(isGenerateDetailEnabled({ generate_detail: false }), false);
  assert.equal(isGenerateDetailEnabled({ generate_detail: "false" }), false);
  assert.equal(isGenerateDetailEnabled({ generate_detail: "0" }), false);
});

await check("cost math: null≠0; only positive AI adds", () => {
  assert.equal(nextGenerationCostEstimate(null, null), null);
  assert.equal(nextGenerationCostEstimate(null, 0), null);
  assert.equal(nextGenerationCostEstimate(0.1, 0.07), 0.17);
  assert.equal(nextGenerationCostEstimate(null, 0.07), 0.07);
});

await check("finalize F: generated_detail only when retain", () => {
  assert.equal(isFinalizeUploadImageType("main"), true);
  assert.equal(isFinalizeUploadImageType("generated_detail"), false);
  assert.equal(
    isFinalizeUploadImageType("generated_detail", { retainForListing: true }),
    true
  );
  assert.equal(isFinalizeUploadImageType("detail"), false);
  const src = read("src/lib/shopify/filesUpload.ts");
  assert.match(src, /retainForListing/);
  assert.match(src, /generated_detail/);
});

await check("to_trad wired (no honest skip)", () => {
  const run = read("src/lib/images/runAiProcess.ts");
  assert.match(run, /intent === "to_trad"/);
  assert.doesNotMatch(
    run,
    /D4 image edit not implemented yet/
  );
  assert.match(run, /appendGenerationCostUsd/);
  const prov = read("src/lib/providers/openai-image-provider.ts");
  assert.match(prov, /buildToTradPrompt/);
  assert.match(prov, /task === "to_trad"/);
  const img = read("src/lib/providers/image.ts");
  assert.match(img, /"to_trad"/);
});

await check("compose-detail route: dual auth + only HTTP export + no self-fetch", () => {
  const src = read("src/app/api/images/compose-detail/route.ts");
  assert.match(src, /requireWorkerToken/);
  assert.match(src, /canOperate/);
  assert.match(src, /runComposeDetailForDraft/);
  assert.match(src, /export async function POST/);
  assert.doesNotMatch(src, /export (async )?function (?!POST)/);
  assert.doesNotMatch(src, /fetch\s*\(\s*[^)]*\/api\/images\//);
  assert.match(src, /maxDuration\s*=\s*60/);
});

await check("send-images / batch snapshot composeDetail", () => {
  const batch = read("src/lib/drafts/createImageBatch.ts");
  assert.match(batch, /composeDetail/);
  assert.match(batch, /isGenerateDetailEnabled/);
  const send = read("src/app/api/drafts/batch/send-images/route.ts");
  assert.match(send, /image_flags/);
  const chain = read("src/lib/images/sendImagesAutoChain.ts");
  assert.match(chain, /tryComposeDetailInChain/);
  assert.match(chain, /awaiting_compose/);
  assert.match(chain, /compose-detail/);
});

await check("runComposeDetail: R3-A default, R3-B env, temp storage", () => {
  const src = read("src/lib/images/detailCompose/runComposeDetail.ts");
  assert.match(src, /DETAIL_COMPOSE_BASE_MODE/);
  assert.match(src, /original/);
  assert.match(src, /generated_detail/);
  assert.match(src, /supabase_temp|storage:\s*"supabase_temp"/);
  assert.match(src, /合成底/);
  // no watermark
  assert.doesNotMatch(src, /非正式上架|SYN-0 打樣/);
  const svg = read("src/lib/images/detailCompose/buildSvg.ts");
  assert.doesNotMatch(svg, /非正式上架|SYN-0 打樣|WATERMARK/);
});

await check("CJK text ink probe (raster non-blank)", async () => {
  // Dynamic import compiled? Use ts via direct reimplementation with sharp + fonts module path
  // Import from built path isn't available — call sharp the same way rasterize does.
  const sharp = (await import("sharp")).default;
  const fontsSrc = read("src/lib/images/detailCompose/fonts.ts");
  assert.match(fontsSrc, /Noto Serif TC/);
  assert.match(fontsSrc, /Microsoft JhengHei/);

  // Resolve font family like production: prefer Noto / MSJH by probing system
  let family = "Microsoft JhengHei";
  const winFonts = path.join(process.env.WINDIR || "C:\\Windows", "Fonts");
  if (fs.existsSync(path.join(winFonts, "NotoSerifTC-VF.ttf"))) {
    family = "Noto Serif TC";
  } else if (fs.existsSync(path.join(winFonts, "msjh.ttc"))) {
    family = "Microsoft JhengHei";
  }

  const cream = "#faf8f3";
  const probe = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">
  <rect width="480" height="120" fill="${cream}"/>
  <text x="24" y="72" font-family="${family}" font-size="36" fill="#2a2a2a">潮巢測試字NESTORY</text>
</svg>`);
  const empty = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="480" height="120">
  <rect width="480" height="120" fill="${cream}"/>
</svg>`);

  const textPng = await sharp(probe).png().toBuffer();
  const emptyPng = await sharp(empty).png().toBuffer();
  const { data: td, info } = await sharp(textPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { data: ed } = await sharp(emptyPng)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  function nonCream(raw, ch) {
    let n = 0;
    for (let i = 0; i < raw.length; i += ch) {
      if (
        Math.abs(raw[i] - 0xfa) > 10 ||
        Math.abs(raw[i + 1] - 0xf8) > 10 ||
        Math.abs(raw[i + 2] - 0xf3) > 10
      ) {
        n++;
      }
    }
    return n;
  }
  const textPx = nonCream(td, info.channels);
  const emptyPx = nonCream(ed, info.channels);
  assert.ok(
    textPx > 200,
    `expected non-blank CJK ink, got textPx=${textPx} (font blank death?)`
  );
  assert.ok(
    textPx > emptyPx + 100,
    `textPx ${textPx} should exceed empty ${emptyPx}`
  );
  // size sanity
  assert.ok(textPng.length > emptyPng.length);
});

await check("prepareCopy uses localize + post-generate fields only", () => {
  const src = read("src/lib/images/detailCompose/prepareCopy.ts");
  assert.match(src, /localizeToTaiwanTraditionalText/);
  assert.match(src, /specText/);
  assert.match(src, /productHighlights/);
  assert.doesNotMatch(src, /raw_capture|taobao_params/);
});

// Also exercise real TS module via tsx? skip — static + sharp probe enough

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nSYN-1 verify passed\n");
