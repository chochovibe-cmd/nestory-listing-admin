#!/usr/bin/env node
/**
 * COPY-A2 read-only blind test. Requires OPENROUTER_API_KEY, Supabase URL and service key
 * in local .env.local. No mutation is performed against a draft, run, image or variant.
 * Child processes load the actual production Brief/Writer modules with candidate model env.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = fileURLToPath(import.meta.url);
const flags = Object.fromEntries(process.argv.slice(2).filter((s) => s.startsWith("--")).map((s) => {
  const index = s.indexOf("=");
  return index === -1 ? [s.slice(2), "true"] : [s.slice(2, index), s.slice(index + 1)];
}));
if (fs.existsSync(path.join(root, ".env.local"))) process.loadEnvFile(path.join(root, ".env.local"));

function parseJsonFromStdout(child) {
  if (child.status !== 0) throw new Error(child.stderr?.slice(-3000) || "Candidate process failed");
  try { return JSON.parse(child.stdout.trim()); } catch { throw new Error("Candidate returned invalid JSON: " + child.stdout.slice(0, 200)); }
}
function executeCandidate(kind, model, payload) {
  return parseJsonFromStdout(spawnSync(process.execPath, [scriptPath, "--child=" + kind], {
    cwd: root,
    env: { ...process.env, OPENAI_COPY_MODEL: model, OPENAI_BRIEF_MODEL: model, OPENAI_REVIEW_MODEL: flags.review || "gpt-4o-mini" },
    input: JSON.stringify(payload), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: 180000,
  }));
}

async function childMode() {
  register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
  let content = "";
  for await (const chunk of process.stdin) content += chunk.toString("utf8");
  const request = JSON.parse(content);
  if (flags.child === "understand") {
    const { buildProductBrief } = await import(pathToFileURL(path.join(root, "src/lib/providers/productBrief.ts")).href);
    const output = await buildProductBrief(request);
    process.stdout.write(JSON.stringify(output));
    return;
  }
  const [{ OpenAICopyProvider }, { runBriefWriterPipeline }] = await Promise.all([
    import(pathToFileURL(path.join(root, "src/lib/providers/openai-copy-provider.ts")).href),
    import(pathToFileURL(path.join(root, "src/lib/copyPipeline/briefWriterPipeline.ts")).href),
  ]);
  const start = Date.now();
  const result = await runBriefWriterPipeline({ input: request, brief: request.facts, provider: new OpenAICopyProvider(), initialStages: request.understandCost ? [request.understandCost] : [] });
  process.stdout.write(JSON.stringify({ ...result, title: result.finalTitle, elapsedMs: Date.now() - start }));
}
function apiHeaders() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY missing from local environment");
  return { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" };
}
async function getRows(table, query) {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "").replace(/\/+$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL missing");
  const url = base + "/rest/v1/" + table + "?" + query;
  const response = await fetch(url, { method: "GET", headers: apiHeaders() });
  if (!response.ok) throw new Error("Read-only Supabase GET failed " + response.status + ": " + (await response.text()).slice(0, 250));
  return await response.json();
}
async function findGoldenDrafts(items) {
  const pending = new Set(items.map((item) => item.id));
  const found = new Map();
  for (let offset = 0; offset < 20000 && pending.size; offset += 1000) {
    const rows = await getRows("product_drafts", "select=*&order=created_at.desc&limit=1000&offset=" + offset);
    for (const row of rows) {
      for (const prefix of [...pending]) {
        if (String(row.id).startsWith(prefix)) { found.set(prefix, row); pending.delete(prefix); }
      }
    }
    if (rows.length < 1000) break;
  }
  if (pending.size) throw new Error("Golden draft IDs not found: " + [...pending].join(", "));
  return found;
}
function h(value) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function randomizedLetters(models) {
  const shuffled = [...models];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return Object.fromEntries(shuffled.map((model, i) => [String.fromCharCode(65 + i), model]));
}
function understandScore(brief, expected) {
  const checks = [];
  for (const [key, got] of [
    ["ip", brief.identity?.ip], ["brandEnglish", brief.identity?.brandEnglish], ["archetype", brief.archetype],
    ["requiresVoltage", brief.requiresVoltage],
  ]) {
    if (expected[key] !== undefined) checks.push({ key, correct: String(got ?? "") === String(expected[key]), expected: expected[key], actual: got });
  }
  if (expected.specLines?.length) {
    const specs = (brief.specLines || []).join(" ");
    for (const spec of expected.specLines) checks.push({ key: "spec", correct: specs.includes(spec), expected: spec });
  }
  return { correct: checks.filter((c) => c.correct).length, total: checks.length, checks };
}
async function main() {
  const writers = (flags.writers || "").split(",").map((m) => m.trim()).filter(Boolean);
  const understand = (flags.understand || "").split(",").map((m) => m.trim()).filter(Boolean);
  if (!writers.length || writers.length > 26) throw new Error("Specify --writers=... model IDs; --understand=... is optional");
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY missing; no model guesses or fallback");
  const file = path.resolve(root, flags.items || "scripts/fixtures/copy-a-golden.json");
  const golden = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = path.resolve(root, flags.out || ".tmp/copy-a-blindtest/" + new Date().toISOString().replace(/[:.]/g, "-"));
  fs.mkdirSync(out, { recursive: true });
  const drafts = await findGoldenDrafts(golden.items);
  const results = [], understandScores = [], keys = [];
  for (const item of golden.items) {
    const draft = drafts.get(item.id);
    const variants = await getRows("product_variants", "select=option1_value,option2_value,option3_value&draft_id=eq." + encodeURIComponent(draft.id) + "&order=sort_order.asc");
    const images = await getRows("product_images", "select=image_type,original_file_url,sort_order&draft_id=eq." + encodeURIComponent(draft.id) + "&order=sort_order.asc");
    const [{ buildVariantStructure, buildReviewEvidence }, { readSourceReviews }] = await Promise.all([
      (async () => { register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href); return import(pathToFileURL(path.join(root, "src/lib/copyPipeline/evidence.ts")).href); })(),
      import(pathToFileURL(path.join(root, "src/lib/import/sourceReviews.ts")).href),
    ]);
    const variantSummary = buildVariantStructure(variants).text;
    const reviewText = buildReviewEvidence(readSourceReviews(draft.raw_capture));
    const base = {
      rawTitle: draft.taobao_title || draft.original_title || "", saleStatus: draft.sale_status || "預購中",
      variantSummary, variantRows: variants, reviews: readSourceReviews(draft.raw_capture),
      note: draft.note, imageDescription: draft.image_description, specText: draft.spec_text,
      existingIp: draft.ip_name, existingCharacter: draft.character_name, existingProductType: draft.product_type,
      existingBrand: draft.product_brand, existingSku: draft.sku,
    };
    const understandCandidates = understand.map((model) => {
      let result;
      try { result = executeCandidate("understand", model, base); }
      catch (error) { return { model, correct: 0, total: 0, checks: [], failed: true, error: String(error?.message || error).slice(0, 300) }; }
      const score = understandScore(result.brief, item.expected || {});
      return { model, ...score, fallback: result.fallback, cost: result.cost?.costUsd ?? result.usage?.costUsd ?? null };
    });
    understandScores.push({ id: draft.id, slot: item.slot, candidates: understandCandidates });
    // gpt-4o-mini occasionally returns an unusable Brief; one retry keeps a whole run from dying on it.
    let shared = executeCandidate("understand", "gpt-4o-mini", base);
    if (shared.fallback) shared = executeCandidate("understand", "gpt-4o-mini", base);
    if (shared.fallback) throw new Error("Brief fallback during test for draft " + draft.id + ": " + (shared.warning || "no warning"));
    const letters = randomizedLetters(writers);
    keys.push({ id: draft.id, letters });
    const writerCandidates = {};
    for (const [letter, model] of Object.entries(letters)) {
      let response;
      try { response = executeCandidate("writer", model, {
        ...base, tone: "潮巢導購版", copyLength: "標準", productBrief: shared.writerText,
        brand: shared.brief.identity?.brandEnglish || shared.brief.identity?.brand,
        ip: shared.brief.identity?.ip, facts: shared.brief, reviewText, understandCost: shared.cost,
      }); } catch (error) {
        // A writer that returns no usable copy counts as a parse failure (gate 1), not a crash.
        writerCandidates[letter] = { title: "（這個寫手這次沒有產出文案）", description: "", faq: "", highlights: [], why: "",
          seo: null, checks: [], costUsd: null, elapsedMs: null, failed: true, error: String(error?.message || error).slice(0, 300) };
        continue;
      }
      writerCandidates[letter] = {
        finalTitle: response.finalTitle, seoTitle: response.seo.seoTitle, metaDescription: response.seo.metaDescription,
        descriptionHtml: response.descriptionHtml, review: { ...response.review, deletedTexts: response.review.deletedTexts, rejected: response.review.rejected }, stages: response.stages, retries: response.retries,
        title: response.title,
        description: response.output.generatedDescriptionHtml,
        faq: response.output.generatedFaqHtml,
        highlights: response.output.productHighlights,
        why: response.output.whyWeChoseIt,
        seo: response.seo, checks: response.checks,
        costUsd: response.output.usage?.reportedCostUsd ?? response.output.usage?.costUsd ?? null,
        elapsedMs: response.elapsedMs,
      };
    }
    results.push({ id: draft.id, slot: item.slot, label: item.label, image: images.find((img) => img.image_type === "main")?.original_file_url || "", candidates: writerCandidates });
  }
  const scoreCards = results.map((item, index) => {
    const cols = Object.entries(item.candidates).map(([letter, r]) => "<article><h3>" + letter + "</h3><h4>" + h(r.title) + "</h4><pre>" + h(r.description) + "</pre><h4>亮點</h4><p>" + h(r.highlights.join("、")) + "</p><h4>為什麼選它</h4><p>" + h(r.why) + "</p><h4>FAQ</h4><pre>" + h(r.faq) + "</pre><label>分數 1–5 <input type='number' min='1' max='5' data-id='" + index + "' data-letter='" + h(letter) + "'></label><textarea placeholder='一句評語（選填）' data-note='" + index + ":" + h(letter) + "'></textarea></article>").join("");
    return "<section><h2>" + (index + 1) + ". " + h(item.label) + "</h2>" + (item.image ? "<img loading='lazy' width='180' src='" + h(item.image) + "' alt='商品主圖'>" : "") + "<div class='columns'>" + cols + "</div></section>";
  }).join("");
  const html = "<!doctype html><html lang='zh-Hant'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>COPY-A2 匿名盲測</title><style>body{font:16px system-ui;margin:20px;background:#f8f8f6;color:#222}section{border-top:2px solid #aaa;padding:20px 0}.columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}article{background:white;border:1px solid #ddd;border-radius:10px;padding:15px;min-width:0}pre{white-space:pre-wrap;font:inherit}textarea{display:block;width:95%}input{width:55px}</style><h1>潮巢 COPY-A2 匿名寫手盲測</h1><p>每欄 5＝直接能上架，4＝改一兩個字，3＝要改幾句，2＝要大改，1＝要重寫。此頁不包含模型對照。</p><button onclick='copyScores()'>複製分數</button>" + scoreCards + "<script>function copyScores(){let answers=[...document.querySelectorAll(\"input[data-id]\")].map(i=>({item:Number(i.dataset.id)+1,letter:i.dataset.letter,score:Number(i.value)||null,note:document.querySelector(\"textarea[data-note=\\\"\"+i.dataset.id+\":\"+i.dataset.letter+\"\\\"]\")?.value||\"\"}));navigator.clipboard.writeText(JSON.stringify(answers,null,2)).then(()=>alert(\"已複製\"));}</script></html>";
  fs.writeFileSync(path.join(out, "score-sheet.html"), html);
  fs.writeFileSync(path.join(out, "key.json"), JSON.stringify(keys, null, 2));
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(out, "understand-scores.json"), JSON.stringify(understandScores, null, 2));
  process.stdout.write("Read-only blind test saved at " + out + "\n");
}
try {
  if (flags.child) await childMode();
  else await main();
} catch (error) {
  process.stderr.write(String(error?.stack || error) + "\n");
  process.exitCode = 1;
}
