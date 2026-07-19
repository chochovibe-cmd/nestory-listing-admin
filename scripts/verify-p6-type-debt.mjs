/**
 * P6｜類型系統債清尾 verify
 *
 * Fable 核帳四回歸 + 管線補洞：
 * 1) P0-62 紅燈語意（blocked → needs_revision / failed；ready → completed）
 * 2) hasBlockingWarnings：類型 suggest 不擋；⛔ 必修仍擋
 * 3) 缺 IP／銷售／價格帶單獨存在時仍 blocked（missing）
 * 4) Q10 滑鼠墊長關鍵字（不被滑鼠吃掉）
 * + 目錄外 B 文案、P3 五類 handle/scenario/title alias
 *
 * Pure source + inline mirrors. Run: node scripts/verify-p6-type-debt.mjs
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

// --- Mirror: P0-62 generateSuccessStatus ---
function buildGenerateSuccessStatusPatch(draftState, validationErrors = []) {
  const blocked = draftState === "blocked";
  const status = blocked ? "needs_revision" : "ready_for_review";
  return {
    status,
    generation_status: blocked ? "failed" : "completed",
    generation_error: blocked
      ? validationErrors.filter(Boolean).join("; ") || "blocked"
      : null,
  };
}

// --- Mirror: warningTiers (keep in sync with src/lib/drafts/warningTiers.ts) ---
const SUGGEST_PATTERNS = [
  /使用情境/,
  /推薦標籤/,
  /網搜/,
  /請核實/,
  /建議/,
  /可補強/,
  /meta.*相似/,
  /相似度/,
  /情境詞/,
  /內部連結/,
  /待收編類型/,
  /不在 Tags V2 固定類型中/,
  /未輸出\s*類型_?\s*tag/,
  /未輸出類型 tag/,
];
const BLOCK_PATTERNS = [
  /尚未建立/,
  /角色「[^」]+」尚未/,
  /IP.*缺/,
  /缺少\s*IP/,
  /必填/,
  /成本不齊/,
  /每款式成本/,
  /blocked/i,
  /無法生成/,
];

function gradeWarningText(raw) {
  const text = String(raw ?? "")
    .replace(/^[⚠⛔🔍\s]+/, "")
    .trim();
  if (!text) return "confirm";
  for (const re of BLOCK_PATTERNS) if (re.test(text)) return "block";
  for (const re of SUGGEST_PATTERNS) if (re.test(text)) return "suggest";
  return "confirm";
}

function gradeDraftWarnings(warnings) {
  const block = [];
  const suggest = [];
  const confirm = [];
  for (const raw of warnings ?? []) {
    const tier = gradeWarningText(raw);
    if (tier === "block") block.push(raw);
    else if (tier === "suggest") suggest.push(raw);
    else confirm.push(raw);
  }
  return {
    block,
    suggest,
    confirm,
    blockCount: block.length,
    suggestCount: suggest.length,
    confirmCount: confirm.length,
  };
}

function hasBlockingWarnings(summary) {
  return summary.blockCount > 0;
}

// --- Mirror: nestoryTagsV2 product-type canonicalize (length-desc includes) ---
function parseCanonicalMap(src) {
  const map = new Map();
  const block = src.match(
    /const PRODUCT_TYPE_CANONICALS = new Map\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(block, "PRODUCT_TYPE_CANONICALS block not found");
  const re =
    /\['((?:\\'|[^'])*)',\s*(?:'((?:\\'|[^'])*)'|CHARM_ACCESSORY_TAG_LABEL)\]/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const key = m[1].replace(/\\'/g, "'");
    const val = (m[2] ?? "吊飾徽章").replace(/\\'/g, "'");
    map.set(key, val);
  }
  return map;
}

function parseFixedTypes(src) {
  const block = src.match(
    /export const NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(block, "NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS not found");
  const labels = [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  return new Set([...labels, "吊飾徽章"]);
}

function canonicalizeProductType(value, map, fixed) {
  const normalized = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/^類型_/, "");
  if (!normalized) return null;
  const direct = map.get(normalized);
  if (direct && fixed.has(direct)) return direct;
  const matched = Array.from(map.entries())
    .sort(([left], [right]) => right.length - left.length)
    .find(
      ([keyword, canonical]) =>
        normalized.includes(keyword) && fixed.has(canonical),
    );
  return matched ? matched[1] : null;
}

/**
 * Mirror of P6 B type resolution branch:
 * - off-catalog raw → warning, not missing (if no canonical after inference)
 * - vacuum → missing
 * This mirror only covers canonicalize path (no text inference) to lock B branching.
 */
