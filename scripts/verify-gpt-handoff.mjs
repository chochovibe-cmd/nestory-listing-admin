import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const mod = await import(pathToFileURL(path.join(root, "src/lib/csv/gptRawExport.ts")).href);
const { buildGptRawCsv, gptPriceWarnings, gptPriceWarningsFromCosts } = mod;
const EXPECTED_HEADERS = ["商品編號", "來源平台", "來源連結", "原始標題", "品牌", "IP", "角色", "規格參數", "備註", "影片連結", "主圖", "詳情圖", "價格提醒", "選項1名稱", "選項1", "選項2名稱", "選項2", "選項3名稱", "選項3", "SKU", "成本（人民幣）", "促銷價（人民幣）", "來源庫存", "來源狀態", "款式圖"];
const base = (id, extra = {}) => ({
  id: `${id}1234567890`, source_url: "https://example.test/item", source_platform: "淘寶", title_zh: "生成後標題",
  taobao_title: "較舊標題", original_title: "原始\"標題\r\n第二行", product_brand: "品牌", ip_name: "IP", character_name: "角色",
  spec_text: "規格", note: "備註", video_urls: ["v1", "v2"], cny_price: 12, compare_at_price: 19,
  sku: "base-sku",
  product_images: [], product_variants: [], ...extra
});
function parse(csv) {
  const rows = []; let row = [], value = "", quoted = false;
  const source = csv.slice(1);
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted && c === '"' && source[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { row.push(value); value = ""; }
    else if (c === "\r" && source[i + 1] === "\n" && !quoted) { row.push(value); rows.push(row); row = []; value = ""; i++; }
    else value += c;
  }
  return rows;
}
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log(`  ✓ ${name}`); };

check("BOM、CRLF、固定表頭、全欄雙引號、引號跳脫與格內換行", () => {
  const csv = buildGptRawCsv([base("abcdefgh")]);
  assert.ok(csv.startsWith("\uFEFF\"商品編號\""));
  assert.ok(csv.includes("\r\n"));
  assert.ok(csv.includes('原始""標題\r\n第二行'));
  assert.deepEqual(parse(csv)[0], EXPECTED_HEADERS);
  assert.equal((parse(csv)[1]).length, EXPECTED_HEADERS.length);
});

check("三款各一列，編號標題重複，平台至提醒僅首列填寫", () => {
  const variants = [1, 2, 3].map((n) => ({ id: `v${n}`, sort_order: n, option1_name: "款式", option1_value: `${n}`, option2_name: null, option2_value: null, option3_name: null, option3_value: null, sku: n === 2 ? null : `sku${n}`, source_sku_id: `sku-${n}`, cny_price: n, compare_at_price: 0, image_id: null, source_options: { names: ["款式"], values: [`${n}`] } }));
  const variants_flat = variants.map((variant, index) => ({ source_sku_id: variant.source_sku_id, sku: variant.sku, option1_value: variant.option1_value, promo_price_cny: [2.5, 3.5, 4.5][index], source_quantity: index === 1 ? null : index + 1, source_stock_status: index === 0 ? "in_stock" : "sold_out" }));
  const rows = parse(buildGptRawCsv([base("abcdefgh", { product_variants: variants, raw_capture: { payload: { variants_flat } } })]));
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.slice(1).map((row) => row[0]), ["abcdefgh", "abcdefgh", "abcdefgh"]);
  assert.deepEqual(rows.slice(1).map((row) => row[3]), ["原始\"標題\r\n第二行", "原始\"標題\r\n第二行", "原始\"標題\r\n第二行"]);
  assert.ok([...rows[2].slice(1, 3), ...rows[2].slice(4, 13)].every((value) => !value));
  assert.deepEqual(rows.slice(1).map((row) => row[21]), ["2.5", "3.5", "4.5"]);
  assert.equal(rows[2][19], "");
  assert.equal(rows[2][22], "");
  assert.equal(rows[2].length, 25);
});

check("無款式一列且取商品成本；佔位成本空白並提示未抓到", () => {
  const rows = parse(buildGptRawCsv([base("abcdefgh", { cny_price: 12 }), base("ijklmnop", { cny_price: 0.01 })]));
  assert.equal(rows.length, 3); assert.equal(rows[1][20], "12"); assert.equal(rows[2][20], "");
  assert.ok(rows[2][12].includes("沒抓到成本"));
});

check("促銷價使用 raw_capture 人民幣欄位，不把 compare_at_price 台幣值當促銷價；標題不取生成標題", () => {
  const product = base("abcdefgh", { raw_capture: { client_meta: { promo_price_cny: 6.8 }, payload: {} } });
  const row = parse(buildGptRawCsv([product]))[1];
  assert.equal(row[3], "原始\"標題\r\n第二行");
  assert.equal(row[21], "6.8");
  assert.notEqual(row[21], String(product.compare_at_price));
  assert.equal(gptPriceWarnings(base("no-confidence")), "");
});

check("原始標題優先 original_title，空值時退回 taobao_title", () => {
  const preferred = parse(buildGptRawCsv([base("preferred")]))[1];
  const fallback = parse(buildGptRawCsv([base("fallback", { original_title: null })]))[1];
  assert.equal(preferred[3], "原始\"標題\r\n第二行");
  assert.equal(fallback[3], "較舊標題");
});

check("圖片依 sort_order、main/detail 分開，忽略其他類型與空網址", () => {
  const imgs = [
    { id: "d2", image_type: "detail", sort_order: 2, original_file_url: "d2", processed_file_url: null },
    { id: "m1", image_type: "main", sort_order: 1, original_file_url: "m1", processed_file_url: null },
    { id: "skip", image_type: "variant", sort_order: 0, original_file_url: "bad", processed_file_url: null },
    { id: "empty", image_type: "main", sort_order: 2, original_file_url: " ", processed_file_url: null },
    { id: "d1", image_type: "detail", sort_order: 1, original_file_url: "d1", processed_file_url: null }
  ];
  const row = parse(buildGptRawCsv([base("abcdefgh", { product_images: imgs })]))[1];
  assert.equal(row[10], "主圖1 m1"); assert.equal(row[11], "詳情圖1 d1\n詳情圖2 d2");
});

