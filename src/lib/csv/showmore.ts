import type { ProductDraft, ProductImage } from "@/types/domain";

export interface ShowmoreDraft extends ProductDraft {
  product_images?: ProductImage[];
}

// Nestory doesn't track these at all -- Showmore's new-product template
// requires them, so exported rows need a human to confirm/adjust after
// download rather than leaving a required column blank.
const DEFAULT_STOCK = 999;
const DEFAULT_WEIGHT_KG = 0.1;

function escapeCsv(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function buildShowmoreRows(drafts: ShowmoreDraft[]) {
  return drafts.map((draft) => {
    const images = (draft.product_images ?? []).sort((a, b) => a.sort_order - b.sort_order);
    const mainImage = images.find((image) => image.image_type === "main") ?? images[0];
    const mainImageUrl = mainImage?.processed_file_url || mainImage?.original_file_url || "";
    const otherImageUrls = images
      .filter((image) => image !== mainImage)
      .map((image) => image.processed_file_url || image.original_file_url || "")
      .filter(Boolean);

    return {
      "商品名稱*": draft.title_zh || draft.taobao_title || draft.original_title || "",
      "商品簡述": "",
      "商品介紹": draft.description_html || draft.description_plain || "",
      "配送限定": "",
      "商品編號(sku)": draft.sku || "",
      "第一層樣式名稱": "款式",
      "第一層樣式*": "單一款式",
      "第二層樣式名稱": "",
      "第二層樣式": "",
      "第三層樣式名稱": "",
      "第三層樣式": "",
      "原價": draft.compare_at_price ?? "",
      "售價*": draft.twd_price ?? "",
      "成本": draft.twd_cost ?? "",
      "官網庫存*": DEFAULT_STOCK,
      "重量(kg)*": DEFAULT_WEIGHT_KG,
      "VIP價格": "",
      "主要圖片*": mainImageUrl,
      "廣告圖": mainImageUrl,
      "商品圖片": otherImageUrls.join(" "),
      "商品樣式圖片": ""
    };
  });
}

export function buildShowmoreCsv(drafts: ShowmoreDraft[]) {
  const rows = buildShowmoreRows(drafts);
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header as keyof typeof row])).join(","));
  }
  return `﻿${lines.join("\n")}`;
}
