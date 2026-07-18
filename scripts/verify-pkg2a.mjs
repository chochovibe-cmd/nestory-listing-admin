/**
 * PKG2A verify: multi-dim pipeline (Matrixify expand, Showmore, Shopify plan,
 * feedback 84 localize idempotent, CAP-1 multi-dim info + price map).
 * No network / no secrets.
 *
 * Run: node scripts/verify-pkg2a.mjs  |  pnpm run verify:pkg2a
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

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

// ── Inline mirrors (keep in sync with src) ──────────────────────────────

function matrixifyInventoryFields(inv) {
  const isDeny = inv.inventory_policy === "deny";
  const qtyRaw = inv.inventory_quantity;
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

function hasFilledVariant(v) {
  return Boolean(
    (v.option1_value ?? "").trim() ||
      (v.option2_value ?? "").trim() ||
      (v.option3_value ?? "").trim()
  );
}

/** Mirror of buildMatrixifyRows multi-variant branch structure (no HTML deps). */
function buildMatrixifyRowSkeleton(draft) {
  const handle = draft.shopify_handle || "fallback-handle";
  const images = (draft.product_images ?? [])
    .filter((i) => i.image_type !== "spec")
    .sort((a, b) => a.sort_order - b.sort_order);
  const variants = (draft.product_variants ?? [])
    .filter(hasFilledVariant)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const rows = [];

  if (variants.length === 0) {
    rows.push({
      kind: "variant",
      Handle: handle,
      Title: draft.title_zh || "",
      "Option1 Name": "Title",
      "Option1 Value": "Default Title",
      "Option2 Name": "",
      "Option2 Value": "",
      ...matrixifyInventoryFields(draft),
      "Image Src": images[0]?.url || "",
      "Image Position": images[0] ? 1 : "",
    });
    images.slice(1).forEach((img, i) => {
      rows.push({
        kind: "image",
        Handle: handle,
        Title: "",
        "Option1 Name": "",
        "Option1 Value": "",
        "Image Src": img.url,
        "Image Position": i + 2,
      });
    });
    return rows;
  }

  const first = variants[0];
  const opt1Name = (first.option1_name ?? "").trim() || "款式";
  const opt2Name = (first.option2_name ?? "").trim();
  const opt3Name = (first.option3_name ?? "").trim();

  variants.forEach((variant, index) => {
    const inventory = matrixifyInventoryFields({
      inventory_policy: variant.inventory_policy ?? draft.inventory_policy,
      inventory_quantity:
        variant.inventory_quantity != null
          ? variant.inventory_quantity
          : draft.inventory_quantity,
    });
    if (index === 0) {
      rows.push({
        kind: "variant",
        Handle: handle,
        Title: draft.title_zh || "",
        "Option1 Name": opt1Name,
        "Option1 Value": (variant.option1_value ?? "").trim(),
        "Option2 Name": opt2Name,
        "Option2 Value": (variant.option2_value ?? "").trim(),
        "Option3 Name": opt3Name,
        "Option3 Value": (variant.option3_value ?? "").trim(),
        "Variant SKU": variant.sku || "",
        "Variant Price": variant.twd_price ?? draft.twd_price,
        ...inventory,
        "Image Src": images[0]?.url || "",
        "Image Position": images[0] ? 1 : "",
      });
    } else {
      rows.push({
        kind: "variant",
        Handle: handle,
        Title: "",
        "Option1 Name": "",
        "Option1 Value": (variant.option1_value ?? "").trim(),
        "Option2 Name": "",
        "Option2 Value": (variant.option2_value ?? "").trim(),
        "Option3 Name": "",
        "Option3 Value": (variant.option3_value ?? "").trim(),
        "Variant SKU": variant.sku || "",
        "Variant Price": variant.twd_price ?? draft.twd_price,
        ...inventory,
        "Image Src": "",
        "Image Position": "",
      });
    }
  });

  images.slice(1).forEach((img, i) => {
    rows.push({
      kind: "image",
      Handle: handle,
      Title: "",
      "Option1 Name": "",
      "Option1 Value": "",
      "Image Src": img.url,
      "Image Position": i + 2,
    });
  });
  return rows;
}

