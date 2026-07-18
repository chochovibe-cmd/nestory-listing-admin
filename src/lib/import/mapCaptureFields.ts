/**
 * CAP-1: pure mapping from capture payload → product_drafts fields (§3).
 * Honesty: missing → empty/null/placeholder; never invent title/price/brand.
 */
import { normalizeDetectedProductBrand } from "@/lib/providers/productBrand";
import { normalizeVideoUrls } from "@/lib/media/videoUrls";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import type {
  CaptureFilledSummary,
  CaptureImportBody,
  CaptureVariantFlat
} from "@/lib/import/captureTypes";
import {
  PRICE_PLACEHOLDER_CNY,
  RAW_CAPTURE_FIELD_MAX_BYTES,
  WARNING_MISSING_PRICE,
  WARNING_MULTIDIM_SKU
} from "@/lib/import/captureTypes";

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
  variantRows: Array<Record<string, unknown>>;
  variantDimensions: Array<{ name: string }>;
  rawCapture: Record<string, unknown>;
  warnings: string[];
  filled: CaptureFilledSummary;
  mainImageUrls: string[];
  detailImageUrls: string[];
  /** True when cny_price used placeholder. */
  usedPricePlaceholder: boolean;
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

/** Build spec_text from params object (key：value lines). */
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
  return lines.length ? lines.join("\n") : null;
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

function mapVariantRows(flats: CaptureVariantFlat[]): {
  rows: Array<Record<string, unknown>>;
  dimensions: Array<{ name: string }>;
} {
  const rows: Array<Record<string, unknown>> = [];
  const dimNames: string[] = [];

  flats.forEach((v, index) => {
    const o1n = asTrimmedString(v.option1_name) ?? "款式";
    const o1v = asTrimmedString(v.option1_value);
    if (!o1v) return;

    const o2n = asTrimmedString(v.option2_name);
    const o2v = asTrimmedString(v.option2_value);
    const o3n = asTrimmedString(v.option3_name);
    const o3v = asTrimmedString(v.option3_value);

    for (const name of [o1n, o2n, o3n]) {
      if (name && !dimNames.includes(name)) dimNames.push(name);
    }

    const cny = asPositiveNumber(v.cny_price);
    rows.push({
      option1_name: o1n,
      option1_value: o1v,
      option2_name: o2n,
      option2_value: o2v,
      option3_name: o3n,
      option3_value: o3v,
      sku: asTrimmedString(v.sku),
      cny_price: cny,
      sort_order: index,
      inventory_quantity: 0,
      inventory_policy: "continue"
    });
  });

  const dimensions =
    dimNames.length > 0
      ? dimNames.slice(0, 3).map((name) => ({ name }))
      : rows.length > 0
        ? [{ name: "款式" }]
        : [];

  return { rows, dimensions };
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
  if (usedPricePlaceholder) {
    warnings.push(WARNING_MISSING_PRICE);
  }

  const noteParts: string[] = [];
  if (listPrice != null) {
    noteParts.push(`來源劃線原價：CNY ${listPrice}`);
  }

  const params = body.params && typeof body.params === "object" ? body.params : null;
  const explicitSpec = asTrimmedString(body.spec_text);
  const fromParams = formatParamsAsSpecText(params ?? undefined);
  const specText = explicitSpec ?? fromParams;

  const productBrand = extractBrandFromParams(params ?? undefined);

  const multiDim = detectMultiDimSku(body);
  if (multiDim) {
    warnings.push(WARNING_MULTIDIM_SKU);
  }

  const clientWarnings = body.capture_meta?.warnings_from_client;
  if (Array.isArray(clientWarnings)) {
    for (const w of clientWarnings) {
      const s = asTrimmedString(w);
      if (s) warnings.push(s);
    }
  }

  const flats = Array.isArray(body.variants_flat) ? body.variants_flat : [];
  const { rows: variantRows, dimensions: variantDimensions } = mapVariantRows(flats);

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
      warnings: stripped.warnings.slice(),
      sku_flat_warning: multiDim,
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
    note: noteParts.length ? noteParts.join("\n") : null,
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
    sale_status: "台灣現貨",
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
    usedPricePlaceholder
  };
}
