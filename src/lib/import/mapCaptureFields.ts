/**
 * CAP-1: pure mapping from capture payload → product_drafts fields (§3).
 * Honesty: missing → empty/null/placeholder; never invent title/price/brand.
 */
import { normalizeDetectedProductBrand } from "@/lib/providers/productBrand";
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import { normalizeVideoUrls } from "@/lib/media/videoUrls";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import {
  parseAndFilterSpecText,
  type SpecRow
} from "@/lib/images/detailCompose/filterSpecs";
import type {
  CaptureFilledSummary,
  CaptureImportBody,
  CaptureVariantFlat
} from "@/lib/import/captureTypes";
import {
  formatMultiDimStoredInfo,
  PRICE_PLACEHOLDER_CNY,
  RAW_CAPTURE_FIELD_MAX_BYTES,
  WARNING_MISSING_PRICE,
  WARNING_MULTIDIM_NO_FLAT
} from "@/lib/import/captureTypes";
import { keepOrInheritVariantCny } from "@/lib/import/captureVariantPrice";
import { isFakeVariantRow } from "@/lib/shopify/publishReadiness";
import { parsePriceRange } from "@/lib/shopify/publishReadiness";
import { cleanVariantRows } from "@/lib/variants/variantNameRules";
import {
  WARNING_HIDDEN_VARIANT_PRICES,
  WARNING_INTERACT_NEEDS_CONFIRMATION,
  captureHidesVariantPrices,
  interactRequiresConfirmation
} from "@/lib/import/captureHiddenPrices";

const BRAND_PARAM_KEYS = [
  "品牌",
  "brand",
  "Brand",
  "BRAND",
  "Trademark",
  "商标",
  "商標",
  "牌子"
];

export type MappedCaptureDraft = {
  draftRow: Record<string, unknown>;
  /**
   * Variant rows ready for product_variants insert.
   * May include temporary `image_url` (stripped before DB insert after map→image_id).
   */
  variantRows: Array<Record<string, unknown>>;
  variantDimensions: Array<{ name: string }>;
  rawCapture: Record<string, unknown>;
  warnings: string[];
  filled: CaptureFilledSummary;
  mainImageUrls: string[];
  detailImageUrls: string[];
  /** CAP-2.6 / 88: unique SKU thumb URLs from variants_flat.image_url */
  variantImageUrls: string[];
  /** True when cny_price used placeholder. */
  usedPricePlaceholder: boolean;
  /** VARIANT-CLEAN: non-product options kept out of product_variants (restorable from the 規格 tab). */
  excludedVariants: ExcludedCaptureVariant[];
};

/** A 款式 the import refused to create (購買須知／勿拍／補差價…). `row` is the full would-be variant row. */
export type ExcludedCaptureVariant = {
  label: string;
  reason: "non_product_option";
  row: Record<string, unknown>;
};

function asTrimmedString(value: unknown): string | null {
  if (value == null) return null;
  const s = String(value).trim();
  return s.length ? s : null;
}

function asPositiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const s = asTrimmedString(item);
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** SKU selector axes dumped as params — not product spec (材質／產地／貨號). */
const SKU_AXIS_PARAM_KEY_RE =
  /顏色分類|颜色分类|颜色分類|顏色分类|鞋碼|鞋码|尺碼|尺码|^口味$|口味分類|口味分类/;

function isSkuAxisParamKey(key: string): boolean {
  const k = key.replace(/\s+/g, "").trim();
  if (!k) return false;
  return SKU_AXIS_PARAM_KEY_RE.test(k);
}

/**
 * Taobao fulfillment talk. Not our sale status and not a product spec.
 * Simplified and traditional both match.
 */
const FULFILLMENT_SPEC_RE =
  /出售[状狀][态態]|[发發][货貨]|出[货貨]|到[货貨]|[预預]售|庫存|库存|物流|[运運]費|包[邮郵]/;

