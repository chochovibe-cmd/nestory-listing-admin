/**
 * SYN-0 Route B: OpenAI Images API samples (medium × 4, budget ~$0.40).
 * Usage: node scripts/syn0-run-b.mjs
 *
 * - OPENAI_API_KEY only via process.env (loadEnvLocal) — never logged.
 * - Does not write product_images / does not touch UI pipeline.
 */
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  OUT_DIR,
  PRODUCTS,
  FIXED_BUY_NOTICE,
  WATERMARK,
  ensureDirs,
  loadProductBundle,
  getOpenAiKey,
  fetchImageBuffer,
  estimateImageCostUsd,
  writeJson
} from "./syn0-shared.mjs";

const MODEL = process.env.OPENAI_IMAGE_MODEL?.trim() || "gpt-image-1";
const SIZE = "1024x1536";
const QUALITY = "medium";
const BUDGET_USD = 0.4;
const UNIT = estimateImageCostUsd(QUALITY);

function buildDetailPrompt(bundle, mode) {
  const d = bundle.draft;
  const title = d.title_zh || "";
  const brand = d.product_brand || "";
  const ip = d.ip_name || d.character_name || "";
  const type = d.product_type || "";
  const highlights = bundle.highlights;
  const spec = d.spec_text || "";

  const exactText = [
    "CRITICAL TEXT RULES:",
    "- All on-image Chinese/English text MUST be copied EXACTLY from the fields below.",
    "- Do NOT invent, round, translate, or change any numbers (e.g. 54克, 15 x 15 x 30 cm, 35K, 10m, 2年).",
    "- Prefer Traditional Chinese as given. If draft has simplified, keep as-is.",
    "- If text is hard to render, leave a clean blank text box rather than wrong numbers.",
    "",
    `TITLE: ${title}`,
    `BRAND: ${brand}`,
    `IP: ${ip}`,
    `TYPE: ${type}`,
    "HIGHLIGHTS:",
    ...highlights.map((h, i) => `  ${i + 1}. ${h}`),
    "SPEC_TEXT (verbatim):",
    spec,
    `BUY_NOTICE: ${FIXED_BUY_NOTICE}`,
    `WATERMARK (small corner): ${WATERMARK}`,
    "BADGE: 潮巢嚴選正版"
  ].join("\n");

  if (mode === "generations") {
    return [
      "Create ONE vertical e-commerce product DETAIL PAGE image for a Taiwan anime lifestyle store (潮巢 Nestory).",
      "Layout top→bottom: large product photo area, product title, 3–4 numbered selling points, specification table, brand/authenticity badge, purchase notice.",
      "Visual style: clean Nordic light ecommerce (warm off-white paper, soft blue accent #58a9dc, clear sans-serif Chinese typography, generous spacing). Not cluttered Taobao spam.",
      "Aspect: tall portrait poster (1024x1536). Photoreal product when possible.",
      "Store identity: Nestory / 潮巢.",
      mode === "generations" && bundle.draft.image_description
        ? `Product visual reference: ${String(bundle.draft.image_description).slice(0, 800)}`
        : "",
      exactText
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 3200);
  }

  // edits
  return [
    "Using the provided product photo as the hero reference, compose ONE vertical e-commerce DETAIL PAGE image for 潮巢 Nestory (Taiwan).",
    "Keep the product appearance faithful (shape, colors, logo on product if any). Surround with clean Nordic light layout panels.",
    "Layout top→bottom: hero product, title, numbered highlights, spec table with EXACT numbers from SPEC_TEXT, brand badge 潮巢嚴選正版, purchase notice, small SYN-0 watermark.",
    "Do not invent specs. Do not change numbers. Clear Traditional Chinese labels.",
    exactText
  ]
    .join("\n")
    .slice(0, 3200);
}

async function callGenerations({ apiKey, prompt }) {
  const body = {
    model: MODEL,
    prompt,
    n: 1,
    size: SIZE,
    quality: QUALITY
  };
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const errText = await response.text();
    // Never echo headers/key; body may contain request id only.
    throw new Error(`images/generations failed (${response.status}): ${errText.slice(0, 280)}`);
  }
  const payload = await response.json();
  const data = payload?.data?.[0];
  if (data?.b64_json) {
    return Buffer.from(data.b64_json, "base64");
  }
  if (data?.url) {
    const fetched = await fetchImageBuffer(data.url);
    return fetched.buffer;
  }
  throw new Error("images/generations: no b64_json or url");
}