function resolveTypesB(rawTypes, map, fixed) {
  const productTypes = [];
  const warnings = [];
  const missing = [];
  const offCatalog = [];

  for (const raw of rawTypes ?? []) {
    const canonical = canonicalizeProductType(raw, map, fixed);
    if (canonical) {
      if (!productTypes.includes(canonical)) productTypes.push(canonical);
    } else if (String(raw ?? "").trim()) {
      const label = String(raw).trim().replace(/^類型_/, "");
      if (label && !offCatalog.includes(label)) {
        offCatalog.push(label);
        warnings.push(
          `待收編類型：${label}（未輸出類型 tag，不影響上架）`,
        );
      }
    }
  }

  if (productTypes.length === 0) {
    if (offCatalog.length === 0) {
      missing.push("缺少 類型_ tag，請選擇商品類型。");
    }
  }

  const tags = productTypes.map((t) => `類型_${t}`);
  return { productTypes, warnings, missing, tags, offCatalog };
}

console.log("verify-p6-type-debt:\n");

const v2Src = read("src/lib/nestoryTagsV2.ts");
const tiersSrc = read("src/lib/drafts/warningTiers.ts");
const handleSrc = read("src/lib/contentGenerator/handleGenerator.ts");
const scenarioSrc = read("src/lib/contentGenerator/scenarioKeywords.ts");
const titleSrc = read("src/lib/contentGenerator/titleGenerator.ts");
const statusSrc = read("src/lib/drafts/generateSuccessStatus.ts");
const map = parseCanonicalMap(v2Src);
const fixed = parseFixedTypes(v2Src);

