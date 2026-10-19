/**
 * WORKBENCH-UX verifier (offline): WB-1 character tags/recompute, WB-2 sequential
 * live-review wiring, WB-3 Shopify main image authority, WB-4 workspace preferences.
 * No network, Supabase, Shopify, or browser session writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);
const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const splitNames = await import(src("src/lib/characters/splitCharacterNames.ts"));
const tagsV2 = await import(src("src/lib/nestoryTagsV2.ts"));
const listingDraftInput = await import(src("src/lib/drafts/listingDraftInput.ts"));
const missingWarnings = await import(src("src/lib/characters/missingCharacterWarnings.ts"));
const recompute = await import(src("src/lib/drafts/recomputeDraftTags.ts"));
const mainImage = await import(src("src/lib/images/shopifyMainImage.ts"));
const payload = await import(src("src/lib/shopify/payload.ts"));
const workspacePrefs = await import(src("src/lib/drafts/workspacePrefs.ts"));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("WB-1 — character tags + recompute");

await check("splitCharacterNames supports the approved separators, preserves spaces, dedupes", () => {
  assert.deepEqual(splitNames.splitCharacterNames("耿鬼、路卡利歐、沙奈朵"), ["耿鬼", "路卡利歐", "沙奈朵"]);
  assert.deepEqual(splitNames.splitCharacterNames("Hello Kitty, 酷洛米"), ["Hello Kitty", "酷洛米"]);
  assert.deepEqual(splitNames.splitCharacterNames("皮卡丘、皮卡丘"), ["皮卡丘"]);
  assert.deepEqual(splitNames.splitCharacterNames("不指定"), []);
  assert.deepEqual(splitNames.splitCharacterNames(null), []);
  assert.deepEqual(splitNames.splitCharacterNames("A，B／C｜D＋E+F/G|H"), ["A", "B", "C", "D", "E", "F", "G", "H"]);
  assert.deepEqual(splitNames.splitCharacterNames("Hello Kitty"), ["Hello Kitty"]);
  assert.deepEqual(splitNames.splitCharacterNames("A & B 和 C 與 D"), ["A & B 和 C 與 D"]);
  assert.deepEqual(splitNames.splitCharacterNames("不指定、、A、A、 "), ["A"]);
  assert.equal(splitNames.hasCharacterNameSeparator("A、B"), true);
  assert.equal(splitNames.hasCharacterNameSeparator("Hello Kitty"), false);
});

await check("buildNestoryTagsV2Result emits one 角色_ tag per split character", () => {
  const result = tagsV2.buildNestoryTagsV2Result(
    {
      product_status: "general",
      ip: "寶可夢",
      characters: ["耿鬼、路卡利歐、沙奈朵"],
      variants: [],
      product_types: ["公仔模型"],
      use_cases: [],
      sale_status: null,
      recommend_tags: [],
      product_name: "測試",
      price: 399,
    },
    {
      ipCatalog: [{ ip_name: "寶可夢", aliases: [] }],
      ipCharacters: [
        { ip_name: "寶可夢", character_name: "耿鬼", aliases: [] },
        { ip_name: "寶可夢", character_name: "路卡利歐", aliases: [] },
        { ip_name: "寶可夢", character_name: "沙奈朵", aliases: [] },
      ],
    },
  );
  assert.ok(result.tags.includes("角色_耿鬼"));
  assert.ok(result.tags.includes("角色_路卡利歐"));
  assert.ok(result.tags.includes("角色_沙奈朵"));
  assert.ok(!result.warnings.some((warning) => warning.includes("尚未建立")));
});

await check("toListingDraftInput uses split character array", () => {
  const input = listingDraftInput.toListingDraftInput(
    {
      source_url: null,
      is_secondhand: false,
      product_brand: null,
      sale_status: null,
      title_zh: "測試",
      taobao_title: null,
      original_title: null,
      note: null,
      twd_price: 299,
      compare_at_price: null,
      image_description: null,
      secondhand_grade: null,
      secondhand_condition: null,
      secondhand_notes: null,
    },
    { ip: "寶可夢", character: "耿鬼、路卡利歐", productType: "公仔模型", category: "", sku: "" },
  );
  assert.deepEqual(input.characters, ["耿鬼", "路卡利歐"]);
});

await check("missing-character warning parser returns split individual names", () => {
  assert.deepEqual(
    missingWarnings.extractMissingCharacterNames([
      "角色「Hello Kitty, 酷洛米」尚未建立 V2 字典 canonical name，未輸出角色_ tag。",
    ]),
    ["Hello Kitty", "酷洛米"],
  );
});

await check("recompute helpers recognize all approved dictionary warning families", () => {
  const samples = [
    "角色「A」尚未建立 V2 字典 canonical name",
    "角色「A」尚未建立正式 tag_rules",
    "角色「A」尚未建立二手 tag_rules",
    "角色「A」尚未建立 tag_rules",
    "IP「X」不在 V2 IP 字典中",
    "⚠ 待收編類型：奇怪類型",
  ];
  for (const sample of samples) assert.equal(recompute.isTagDictWarning(sample), true, sample);
  assert.equal(recompute.isTagDictWarning("售價待確認"), false);
});

await check("recompute tags preserves manual role tags, ignores unrelated derived prefixes, and conditionally replaces type", () => {
  const next = recompute.buildRecomputedTags(
    ["定位_IP周邊", "類型_吊飾徽章", "角色_自己加的"],
    ["IP_寶可夢", "角色_耿鬼", "類型_公仔模型", "定位_收藏選物"],
  );
  assert.ok(next.includes("IP_寶可夢"));
  assert.ok(next.includes("角色_耿鬼"));
  assert.ok(next.includes("角色_自己加的"));
  assert.ok(next.includes("類型_公仔模型"));
  assert.ok(next.includes("定位_IP周邊"));
  assert.ok(!next.includes("類型_吊飾徽章"));
  assert.ok(!next.includes("定位_收藏選物"));
  assert.ok(recompute.buildRecomputedTags(["類型_吊飾徽章"], ["IP_寶可夢"]).includes("類型_吊飾徽章"));
});

await check("recompute warnings clear only dictionary warnings and resolved AI IP warning", () => {
  const next = recompute.buildRecomputedWarnings(
    [
      "角色「A」尚未建立 V2 字典 canonical name",
      "AI 判斷 IP「寶可夢」不在建檔清單中，tag 可能不完整",
      "售價待確認",
    ],
    ["角色「B」尚未建立 V2 字典 canonical name"],
    { ipInCatalog: true },
  );
  assert.deepEqual(next, ["售價待確認", "角色「B」尚未建立 V2 字典 canonical name"]);
  const unresolved = recompute.buildRecomputedWarnings(
    ["AI 判斷 IP「X」不在建檔清單中，tag 可能不完整", "價格 warning"],
    [],
    { ipInCatalog: false },
  );
  assert.deepEqual(unresolved, ["AI 判斷 IP「X」不在建檔清單中，tag 可能不完整", "價格 warning"]);
});

await check("quick-add rejects multi-character input before auth; recompute route is POST-only and AI-free", () => {
  const quick = read("src/app/api/characters/quick-add/route.ts");
  assert.match(quick, /hasCharacterNameSeparator\(characterName\)/);
  assert.match(quick, /multi_character_name/);
  assert.ok(quick.indexOf("hasCharacterNameSeparator(characterName)") < quick.indexOf("createServerSupabaseClient()"));

  const route = read("src/app/api/drafts/[id]/recompute-tags/route.ts");
  assert.match(route, /export async function POST/);
  assert.doesNotMatch(route, /export\s+(?:async\s+function|const)\s+(?!POST\b)/);
  assert.match(route, /buildNestoryTagsV2Result/);
  assert.match(route, /shopify_product_id/);
  assert.match(route, /code: "published"/);
  assert.match(route, /shopify_tags: nextTags/);
  assert.doesNotMatch(route, /openai|anthropic|\/api\/generate|generateListingContent/i);
});

console.log("WB-2 — sequential review");

await check("sequential overlay resets by roundId, not live queue identity, and respects top modals", () => {
  const overlay = read("src/components/listing/SequentialReviewOverlay.tsx");
  assert.match(overlay, /syncedRoundId !== roundId/);
  assert.doesNotMatch(overlay, /syncedQueue !== queue/);
  assert.match(overlay, /\[open, roundId, isImageMode\]/);
  assert.match(overlay, /\.modal-overlay\.open:not\(\.seq-review-overlay\)/);
  assert.match(overlay, /isJumpTarget=\{flashDraftId === current\.draft\.id\}/);
});

await check("DraftResultsPanel keeps round order but feeds live draft/images/variants", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(panel, /seqReviewRound/);
  assert.match(panel, /draftsById\.get\(id\)/);
  assert.match(panel, /imagesByDraft\.get\(id\)/);
  assert.match(panel, /variantsByDraft\.get\(id\)/);
  assert.match(panel, /roundId=\{seqReviewRound\?\.id \?\? 0\}/);
});

await check("both station-2 batch failure branches refresh before return", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  const batch = panel.slice(panel.indexOf("async function batchStationReview()"), panel.indexOf("async function batchArchiveOrUnarchive"));
  assert.match(batch, /advance-ready[\s\S]*?!response\.ok && !payload\.ok[\s\S]*?router\.refresh\(\);[\s\S]*?return;/);
  assert.match(batch, /send-images[\s\S]*?!response\.ok[\s\S]*?router\.refresh\(\);[\s\S]*?return;/);
});

console.log("WB-3 — Shopify main image");

await check("Shopify main helper filters main+variant and stable-sorts by sort_order", () => {
  const images = [
    { id: "detail", image_type: "detail", sort_order: -10 },
    { id: "main-late", image_type: "main", sort_order: 2 },
    { id: "variant-first-a", image_type: "variant", sort_order: 0 },
    { id: "variant-first-b", image_type: "variant", sort_order: 0 },
  ];
  assert.deepEqual(mainImage.sortShopifyMediaImages(images).map((x) => x.id), [
    "variant-first-a",
    "variant-first-b",
    "main-late",
  ]);
  assert.equal(mainImage.pickShopifyMainImage(images)?.id, "variant-first-a");
  assert.equal(
    mainImage.pickShopifyMainImage([
      { id: "detail", image_type: "detail", sort_order: 0 },
      { id: "main-3", image_type: "main", sort_order: 3 },
      { id: "main-1", image_type: "main", sort_order: 1 },
    ])?.id,
    "main-1",
  );
  assert.equal(mainImage.pickShopifyMainImage([]), null);
  assert.equal(mainImage.pickShopifyMainImage([{ id: "d", image_type: "detail", sort_order: 0 }]), null);
});

const baseDraft = (overrides = {}) => ({
  id: "11111111-1111-4111-8111-111111111111",
  title_zh: "WORKBENCH-UX 測試商品",
  description_html: "測試內文",
  generated_faq_html: "",
  spec_text: "",
  generation_tone: "潮巢導購版",
  sale_status: "",
  twd_price: 299,
  twd_cost: 100,
  cny_price: 20,
  inventory_policy: "continue",
  inventory_quantity: 0,
  shopify_tags: [],
  tags: [],
  product_images: [],
  ...overrides,
});

await check("payload media first image matches pickShopifyMainImage", () => {
  const productImages = [
    {
      id: "m2", draft_id: "d", image_type: "main", sort_order: 2,
      original_file_url: "https://example.com/m2.jpg", processed_file_url: null,
      generated_file_url: null, list_thumb_url: null, alt_text: "m2",
    },
    {
      id: "v0", draft_id: "d", image_type: "variant", sort_order: 0,
      original_file_url: "https://example.com/v0.jpg", processed_file_url: null,
      generated_file_url: null, list_thumb_url: null, alt_text: "v0",
    },
    {
      id: "d0", draft_id: "d", image_type: "detail", sort_order: -1,
      original_file_url: "https://example.com/detail.jpg", processed_file_url: null,
      generated_file_url: null, list_thumb_url: null, alt_text: "detail",
    },
  ];
  assert.equal(mainImage.pickShopifyMainImage(productImages)?.id, "v0");
  const built = payload.buildShopifyProductPayload(baseDraft({ product_images: productImages }), "draft");
  assert.equal(built.media[0].alt, "v0");
  assert.equal(built.media.length, 2);
});

await check("UI uses shared main-image authority without changing publish sorting", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  const station2 = read("src/components/listing/Station2ImagePanel.tsx");
  const station3 = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  const payloadSource = read("src/lib/shopify/payload.ts");
  assert.match(card, /pickShopifyMainImage\(images\)/);
  assert.match(station2, /⭐ Shopify 主圖/);
  assert.match(station2, /設為主圖/);
  assert.match(station3, /⭐ Shopify 主圖/);
  assert.match(payloadSource, /filter\(isShopifyProductMediaImage\)[\s\S]*?sort\(\(a, b\) => a\.sort_order - b\.sort_order\)/);
});

console.log("WB-4 — workspace defaults + completion flash");

class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
}
const VALID_TONES = ["黑膠文藝收藏感", "小編聊天口吻", "潮巢導購版", "依IP自動匹配"];

await check("workspace prefs default to single + 潮巢導購版 and persist manual choices", () => {
  const storage = new FakeStorage();
  assert.deepEqual(workspacePrefs.readWorkspacePrefs(storage, VALID_TONES), {
    priceMode: "single",
    tone: "潮巢導購版",
  });
  storage.setItem(
    workspacePrefs.WORKSPACE_PREFS_KEY,
    JSON.stringify({ priceMode: "sale", tone: "小編聊天口吻" }),
  );
  assert.deepEqual(workspacePrefs.readWorkspacePrefs(storage, VALID_TONES), {
    priceMode: "sale",
    tone: "小編聊天口吻",
  });
  storage.setItem(
    workspacePrefs.WORKSPACE_PREFS_KEY,
    JSON.stringify({ priceMode: "sale", tone: "不存在的語氣" }),
  );
  assert.deepEqual(workspacePrefs.readWorkspacePrefs(storage, VALID_TONES), {
    priceMode: "sale",
    tone: "潮巢導購版",
  });
  workspacePrefs.writeWorkspacePref(storage, { priceMode: "single" });
  assert.equal(workspacePrefs.readWorkspacePrefs(storage, VALID_TONES).priceMode, "single");
  storage.setItem(workspacePrefs.WORKSPACE_PREFS_KEY, "{broken");
  assert.deepEqual(workspacePrefs.readWorkspacePrefs(storage, VALID_TONES), {
    priceMode: "single",
    tone: "潮巢導購版",
  });
});

await check("WorkspaceInputPanel compares auto-tone against preferred tone and writes prefs only in manual handlers", () => {
  const panel = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(panel, /tone !== preferredTone/);
  assert.match(panel, /fields\.tone !== preferredToneRef\.current/);
  assert.match(panel, /current !== preferredToneRef\.current/);
  assert.match(panel, /writeWorkspacePref[\s\S]*?priceMode: next/);
  assert.match(panel, /setPreferredTone\(option\.value\)[\s\S]*?writeWorkspacePref/);
  const serverSeed = panel.slice(panel.indexOf("function applyServerFormSeed"), panel.indexOf("function continueRestore"));
  assert.doesNotMatch(serverSeed, /writeWorkspacePref/);
});

await check("generation and regen completion reuse ResultCard is-jump-target flash for 8 seconds", () => {
  const panel = read("src/components/listing/DraftResultsPanel.tsx");
  assert.match(panel, /setTimeout\([\s\S]*?8000\)/);
  assert.match(panel, /GENERATION_PROGRESS_EVENT/);
  assert.match(panel, /REGEN_QUEUE_STATUS_EVENT/);
  assert.match(panel, /doneFlashId === draft\.id/);
  assert.match(panel, /flashDraftId=\{doneFlashId\}/);
});

await check("ResultCard edits product_type, not detected_category, and unpublished saves recompute tags", () => {
  const card = read("src/components/listing/ResultCard.tsx");
  assert.match(card, /product_type: productType\.trim\(\) \|\| null/);
  assert.doesNotMatch(card, /detected_category:\s*detectedCategory/);
  assert.match(card, /productTypeChanged && !draft\.shopify_product_id/);
  assert.match(card, /\/recompute-tags/);
  assert.match(card, /型態已改，類型_ tag 請到 Tags 分頁確認/);
});

if (failures.length) {
  console.error(`\nWORKBENCH-UX verifier FAILED: ${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nWORKBENCH-UX verifier PASS: ${passed} checks`);
