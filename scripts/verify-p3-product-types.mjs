/**
 * P3 類型目錄擴充 verify：
 * - 新類型／alias 在 nestoryTagsV2 就位
 * - 長關鍵字優先：滑鼠墊≠滑鼠、鍵帽≠鍵盤
 * - 舊類型（絨毛／吊飾／臺燈→燈具／充電）零回歸（源碼＋鏡像邏輯）
 * - migration 037 僅新四類＋二手_類型_X；大型娃娃不重產
 *
 * Pure source + inline mirror. Run: node scripts/verify-p3-product-types.mjs
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

// --- Mirror of PRODUCT_TYPE_CANONICALS matching (length-desc includes) ---
// Keep expected pairs in sync with nestoryTagsV2.ts; tests assert source has them too.
function parseCanonicalMap(src) {
  const map = new Map();
  const block = src.match(
    /const PRODUCT_TYPE_CANONICALS = new Map\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(block, "PRODUCT_TYPE_CANONICALS block not found");
  // String→string pairs, plus string→CHARM_ACCESSORY_TAG_LABEL (吊飾徽章)
  const re =
    /\['((?:\\'|[^'])*)',\s*(?:'((?:\\'|[^'])*)'|CHARM_ACCESSORY_TAG_LABEL)\]/g;
  let m;
  while ((m = re.exec(block[1])) !== null) {
    const key = m[1].replace(/\\'/g, "'");
    const val = (m[2] ?? "吊飾徽章").replace(/\\'/g, "'");
    map.set(key, val);
  }
  assert.ok(map.size > 40, `expected rich map, got ${map.size}`);
  return map;
}

function parseFixedTypes(src) {
  const block = src.match(
    /export const NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS = \[([\s\S]*?)\] as const;/,
  );
  assert.ok(block, "NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS not found");
  const labels = [...block[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  // charm accessory tag label is extra fixed type
  const fixed = new Set([...labels, "吊飾徽章"]);
  return fixed;
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
    .find(([keyword, canonical]) => normalized.includes(keyword) && fixed.has(canonical));

  return matched ? matched[1] : null;
}

console.log("verify-p3-product-types:");

const src = read("src/lib/nestoryTagsV2.ts");
const map = parseCanonicalMap(src);
const fixed = parseFixedTypes(src);

// --- Labels present ---
check("P3 labels: 滑鼠／鍵盤／手把控制器／保溫杯瓶／大型娃娃 in FIXED list", () => {
  for (const t of ["滑鼠", "鍵盤", "手把控制器", "保溫杯瓶", "大型娃娃"]) {
    assert.ok(fixed.has(t), `missing fixed type ${t}`);
    assert.match(src, new RegExp(`'${t}'`));
  }
});

// --- Critical Q10 length priority ---
check("Q10: 滑鼠墊 → 滑鼠墊（不被滑鼠吃掉）", () => {
  assert.equal(canonicalizeProductType("滑鼠墊", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("電競滑鼠墊", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("鼠标垫", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("桌墊", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("mouse pad", map, fixed), "滑鼠墊");
  assert.equal(canonicalizeProductType("desk mat", map, fixed), "滑鼠墊");
});

check("Q10: 無線滑鼠／mouse → 滑鼠（解 Razer blocked；靠子字串滑鼠）", () => {
  assert.equal(canonicalizeProductType("滑鼠", map, fixed), "滑鼠");
  assert.equal(canonicalizeProductType("無線滑鼠", map, fixed), "滑鼠");
  assert.equal(canonicalizeProductType("电竞鼠标", map, fixed), "滑鼠");
  assert.equal(canonicalizeProductType("mouse", map, fixed), "滑鼠");
  assert.notEqual(canonicalizeProductType("無線滑鼠", map, fixed), "滑鼠墊");
  // 禁止「電競滑鼠」複合 key（會吃掉電競滑鼠墊）
  assert.equal(map.has("電競滑鼠"), false);
  assert.equal(map.has("無線滑鼠"), false);
});

check("Q10: 鍵帽 ≠ 鍵盤；鍵盤獨立", () => {
  assert.equal(canonicalizeProductType("鍵帽", map, fixed), "鍵帽");
  assert.equal(canonicalizeProductType("键帽", map, fixed), "鍵帽");
  assert.equal(canonicalizeProductType("keycap", map, fixed), "鍵帽");
  assert.equal(canonicalizeProductType("鍵帽組", map, fixed), "鍵帽");
  assert.equal(canonicalizeProductType("鍵盤", map, fixed), "鍵盤");
  assert.equal(canonicalizeProductType("機械鍵盤", map, fixed), "鍵盤");
  assert.equal(canonicalizeProductType("keyboard", map, fixed), "鍵盤");
  assert.notEqual(canonicalizeProductType("鍵帽", map, fixed), "鍵盤");
  assert.notEqual(canonicalizeProductType("鍵盤", map, fixed), "鍵帽");
});

// --- Alias packs ---
check("#3 耳機 alias → 藍牙耳機（不新開類型）", () => {
  assert.equal(canonicalizeProductType("耳機", map, fixed), "藍牙耳機");
  assert.equal(canonicalizeProductType("電競耳機", map, fixed), "藍牙耳機");
  assert.equal(canonicalizeProductType("headset", map, fixed), "藍牙耳機");
  assert.equal(canonicalizeProductType("藍牙耳機", map, fixed), "藍牙耳機");
  assert.ok(!fixed.has("耳機") || fixed.has("藍牙耳機"));
  assert.ok(!src.includes("'耳機',\n  '藍牙") && !/NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS[\s\S]*?'耳機'/.test(
    src.match(/NESTORY_TAGS_V2_PRODUCT_TYPE_LABELS = \[[\s\S]*?\] as const;/)[0],
  ));
});

check("Q4 喇叭 alias → 藍牙音響", () => {
  assert.equal(canonicalizeProductType("喇叭", map, fixed), "藍牙音響");
  assert.equal(canonicalizeProductType("音箱", map, fixed), "藍牙音響");
  assert.equal(canonicalizeProductType("speaker", map, fixed), "藍牙音響");
});

check("#5 手把控制器", () => {
  assert.equal(canonicalizeProductType("手把", map, fixed), "手把控制器");
  assert.equal(canonicalizeProductType("遊戲手把", map, fixed), "手把控制器");
  assert.equal(canonicalizeProductType("gamepad", map, fixed), "手把控制器");
});

check("#9 保溫杯瓶", () => {
  assert.equal(canonicalizeProductType("保溫杯", map, fixed), "保溫杯瓶");
  assert.equal(canonicalizeProductType("保温杯", map, fixed), "保溫杯瓶");
  assert.equal(canonicalizeProductType("水壺", map, fixed), "保溫杯瓶");
  assert.equal(canonicalizeProductType("tumbler", map, fixed), "保溫杯瓶");
});

check("Q5 收納盒／袋 → 展示收納", () => {
  assert.equal(canonicalizeProductType("收納", map, fixed), "展示收納");
  assert.equal(canonicalizeProductType("收納盒", map, fixed), "展示收納");
  assert.equal(canonicalizeProductType("收納袋", map, fixed), "展示收納");
  assert.equal(canonicalizeProductType("置物盒", map, fixed), "展示收納");
});

check("#22 充電周邊 alias 擴充", () => {
  assert.equal(canonicalizeProductType("充電器", map, fixed), "充電周邊");
  assert.equal(canonicalizeProductType("充電線", map, fixed), "充電周邊");
  assert.equal(canonicalizeProductType("行動電源", map, fixed), "充電周邊");
  assert.equal(canonicalizeProductType("power bank", map, fixed), "充電周邊");
});

check("Q6 大型娃娃 in V2（對齊 033，不重產 migration）", () => {
  assert.equal(canonicalizeProductType("大型娃娃", map, fixed), "大型娃娃");
  assert.equal(canonicalizeProductType("大型玩偶", map, fixed), "大型娃娃");
  assert.equal(canonicalizeProductType("大娃娃", map, fixed), "大型娃娃");
});

// --- Regression ---
check("回歸：臺燈系 → 燈具小物（P1-C1）", () => {
  for (const a of ["臺燈", "台燈", "檯燈", "桌燈", "夜燈"]) {
    assert.equal(canonicalizeProductType(a, map, fixed), "燈具小物");
  }
});

check("回歸：絨毛／吊飾／公仔既有類型", () => {
  assert.equal(canonicalizeProductType("絨毛娃娃", map, fixed), "絨毛娃娃");
  assert.equal(canonicalizeProductType("毛絨公仔", map, fixed), "絨毛娃娃");
  assert.equal(canonicalizeProductType("plush", map, fixed), "絨毛娃娃");
  assert.equal(canonicalizeProductType("吊飾", map, fixed), "吊飾徽章");
  assert.equal(canonicalizeProductType("keychain", map, fixed), "吊飾徽章");
  assert.equal(canonicalizeProductType("公仔模型", map, fixed), "公仔模型");
  assert.equal(canonicalizeProductType("盲盒", map, fixed), "盲盒");
});

check("回歸：未知類型仍 null（本包仍 hard-block；B 方案另包）", () => {
  assert.equal(canonicalizeProductType("量子衛星", map, fixed), null);
  assert.equal(canonicalizeProductType("完全不存在的品類xyz", map, fixed), null);
});

// --- Themes wiring in source ---
check("addThemeByType：新 3C → 手機電腦；保溫杯瓶 → 居家日用；大型娃娃 → 居家療癒", () => {
  assert.match(src, /'滑鼠'[\s\S]*?'手機電腦'|手機電腦[\s\S]*?'滑鼠'/);
  // stronger: 手機電腦 block includes new types
  const phoneBlock = src.match(
    /if \(\s*\[\s*[\s\S]*?'充電周邊'[\s\S]*?\]\.includes\(productType\)\s*\) \{\s*addUnique\(themes, '手機電腦'/,
  );
  assert.ok(phoneBlock, "手機電腦 theme block should include 充電周邊 cluster");
  assert.match(phoneBlock[0], /'滑鼠'/);
  assert.match(phoneBlock[0], /'鍵盤'/);
  assert.match(phoneBlock[0], /'手把控制器'/);

  assert.match(src, /\['杯具餐具', '毛巾毯子', '生活雜貨', '保溫杯瓶'\]/);
  assert.match(src, /productType === '娃娃抱枕' \|\| productType === '大型娃娃'/);
});

// --- Migration 037 ---
check("migration 037 存在且含四新類型＋二手_類型_X", () => {
  assert.ok(exists("supabase/migrations/037_tag_rules_p3_product_types.sql"));
  const sql = read("supabase/migrations/037_tag_rules_p3_product_types.sql");
  for (const t of ["滑鼠", "鍵盤", "手把控制器", "保溫杯瓶"]) {
    assert.match(sql, new RegExp(`類型_${t}`));
    assert.match(sql, new RegExp(`二手_類型_${t}`));
  }
  // 大型娃娃 must NOT be re-seeded as tag_value (comment may mention it)
  assert.ok(!sql.includes("類型_大型娃娃"), "037 must not re-seed 類型_大型娃娃");
  assert.ok(!sql.includes("二手_類型_大型娃娃"), "037 must not re-seed 二手_類型_大型娃娃");
  // alias-only packs must not invent new type rows
  assert.ok(!sql.includes("類型_耳機"));
  assert.ok(!sql.includes("類型_喇叭"));
});

check("033 still owns 大型娃娃 seed", () => {
  const m033 = read("supabase/migrations/033_tag_rules_sync_boss_tool.sql");
  // unicode form for 大型娃娃
  assert.ok(
    m033.includes("大型娃娃") || m033.includes("\\5927\\578B\\5A03\\5A03") || m033.includes("\\u5927"),
    "033 should seed 大型娃娃",
  );
});

// --- buildNestoryTagsV2Result missing message still present (A-path) ---
check("blocked 路徑仍靠 missing 類型_（B 方案未實作）", () => {
  assert.match(src, /缺少 類型_ tag，請選擇商品類型/);
  assert.match(src, /不在 Tags V2 固定類型中，未輸出 類型_ tag/);
});

if (failures.length) {
  console.error(`\n${failures.length} failed`);
  process.exit(1);
}
console.log("\nALL passed");