// ========== 1) P0-62 紅燈語意 ==========
check("P0-62 source still maps blocked → failed / needs_revision", () => {
  assert.match(statusSrc, /draftState === ["']blocked["']/);
  assert.match(statusSrc, /needs_revision/);
  assert.match(statusSrc, /generation_status:\s*blocked \? ["']failed["']/);
});

check("P0-62: blocked keeps red lights", () => {
  const p = buildGenerateSuccessStatusPatch("blocked", ["缺少 IP_ tag"]);
  assert.equal(p.status, "needs_revision");
  assert.equal(p.generation_status, "failed");
  assert.ok(p.generation_error);
});

check("P0-62: ready → completed (off-catalog path after B)", () => {
  const p = buildGenerateSuccessStatusPatch("ready", []);
  assert.equal(p.status, "ready_for_review");
  assert.equal(p.generation_status, "completed");
  assert.equal(p.generation_error, null);
});

// ========== 2) hasBlockingWarnings + 類型 suggest ==========
check("warningTiers source has P6 type suggest patterns", () => {
  assert.match(tiersSrc, /待收編類型/);
  assert.match(tiersSrc, /不在 Tags V2 固定類型中/);
  assert.match(tiersSrc, /未輸出類型 tag/);
});

check("新文案 待收編類型 → suggest，不擋核准", () => {
  const msg = "待收編類型：電競椅（未輸出類型 tag，不影響上架）";
  assert.equal(gradeWarningText(msg), "suggest");
  const summary = gradeDraftWarnings([msg]);
  assert.equal(summary.suggestCount, 1);
  assert.equal(summary.blockCount, 0);
  assert.equal(hasBlockingWarnings(summary), false);
});

check("舊文案 不在 Tags V2… → suggest 相容", () => {
  const old =
    "商品類型「電競椅」不在 Tags V2 固定類型中，未輸出 類型_ tag。";
  assert.equal(gradeWarningText(old), "suggest");
  assert.equal(hasBlockingWarnings(gradeDraftWarnings([old])), false);
});

check("⛔ 必修仍擋（缺 IP／角色未建立）", () => {
  assert.equal(gradeWarningText("缺少 IP（必填）"), "block");
  assert.equal(
    gradeWarningText("角色「小八」尚未建立 V2 字典 canonical name，未輸出角色_ tag。"),
    "block",
  );
  assert.equal(
    hasBlockingWarnings(
      gradeDraftWarnings([
        "待收編類型：X（未輸出類型 tag，不影響上架）",
        "缺少 IP（必填）",
      ]),
    ),
    true,
  );
});

// ========== 3) 缺 IP／銷售／價格帶 仍 missing/blocked ==========
check("V2 source: IP／銷售／價格 missing 文案仍在", () => {
  assert.match(v2Src, /缺少 IP_ tag/);
  assert.match(v2Src, /缺少 銷售_ tag/);
  assert.match(v2Src, /缺少有效售價，無法產生 價格帶_ tag/);
  assert.match(v2Src, /缺少 類型_ tag，請選擇商品類型/);
});

check("B 鏡像：目錄外 alone → warning、無 missing、無自由類型 tag", () => {
  const r = resolveTypesB(["電競椅腳踏"], map, fixed);
  assert.equal(r.productTypes.length, 0);
  assert.equal(r.missing.length, 0);
  assert.ok(r.warnings.some((w) => w.includes("待收編類型：電競椅腳踏")));
  assert.ok(r.warnings.every((w) => w.includes("不影響上架")));
  assert.equal(r.tags.length, 0);
  assert.ok(!r.tags.some((t) => t.includes("待確認")));
});

check("B 鏡像：真空 → missing（仍可 blocked）", () => {
  const r = resolveTypesB([], map, fixed);
  assert.equal(r.productTypes.length, 0);
  assert.ok(r.missing.some((m) => m.includes("缺少 類型_ tag")));
  assert.equal(r.warnings.length, 0);
});

check("B 鏡像：目錄內正常 → 有 類型_ tag、無 warning", () => {
  const r = resolveTypesB(["滑鼠"], map, fixed);
  assert.deepEqual(r.productTypes, ["滑鼠"]);
  assert.deepEqual(r.tags, ["類型_滑鼠"]);
  assert.equal(r.missing.length, 0);
  assert.equal(r.offCatalog.length, 0);
});

check("B 鏡像：缺類型 missing + 其他 missing 語意可並存（draft_state blocked）", () => {
  // Simulate: vacuum type missing alone is enough for blocked
  const typeMissing = resolveTypesB([], map, fixed).missing;
  const allMissing = [
    "缺少 IP_ tag，請先套用或選擇 IP。",
    ...typeMissing,
    "缺少 銷售_ tag，請選擇銷售狀態。",
    "缺少有效售價，無法產生 價格帶_ tag。",
  ];
  assert.ok(allMissing.length >= 3);
  const draftState = allMissing.length > 0 ? "blocked" : "ready";
  const patch = buildGenerateSuccessStatusPatch(draftState, allMissing);
  assert.equal(patch.generation_status, "failed");
  // IP-only missing still blocked
  const ipOnly = buildGenerateSuccessStatusPatch("blocked", [
    "缺少 IP_ tag，請先套用或選擇 IP。",
  ]);
  assert.equal(ipOnly.status, "needs_revision");
  // Sale-only
  const saleOnly = buildGenerateSuccessStatusPatch("blocked", [
    "缺少 銷售_ tag，請選擇銷售狀態。",
  ]);
  assert.equal(saleOnly.generation_status, "failed");
  // Price-band only
  const priceOnly = buildGenerateSuccessStatusPatch("blocked", [
    "缺少有效售價，無法產生 價格帶_ tag。",
  ]);
  assert.equal(priceOnly.generation_status, "failed");
});

check("目錄外 ready 路徑：warnings only → draft_state ready", () => {
  const r = resolveTypesB(["未知小物XYZ"], map, fixed);
  const validationErrors = r.missing;
  const draftState = validationErrors.length > 0 ? "blocked" : "ready";
  assert.equal(draftState, "ready");
  const patch = buildGenerateSuccessStatusPatch(draftState, validationErrors);
  assert.equal(patch.generation_status, "completed");
  assert.equal(hasBlockingWarnings(gradeDraftWarnings(r.warnings)), false);
});

// ========== 4) Q10 滑鼠墊長關鍵字 ==========
check("Q10: 滑鼠墊／電競滑鼠墊 → 滑鼠墊，不被滑鼠吃掉", () => {
  assert.equal(canonicalizeProductType("滑鼠墊", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("電競滑鼠墊", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("鼠标垫", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("桌墊", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("無線滑鼠", map, fixed), "滑鼠");
  assert.equal(canonicalizeProductType("滑鼠", map, fixed), "滑鼠");
});

check("titleGenerator 滑鼠 alias 有負向預查 (?!墊)", () => {
  assert.match(titleSrc, /滑鼠\(\?!墊\)/);
  assert.match(titleSrc, /鍵盤\(\?!帽\)/);
});

// ========== P3 五類管線補洞 ==========
const P3_TYPES = ["滑鼠", "鍵盤", "手把控制器", "保溫杯瓶", "大型娃娃"];
const P3_SLUGS = {
  滑鼠: "mouse",
  鍵盤: "keyboard",
  手把控制器: "gamepad",
  保溫杯瓶: "tumbler",
  大型娃娃: "jumbo-plush",
};

check("handleGenerator PRODUCT_TYPE_SLUGS 含 P3 五類", () => {
  for (const [label, slug] of Object.entries(P3_SLUGS)) {
    assert.match(
      handleSrc,
      new RegExp(`${label}:\\s*'${slug}'`),
      `missing slug ${label}→${slug}`,
    );
  }
});

check("scenarioKeywords DEFAULT 含 P3 五類且每類 ≥3 詞", () => {
  for (const t of P3_TYPES) {
    assert.match(scenarioSrc, new RegExp(`${t}:\\s*\\[`));
  }
  // crude count: each P3 block should have at least 3 quoted strings nearby
  for (const t of P3_TYPES) {
    const re = new RegExp(`${t}:\\s*\\[([^\\]]+)\\]`);
    const m = scenarioSrc.match(re);
    assert.ok(m, `scenario block for ${t}`);
    const terms = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    assert.ok(terms.length >= 3, `${t} needs ≥3 scenario terms, got ${terms.length}`);
    // P2-80: title blacklist terms may appear in SEO/D scenario (生日禮物 OK);
    // must not invent 熱賣/必買 seller puffery in our draft lists
    for (const term of terms) {
      assert.ok(!/熱賣|爆款|必買|超值|限時/.test(term), `puffery term ${term}`);
    }
  }
});

check("titleGenerator PRODUCT_TYPE_ALIASES 含 P3 五類 canonical", () => {
  for (const t of P3_TYPES) {
    assert.match(titleSrc, new RegExp(`['"]${t}['"]`));
  }
  assert.match(titleSrc, /大型娃娃/);
  assert.match(titleSrc, /手把控制器/);
  assert.match(titleSrc, /保溫杯瓶/);
});

check("不得把自由字／待確認寫進 類型_ tag", () => {
  assert.doesNotMatch(v2Src, /addTag\(\s*tags,\s*'類型_',\s*'待確認'/);
  assert.doesNotMatch(v2Src, /addTag\(\s*tags,\s*'類型_',\s*rawType/);
  assert.doesNotMatch(v2Src, /addTag\(\s*tags,\s*'類型_',\s*label/);
  // only addTag 類型_ from productTypes loop (canonical)
  assert.match(
    v2Src,
    /for \(const productType of productTypes\) \{\s*addTag\(tags, '類型_', productType\);/,
  );
});

check("B 實作：offCatalog 分支存在、舊硬擋文案改 warning 路徑", () => {
  assert.match(v2Src, /offCatalogTypeLabels/);
  assert.match(v2Src, /P6 B/);
  // vacuum still missing
  assert.match(v2Src, /缺少 類型_ tag，請選擇商品類型/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nALL passed");
