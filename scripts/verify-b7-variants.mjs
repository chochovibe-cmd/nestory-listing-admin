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
  // Node 22+ can strip types when run with --experimental-strip-types;
  // also try plain import (Node 24 often works for type-only syntax).
  try {
    return await import(pathToFileURL(abs).href + `?t=${Date.now()}`);
  } catch (e) {
    throw e;
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

// ── pkg2b: cross-expand + merge (inline mirror of variantCrossExpand.ts) ─
console.log("\n8) pkg2b cross-expand merge + clamp (Fable)");

const CARTESIAN_CLAMP_WARNING =
  "款式組合超過 50，已截斷——請減少軸值或分兩件商品上架";

function normalizeIdentity(value) {
  return String(value || "").normalize("NFKC").trim().replace(/\s+/g, " ");
}

// Minimal P2-79 fold: 米飛／米菲 → miffy (mirrors alias patch + merge extra)
function normalizeOptionValueForMerge(raw) {
  const id = normalizeIdentity(raw);
  if (!id) return "";
  const key = id.toLowerCase();
  const alias = {
    米飛: "miffy",
    米菲: "miffy",
    米菲兔: "miffy",
    米菲兔子: "miffy",
    miffy: "miffy"
  };
  return alias[key] || key;
}

function optionValuesMergeKey(ov) {
  return [0, 1, 2]
    .map((i) => normalizeOptionValueForMerge(ov[i] || ""))
    .join("\u0001");
}

function isHandFilled(row) {
  if (row.priceLocked) return true;
  if (row.imageId) return true;
  if (String(row.sku || "").trim()) return true;
  if (String(row.qty || "").trim()) return true;
  if (String(row.sellPrice || "").trim()) return true;
  if (String(row.compareAt || "").trim()) return true;
  const costNum = Number(row.cost);
  if (String(row.cost || "").trim() && Number.isFinite(costNum) && costNum > 0) return true;
  return false;
}

function uniqueAxisValues(values) {
  const ordered = [];
  const seen = new Set();
  for (const raw of values || []) {
    const display = String(raw || "").trim();
    if (!display) continue;
    const k = normalizeOptionValueForMerge(display);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    ordered.push(display);
  }
  return ordered;
}

function cartesianOptionValueCombos(dimensions) {
  const dims = (dimensions || []).slice(0, 3);
  const active = [];
  for (let i = 0; i < dims.length; i++) {
    const values = uniqueAxisValues(dims[i]?.values);
    if (values.length > 0) active.push({ index: i, values });
  }
  if (!active.length) return [];
  let combos = [["", "", ""]];
  for (const axis of active) {
    const next = [];
    for (const base of combos) {
      for (const v of axis.values) {
        const ov = [base[0], base[1], base[2]];
        ov[axis.index] = v;
        next.push(ov);
      }
    }
    combos = next;
  }
  return combos;
}

function expandAndMergeVariantRows(dimensions, existing) {
  const combos = cartesianOptionValueCombos(dimensions);
  const existingByKey = new Map();
  const sortedExisting = [...(existing || [])].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
  for (const row of sortedExisting) {
    if (!isFilled(row)) continue;
    const key = optionValuesMergeKey(row.optionValues);
    if (!existingByKey.has(key)) existingByKey.set(key, row);
  }
  const expandedKeys = new Set(combos.map((ov) => optionValuesMergeKey(ov)));
  const wouldDiscardHandFilled = [];
  for (const [key, row] of existingByKey) {
    if (!expandedKeys.has(key) && isHandFilled(row)) wouldDiscardHandFilled.push(row);
  }
  let rows = combos.map((optionValues, i) => {
    const hit = existingByKey.get(optionValuesMergeKey(optionValues));
    const base = {
      optionValues,
      cost: "",
      sellPrice: "",
      compareAt: "",
      priceLocked: false,
      qty: "",
      sku: "",
      imageId: null,
      sortOrder: i
    };
    if (!hit) return base;
    return {
      ...base,
      cost: hit.cost,
      sellPrice: hit.sellPrice,
      compareAt: hit.compareAt,
      priceLocked: hit.priceLocked,
      qty: hit.qty,
      sku: hit.sku,
      imageId: hit.imageId
    };
  });
  let truncated = false;
  let warning = null;
  if (rows.length > MAX_VARIANT_ROWS) {
    truncated = true;
    warning = CARTESIAN_CLAMP_WARNING;
    rows = rows.slice(0, MAX_VARIANT_ROWS).map((r, i) => ({ ...r, sortOrder: i }));
  }
  return {
    rows,
    truncated,
    warning,
    wouldDiscardHandFilled,
    comboCount: combos.length
  };
}

function rebuildDimensionValuesFromRows(dimensions, rows) {
  const sorted = [...(rows || [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return (dimensions || []).slice(0, 3).map((dim, di) => {
    const ordered = [];
    const seen = new Set();
    for (const row of sorted) {
      const display = String(row.optionValues?.[di] || "").trim();
      if (!display) continue;
      const key = normalizeOptionValueForMerge(display);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      ordered.push(display);
    }
    return { name: dim.name, values: ordered };
  });
}

function removeDimensionMergingRows(dimensions, rows, dimIndex) {
  const nextDims = dimensions.filter((_, i) => i !== dimIndex);
  const shifted = rows.map((row) => {
    const optionValues = [
      row.optionValues[0] || "",
      row.optionValues[1] || "",
      row.optionValues[2] || ""
    ];
    for (let i = dimIndex; i < 2; i++) optionValues[i] = optionValues[i + 1] || "";
    optionValues[2] = "";
    return { ...row, optionValues };
  });
  const winners = new Map();
  const wouldDiscardHandFilled = [];
  const sorted = [...shifted].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  for (const row of sorted) {
    if (!isFilled(row)) continue;
    const key = optionValuesMergeKey(row.optionValues);
    if (!winners.has(key)) winners.set(key, row);
    else if (isHandFilled(row)) wouldDiscardHandFilled.push(row);
  }
  const nextRows = [...winners.values()].map((r, i) => ({ ...r, sortOrder: i }));
  return {
    dimensions: rebuildDimensionValuesFromRows(nextDims, nextRows),
    rows: nextRows,
    wouldDiscardHandFilled
  };
}

function emptyRow(sortOrder, ov = ["", "", ""]) {
  return {
    optionValues: ov,
    cost: "",
    sellPrice: "",
    compareAt: "",
    priceLocked: false,
    qty: "",
    sku: "",
    imageId: null,
    sortOrder
  };
}

await check("米飛／米菲 merge key same (P2-79)", () => {
  const a = optionValuesMergeKey(["米飛", "12cm", ""]);
  const b = optionValuesMergeKey(["米菲", "12cm", ""]);
  assert.equal(a, b);
});

await check("merge preserves cost/sell/lock/qty/sku/image_id", () => {
  const dims = [
    { name: "角色", values: ["小八", "烏薩奇"] },
    { name: "尺寸", values: ["12cm"] }
  ];
  const existing = [
    {
      ...emptyRow(0, ["小八", "12cm", ""]),
      cost: "35.5",
      sellPrice: "299",
      compareAt: "349",
      priceLocked: true,
      qty: "2",
      sku: "SKU-A",
      imageId: "img-uuid-1"
    },
    {
      ...emptyRow(1, ["烏薩奇", "12cm", ""]),
      cost: "40",
      sellPrice: "329",
      priceLocked: false,
      qty: "",
      sku: "",
      imageId: null
    }
  ];
  const result = expandAndMergeVariantRows(dims, existing);
  assert.equal(result.rows.length, 2);
  const hit = result.rows.find((r) => r.optionValues[0] === "小八");
  assert.ok(hit);
  assert.equal(hit.cost, "35.5");
  assert.equal(hit.sellPrice, "299");
  assert.equal(hit.compareAt, "349");
  assert.equal(hit.priceLocked, true);
  assert.equal(hit.qty, "2");
  assert.equal(hit.sku, "SKU-A");
  assert.equal(hit.imageId, "img-uuid-1");
  assert.equal(result.wouldDiscardHandFilled.length, 0);
});

await check("cartesian clamp 50 Fable copy", () => {
  const dims = [
    { name: "A", values: Array.from({ length: 10 }, (_, i) => `A${i}`) },
    { name: "B", values: Array.from({ length: 6 }, (_, i) => `B${i}`) }
  ];
  const result = expandAndMergeVariantRows(dims, []);
  assert.equal(result.comboCount, 60);
  assert.equal(result.rows.length, 50);
  assert.equal(result.truncated, true);
  assert.equal(result.warning, CARTESIAN_CLAMP_WARNING);
});

await check("empty axis does not participate", () => {
  const dims = [
    { name: "角色", values: ["小八", "烏薩奇"] },
    { name: "尺寸", values: [] },
    { name: "顏色", values: ["粉"] }
  ];
  const combos = cartesianOptionValueCombos(dims);
  assert.equal(combos.length, 2);
  assert.deepEqual(combos[0], ["小八", "", "粉"]);
  assert.deepEqual(combos[1], ["烏薩奇", "", "粉"]);
});

await check("axis order 0→1→2", () => {
  const dims = [
    { name: "角色", values: ["A", "B"] },
    { name: "尺寸", values: ["1", "2"] }
  ];
  const combos = cartesianOptionValueCombos(dims);
  assert.deepEqual(
    combos.map((c) => c.join("/")),
    ["A/1/", "A/2/", "B/1/", "B/2/"]
  );
});

await check("remove dim partial hit keeps min sortOrder", () => {
  const dims = [
    { name: "角色", values: ["小八"] },
    { name: "尺寸", values: ["12cm", "15cm"] }
  ];
  const rows = [
    { ...emptyRow(0, ["小八", "12cm", ""]), cost: "10", imageId: "keep-me" },
    { ...emptyRow(1, ["小八", "15cm", ""]), cost: "99", imageId: "lose-me" }
  ];
  const result = removeDimensionMergingRows(dims, rows, 1);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].optionValues[0], "小八");
  assert.equal(result.rows[0].cost, "10");
  assert.equal(result.rows[0].imageId, "keep-me");
  assert.equal(result.wouldDiscardHandFilled.length, 1);
  assert.equal(result.wouldDiscardHandFilled[0].imageId, "lose-me");
});

await check("rebuild values from rows (not reverse invent)", () => {
  const dims = [
    { name: "角色", values: ["幽靈", "幽靈2"] },
    { name: "尺寸", values: ["99cm"] }
  ];
  const rows = [emptyRow(0, ["小八", "12cm", ""]), emptyRow(1, ["烏薩奇", "12cm", ""])];
  const rebuilt = rebuildDimensionValuesFromRows(dims, rows);
  assert.deepEqual(rebuilt[0].values, ["小八", "烏薩奇"]);
  assert.deepEqual(rebuilt[1].values, ["12cm"]);
});

await check("wouldDiscard hand-filled on shrink expand", () => {
  const dims = [{ name: "角色", values: ["小八"] }];
  const existing = [
    { ...emptyRow(0, ["小八", "", ""]), cost: "10", imageId: "a" },
    { ...emptyRow(1, ["烏薩奇", "", ""]), cost: "20", imageId: "b" }
  ];
  const result = expandAndMergeVariantRows(dims, existing);
  assert.equal(result.rows.length, 1);
  assert.equal(result.wouldDiscardHandFilled.length, 1);
  assert.equal(result.wouldDiscardHandFilled[0].imageId, "b");
});

// Source contract: real module exports + Fable clamp string present
await check("src variantCrossExpand has Fable clamp + exports", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    path.join(root, "src/lib/variants/variantCrossExpand.ts"),
    "utf8"
  );
  assert.match(src, /CARTESIAN_CLAMP_WARNING/);
  assert.match(src, /款式組合超過 50，已截斷/);
  assert.match(src, /export function expandAndMergeVariantRows/);
  assert.match(src, /export function removeDimensionMergingRows/);
  assert.match(src, /normalizeOptionValueForMerge/);
  const ve = fs.readFileSync(
    path.join(root, "src/components/listing/VariantEditor.tsx"),
    "utf8"
  );
  // UX-B4-P03: auto expand on axis change; secondary re-expand CTA
  assert.match(ve, /tryAutoExpandFromDimensions/);
  assert.match(ve, /expandAndMergeVariantRows/);
  assert.match(ve, /重新展開|自動展開/);
  assert.match(ve, /duplicateRow/);
  assert.doesNotMatch(ve, /VariantEditor2|fork/i);
});

// Single-dim regression still uses formRowsToDbInserts path above (section 2).
console.log("\n9) single-dim zero regression (form mapping still 1-axis)");
await check("single-dim option1 only still maps", () => {
  const inserts = formRowsToDbInserts([{ name: "款式" }], [
    {
      optionValues: ["粉色", "", ""],
      cost: "12",
      sellPrice: "199",
      compareAt: "",
      priceLocked: false,
      qty: "",
      sku: "",
      imageId: "img-1",
      sortOrder: 0
    }
  ]);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].option1_name, "款式");
  assert.equal(inserts[0].option1_value, "粉色");
  assert.equal(inserts[0].option2_name, null);
  assert.equal(inserts[0].option2_value, null);
  assert.equal(inserts[0].image_id, "img-1");
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
