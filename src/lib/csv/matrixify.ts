import { categoryLabel } from "@/lib/categories";
import { formatPlainTextAsHtml } from "@/lib/contentGenerator/htmlFormat";
import type { ProductDraft, ProductImage } from "@/types/domain";

export interface MatrixifyDraft extends ProductDraft {
  product_images?: ProductImage[];
}

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

export function buildMatrixifyRows(drafts: MatrixifyDraft[]) {
  const rows: Record<string, unknown>[] = [];

  for (const draft of drafts) {
    const handle = handleFor(draft);
    const tags = draft.shopify_tags?.length ? draft.shopify_tags : draft.tags;
    const images = (draft.product_images ?? [])
      .filter((image) => image.image_type !== "spec")
      .sort((a, b) => a.sort_order - b.sort_order);
    const firstImage = images[0];

    rows.push({
      Command: "NEW",
      Handle: handle,
      Title: draft.title_zh || draft.taobao_title || "",
      // A25 / D8-open: convert plain description at CSV boundary (same as Shopify payload).
      "Body HTML": formatPlainTextAsHtml(
        draft.description_html || draft.description_plain || ""
      ),
      // A24 (2026-07-10 A14 finding): same fallback fix as payload.ts.
      Vendor: draft.vendor || "潮巢 Nestory",
      Type: draft.product_type || categoryLabel(draft.category),
      Tags: tags?.join(", ") ?? "",
      Published: draft.publish_mode === "active" ? "TRUE" : "FALSE",
      Status: draft.publish_mode === "active" ? "active" : "draft",
      "SEO Title": draft.seo_title || "",
      "SEO Description": draft.seo_description || "",
      "Option1 Name": "Title",
      "Option1 Value": "Default Title",
      "Variant SKU": `NST-${draft.id.slice(0, 8).toUpperCase()}`,
      "Variant Price": draft.twd_price || "",
      "Variant Cost": draft.twd_cost || "",
      "Variant Inventory Tracker": "shopify",
      "Variant Inventory Qty": 0,
      "Variant Inventory Policy": "deny",
      "Variant Requires Shipping": "TRUE",
      "Variant Image": firstImage?.processed_file_url || firstImage?.original_file_url || "",
      "Image Src": firstImage?.processed_file_url || firstImage?.original_file_url || "",
      "Image Position": firstImage ? 1 : "",
      "Image Alt Text": firstImage?.alt_text || draft.title_zh || ""
    });

    images.slice(1).forEach((image, index) => {
      rows.push({
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
        "Option1 Name": "Title",
        "Option1 Value": "",
        "Variant SKU": "",
        "Variant Price": "",
        "Variant Cost": "",
        "Variant Inventory Tracker": "",
        "Variant Inventory Qty": "",
        "Variant Inventory Policy": "",
        "Variant Requires Shipping": "",
        "Variant Image": "",
        "Image Src": image.processed_file_url || image.original_file_url || "",
        "Image Position": index + 2,
        "Image Alt Text": image.alt_text || draft.title_zh || ""
      });
    });
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