function resolveDimNames(rows) {
  const found = [null, null, null];
  let maxAxis = 0;
  for (const row of rows) {
    const n1 = row.option1_name?.trim();
    const n2 = row.option2_name?.trim();
    const n3 = row.option3_name?.trim();
    if (n1 && !found[0]) found[0] = n1;
    if (n2 && !found[1]) found[1] = n2;
    if (n3 && !found[2]) found[2] = n3;
    if (row.option1_value?.trim() || n1) maxAxis = Math.max(maxAxis, 1);
    if (row.option2_value?.trim() || n2) maxAxis = Math.max(maxAxis, 2);
    if (row.option3_value?.trim() || n3) maxAxis = Math.max(maxAxis, 3);
  }
  const defaults = ["款式", "選項2", "選項3"];
  if (maxAxis === 0) return ["款式"];
  const names = [];
  for (let i = 0; i < maxAxis; i++) names.push(found[i] || defaults[i]);
  return names;
}

function formatMultiDimStoredInfo(axisCount, rowCount) {
  return `多維已入庫（${Math.max(0, Math.floor(axisCount))} 軸 × ${Math.max(0, Math.floor(rowCount))} 款）`;
}

function lookupSkuTablePrice(skuTable, combo) {
  if (!skuTable || typeof skuTable !== "object" || Array.isArray(skuTable)) return null;
  const rows = Array.isArray(skuTable.rows) ? skuTable.rows : null;
  if (!rows?.length) return null;
  const axes = Array.isArray(skuTable.axes)
    ? skuTable.axes.map((a) => String(a || "").trim()).filter(Boolean)
    : [];
  const wanted = [];
  if (combo.option1_name && combo.option1_value) {
    wanted.push([combo.option1_name, combo.option1_value]);
  } else if (axes[0] && combo.option1_value) {
    wanted.push([axes[0], combo.option1_value]);
  }
  if (combo.option2_name && combo.option2_value) {
    wanted.push([combo.option2_name, combo.option2_value]);
  } else if (axes[1] && combo.option2_value) {
    wanted.push([axes[1], combo.option2_value]);
  }
  if (!wanted.length) return null;
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    let match = true;
    for (const [axis, val] of wanted) {
      if (row[axis] == null || String(row[axis]).trim() !== val) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const priceRaw = row.price != null ? row.price : row.cny_price;
    const n = Number(priceRaw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

// ── Showmore multi-row mirror (structure only) ──────────────────────────

function buildShowmoreRowSkeleton(draft) {
  const variants = (draft.product_variants ?? [])
    .filter(hasFilledVariant)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  if (!variants.length) {
    return [{ "商品名稱*": draft.title_zh || "", "第一層樣式*": "單一款式" }];
  }
  return variants.map((v, index) => ({
    "商品名稱*": index === 0 ? draft.title_zh || "" : "",
    "第一層樣式名稱": index === 0 ? (v.option1_name || "款式") : (v.option1_name || "款式"),
    "第一層樣式*": (v.option1_value || "").trim(),
    "第二層樣式": (v.option2_value || "").trim(),
    "商品編號(sku)": v.sku || "",
  }));
}

// ── Tests ───────────────────────────────────────────────────────────────

console.log("PKG2A multi-dim pipeline verification\n");

const fixture = JSON.parse(read("scripts/fixtures/pkg2a-razer-16.json"));
assert.equal(fixture.product_variants.length, 16, "fixture must be 16 styles");

check("files: matrixify / showmore / shopifyVariants / localizer / CAP", () => {
  assert.ok(exists("src/lib/csv/matrixify.ts"));
  assert.ok(exists("src/lib/csv/showmore.ts"));
  assert.ok(exists("src/lib/variants/shopifyVariants.ts"));
  assert.ok(exists("src/lib/zhTwLocalizer.ts"));
  assert.ok(exists("src/lib/import/mapCaptureFields.ts"));
  assert.ok(exists("scripts/fixtures/pkg2a-razer-16.json"));
});

check("wiring: matrixify multi-variant + product_variants on export route", () => {
  const mx = read("src/lib/csv/matrixify.ts");
  assert.match(mx, /product_variants/);
  assert.match(mx, /matrixifyInventoryFields/);
  assert.match(mx, /Option2 Name/);
  assert.match(mx, /appendExtraImageRows|images\.slice\(1\)/);
  // subsequent rows blank option names
  assert.match(mx, /Option1 Value/);
  const route = read("src/app/api/exports/matrixify/route.ts");
  assert.match(route, /product_variants/);
  assert.match(route, /from\("product_variants"\)/);
});

check("wiring: showmore multi-variant expand (55)", () => {
  const sm = read("src/lib/csv/showmore.ts");
  assert.match(sm, /product_variants/);
  assert.match(sm, /index === 0/);
  assert.match(sm, /第二層樣式/);
});

check("wiring: shopify resolveDimNames + generate 84 path", () => {
  const sv = read("src/lib/variants/shopifyVariants.ts");
  assert.match(sv, /export function resolveDimNames/);
  assert.match(sv, /選項2|選項3/);
  const gen = read("src/app/api/generate/route.ts");
  assert.match(gen, /localizeProductVariantOptionFields/);
  assert.match(gen, /localizeVariantDimensions/);
  assert.match(gen, /回饋 84|PKG2A/);
  assert.ok(gen.indexOf("localizeProductVariantOptionFields") > 0);
  assert.match(gen, /全文 generate 成功路徑|款式簡轉繁/);
});

check("wiring: CAP multi-dim info formula", () => {
  const cap = read("src/lib/import/captureTypes.ts");
  assert.match(cap, /formatMultiDimStoredInfo/);
  assert.match(cap, /多維已入庫/);
  const map = read("src/lib/import/mapCaptureFields.ts");
  assert.match(map, /formatMultiDimStoredInfo/);
  assert.match(map, /lookupSkuTablePrice/);
  assert.match(map, /WARNING_MULTIDIM_NO_FLAT/);
  assert.doesNotMatch(map, /warnings\.push\(WARNING_MULTIDIM_SKU\)/);
});

check("single-SKU Matrixify: Title/Default Title + image after", () => {
  const rows = buildMatrixifyRowSkeleton({
    title_zh: "單款商品",
    shopify_handle: "single-sku-handle-xxxxxx",
    inventory_policy: "continue",
    inventory_quantity: null,
    product_variants: [],
    product_images: [
      { image_type: "main", sort_order: 0, url: "https://cdn.example/1.webp" },
      { image_type: "detail", sort_order: 1, url: "https://cdn.example/2.webp" },
    ],
  });
  assert.equal(rows[0]["Option1 Name"], "Title");
  assert.equal(rows[0]["Option1 Value"], "Default Title");
  assert.equal(rows[0].Title, "單款商品");
  assert.equal(rows[1].kind, "image");
  assert.equal(rows[1]["Image Position"], 2);
  assert.equal(rows[0]["Variant Inventory Policy"], "continue");
  assert.equal(rows[0]["Variant Inventory Qty"], 0);
});

check("multi 16 Matrixify: variant rows then image rows; shared handle; blank names", () => {
  const draft = {
    title_zh: fixture.title,
    shopify_handle: fixture.shopify_handle,
    twd_price: fixture.twd_price,
    inventory_policy: fixture.inventory_policy,
    inventory_quantity: fixture.inventory_quantity,
    product_variants: fixture.product_variants,
    product_images: [
      { image_type: "main", sort_order: 0, url: "https://cdn.example/m.webp" },
      { image_type: "detail", sort_order: 1, url: "https://cdn.example/d.webp" },
    ],
  };
  const rows = buildMatrixifyRowSkeleton(draft);
  const variantRows = rows.filter((r) => r.kind === "variant");
  const imageRows = rows.filter((r) => r.kind === "image");
  assert.equal(variantRows.length, 16);
  assert.equal(imageRows.length, 1);
  // Order: all variants before any image-only row
  const firstImageIdx = rows.findIndex((r) => r.kind === "image");
  const lastVariantIdx = rows.map((r) => r.kind).lastIndexOf("variant");
  assert.ok(firstImageIdx > lastVariantIdx, "image rows must follow all variant rows");
  // P0-73: same handle on every row
  for (const r of rows) {
    assert.equal(r.Handle, fixture.shopify_handle);
  }
  // First variant: option names filled; subsequent blank names + required values
  assert.equal(variantRows[0]["Option1 Name"], "顏色");
  assert.equal(variantRows[0]["Option2 Name"], "尺寸");
  assert.equal(variantRows[0].Title, fixture.title);
  assert.equal(variantRows[1]["Option1 Name"], "");
  assert.equal(variantRows[1]["Option2 Name"], "");
  assert.ok(variantRows[1]["Option1 Value"]);
  assert.ok(variantRows[1]["Option2 Value"]);
  assert.equal(variantRows[1].Title, "");
  // P0-74 per-variant inventory
  assert.equal(variantRows[0]["Variant Inventory Policy"], "deny");
  assert.equal(variantRows[0]["Variant Inventory Qty"], 3);
  assert.equal(variantRows[2]["Variant Inventory Policy"], "continue");
  assert.equal(variantRows[2]["Variant Inventory Qty"], 0);
});

check("Showmore 16: first title filled, rest blank", () => {
  const rows = buildShowmoreRowSkeleton({
    title_zh: fixture.title,
    product_variants: fixture.product_variants,
  });
  assert.equal(rows.length, 16);
  assert.equal(rows[0]["商品名稱*"], fixture.title);
  assert.equal(rows[1]["商品名稱*"], "");
  assert.equal(rows[15]["商品名稱*"], "");
  assert.ok(rows[0]["第一層樣式*"]);
  assert.ok(rows[5]["第二層樣式"]);
});

check("Shopify plan: 2 axes from 16; first-row missing name still 2 axes", () => {
  const names = resolveDimNames(fixture.product_variants);
  assert.deepEqual(names, ["顏色", "尺寸"]);
  // first row missing option2_name but values present elsewhere / on same row via value
  const broken = [
    {
      option1_name: null,
      option1_value: "粉",
      option2_name: null,
      option2_value: "S",
      option3_name: null,
      option3_value: null,
    },
    {
      option1_name: "顏色",
      option1_value: "藍",
      option2_name: "尺寸",
      option2_value: "M",
      option3_name: null,
      option3_value: null,
    },
  ];
  assert.deepEqual(resolveDimNames(broken), ["顏色", "尺寸"]);
  // only values, no names → fallback 款式/選項2
  const valOnly = [
    {
      option1_name: null,
      option1_value: "A",
      option2_name: null,
      option2_value: "1",
      option3_name: null,
      option3_value: null,
    },
  ];
  assert.deepEqual(resolveDimNames(valOnly), ["款式", "選項2"]);
});

check("CAP info formula: 2 軸 × 16 款 (actual rows, not cartesian invent)", () => {
  assert.equal(formatMultiDimStoredInfo(2, 16), "多維已入庫（2 軸 × 16 款）");
  assert.equal(formatMultiDimStoredInfo(2, 3), "多維已入庫（2 軸 × 3 款）");
  // not theoretical 4×4 when only 3 stored
  assert.notEqual(formatMultiDimStoredInfo(2, 3), "多維已入庫（2 軸 × 16 款）");
});

check("sku_table price map: match cell; missing stays null", () => {
  const ok = lookupSkuTablePrice(fixture.sku_table, {
    option1_name: "顏色",
    option1_value: "粉",
    option2_name: "尺寸",
    option2_value: "S",
  });
  assert.equal(ok, 89);
  const missing = lookupSkuTablePrice(fixture.sku_table, {
    option1_name: "顏色",
    option1_value: "缺格測試",
    option2_name: "尺寸",
    option2_value: "S",
  });
  assert.equal(missing, null);
});

check("package.json verify:pkg2a script", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.ok(pkg.scripts["verify:pkg2a"]);
});

await checkAsync("84: 鼠标→滑鼠 idempotent double-run", async () => {
  const mod = await import(pathToFileURL(path.join(root, "src/lib/zhTwLocalizer.ts")).href);
  const once = mod.localizeToTaiwanTraditionalText("皮卡丘鼠标SE");
  const twice = mod.localizeToTaiwanTraditionalText(once);
  assert.equal(once, "皮卡丘滑鼠SE");
  assert.equal(twice, once);
  const row = {
    option1_name: "颜色",
    option1_value: "皮卡丘鼠标SE",
    option2_name: null,
    option2_value: null,
    option3_name: null,
    option3_value: null,
  };
  const a = mod.localizeProductVariantOptionFields(row);
  const b = mod.localizeProductVariantOptionFields(a);
  assert.equal(a.option1_name, "顏色");
  assert.equal(a.option1_value, "皮卡丘滑鼠SE");
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const dims = mod.localizeVariantDimensions([{ name: "颜色" }, { name: "尺寸" }]);
  assert.equal(dims[0].name, "顏色");
  const dims2 = mod.localizeVariantDimensions(dims);
  assert.equal(JSON.stringify(dims), JSON.stringify(dims2));
});

if (failures.length) {
  console.error(`\nverify-pkg2a FAILED: ${failures.length} check(s)`);
  process.exit(1);
}
console.log("\nverify-pkg2a ALL passed");
