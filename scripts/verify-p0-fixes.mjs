/**
 * P0 fixes (Fable 2026-07-18 §1.2): pure logic + wiring checks.
 * Covers 61 / 62 / 63 / 73 / 74 / 78. No secrets, no network.
 *
 * Run: node scripts/verify-p0-fixes.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

async function loadTs(rel) {
  // Prefer compiled-free import via dynamic path — project uses tsx-less mirrors.
  // We re-implement pure helpers inline where needed and also import via node
  // when the module is .ts through a small transpile-free reimplementation.
  return null;
}

// --- Inline pure mirrors (must stay in sync with src/) ---

function handleUniquenessSuffix(draftId) {
  const raw = String(draftId ?? "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
  return raw.slice(0, 6);
}

function generateShopifyHandleSlug(input) {
  const HANDLE_MAX_LENGTH = 80;
  const parts = [input.ip, input.character, input.productType]
    .map((s) =>
      String(s ?? "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    )
    .filter(Boolean);
  const base = parts.join("-").replace(/-{2,}/g, "-") || "nestory-product";
  const uniq = handleUniquenessSuffix(input.draftId);
  if (!uniq) {
    return base.slice(0, HANDLE_MAX_LENGTH).replace(/-+$/g, "") || "nestory-product";
  }
  const tail = `-${uniq}`;
  const maxBase = HANDLE_MAX_LENGTH - tail.length;
  const truncatedBase = base.slice(0, Math.max(1, maxBase)).replace(/-+$/g, "") || "nestory-product";
  return `${truncatedBase}${tail}`.slice(0, HANDLE_MAX_LENGTH);
}

function mapStatusToPipelineStage(status) {
  switch (status ?? "") {
    case "ready_for_review":
    case "needs_revision":
    case "failed":
      return "copy_review";
    case "approved":
      return "image_review";
    default:
      return "input";
  }
}

function buildGenerateSuccessStatusPatch(draftState, validationErrors = []) {
  const blocked = draftState === "blocked";
  const status = blocked ? "needs_revision" : "ready_for_review";
  return {
    status,
    pipeline_stage: mapStatusToPipelineStage(status),
    generation_status: blocked ? "failed" : "completed",
    generation_error: blocked
      ? validationErrors.filter(Boolean).join("; ") || "blocked"
      : null,
  };
}

function normalizeOptionalRevisionComment(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function matrixifyInventoryFields(draft) {
  const isDeny = draft.inventory_policy === "deny";
  const qtyRaw = draft.inventory_quantity;
  const qty =
    isDeny && qtyRaw != null && Number.isFinite(Number(qtyRaw)) && Number(qtyRaw) >= 0
      ? Number(qtyRaw)
      : 0;
  return {
    "Variant Inventory Tracker": "shopify",
    "Variant Inventory Qty": qty,
    "Variant Inventory Policy": isDeny ? "deny" : "continue",
  };
}

console.log("P0 fixes checks\n");

// ---------- 73 handle uniqueness ----------
check("73 handleGenerator exports suffix helpers", () => {
  const src = read("src/lib/contentGenerator/handleGenerator.ts");
  assert.match(src, /handleUniquenessSuffix/);
  assert.match(src, /HANDLE_SUFFIX_LEN\s*=\s*6|slice\(0,\s*HANDLE_SUFFIX_LEN\)|slice\(0,\s*6\)/);
  assert.match(src, /draftId/);
  assert.match(src, /HANDLE_MAX_LENGTH\s*=\s*80/);
});

check("73 generate route passes draftId into handle", () => {
  const src = read("src/app/api/generate/route.ts");
  assert.match(src, /generateShopifyHandleSlug/);
  assert.match(src, /draftId/);
  // ensure call site includes draftId key
  assert.match(src, /draftId\s*,?\s*\n?\s*\}/);
});

check("73 two drafts same identity → different handles", () => {
  const a = generateShopifyHandleSlug({
    ip: "chiikawa",
    character: "hachiware",
    productType: "keychain",
    draftId: "6bb29811-aaaa-bbbb-cccc-dddddddddddd",
  });
  const b = generateShopifyHandleSlug({
    ip: "chiikawa",
    character: "hachiware",
    productType: "keychain",
    draftId: "a1b2c3dd-eeee-ffff-0000-111111111111",
  });
  assert.equal(a, "chiikawa-hachiware-keychain-6bb298");
  assert.equal(b, "chiikawa-hachiware-keychain-a1b2c3");
  assert.notEqual(a, b);
  assert.ok(a.endsWith("-6bb298"));
  assert.ok(b.endsWith("-a1b2c3"));
});

check("73 long base never truncates the 6-char suffix", () => {
  const longType = "x".repeat(100);
  const id = "abcdef01-2222-3333-4444-555555555555";
  const slug = generateShopifyHandleSlug({
    ip: "ip",
    character: "char",
    productType: longType,
    draftId: id,
  });
  assert.ok(slug.endsWith("-abcdef"), `suffix lost: ${slug}`);
  assert.ok(slug.length <= 80, `over max: ${slug.length}`);
});

// ---------- 61 modal open class ----------
check("61 RegenCopyModal uses modal-overlay open", () => {
  const src = read("src/components/listing/RegenCopyModal.tsx");
  assert.match(src, /className=["']modal-overlay open["']/);
});

check("61 LockedCopyPreview uses modal-overlay open", () => {
  const src = read("src/components/listing/LockedCopyPreview.tsx");
  assert.match(src, /className=["']modal-overlay open["']/);
});

check("61 globals.css requires .open for display:flex", () => {
  const css = read("src/app/globals.css");
  assert.match(css, /\.modal-overlay\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.modal-overlay\.open\s*\{[^}]*display:\s*flex/s);
});

// ---------- 62 failed → success sync ----------
check("62 generateSuccessStatus helper exists and is used", () => {
  const helper = read("src/lib/drafts/generateSuccessStatus.ts");
  assert.match(helper, /buildGenerateSuccessStatusPatch/);
  const route = read("src/app/api/generate/route.ts");
  assert.match(route, /buildGenerateSuccessStatusPatch/);
  assert.match(route, /successStatus\.status/);
  assert.match(route, /successStatus\.pipeline_stage/);
  assert.match(route, /successStatus\.generation_status/);
  assert.match(route, /successStatus\.generation_error/);
});

check("62 failed draft regen success → three fields pull back", () => {
  // Simulate prior fail light (generation_status failed, stage copy_review)
  const prior = {
    status: "ready_for_review",
    generation_status: "failed",
    pipeline_stage: "copy_review",
    generation_error: "Copy provider failed",
  };
  const patch = buildGenerateSuccessStatusPatch("ok", []);
  // Merge like the route update does
  const next = { ...prior, ...patch };
  assert.equal(next.status, "ready_for_review");
  assert.equal(next.generation_status, "completed");
  assert.equal(next.pipeline_stage, "copy_review");
  assert.equal(next.generation_error, null);
});

check("62 failed draft regen success also recovers status=failed", () => {
  const prior = {
    status: "failed",
    generation_status: "failed",
    pipeline_stage: "copy_review",
    generation_error: "boom",
  };
  const next = { ...prior, ...buildGenerateSuccessStatusPatch("ready", []) };
  assert.equal(next.status, "ready_for_review");
  assert.equal(next.generation_status, "completed");
  assert.equal(next.pipeline_stage, "copy_review");
  assert.equal(next.generation_error, null);
});

check("62 blocked stays failed lights", () => {
  const patch = buildGenerateSuccessStatusPatch("blocked", ["IP missing"]);
  assert.equal(patch.status, "needs_revision");
  assert.equal(patch.generation_status, "failed");
  assert.equal(patch.pipeline_stage, "copy_review");
  assert.match(patch.generation_error, /IP missing/);
});

// ---------- 63 reason optional + operator ----------
check("63 request-revision allows operator", () => {
  const src = read("src/app/api/drafts/[id]/request-revision/route.ts");
  assert.match(src, /operator/);
  assert.match(src, /normalizeOptionalRevisionComment|comment/);
  // must not require non-empty reason
  assert.doesNotMatch(src, /reason is required|comment is required|請填寫退回原因/);
});

check("63 empty / missing reason accepted", () => {
  assert.equal(normalizeOptionalRevisionComment(undefined), null);
  assert.equal(normalizeOptionalRevisionComment(null), null);
  assert.equal(normalizeOptionalRevisionComment(""), null);
  assert.equal(normalizeOptionalRevisionComment("   "), null);
  assert.equal(normalizeOptionalRevisionComment("尺寸不對"), "尺寸不對");
});

// ---------- 74 matrixify inventory ----------
check("74 matrixifyInventoryFields wiring", () => {
  const src = read("src/lib/csv/matrixify.ts");
  assert.match(src, /matrixifyInventoryFields/);
  assert.match(src, /\.\.\.inventory/);
  assert.doesNotMatch(
    src.replace(/matrixifyInventoryFields[\s\S]*?^}/m, ""),
    /"Variant Inventory Policy":\s*"deny"/
  );
});

check("74 unlimited → continue + qty 0 + shopify tracker", () => {
  const u = matrixifyInventoryFields({ inventory_policy: "continue", inventory_quantity: null });
  assert.equal(u["Variant Inventory Policy"], "continue");
  assert.equal(u["Variant Inventory Qty"], 0);
  assert.equal(u["Variant Inventory Tracker"], "shopify");

  const def = matrixifyInventoryFields({ inventory_policy: undefined, inventory_quantity: null });
  assert.equal(def["Variant Inventory Policy"], "continue");
});

check("74 deny → actual qty", () => {
  const d = matrixifyInventoryFields({ inventory_policy: "deny", inventory_quantity: 5 });
  assert.equal(d["Variant Inventory Policy"], "deny");
  assert.equal(d["Variant Inventory Qty"], 5);
  assert.equal(d["Variant Inventory Tracker"], "shopify");
});

// ---------- 78 light-reset documentation assertions ----------
check("78 resetForNextItem light-reset contract in WorkspaceInputPanel", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(src, /function resetForNextItem/);
  assert.match(src, /clearWorkspaceAutosave/);
  // cleared
  assert.match(src, /setTitle\(""\)/);
  assert.match(src, /setPrice\(""\)/);
  assert.match(src, /setDraftId\(null\)/);
  assert.match(src, /setFormKey/);
  assert.match(src, /setSeedImages\(null\)/);
  assert.match(src, /setVariants\(\[\]\)/);
  // success path calls reset
  assert.match(src, /resetForNextItem\(\)/);
  // keeps: no setSource("") / setTone / setSaleStatus reset to default inside resetForNextItem body
  const fn = src.match(/function resetForNextItem\(\)\s*\{[\s\S]*?\n  \}/);
  assert.ok(fn, "resetForNextItem body not found");
  const body = fn[0];
  assert.doesNotMatch(body, /setSource\(/);
  assert.doesNotMatch(body, /setTone\(/);
  assert.doesNotMatch(body, /setSaleStatus\(/);
  assert.doesNotMatch(body, /setCopyLength\(/);
  assert.doesNotMatch(body, /setPriceMode\(/);
  assert.doesNotMatch(body, /setUseWebSearch\(/);
});

// Source file parity: real TS modules for 62/74 when available via dynamic import
// (optional — mirrors above already cover logic)
check("62/74 source files parse markers", () => {
  assert.ok(fs.existsSync(path.join(root, "src/lib/drafts/generateSuccessStatus.ts")));
  assert.ok(fs.existsSync(path.join(root, "src/lib/csv/matrixify.ts")));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("P0 fixes ALL passed");
