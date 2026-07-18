import { categoryLabel } from "@/lib/categories";
import { appendDescriptionEmbedIfEnabled } from "@/lib/contentGenerator/descriptionEmbed";
import { formatPlainTextAsHtml } from "@/lib/contentGenerator/htmlFormat";
import { collapseSkuHyphens } from "@/lib/contentGenerator/sku";
import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";

export interface MatrixifyDraft extends ProductDraft {
  product_images?: ProductImage[];
  /**
   * PKG2A / 回饋 55：多款式時由 export route 掛上。
   * 缺省或空 → 單 SKU 舊路徑（Title / Default Title）。
   */
  product_variants?: Array<
    Pick<
      ProductVariantRow,
      | "option1_name"
      | "option1_value"
      | "option2_name"
      | "option2_value"
      | "option3_name"
      | "option3_value"
      | "sku"
      | "twd_price"
      | "compare_at_price"
      | "cny_price"
      | "inventory_quantity"
      | "inventory_policy"
      | "sort_order"
    >
  >;
}

type MatrixifyRow = Record<string, unknown>;

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

function handleFor(draft: MatrixifyDraft) {
  if (draft.shopify_handle) return draft.shopify_handle;
  const source = draft.title_zh || draft.taobao_title || draft.original_title || draft.id;
  return source
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * P0-74: map migration 018 inventory semantics onto Matrixify variant columns.
 * - unlimited (continue / default): Policy continue + Tracker shopify + Qty 0
 * - finite (deny): Policy deny + actual Qty
 *
 * PKG2A: accepts **row-level** inventory (draft or product_variants).
 * Semantics unchanged from single-SKU path.
 */
export function matrixifyInventoryFields(
  inv: Pick<
    { inventory_policy?: string | null; inventory_quantity?: number | null },
    "inventory_policy" | "inventory_quantity"
  >
): {
  "Variant Inventory Tracker": string;
  "Variant Inventory Qty": number;
  "Variant Inventory Policy": "deny" | "continue";
} {
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

function hasFilledVariant(
  v: NonNullable<MatrixifyDraft["product_variants"]>[number]
): boolean {
  return Boolean(
    (v.option1_value ?? "").trim() ||
      (v.option2_value ?? "").trim() ||
      (v.option3_value ?? "").trim()
  );
}

function imageUrl(image: ProductImage | undefined): string {
  if (!image) return "";
  return image.processed_file_url || image.original_file_url || "";
}

function emptyTrailingRow(handle: string): MatrixifyRow {
  return {
    Command: "",
    Handle: handle,
    Title: "",
    "Body HTML": "",
    Vendor: "",
    Type: "",
    Tags: "",
    Published: "",
    Status: "",
    "SEO Title": "",
    "SEO Description": "",
    "Option1 Name": "",
    "Option1 Value": "",
    "Option2 Name": "",
    "Option2 Value": "",
    "Option3 Name": "",
    "Option3 Value": "",
    "Variant SKU": "",
    "Variant Price": "",
    "Variant Cost": "",
    "Variant Inventory Tracker": "",
    "Variant Inventory Qty": "",
    "Variant Inventory Policy": "",
    "Variant Requires Shipping": "",
    "Variant Image": "",
    "Image Src": "",
    "Image Position": "",
    "Image Alt Text": ""
  };
}

/**
 * PKG2A row order within one Handle (Matrixify Products docs):
 * 1) All variant rows first (first carries product-level fields + Image Position 1)
 * 2) Extra image-only rows after all variants
 *
 * Rationale: Matrixify treats a row as a variant when any Variant- or Option-
 * prefixed cell is filled; interleaving Image Src-only rows between variants
 * confuses option identity. Official Products template groups option/variant
 * rows, then additional images. Fable PKG2A: 款式列全部在前、圖片列在後.
 */
function appendExtraImageRows(
  rows: MatrixifyRow[],
  handle: string,
  images: ProductImage[],
  titleFallback: string,
  /** 1-based position of first extra image (usually 2). */
  startPosition: number
) {
  images.forEach((image, index) => {
    const row = emptyTrailingRow(handle);
    row["Image Src"] = imageUrl(image);
    row["Image Position"] = startPosition + index;
    row["Image Alt Text"] = image.alt_text || titleFallback || "";
    rows.push(row);
  });
}

export function buildMatrixifyRows(drafts: MatrixifyDraft[]) {
  const rows: MatrixifyRow[] = [];

  for (const draft of drafts) {
    const handle = handleFor(draft);
    const tags = draft.shopify_tags?.length ? draft.shopify_tags : draft.tags;
    const images = (draft.product_images ?? [])
      .filter((image) => image.image_type !== "spec")
      .sort((a, b) => a.sort_order - b.sort_order);
    const firstImage = images[0];
    const titleText = draft.title_zh || draft.taobao_title || "";
    // A25 / D8-open: plain→HTML at CSV boundary; D8a-open Q5-A: same embed as payload.
    // (Keep formatPlainTextAsHtml adjacent to "Body HTML" key for verify-d8 static check.)
    const bodyHtmlCell = {
      "Body HTML": appendDescriptionEmbedIfEnabled(
        formatPlainTextAsHtml(
          draft.description_html || draft.description_plain || ""
        ),
        draft.product_images,
        draft.title_zh || draft.taobao_title
      )
    };

    const variants = (draft.product_variants ?? [])
      .filter(hasFilledVariant)
      .slice()
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

    // ── Single-SKU (no filled variants): legacy Title / Default Title ──
    if (variants.length === 0) {
      const inventory = matrixifyInventoryFields(draft);
      rows.push({
        Command: "NEW",
        Handle: handle,
        Title: titleText,
        ...bodyHtmlCell,
        Vendor: draft.vendor || "潮巢 Nestory",
        Type: draft.product_type || categoryLabel(draft.category),
        Tags: tags?.join(", ") ?? "",
        Published: draft.publish_mode === "active" ? "TRUE" : "FALSE",
        Status: draft.publish_mode === "active" ? "active" : "draft",
        "SEO Title": draft.seo_title || "",
        "SEO Description": draft.seo_description || "",
        "Option1 Name": "Title",
        "Option1 Value": "Default Title",
        "Option2 Name": "",
        "Option2 Value": "",
        "Option3 Name": "",
        "Option3 Value": "",
        "Variant SKU": `NST-${draft.id.slice(0, 8).toUpperCase()}`,
        "Variant Price": draft.twd_price || "",
        "Variant Cost": draft.twd_cost || "",
        ...inventory,
        "Variant Requires Shipping": "TRUE",
        "Variant Image": imageUrl(firstImage),
        "Image Src": imageUrl(firstImage),
        "Image Position": firstImage ? 1 : "",
        "Image Alt Text": firstImage?.alt_text || titleText
      });

      appendExtraImageRows(rows, handle, images.slice(1), titleText, 2);
      continue;
    }

    // ── Multi-variant (回饋 55 / PKG2A) ──
    // Axis names from first filled row; subsequent rows leave Option* Name blank.
    const first = variants[0];
    const opt1Name = (first.option1_name ?? "").trim() || "款式";
    const opt2Name = (first.option2_name ?? "").trim();
    const opt3Name = (first.option3_name ?? "").trim();

    variants.forEach((variant, index) => {
      const opt1Value = (variant.option1_value ?? "").trim();
      const opt2Value = (variant.option2_value ?? "").trim();
      const opt3Value = (variant.option3_value ?? "").trim();
      const variantSku =
        collapseSkuHyphens(variant.sku) ||
        collapseSkuHyphens(
          draft.sku ? `${draft.sku}-${index + 1}` : `NST-${draft.id.slice(0, 8).toUpperCase()}-${index + 1}`
        );
      const price = variant.twd_price ?? draft.twd_price ?? "";
      const cost = draft.twd_cost ?? "";
      const inventory = matrixifyInventoryFields({
        inventory_policy: variant.inventory_policy ?? draft.inventory_policy,
        inventory_quantity:
          variant.inventory_quantity != null
            ? variant.inventory_quantity
            : draft.inventory_quantity
      });

      if (index === 0) {
        rows.push({
          Command: "NEW",
          Handle: handle,
          Title: titleText,
          ...bodyHtmlCell,
          Vendor: draft.vendor || "潮巢 Nestory",
          Type: draft.product_type || categoryLabel(draft.category),
          Tags: tags?.join(", ") ?? "",
          Published: draft.publish_mode === "active" ? "TRUE" : "FALSE",
          Status: draft.publish_mode === "active" ? "active" : "draft",
          "SEO Title": draft.seo_title || "",
          "SEO Description": draft.seo_description || "",
          "Option1 Name": opt1Name,
          "Option1 Value": opt1Value,
          "Option2 Name": opt2Name,
          "Option2 Value": opt2Value,
          "Option3 Name": opt3Name,
          "Option3 Value": opt3Value,
          "Variant SKU": variantSku,
          "Variant Price": price,
          "Variant Cost": cost,
          ...inventory,
          "Variant Requires Shipping": "TRUE",
          "Variant Image": imageUrl(firstImage),
          "Image Src": imageUrl(firstImage),
          "Image Position": firstImage ? 1 : "",
          "Image Alt Text": firstImage?.alt_text || titleText
        });
      } else {
        // Subsequent variant rows: product-level blank; Option Name blank; Value required.
        // P0-73: same Handle (suffix intact). No re-emit of Title/Body/SEO.
        const row = emptyTrailingRow(handle);
        row["Option1 Value"] = opt1Value;
        row["Option2 Value"] = opt2Value;
        row["Option3 Value"] = opt3Value;
        row["Variant SKU"] = variantSku;
        row["Variant Price"] = price;
        row["Variant Cost"] = cost;
        Object.assign(row, inventory);
        row["Variant Requires Shipping"] = "TRUE";
        rows.push(row);
      }
    });

    // Extra images AFTER all variant rows (stable Handle structure for Matrixify).
    appendExtraImageRows(rows, handle, images.slice(1), titleText, 2);
  }

  return rows;
}

export function buildMatrixifyCsv(drafts: MatrixifyDraft[]) {
  const rows = buildMatrixifyRows(drafts);
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(","));
  }
  return `\uFEFF${lines.join("\n")}`;
}