async function callEdits({ apiKey, prompt, imageBuffer, mimeType }) {
  const form = new FormData();
  form.append("model", MODEL);
  form.append("prompt", prompt);
  form.append("n", "1");
  form.append("size", SIZE);
  form.append("quality", QUALITY);
  const ext = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : "png";
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
  if (data?.b64_json) {
    return Buffer.from(data.b64_json, "base64");
  }
  if (data?.url) {
    const fetched = await fetchImageBuffer(data.url);
    return fetched.buffer;
  }
  throw new Error("images/edits: no b64_json or url");
}

async function main() {
  ensureDirs();
  const apiKey = getOpenAiKey();

  const jobs = [
    {
      productKey: "miffy_lamp",
      mode: "generations",
      outName: "米菲臺燈-B1-generations.png"
    },
    {
      productKey: "miffy_lamp",
      mode: "edits",
      outName: "米菲臺燈-B2-edits.png"
    },
    {
      productKey: "razer_mouse",
      mode: "generations",
      outName: "Razer皮卡丘滑鼠-B1-generations.png"
    },
    {
      productKey: "razer_mouse",
      mode: "edits",
      outName: "Razer皮卡丘滑鼠-B2-edits.png"
    }
  ];

  let spent = 0;
  const report = {
    route: "B",
    model: MODEL,
    size: SIZE,
    quality: QUALITY,
    unitEstimateUsd: UNIT,
    budgetUsd: BUDGET_USD,
    startedAt: new Date().toISOString(),
    items: [],
    note: "costUsd is estimateImageCostUsd only — not OpenAI billing invoice"
  };

  for (const job of jobs) {
    if (spent + UNIT > BUDGET_USD + 1e-9) {
      console.error(
        `Budget stop: spent_est=${spent.toFixed(2)} next=${UNIT} budget=${BUDGET_USD}`
      );
      break;
    }
    const t0 = Date.now();
    console.log(`B ${job.mode} ${job.productKey}...`);
    const bundle = await loadProductBundle(job.productKey);
    const prompt = buildDetailPrompt(bundle, job.mode);

    let bytes;
    try {
      if (job.mode === "generations") {
        bytes = await callGenerations({ apiKey, prompt });
      } else {
        if (!bundle.mainUrl) throw new Error("no mainUrl for edits");
        const src = await fetchImageBuffer(bundle.mainUrl);
        bytes = await callEdits({
          apiKey,
          prompt,
          imageBuffer: src.buffer,
          mimeType: src.mimeType
        });
      }
    } catch (e) {
      const item = {
        productKey: job.productKey,
        mode: job.mode,
        file: job.outName,
        ok: false,
        error: String(e.message || e).slice(0, 400),
        durationMs: Date.now() - t0,
        costUsd: 0,
        draftId: bundle.draft.id,
        title: bundle.draft.title_zh,
        specNumbers: bundle.specNumbers,
        highlights: bundle.highlights,
        specText: bundle.draft.spec_text
      };
      report.items.push(item);
      console.error(`  FAIL ${job.outName}: ${item.error}`);
      // count failed call toward budget if we likely were charged? Usually failed = no charge; don't add.
      continue;
    }

    spent += UNIT;
    const outPath = join(OUT_DIR, job.outName);
    writeFileSync(outPath, bytes);
    const ms = Date.now() - t0;
    const item = {
      productKey: job.productKey,
      mode: job.mode,
      file: job.outName,
      ok: true,
      durationMs: ms,
      costUsd: UNIT,
      spentEstimateUsd: spent,
      draftId: bundle.draft.id,
      title: bundle.draft.title_zh,
      specNumbers: bundle.specNumbers,
      highlights: bundle.highlights,
      specText: bundle.draft.spec_text,
      promptChars: prompt.length
    };
    report.items.push(item);
    console.log(`  wrote ${job.outName} in ${ms}ms est$${UNIT} spent_est$${spent.toFixed(2)}`);
  }

  report.finishedAt = new Date().toISOString();
  report.totalEstimateUsd = spent;
  writeJson(join(OUT_DIR, "syn0-b-report.json"), report);
  console.log(
    `B done. total_est=$${spent.toFixed(2)} / budget $${BUDGET_USD} → docs/合成詳情圖打樣/syn0-b-report.json`
  );
}

main().catch((e) => {
  console.error("syn0-run-b failed:", e.message || e);
  process.exit(1);
});
