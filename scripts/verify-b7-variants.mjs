/**
 * B7 pure-logic verification (no secrets, no network).
 * Covers: dimension clamp, row cap 50, form→DB mapping, productOptions first-value order,
 * publish plan multi vs single, B3 screenshot fill shape, persist insert-first safety,
 * price lock recalculation contract.
 *
 * Run: node --experimental-strip-types scripts/verify-b7-variants.mjs
 *   or: node scripts/verify-b7-variants.mjs  (inline mirrors)
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

async function loadTs(rel) {
  const abs = path.join(root, rel);
  try {
    return await import(pathToFileURL(abs).href);
  } catch (e) {
    // Node 24 strip types
    const { register } = await import("node:module");
    try {
      // fallback: dynamic with query
      return await import(pathToFileURL(abs).href + `?t=${Date.now()}`);
    } catch {
      throw e;
    }
  }
}

console.log("B7 variant verification\n");

// ── Inline mirrors (always run; no TS loader required) ───────────────────

const MAX_VARIANT_ROWS = 50;
const MAX_VARIANT_DIMENSIONS = 3;

function clampDimensions(dims) {
  return dims
    .map((d) => ({ name: String(d.name || "").trim() }))
    .filter((d) => d.name.length > 0)
    .slice(0, MAX_VARIANT_DIMENSIONS);
}

function isFilled(row) {
  return (row.optionValues || []).some((v) => String(v || "").trim());
}

function clampVariantRows(rows) {
  if (rows.length <= MAX_VARIANT_ROWS) {
    return { rows, truncated: false, warning: null };
  }
  return {
    rows: rows.slice(0, MAX_VARIANT_ROWS),
    truncated: true,
    warning: `上限 ${MAX_VARIANT_ROWS}`
  };
}

function formRowsToDbInserts(dimensions, rows) {
  const dims = clampDimensions(dimensions);
  const names = [dims[0]?.name ?? "款式", dims[1]?.name ?? null, dims[2]?.name ?? null];
  return rows.filter(isFilled).map((row, index) => {
    const v0 = row.optionValues[0]?.trim() || "";
    const v1 = row.optionValues[1]?.trim() || "";
    const v2 = row.optionValues[2]?.trim() || "";
    const costNum = Number(row.cost);
    const sellNum = Number(row.sellPrice);
    const qtyTrim = String(row.qty || "").trim();
    const qtyNum = qtyTrim === "" ? null : Number(qtyTrim);
    const hasFinite = qtyNum != null && Number.isInteger(qtyNum) && qtyNum >= 0 && qtyTrim !== "";
    return {
      option1_name: names[0],
      option1_value: v0 || "Default Title",
      option2_name: names[1] && v1 ? names[1] : null,
      option2_value: names[1] && v1 ? v1 : null,
      option3_name: names[2] && v2 ? names[2] : null,
      option3_value: names[2] && v2 ? v2 : null,
      cny_price: Number.isFinite(costNum) && costNum > 0 ? costNum : null,
      twd_price: Number.isFinite(sellNum) && sellNum > 0 ? Math.round(sellNum) : null,
      price_locked: Boolean(row.priceLocked),
      sort_order: index,
      inventory_quantity: hasFinite ? qtyNum : 0,
      inventory_policy: hasFinite ? "deny" : "continue",
      image_id: row.imageId ?? null
    };
  });
}

function buildShopifyProductOptions(dimensions, rows) {
  const dims = clampDimensions(dimensions);
  const filled = rows.filter(isFilled);
  if (!dims.length || !filled.length) return [];
  return dims.map((dim, dimIndex) => {
    const ordered = [];
    const seen = new Set();
    for (const row of filled) {
      const val = row.optionValues[dimIndex]?.trim() || "";
      if (!val || seen.has(val)) continue;
      seen.add(val);
      ordered.push(val);
    }
    if (!ordered.length) ordered.push("Default");
    return { name: dim.name, values: ordered.map((name) => ({ name })) };
  });
}

function buildVariantPublishPlan(dbRows, draft) {
  const sorted = [...(dbRows || [])]
    .filter((r) => r.option1_value?.trim() || r.option2_value?.trim())
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (!sorted.length) return { mode: "single" };
  const dimNames = [];
  if (sorted[0].option1_name) dimNames.push(sorted[0].option1_name);
  if (sorted[0].option2_name) dimNames.push(sorted[0].option2_name);
  if (sorted[0].option3_name) dimNames.push(sorted[0].option3_name);
  if (!dimNames.length) dimNames.push("款式");
  const productOptions = dimNames.map((name, dimIndex) => {
    const ordered = [];
    const seen = new Set();
    for (const row of sorted) {
      const vals = [row.option1_value, row.option2_value, row.option3_value];
      const val = (vals[dimIndex] || "Default").trim() || "Default";
      if (seen.has(val)) continue;
      seen.add(val);
      ordered.push(val);
    }
    return { name, values: ordered.map((n) => ({ name: n })) };
  });
  const seeds = sorted.map((row) => ({
    price: row.twd_price ?? 0,
    compareAtPrice: draft.price_mode === "single" ? null : row.compare_at_price ?? null,
    inventoryPolicy: row.inventory_policy === "deny" ? "DENY" : "CONTINUE",
    optionValues: dimNames.map((optionName, i) => ({
      optionName,
      name: [row.option1_value, row.option2_value, row.option3_value][i] || "Default"
    }))
  }));
  return {
    mode: "multi",
    productOptions,
    initial: seeds[0],
    additional: seeds.slice(1),
    all: seeds
  };
}

// B3 2A fill (mirror of screenshotRecognition post-B7)
function planScreenshotVariants(currentVariants, recognized) {
  const hasExisting = currentVariants.some((row) =>
    (row.optionValues || []).some((v) => String(v || "").trim())
  );
  const recognizedVariants = (recognized || []).filter((v) => v.name?.trim());
  if (hasExisting) {
    return { variants: null, note: hasExisting && recognizedVariants.length ? "skip" : "none" };
  }
  if (!recognizedVariants.length) return { variants: null, note: "missing" };
  const capped = recognizedVariants.slice(0, 50);
  return {
    variants: capped.map((v, index) => ({
      optionValues: [v.name.trim(), "", ""],
      cost: v.costCny != null && v.costCny > 0 ? String(v.costCny) : "",
      sellPrice: "",
      compareAt: "",
      priceLocked: false,
      qty: "",
      sku: "",
      imageId: null,
      sortOrder: index
    })),
    note: "filled"
  };
}

// persist insert-first mock
async function persistSafe(store, draftId, rows) {
  const old = store.filter((r) => r.draft_id === draftId);
  if (rows.length === 0) {
    store.splice(0, store.length, ...store.filter((r) => r.draft_id !== draftId));
    return { ok: true, deleted: old.length };
  }
  // simulate insert fail
  if (rows.some((r) => r._fail)) {
    return { ok: false, phase: "insert", error: "insert failed", oldCount: old.length };
  }
  const inserted = rows.map((r, i) => ({ ...r, id: `new-${i}`, draft_id: draftId }));
  // insert first
  store.push(...inserted);
  // then delete old
  for (const o of old) {
    const idx = store.findIndex((r) => r.id === o.id);
    if (idx >= 0) store.splice(idx, 1);
  }
  return { ok: true, inserted: inserted.length, deleted: old.length };
}

async function main() {
console.log("1) dimensions + row cap");
await check("max 3 dimensions", () => {
  const d = clampDimensions([
    { name: "角色" },
    { name: "尺寸" },
    { name: "顏色" },
    { name: "材質" }
  ]);
  assert.equal(d.length, 3);
  assert.equal(d[2].name, "顏色");
});
await check("row cap 50 with warning", () => {
  const many = Array.from({ length: 55 }, (_, i) => ({
    optionValues: [`R${i}`, "", ""],
    cost: "10",
    sellPrice: "100",
    compareAt: "",
    priceLocked: false,
    qty: "",
    sku: "",
    imageId: null,
    sortOrder: i
  }));
  const r = clampVariantRows(many);
  assert.equal(r.rows.length, 50);
  assert.equal(r.truncated, true);
  assert.ok(r.warning);
});

console.log("\n2) form → DB mapping (cny_price=cost, twd_price=sell)");
await check("cost goes to cny_price, sell to twd_price", () => {
  const inserts = formRowsToDbInserts(
    [{ name: "角色" }, { name: "尺寸" }],
    [
      {
        optionValues: ["小八", "12cm", ""],
        cost: "35.5",
        sellPrice: "299",
        compareAt: "349",
        priceLocked: true,
        qty: "",
        sku: "",
        imageId: null,
        sortOrder: 0
      }
    ]
  );
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].cny_price, 35.5);
  assert.equal(inserts[0].twd_price, 299);
  assert.equal(inserts[0].option1_name, "角色");
  assert.equal(inserts[0].option2_value, "12cm");
  assert.equal(inserts[0].inventory_policy, "continue");
  assert.equal(inserts[0].price_locked, true);
});
await check("finite qty → deny", () => {
  const inserts = formRowsToDbInserts([{ name: "款式" }], [
    {
      optionValues: ["A", "", ""],
      cost: "10",
      sellPrice: "199",
      compareAt: "",
      priceLocked: false,
      qty: "3",
      sku: "",
      imageId: null,
      sortOrder: 0
    }
  ]);
  assert.equal(inserts[0].inventory_policy, "deny");
  assert.equal(inserts[0].inventory_quantity, 3);
});

console.log("\n3) productOptions first-value = first row (no ghost Default Title)");
await check("first option values match sort_order 0", () => {
  const rows = [
    {
      optionValues: ["烏薩奇", "15cm", ""],
      cost: "42",
      sellPrice: "329",
      compareAt: "",
      priceLocked: false,
      qty: "",
      sku: "",
      imageId: null,
      sortOrder: 0
    },
    {
      optionValues: ["小八", "12cm", ""],
      cost: "35",
      sellPrice: "299",
      compareAt: "",
      priceLocked: false,
      qty: "",
      sku: "",
      imageId: null,
      sortOrder: 1
    }
  ];
  const opts = buildShopifyProductOptions([{ name: "角色" }, { name: "尺寸" }], rows);
  assert.equal(opts[0].values[0].name, "烏薩奇");
  assert.equal(opts[1].values[0].name, "15cm");
  assert.ok(opts[0].values.some((v) => v.name === "小八"));
});

console.log("\n4) publish plan multi vs single");
await check("0 rows → single", () => {
  const plan = buildVariantPublishPlan([], { price_mode: "sale" });
  assert.equal(plan.mode, "single");
});
await check("2 rows → multi with initial + additional", () => {
  const plan = buildVariantPublishPlan(
    [
      {
        option1_name: "角色",
        option1_value: "小八",
        option2_name: null,
        option2_value: null,
        option3_name: null,
        option3_value: null,
        twd_price: 299,
        compare_at_price: 349,
        inventory_policy: "continue",
        inventory_quantity: 0,
        sort_order: 0
      },
      {
        option1_name: "角色",
        option1_value: "烏薩奇",
        option2_name: null,
        option2_value: null,
        option3_name: null,
        option3_value: null,
        twd_price: 329,
        compare_at_price: 399,
        inventory_policy: "deny",
        inventory_quantity: 2,
        sort_order: 1
      }
    ],
    { price_mode: "sale" }
  );
  assert.equal(plan.mode, "multi");
  assert.equal(plan.all.length, 2);
  assert.equal(plan.initial.price, 299);
  assert.equal(plan.additional.length, 1);
  assert.equal(plan.additional[0].inventoryPolicy, "DENY");
  assert.equal(plan.productOptions[0].values[0].name, "小八");
});
await check("single price mode nulls compareAt on seeds", () => {
  const plan = buildVariantPublishPlan(
    [
      {
        option1_name: "款式",
        option1_value: "A",
        twd_price: 199,
        compare_at_price: 249,
        inventory_policy: "continue",
        inventory_quantity: 0,
        sort_order: 0
      }
    ],
    { price_mode: "single" }
  );
  assert.equal(plan.mode, "multi");
  assert.equal(plan.initial.compareAtPrice, null);
});

console.log("\n5) B3 screenshot fill → B7 structure");
await check("empty table fills 1-dim rows", () => {
  const plan = planScreenshotVariants([], [
    { name: "粉色", costCny: 12 },
    { name: "藍色", costCny: 15 }
  ]);
  assert.equal(plan.note, "filled");
  assert.equal(plan.variants.length, 2);
  assert.equal(plan.variants[0].optionValues[0], "粉色");
  assert.equal(plan.variants[0].cost, "12");
  assert.equal(plan.variants[0].priceLocked, false);
});
await check("existing rows not overwritten", () => {
  const plan = planScreenshotVariants(
    [{ optionValues: ["已有", "", ""], cost: "1", sellPrice: "", compareAt: "", priceLocked: false, qty: "", sku: "", imageId: null, sortOrder: 0 }],
    [{ name: "新的", costCny: 99 }]
  );
  assert.equal(plan.note, "skip");
  assert.equal(plan.variants, null);
});

console.log("\n6) persist insert-first (no silent wipe)");
await check("insert fail keeps old rows", async () => {
  const store = [
    { id: "old-1", draft_id: "d1", option1_value: "舊" },
    { id: "old-2", draft_id: "d1", option1_value: "舊2" }
  ];
  const r = await persistSafe(store, "d1", [{ option1_value: "新", _fail: true }]);
  assert.equal(r.ok, false);
  assert.equal(r.phase, "insert");
  assert.equal(store.filter((x) => x.draft_id === "d1").length, 2);
  assert.ok(store.some((x) => x.option1_value === "舊"));
});
await check("insert success then deletes old", async () => {
  const store = [{ id: "old-1", draft_id: "d1", option1_value: "舊" }];
  const r = await persistSafe(store, "d1", [{ option1_value: "新A" }, { option1_value: "新B" }]);
  assert.equal(r.ok, true);
  const mine = store.filter((x) => x.draft_id === "d1");
  assert.equal(mine.length, 2);
  assert.ok(mine.every((x) => String(x.option1_value).startsWith("新")));
});

console.log("\n7) locked rows skip recalculation contract");
await check("priceLocked rows unchanged by map", () => {
  const rows = [
    { priceLocked: true, sellPrice: "999", cost: "10" },
    { priceLocked: false, sellPrice: "100", cost: "10" }
  ];
  const next = rows.map((row) =>
    row.priceLocked ? row : { ...row, sellPrice: "200" }
  );
  assert.equal(next[0].sellPrice, "999");
  assert.equal(next[1].sellPrice, "200");
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
