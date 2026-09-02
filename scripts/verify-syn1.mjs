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
  assert.match(src, /resolveRequestPrincipal/);
  assert.match(src, /resolveAuthorizedDraftId/);
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

await check("prepareCopy strips P4 residual （來源：網路） before render", () => {
  const src = read("src/lib/images/detailCompose/prepareCopy.ts");
  assert.match(src, /stripCustomerSourceMarkers/);
  assert.match(src, /stripCustomerSourceMarkersList/);

  // Inline mirror of stripCustomerSourceMarkers (keep in sync)
  const PAREN =
    /[（(]\s*來\s*源\s*[:：]\s*網\s*路\s*[）)]|[（(]\s*来\s*源\s*[:：]\s*网\s*络\s*[）)]/gi;
  const BARE =
    /[ \t]*來源\s*[:：]\s*網路(?:搜尋)?(?=$|[\s）)\]】，。、；;,.…])|[ \t]*来源\s*[:：]\s*网络(?=$|[\s）)\]】，。、；;,.…])/gi;
  function strip(value) {
    let s = String(value ?? "");
    for (let i = 0; i < 3; i++) {
      const before = s;
      s = s.replace(PAREN, "");
      s = s.replace(BARE, "");
      s = s.replace(/[^\S\n]{2,}/g, " ").trim();
      if (s === before) break;
    }
    return s;
  }

  // Old-draft residual samples that used to paint onto the image
  const dirtySpec = "尺寸：15 x 15 x 30 cm（來源：網路）\n材質：絨毛 來源：網路";
  const cleaned = dirtySpec
    .split("\n")
    .map((line) => strip(line))
    .join("\n");
  assert.ok(!cleaned.includes("來源"), `still has marker: ${cleaned}`);
  assert.ok(!cleaned.includes("網路") || cleaned.includes("15"), "no bare 來源：網路");
  assert.ok(cleaned.includes("15 x 15"), "kept real spec");
  assert.ok(cleaned.includes("絨毛"), "kept material");

  const dirtyHl = "柔軟親膚（來源：網路）";
  assert.equal(strip(dirtyHl), "柔軟親膚");
});