function isFulfillmentSpec(key: string, value: string): boolean {
  return FULFILLMENT_SPEC_RE.test(key) || FULFILLMENT_SPEC_RE.test(value);
}

/** Long slash/comma dumps look like SKU option lists, not a single spec value. */
function looksLikeSkuOptionList(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.length >= 80) return true;
  const parts = v.split(/[/／、,，;；|]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length >= 4;
}

function formatSpecRows(rows: SpecRow[]): string | null {
  const lines: string[] = [];
  for (const row of rows) {
    const k = (row.key || "").trim();
    const v = (row.value || "").trim();
    if (!k && !v) continue;
    lines.push(k ? `${k}：${v}` : v);
  }
  return lines.length ? lines.join("\n") : null;
}

/**
 * Drop seller-service / promo / fulfillment noise (P4／SYN-1) and SKU-axis params.
 * Simplified and traditional copies of the same line collapse to one traditional line.
 */
export function filterCaptureSpecText(specText: string | null | undefined): string | null {
  const filtered = parseAndFilterSpecText(specText);
  const kept: SpecRow[] = [];
  const seen = new Set<string>();
  for (const row of filtered) {
    const k = (row.key || "").trim();
    const v = (row.value || "").trim();
    if (isSkuAxisParamKey(k)) continue;
    if (isFulfillmentSpec(k, v)) continue;
    if (v && looksLikeSkuOptionList(v) && !/品牌|材質|材质|產地|产地|貨號|货号|款式|角色|配件|功能|功率|系列|填充|烤盤|烤盘|內容|内容|掛繩|挂绳|型號|型号|電壓|电压|重量|顏色|颜色/.test(k)) {
      continue;
    }
    const key = localizeToTaiwanTraditionalText(k);
    const value = localizeToTaiwanTraditionalText(v);
    const sig = `${key}\u0001${value}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    kept.push({ key, value });
  }
  return formatSpecRows(kept);
}

/** Build spec_text from params: filter promo/SKU-axis noise first, then join. */
export function formatParamsAsSpecText(
  params: Record<string, string | number | null | undefined> | null | undefined
): string | null {
  if (!params || typeof params !== "object") return null;
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(params)) {
    const k = key.trim();
    if (!k) continue;
    if (raw == null) continue;
    const v = String(raw).trim();
    if (!v) continue;
    lines.push(`${k}：${v}`);
  }
  return filterCaptureSpecText(lines.length ? lines.join("\n") : null);
}

/** Pull brand-like keys from params; run through 75a sanitizer. */
export function extractBrandFromParams(
  params: Record<string, string | number | null | undefined> | null | undefined
): string | null {
  if (!params || typeof params !== "object") return null;
  for (const key of BRAND_PARAM_KEYS) {
    if (!(key in params)) continue;
    const cleaned = normalizeDetectedProductBrand(String(params[key] ?? ""));
    if (cleaned) return cleaned;
  }
  // Case-insensitive fallback for keys containing 品牌/brand
  for (const [key, raw] of Object.entries(params)) {
    if (!/品牌|brand|trademark|商标|商標/i.test(key)) continue;
    const cleaned = normalizeDetectedProductBrand(String(raw ?? ""));
    if (cleaned) return cleaned;
  }
  return null;
}

export function detectMultiDimSku(body: CaptureImportBody): boolean {
  const dim = body.capture_meta?.sku_dimensions;
  if (typeof dim === "number" && dim >= 2) return true;

  const table = body.sku_table;
  if (table && typeof table === "object" && !Array.isArray(table)) {
    const rec = table as Record<string, unknown>;
    const axes = rec.axes ?? rec.dimensions ?? rec.dimension_names;
    if (Array.isArray(axes) && axes.length >= 2) return true;
  }

  // Heuristic: any flat row with option2 filled → multi-axis listing
  const flats = Array.isArray(body.variants_flat) ? body.variants_flat : [];
  if (flats.some((r) => asTrimmedString(r.option2_value))) return true;

  return false;
}

/** Count option axes present on flat rows (1–3). */
export function countAxesFromFlats(flats: CaptureVariantFlat[]): number {
  let max = 0;
  for (const v of flats) {
    let n = 0;
    if (asTrimmedString(v.option1_value) || asTrimmedString(v.option1_name)) n = 1;
    if (asTrimmedString(v.option2_value) || asTrimmedString(v.option2_name)) n = 2;
    if (asTrimmedString(v.option3_value) || asTrimmedString(v.option3_name)) n = 3;
    if (n > max) max = n;
  }
  return max;
}

/**
 * Look up per-cell price from raw_capture.sku_table for a flat combo.
 * Missing cell → null (never invent). Matches axis names on table.rows.
 */
export function lookupSkuTablePrice(
  skuTable: unknown,
  combo: {
    option1_name?: string | null;
    option1_value?: string | null;
    option2_name?: string | null;
    option2_value?: string | null;
    option3_name?: string | null;
    option3_value?: string | null;
  }
): number | null {
  if (!skuTable || typeof skuTable !== "object" || Array.isArray(skuTable)) return null;
  const rec = skuTable as Record<string, unknown>;
  const rows = Array.isArray(rec.rows) ? rec.rows : null;
  if (!rows?.length) return null;

  const axesRaw = rec.axes ?? rec.dimensions ?? rec.dimension_names;
  const axes = Array.isArray(axesRaw)
    ? axesRaw.map((a) => String(a || "").trim()).filter(Boolean)
    : [];

  const wanted: Array<[string, string]> = [];
  const n1 = asTrimmedString(combo.option1_name);
  const v1 = asTrimmedString(combo.option1_value);
  const n2 = asTrimmedString(combo.option2_name);
  const v2 = asTrimmedString(combo.option2_value);
  const n3 = asTrimmedString(combo.option3_name);
  const v3 = asTrimmedString(combo.option3_value);
  if (n1 && v1) wanted.push([n1, v1]);
  else if (axes[0] && v1) wanted.push([axes[0], v1]);
  if (n2 && v2) wanted.push([n2, v2]);
  else if (axes[1] && v2) wanted.push([axes[1], v2]);
  if (n3 && v3) wanted.push([n3, v3]);
  else if (axes[2] && v3) wanted.push([axes[2], v3]);
  if (!wanted.length) return null;

  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    let match = true;
    for (const [axis, val] of wanted) {
      const cell = row[axis];
      if (cell == null || String(cell).trim() !== val) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    const priceRaw = row.price != null ? row.price : row.cny_price;
    return asPositiveNumber(priceRaw);
  }
  return null;
}

/**
 * Strip/truncate oversized string fields (>256KB) for raw_capture.payload.
 * Returns cleaned value + server warnings.
 */
export function stripOversizedCaptureFields(
  value: unknown,
  path = "payload"
): { value: unknown; warnings: string[] } {
  const warnings: string[] = [];

  function walk(node: unknown, p: string): unknown {
    if (typeof node === "string") {
      const bytes = Buffer.byteLength(node, "utf8");
      if (bytes > RAW_CAPTURE_FIELD_MAX_BYTES) {
        warnings.push(
          `raw_capture 欄位過大已截斷：${p}（${bytes} bytes → ${RAW_CAPTURE_FIELD_MAX_BYTES}）`
        );
        // Truncate by UTF-8 bytes safely
        let end = RAW_CAPTURE_FIELD_MAX_BYTES;
        let slice = node;
        while (Buffer.byteLength(slice.slice(0, end), "utf8") > RAW_CAPTURE_FIELD_MAX_BYTES && end > 0) {
          end -= 1;
        }
        return `${slice.slice(0, end)}…[truncated]`;
      }
      return node;
    }
    if (Array.isArray(node)) {
      return node.map((item, i) => walk(item, `${p}[${i}]`));
    }
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
        out[k] = walk(v, p ? `${p}.${k}` : k);
      }
      return out;
    }
    return node;
  }

  return { value: walk(value, path), warnings };
}

/**
 * CAP-2.6 / 87: do not re-fill row cost from sku_table when it equals product price
 * (would undo client omit of uniform prices). Only apply table price when it
 * differs from product-level cost.
 */
export function mapVariantRows(
  flats: CaptureVariantFlat[],
  skuTable?: unknown,
  productPriceCny?: number | null
): {
  rows: Array<Record<string, unknown>>;
  dimensions: Array<{ name: string }>;
  variantImageUrls: string[];
  excluded: ExcludedCaptureVariant[];
} {
  const rows: Array<Record<string, unknown>> = [];
  const excluded: ExcludedCaptureVariant[] = [];
  const dimNames: string[] = [];
  const valuesByName = new Map<string, string[]>();
  const imageUrls: string[] = [];
  const seenImg = new Set<string>();
  const product =
    productPriceCny != null && Number.isFinite(productPriceCny) && productPriceCny > 0
      ? productPriceCny
      : null;

  function addDimValue(name: string | null, value: string | null) {
    if (!name || !value) return;
    if (!dimNames.includes(name)) dimNames.push(name);
    const list = valuesByName.get(name) ?? [];
    if (!list.includes(value)) list.push(value);
    valuesByName.set(name, list);
  }

  flats.forEach((v, index) => {
    const o1n = asTrimmedString(v.option1_name) ?? "款式";
    const o1v = asTrimmedString(v.option1_value);
    if (!o1v) return;

    const o2n = asTrimmedString(v.option2_name);
    const o2v = asTrimmedString(v.option2_value);
    const o3n = asTrimmedString(v.option3_name);
    const o3v = asTrimmedString(v.option3_value);

    // Prefer flat.cny_price; if missing, map from sku_table cell only when
    // cell price differs from product cost (CAP-2.6 / 87 D1+C1).
    let cny = asPositiveNumber(v.cny_price);
    const ownPriceSource = cny != null ? asTrimmedString(v.price_source) : null;
    if (cny == null && skuTable != null) {
      const fromTable = lookupSkuTablePrice(skuTable, {
        option1_name: o1n,
        option1_value: o1v,
        option2_name: o2n,
        option2_value: o2v,
        option3_name: o3n,
        option3_value: o3v
      });
      if (
        fromTable != null &&
        (product == null || Math.abs(fromTable - product) >= 0.001)
      ) {
        cny = fromTable;
      }
    }
    // C1: only an unsourced price equal to product collapses to null (follow
    // product cost); a SKU's own captured price stays explicit (r6).
    cny = keepOrInheritVariantCny(cny, product, ownPriceSource);

    const imageUrl = asTrimmedString(v.image_url);
    // Taobao's skuId is an internal purchasing id now; the Shopify SKU (NS-…) is assigned
    // after the draft exists (createCaptureDraft), so `sku` stays empty here.
    const row: Record<string, unknown> = {
      option1_name: o1n,
      option1_value: o1v,
      option2_name: o2n,
      option2_value: o2v,
      option3_name: o3n,
      option3_value: o3v,
      sku: null,
      source_sku_id: asTrimmedString(v.sku),
      cny_price: cny,
      // CAPTURE-TRUTH-A: a blank per-SKU cost means "follow product cost",
      // not "this SKU independently captured the same price".
      cost_is_inherited: cny == null && product != null,
      sort_order: index,
      inventory_quantity: 0,
      inventory_policy: "continue",
      // temporary; createCaptureDraft maps → image_id then strips
      ...(imageUrl ? { image_url: imageUrl } : {})
    };

    // Same predicate PUBLISH-GUARD uses, so import and publish can never disagree.
    // Applied before the image / axis bookkeeping: an excluded option leaves no trace.
    if (isFakeVariantRow(row)) {
      excluded.push({
        label: [o1v, o2v, o3v].filter(Boolean).join("／"),
        reason: "non_product_option",
        row
      });
      return;
    }

    if (imageUrl && !seenImg.has(imageUrl)) {
      seenImg.add(imageUrl);
      imageUrls.push(imageUrl);
    }
    rows.push(row);
  });

  // VARIANT-CLEAN rule layer (no AI at import). The imported text is kept in source_options.
  const cleaned = cleanVariantRows(rows);
  rows.forEach((row, i) => {
    row.source_options = {
      names: [row.option1_name, row.option2_name, row.option3_name].map((n) => n ?? null),
      values: [row.option1_value, row.option2_value, row.option3_value].map((n) => n ?? null)
    };
    row.option1_name = cleaned[i].names[0];
    row.option1_value = cleaned[i].values[0];
    row.option2_name = cleaned[i].names[1];
    row.option2_value = cleaned[i].values[1];
    row.option3_name = cleaned[i].names[2];
    row.option3_value = cleaned[i].values[2];
    addDimValue(cleaned[i].names[0], cleaned[i].values[0]);
    addDimValue(cleaned[i].names[1], cleaned[i].values[1]);
    addDimValue(cleaned[i].names[2], cleaned[i].values[2]);
  });

  const dimensions =
    dimNames.length > 0
      ? dimNames.slice(0, 3).map((name) => {
          const values = valuesByName.get(name) ?? [];
          return values.length > 0 ? { name, values } : { name };
        })
      : rows.length > 0
        ? [{ name: "款式" }]
        : [];

  return { rows, dimensions, variantImageUrls: imageUrls, excluded };
}

/**
 * Map capture body → draft insert fields + variants + raw_capture shell (without server image log).
 */
export function mapCaptureToDraftFields(
  body: CaptureImportBody,
  opts: { userId: string; receivedAt?: string }
): MappedCaptureDraft {
  const warnings: string[] = [];
  const title = asTrimmedString(body.title);
  const sourceUrl = asTrimmedString(body.source_url) ?? "";
  const price = asPositiveNumber(body.price_cny);
  const listPrice = asPositiveNumber(body.list_price_cny);
  const usedPricePlaceholder = price == null;
  const cnyPrice = price ?? PRICE_PLACEHOLDER_CNY;
  let priceConfidence = body.capture_meta?.price_confidence ?? null;
  let priceRequiresConfirmation =
    usedPricePlaceholder ||
    priceConfidence === "conflict" ||
    priceConfidence === "needs_confirmation";
  if (usedPricePlaceholder) {
    warnings.push(WARNING_MISSING_PRICE);
  }
  if (priceConfidence === "conflict") {
    warnings.push("價格來源互相衝突；請確認未優惠成本後再生成或上架");
  }

  // CAP-2.6 / 86: promo stays in capture_meta / client_meta; never note / never cost.
  const promoPrice = asPositiveNumber(body.capture_meta?.promo_price_cny);
  if (promoPrice != null && (price == null || Math.abs(promoPrice - price) >= 0.001)) {
    warnings.push(`頁面另有促銷價 CNY ${promoPrice}，未當作成本`);
  }

  const params = body.params && typeof body.params === "object" ? body.params : null;
  const explicitSpec = asTrimmedString(body.spec_text);
  const fromParams = formatParamsAsSpecText(params ?? undefined);
  const specText = filterCaptureSpecText(explicitSpec) ?? fromParams;

  // Brand from raw params (before spec filter) so 品牌 is not lost if a row is dropped.
  const productBrand = extractBrandFromParams(params ?? undefined);

  const multiDim = detectMultiDimSku(body);

  const clientWarnings = body.capture_meta?.warnings_from_client;
  if (Array.isArray(clientWarnings)) {
    for (const w of clientWarnings) {
      const s = asTrimmedString(w);
      if (s) warnings.push(s);
    }
  }

  const flats = Array.isArray(body.variants_flat) ? body.variants_flat : [];
  const {
    rows: variantRows,
    dimensions: variantDimensions,
    variantImageUrls,
    excluded: excludedVariants
  } = mapVariantRows(flats, body.sku_table, price);

  if (excludedVariants.length > 0) {
    warnings.push(
      `已排除 ${excludedVariants.length} 個非商品款式：${excludedVariants.map((e) => `「${e.label}」`).join("")}（可在規格頁籤恢復）`
    );
  }

  // PRICE-GUARD: Taobao may hide every per-variant price (hideOtherPrice / no sku2info price).
  // The extension warns, but the server must also demand a per-variant cost check, otherwise
  // all variants silently publish at the cheapest price. Multi-variant only.
  const ownPricedFlats = flats.filter(
    (v) => asPositiveNumber(v.cny_price) != null && !/^dom./.test(asTrimmedString(v.price_source) ?? "")
  ).length;
  const domOnlyPricedFlats = flats.filter(
    (v) => asPositiveNumber(v.cny_price) != null && /^dom./.test(asTrimmedString(v.price_source) ?? "")
  ).length;
  const hiddenVariantPrices = captureHidesVariantPrices({
    clientMeta: body.capture_meta,
    variantCount: variantRows.length,
    // table-sourced prices count as priced; the DOM "selected SKU" price covers one variant only
    pricedVariantCount: Math.max(
      ownPricedFlats,
      variantRows.filter((row) => row.cny_price != null).length - domOnlyPricedFlats
    ),
    unpricedVariantCount: variantRows.filter((row) => row.cny_price == null).length
  });
  const serverPriceWarnings: string[] = [];
  if (hiddenVariantPrices) {
    priceRequiresConfirmation = true;
    if (priceConfidence !== "conflict") priceConfidence = "needs_confirmation";
    warnings.push(WARNING_HIDDEN_VARIANT_PRICES);
    serverPriceWarnings.push(WARNING_HIDDEN_VARIANT_PRICES);
  }

  // CAPTURE-INTERACT: a partial/aborted/tentative interaction never clears PRICE-GUARD.
  if (variantRows.length >= 2 && interactRequiresConfirmation(body.capture_meta)) {
    priceRequiresConfirmation = true;
    if (priceConfidence !== "conflict") priceConfidence = "needs_confirmation";
    warnings.push(WARNING_INTERACT_NEEDS_CONFIRMATION);
    serverPriceWarnings.push(WARNING_INTERACT_NEEDS_CONFIRMATION);
  }

  // Match the complete independently priced variant range to the page's original range.
  const debugPaths = body.capture_meta?.price_debug?.price_paths ?? [];
  const pageRange = debugPaths
    .map((item) => typeof item?.value === "string" ? parsePriceRange(item.value) : null)
    .find((range) => range != null);
  if (body.capture_meta?.interact && variantRows.length >= 2 && pageRange &&
      variantRows.every((row) => asPositiveNumber(row.cny_price) != null)) {
    const values = variantRows.map((row) => asPositiveNumber(row.cny_price) as number);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const outside = (a: number, b: number) =>
      Math.abs(a - b) > Math.max(0.5, Math.max(Math.abs(a), Math.abs(b)) * 0.015);
    if (outside(min, pageRange.low) || outside(max, pageRange.high)) {
      priceRequiresConfirmation = true;
      if (priceConfidence !== "conflict") priceConfidence = "needs_confirmation";
      const rangeWarning = `外掛讀到的款式價格 ¥${min}–${max} 和頁面價格區間 ¥${pageRange.low}–${pageRange.high} 對不上，請逐款確認`;
      warnings.push(rangeWarning);
      serverPriceWarnings.push(rangeWarning);
    }
  }

  // PKG2A: multi-dim with flat rows already stored → info (axis count × actual rows).
  // No flat → honest warning; never invent cartesian.
  if (multiDim) {
    if (variantRows.length > 0) {
      const axisCount = Math.max(
        countAxesFromFlats(flats),
        variantDimensions.length,
        typeof body.capture_meta?.sku_dimensions === "number"
          ? body.capture_meta.sku_dimensions
          : 0
      );
      warnings.push(formatMultiDimStoredInfo(axisCount, variantRows.length));
    } else {
      warnings.push(WARNING_MULTIDIM_NO_FLAT);
    }
  }

  const videos = normalizeVideoUrls(body.video_urls ?? []);
  const mainImageUrls = stringList(body.main_image_urls);
  const detailImageUrls = stringList(body.detail_image_urls);

  const platform = asTrimmedString(body.source_platform);

  const receivedAt = opts.receivedAt ?? new Date().toISOString();

  // Build payload for strip (body + raw)
  const payloadSource = {
    ...(body as Record<string, unknown>),
    ...(body.raw && typeof body.raw === "object" && !Array.isArray(body.raw)
      ? { raw_nested: body.raw }
      : body.raw != null
        ? { raw_nested: body.raw }
        : {})
  };
  const stripped = stripOversizedCaptureFields(payloadSource, "payload");
  warnings.push(...stripped.warnings);

  const rawCapture: Record<string, unknown> = {
    version: 1,
    captured_at: asTrimmedString(body.captured_at),
    received_at: receivedAt,
    source_url: sourceUrl || null,
    payload: stripped.value,
    sku_table: body.sku_table ?? null,
    params: params ?? null,
    client_meta: body.capture_meta ?? null,
    server: {
      warnings: [...stripped.warnings, ...serverPriceWarnings],
      /** PKG2A: true when multi-dim was detected (info or no-flat warning). */
      sku_multi_dim: multiDim,
      /** @deprecated alias kept for older readers */
      sku_flat_warning: multiDim,
      /** VARIANT-CLEAN: options the import excluded; the 規格 tab lists them with 恢復. */
      excluded_variants: excludedVariants,
      /** CAPTURE-TRUTH-A: downstream/UI may block auto-pricing until operator confirms. */
      price_requires_confirmation: priceRequiresConfirmation,
      price_confidence: priceConfidence,
      /** Which backend build handled this capture (Production vs Preview audits). */
      backend_sha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      backend_env: process.env.VERCEL_ENV || null,
      image_fetch: [] as unknown[]
    }
  };

  const draftRow: Record<string, unknown> = {
    source_type: "capture",
    source_url: sourceUrl || null,
    taobao_url: sourceUrl || null,
    taobao_title: title,
    original_title: title,
    cny_price: cnyPrice,
    note: null,
    spec_text: specText,
    product_brand: productBrand,
    video_urls: videos,
    source_platform: platform,
    variant_dimensions: variantDimensions,
    warnings,
    status: "pending_input",
    pipeline_stage: mapStatusToPipelineStage("pending_input"),
    created_by: opts.userId,
    inventory_quantity: null,
    inventory_policy: "continue",
    sale_status: "海外代購（約14天）",
    generation_status: "pending",
    raw_capture: rawCapture
  };

  const filled: CaptureFilledSummary = {
    title: Boolean(title),
    price_cny: !usedPricePlaceholder,
    list_price_cny: listPrice != null,
    spec_text: Boolean(specText),
    product_brand: Boolean(productBrand),
    variants: variantRows.length,
    videos: videos.length,
    main_images: mainImageUrls.length,
    detail_images: detailImageUrls.length
  };

  return {
    draftRow,
    variantRows,
    variantDimensions,
    rawCapture,
    warnings,
    filled,
    mainImageUrls,
    detailImageUrls,
    variantImageUrls,
    usedPricePlaceholder,
    excludedVariants
  };
}