check("價格提醒含部分缺成本與可信度提醒", () => {
  const capture = (confidence) => ({ version: 1, client_meta: { price_confidence: confidence }, server: { price_confidence: confidence } });
  const warnings = gptPriceWarningsFromCosts("needs_confirmation", 12, [2, null]);
  assert.equal(warnings, "來源價格需確認；部分款式沒抓到成本");
  assert.equal(gptPriceWarnings(base("a", { raw_capture: capture("needs_confirmation"), product_variants: [{ cny_price: 2 }, { cny_price: null }] })), warnings);
  assert.ok(gptPriceWarnings(base("b", { raw_capture: capture("needs_confirmation") })).includes("來源價格需確認"));
  for (const confidence of ["needs_confirmation", "conflict", "display_only", "unknown"]) {
    assert.ok(gptPriceWarnings(base("confidence", { raw_capture: capture(confidence) })).includes("來源價格需確認"));
  }
  assert.equal(gptPriceWarnings(base("absent")), "");
  assert.equal(gptPriceWarningsFromCosts(null, 12, []), "");
  assert.equal(gptPriceWarningsFromCosts("unknown", 12, []), "來源價格需確認");
  assert.equal(gptPriceWarningsFromCosts("high", 0.01, []), "沒抓到成本");
  assert.equal(gptPriceWarningsFromCosts("high", null, [null, 0.01]), "沒抓到成本");
});

check("來源狀態三種對照", () => {
  const withStock = (id, status) => base(id, { product_variants: [{ id, sort_order: 0, option1_name: null, option1_value: null, option2_name: null, option2_value: null, option3_name: null, option3_value: null, sku: "sku", cny_price: 2, compare_at_price: null, image_id: null, source_options: { names: [], values: [], stock: { status, quantity: 8, checked_at: "now" } } }] });
  const rows = parse(buildGptRawCsv([withStock("a", "in_stock"), withStock("b", "sold_out"), withStock("c", "unknown")]));
  assert.deepEqual(rows.slice(1).map((row) => row[23]), ["有貨", "售完", "不明"]);
});

check("靜態 migration、API 更新、UI 路由接線、CSS !important 基線", () => {
  const migration = read("supabase/migrations/20261102100000_gpt_handoff.sql");
  assert.match(migration, /add column if not exists gpt_handoff_at timestamptz/);
  assert.match(migration, /add column if not exists gpt_exported_at timestamptz/);
  const route = read("src/app/api/exports/gpt-raw/route.ts");
  assert.match(route, /gpt_exported_at/);
  assert.match(route, /buildGptRawCsv/);
  const stages = read("src/components/drafts/StageFilterPills.tsx");
  assert.match(stages, /交給 GPT/);
  const input = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(input, /送出給 GPT/);
  const handoffStart = input.indexOf('if (handoffMode === "gpt") {', input.indexOf("async function submit"));
  const handoffEnd = input.indexOf("const expectedImageCount", handoffStart);
  assert.ok(handoffStart > 0 && handoffEnd > handoffStart, "GPT branch must exit before the AI queue flow");
  const handoffBranch = input.slice(handoffStart, handoffEnd);
  assert.ok(!handoffBranch.includes("generation-queue") && !handoffBranch.includes("GENERATION_QUEUE_KICK_EVENT"));
  assert.ok(input.includes('fetch("/api/generation-queue"'), "AI queue path remains present after GPT branch");
  assert.match(input, /showToast\(mode === "gpt" \? `送出失敗：\$\{error\.message\}`/);
  assert.match(input, /showToast\(mode === "gpt" \? `送出失敗：\$\{reason\}`/);
  assert.match(input, /showToast\(mode === "gpt" \? `送出失敗：\$\{persistResult\.error\}`/);
  const css = read("src/app/globals.css");
  assert.equal((css.match(/!important/g) ?? []).length, 12);
});

check("GPT 清單查詢投影欄位精簡、confidence aliases 明確、主圖/款式欄位限縮", () => {
  const page = read("src/app/drafts/new/page.tsx");
  const start = page.indexOf("// GPT handoffs");
  const end = page.indexOf("// B12 D7-A", start);
  assert.ok(start >= 0 && end > start, "GPT-only query section markers must exist");
  const gptPage = page.slice(start, end);
  assert.doesNotMatch(gptPage, /\.select\("\*"\)/, "GPT query must not fetch every column");
  assert.match(gptPage, /server_price_confidence:raw_capture->server->>price_confidence/);
  assert.match(gptPage, /client_price_confidence:raw_capture->client_meta->>price_confidence/);
  assert.match(gptPage, /\.eq\("image_type",\s*"main"\)/);
  assert.match(gptPage, /\.select\("id, draft_id, image_type, sort_order, processed_file_url, original_file_url"\)/);
  assert.match(gptPage, /\.select\("id, draft_id, sort_order, cny_price"\)/);
  const csv = read("src/lib/csv/gptRawExport.ts");
  assert.match(csv, /export type GptRawListItem/);
  assert.match(csv, /export function gptPriceWarningsFromCosts\(/);
  assert.match(csv, /return gptPriceWarningsFromCosts\(/);
  const list = read("src/components/listing/GptRawList.tsx");
  assert.match(list, /gptPriceWarningsFromCosts\(/);
});

console.log(`PASS: ${passed} GPT-HANDOFF checks`);