await check("SVG layout: canvas covers content, sections non-overlapping", () => {
  const src = read("src/lib/images/detailCompose/buildSvg.ts");
  assert.match(src, /measureDetailSvgLayout/);
  assert.match(src, /assertDetailLayoutSound/);
  assert.match(src, /contentBottom/);
  assert.match(src, /BOTTOM_PAD|bottomPad|bottom_pad|contentBottom \+ /i);

  // Mirror measure + assert (same rules as buildSvg.ts)
  function wrapText(text, maxChars) {
    const t = String(text || "").trim();
    if (!t) return [""];
    const lines = [];
    let rest = t;
    while (rest.length > maxChars) {
      let breakAt = maxChars;
      const slice = rest.slice(0, maxChars + 1);
      const m = slice.match(/^[\s\S]{8,}?[\s，、。；：,.…]/);
      if (m && m[0].length >= 8) breakAt = m[0].length;
      lines.push(rest.slice(0, breakAt).trim());
      rest = rest.slice(breakAt).trim();
    }
    if (rest) lines.push(rest);
    return lines.length ? lines : [""];
  }

  function measure(copy) {
    const sections = [];
    const BOTTOM_PAD = 48;
    const HERO_TOP = 56;
    const HERO_H = 720;
    let y = 56;
    sections.push({ name: "topbar", top: 0, bottom: y });
    sections.push({ name: "hero", top: HERO_TOP, bottom: HERO_TOP + HERO_H });
    y = HERO_TOP + HERO_H + 48;
    const titleTop = y;
    y += 28;
    if ([copy.brand, copy.ip, copy.productType].filter(Boolean).length) y += 32;
    y += wrapText(copy.title || "未命名", 22).length * 48;
    y += 24 + 1 + 40;
    sections.push({ name: "title", top: titleTop, bottom: y });
    const highlights = copy.highlights.length ? copy.highlights : ["（草稿尚無賣點）"];
    const hlTop = y;
    let hlInner = 36 + 36;
    for (const h of highlights) {
      hlInner += Math.max(48, wrapText(h, 28).length * 24 + 8);
    }
    hlInner += 20;
    y = hlTop + hlInner + 28;
    sections.push({ name: "highlights", top: hlTop, bottom: y });
    y += 1 + 40;
    const specsTop = y;
    y += 28;
    const specs = copy.specs.length ? copy.specs : [{ key: "", value: "x" }];
    for (const row of specs) {
      y += 36;
      if (row.key) {
        y += Math.max(0, (wrapText(row.value, 36).length - 1) * 22);
      }
      y += 16;
    }
    sections.push({ name: "specs", top: specsTop, bottom: y });
    y += 40;
    const brandTop = y;
    y += 32 + 32 + 40;
    sections.push({ name: "brand", top: brandTop, bottom: y });
    y += 1 + 40;
    const noticeTop = y;
    y += 32 + wrapText(copy.buyNotice, 34).length * 26;
    sections.push({ name: "buy_notice", top: noticeTop, bottom: y });
    y += 40;
    const footTop = y;
    y += 16;
    sections.push({ name: "footer", top: footTop, bottom: y });
    const contentBottom = y;
    return {
      canvasHeight: contentBottom + BOTTOM_PAD,
      contentBottom,
      sections
    };
  }

  const longNotice =
    "本商品為正版授權選品，實際規格以包裝標示為準。潮巢代購商品到貨後經檢視再寄出；如有瑕疵請於收貨後三天內聯繫客服。";
  const layout = measure({
    title: "米菲臺燈長標題測試用第二行也要量得到高度",
    brand: "Miffy",
    ip: "米菲",
    productType: "燈具小物",
    highlights: ["賣點一很長會換行要量高度避免卡片裁切與底部黑帶問題", "賣點二", "賣點三"],
    specs: [
      { key: "尺寸", value: "15 x 15 x 30 cm" },
      { key: "重量", value: "54克" },
      { key: "材質", value: "絨毛" }
    ],
    buyNotice: longNotice
  });

  assert.equal(
    layout.canvasHeight,
    layout.contentBottom + 48,
    "canvasHeight must equal contentBottom + pad"
  );
  assert.ok(layout.canvasHeight >= layout.contentBottom, "canvas covers content");
  for (let i = 1; i < layout.sections.length; i++) {
    const prev = layout.sections[i - 1];
    const cur = layout.sections[i];
    assert.ok(
      cur.top + 0.01 >= prev.bottom,
      `overlap ${prev.name}/${cur.name}: ${cur.top} < ${prev.bottom}`
    );
    assert.ok(cur.bottom >= cur.top, `${cur.name} inverted`);
  }
  const buy = layout.sections.find((s) => s.name === "buy_notice");
  assert.ok(buy, "buy_notice section present");
  assert.ok(buy.bottom <= layout.contentBottom, "buy_notice not past contentBottom");
  assert.ok(buy.bottom < layout.canvasHeight, "buy_notice not past canvas");
});

await check("review gallery includes generated_detail (query + filter)", () => {
  const panel = read("src/components/review/ImageReviewPanel.tsx");
  assert.match(panel, /generated_detail/);
  assert.match(panel, /\["main", "spec", "variant", "generated_detail"\]/);
  const rev = read("src/lib/images/imageReview.ts");
  assert.match(rev, /isReviewGalleryImage/);
  assert.match(rev, /generated_detail/);
  // still must not force generated_detail into 送圖 pipeline marks
  const marks = read("src/lib/images/processMarks.ts");
  assert.doesNotMatch(
    marks,
    /isPipelineImage[\s\S]{0,200}generated_detail/
  );
});

if (failures.length) {
  console.error(`\n${failures.length} failure(s)`);
  process.exit(1);
}
console.log("\nSYN-1 verify passed\n");
