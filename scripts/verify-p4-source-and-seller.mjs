/**
 * P4 文案出處標記退出＋他店服務資訊排除（Fable 2026-07-18 放行 Q1–Q6）。
 *
 * Pure source + inline strip mirror (no secrets, no network).
 * Run: node scripts/verify-p4-source-and-seller.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

function readSystemPromptArchitecture() {
  const wrapper = read("src/lib/providers/systemPrompt.ts");
  assert.match(wrapper, /from ["']\.\/systemPromptBase["']/u, "systemPrompt wrapper no longer imports systemPromptBase");
  assert.match(
    wrapper,
    /buildCopySystemPrompt as buildProductionCopySystemPrompt/u,
    "systemPrompt wrapper no longer aliases Production buildCopySystemPrompt",
  );
  assert.match(
    wrapper,
    /buildFieldRegenSystemPrompt as buildProductionFieldRegenSystemPrompt/u,
    "systemPrompt wrapper no longer aliases Production buildFieldRegenSystemPrompt",
  );
  assert.match(
    wrapper,
    /return `\$\{buildProductionCopySystemPrompt\(tone, copyLength, secondhandInfo\)\}/u,
    "buildCopySystemPrompt no longer delegates to Production base",
  );
  assert.match(
    wrapper,
    /return `\$\{buildProductionFieldRegenSystemPrompt\(field, tone, copyLength, secondhandInfo\)\}/u,
    "buildFieldRegenSystemPrompt no longer delegates to Production base",
  );
  return { wrapper, base: read("src/lib/providers/systemPromptBase.ts") };
}

function readTitleArchitecture() {
  const wrapper = read("src/lib/contentGenerator/titleGenerator.ts");
  assert.match(
    wrapper,
    /export \* from ["']\.\/titleGeneratorBase["']/u,
    "titleGenerator wrapper no longer re-exports titleGeneratorBase",
  );
  assert.ok(!wrapper.includes("stripCustomerSourceMarkers"), "P4 strip helper leaked into title wrapper");
  return { wrapper, base: read("src/lib/contentGenerator/titleGeneratorBase.ts") };
}

// --- Inline mirror of stripCustomerSourceMarkers (keep in sync with .ts) ---
const PAREN_SOURCE_NETWORK_RE =
  /[（(]\s*來\s*源\s*[:：]\s*網\s*路\s*[）)]|[（(]\s*来\s*源\s*[:：]\s*网\s*络\s*[）)]/gi;
const BARE_SOURCE_NETWORK_RE =
  /[ \t]*來源\s*[:：]\s*網路(?:搜尋)?(?=$|[\s）)\]】，。、；;,.…])|[ \t]*来源\s*[:：]\s*网络(?=$|[\s）)\]】，。、；;,.…])/gi;
const SOURCE_URL_ANNOTATION_RE =
  /[ \t]*[（(]?\s*來源\s*[:：]\s*https?:\/\/[^\s）)\n]+[）)]?|[ \t]*[（(]?\s*来源\s*[:：]\s*https?:\/\/[^\s）)\n]+[）)]?/gi;
const EMPTY_PARENS_RE = /[（(]\s*[）)]/g;

function stripCustomerSourceMarkers(value) {
  if (value == null) return "";
  let s = String(value);
  if (!s) return "";
  for (let i = 0; i < 3; i += 1) {
    const before = s;
    s = s.replace(PAREN_SOURCE_NETWORK_RE, "");
    s = s.replace(SOURCE_URL_ANNOTATION_RE, "");
    s = s.replace(BARE_SOURCE_NETWORK_RE, "");
    s = s.replace(EMPTY_PARENS_RE, "");
    s = s.replace(/[^\S\n]{2,}/g, " ");
    s = s.replace(/[ \t]+([，。、；;,.])/g, "$1");
    s = s.replace(/[ \t]+$/gm, "");
    s = s
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => {
        if (line.trim() === "") return true;
        if (/^[:：\-\u2014\u2013]+$/.test(line.trim())) return false;
        return true;
      })
      .join("\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    s = s.replace(/^\n+/, "").replace(/\n+$/, "");
    if (s === before) break;
  }
  return s;
}

console.log("verify-p4-source-and-seller:");

// --- Prompt: no longer teach customer-facing source marks ---
check("prompt: no B19 teach-to-mark 「標『來源：網路』」 positive instruction", () => {
  const { wrapper, base } = readSystemPromptArchitecture();
  const promptSources = `${wrapper}\n${base}`;
  // Old contract phrases that told the model to annotate output
  assert.ok(
    !promptSources.includes("審入時在該行標「來源：網路」"),
    "old evidence-pool mark instruction still present",
  );
  assert.ok(!promptSources.includes("必須標來源"), "old 必須標來源 still present");
  assert.ok(!promptSources.includes("規格寫入請標來源"), "old user-message 標來源 still present");
  assert.ok(!promptSources.includes("並標來源"), "old 並標來源 still present");
});

check("prompt: wrapper delegates and P4 ban + web search honesty kept in base", () => {
  const { base } = readSystemPromptArchitecture();
  assert.match(base, /P4 出處標記禁令/);
  assert.match(base, /禁止加「（來源：網路）」|禁止標「來源：網路」|顧客文案禁止|顧客可見欄位一律禁止出現/);
  // Honesty: still "不確定就不寫" / evidence pool layer 4
  assert.match(base, /不確定就不寫/);
  assert.match(base, /網路搜尋補充資訊（B19|網路搜尋補充（若有提供）/);
  assert.match(base, /不確定勿寫|不確定就不寫/);
});

check("tavily: no 須標來源; internal-only framing", () => {
  const tavily = read("src/lib/providers/webSearch/tavily.ts");
  assert.ok(!tavily.includes("須標來源"), "tavily still says 須標來源");
  assert.match(tavily, /僅供內部參考|不要標「來源：網路」/);
});

check("internal WEB_SEARCH_USED_WARNING retained", () => {
  const idx = read("src/lib/providers/webSearch/index.ts");
  assert.match(idx, /WEB_SEARCH_USED_WARNING/);
  assert.match(idx, /🔍 含網路搜尋資訊/);
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /WEB_SEARCH_USED_WARNING/);
});

// --- Strip helper behavior ---
check("strip helper file + generate wiring", () => {
  assert.ok(exists("src/lib/providers/stripCustomerSourceMarkers.ts"));
  const helper = read("src/lib/providers/stripCustomerSourceMarkers.ts");
  assert.match(helper, /export function stripCustomerSourceMarkers/);
  assert.match(helper, /PAREN_SOURCE_NETWORK_RE|來源.*網路/);
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /stripCustomerSourceMarkers/);
  assert.match(route, /cleanedWhyWeChoseIt/);
  assert.match(route, /cleanedProductHighlights/);
});

check("strip: （來源：網路） and bare 來源：網路", () => {
  assert.equal(stripCustomerSourceMarkers("尺寸：約30cm（來源：網路）"), "尺寸：約30cm");
  assert.equal(stripCustomerSourceMarkers("材質：絨毛 來源：網路"), "材質：絨毛");
  assert.equal(stripCustomerSourceMarkers("尺寸：30cm(來源:網路)"), "尺寸：30cm");
});

check("strip: empty parens cleanup after mark removal", () => {
  assert.equal(stripCustomerSourceMarkers("尺寸：30cm（）"), "尺寸：30cm");
  assert.equal(stripCustomerSourceMarkers("尺寸：30cm()"), "尺寸：30cm");
  assert.equal(stripCustomerSourceMarkers("尺寸：30cm（來源：網路）"), "尺寸：30cm");
});

check("strip: trailing 來源：URL only; bare URL in prose kept", () => {
  assert.equal(stripCustomerSourceMarkers("產地：日本 來源：https://example.com/item"), "產地：日本");
  assert.equal(
    stripCustomerSourceMarkers("詳見官網 https://example.com/official 說明"),
    "詳見官網 https://example.com/official 說明",
  );
  assert.equal(stripCustomerSourceMarkers("尺寸：10cm（來源：https://a.com/x）"), "尺寸：10cm");
});

check("strip: idempotent", () => {
  const samples = [
    "尺寸：約30cm（來源：網路）\n材質：絨毛 來源：網路",
    "賣點（來源：https://x.com）",
    "乾淨規格：20cm",
    "尺寸：30cm（）",
  ];
  for (const s of samples) {
    const once = stripCustomerSourceMarkers(s);
    const twice = stripCustomerSourceMarkers(once);
    assert.equal(twice, once, `not idempotent for: ${JSON.stringify(s)}`);
  }
});

check("strip: multi-line description + orphan blank collapse", () => {
  const input = [
    "◈ 商品資訊",
    "・尺寸：約20cm（來源：網路）",
    "",
    "",
    "・材質：絨毛",
  ].join("\n");
  const out = stripCustomerSourceMarkers(input);
  assert.ok(!out.includes("來源：網路"));
  assert.ok(out.includes("尺寸：約20cm"));
  assert.ok(out.includes("材質：絨毛"));
  assert.ok(!/\n{3,}/.test(out), "should not leave 3+ blank lines");
});

// --- Seller service exclusion (prompt-only + Vision both ends) ---
check("copy prompt: wrapper delegates and P4 賣家服務類排除 stays in base", () => {
  const { base } = readSystemPromptArchitecture();
  assert.match(base, /P4 賣家服務類排除/);
  for (const term of ["保固", "售後", "退換", "贈品", "店鋪活動"]) {
    assert.ok(base.includes(term), `copy prompt base missing ${term}`);
  }
  assert.match(base, /物理事實/);
});

// SYN-1 R2: render-time filter shares the same core service family
check("SYN-1 R2 filter shares P4 seller-service core terms", () => {
  const termsFile = path.join(root, "src/lib/images/detailCompose/sellerServiceTerms.ts");
  if (!fs.existsSync(termsFile)) {
    // older tree without SYN-1 — skip soft
    return;
  }
  const terms = fs.readFileSync(termsFile, "utf8");
  for (const term of ["保固", "售後", "退換", "贈品", "店鋪活動"]) {
    assert.ok(terms.includes(term), `R2 filter terms missing ${term}`);
  }
  const filter = read("src/lib/images/detailCompose/filterSpecs.ts");
  assert.match(filter, /filterSpecsForDetailImage/);
});

check("vision DESCRIBE + RECOGNIZE both expanded", () => {
  const vision = read("src/lib/providers/visionProvider.ts");
  assert.match(vision, /DESCRIBE_SYSTEM_PROMPT[\s\S]*P4 賣家服務/);
  assert.match(vision, /RECOGNIZE_PRODUCT_SYSTEM[\s\S]*P4|賣家服務排除[\s\S]*P4/);
  // Both DESCRIBE and RECOGNIZE mention core service terms
  const describeIdx = vision.indexOf("const DESCRIBE_SYSTEM_PROMPT");
  const productIdx = vision.indexOf("const RECOGNIZE_PRODUCT_SYSTEM");
  const specIdx = vision.indexOf("const RECOGNIZE_SPEC_SYSTEM");
  assert.ok(describeIdx >= 0 && productIdx >= 0 && specIdx >= 0);
  const describeBlock = vision.slice(describeIdx, productIdx);
  const productBlock = vision.slice(productIdx, specIdx);
  const specBlock = vision.slice(specIdx, specIdx + 1200);
  for (const [name, block] of [
    ["DESCRIBE", describeBlock],
    ["RECOGNIZE_PRODUCT", productBlock],
    ["RECOGNIZE_SPEC", specBlock],
  ]) {
    assert.ok(block.includes("保固") || block.includes("售後") || block.includes("退換"), `${name} missing service terms`);
    assert.ok(
      block.includes("贈品") || block.includes("店鋪活動") || block.includes("促銷"),
      `${name} missing promo/gift family`,
    );
  }
});

// --- titleGenerator / UI untouched (source-level smoke) ---
check("titleGenerator wrapper delegates to Production base; P4 strip stays out", () => {
  const { base } = readTitleArchitecture();
  assert.ok(!base.includes("stripCustomerSourceMarkers"), "P4 strip helper leaked into title base");
  assert.match(base, /export const OFFICIAL_TITLE_MAX_LENGTH = 60/);
  assert.match(base, /export const ENRICHED_TITLE_MAX_LENGTH = 80/);
  assert.match(base, /export function generateDisplayTitle/);
  assert.match(base, /export function clampOfficialTitle/);
  assert.match(base, /export function scrubEnrichedTitleSegment3/);
});

if (failures.length) {
  console.error(`\nFAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nALL passed");
