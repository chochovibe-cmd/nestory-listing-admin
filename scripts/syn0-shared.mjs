/**
 * SYN-0 shared helpers — detail-image samples only.
 * Never log secrets; OPENAI_API_KEY / env values must stay in process.env only.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");
export const OUT_DIR = join(ROOT, "docs", "合成詳情圖打樣");
export const TMP_DIR = join(OUT_DIR, ".tmp");

/** Boss-approved sample products (SYN-0). */
export const PRODUCTS = {
  miffy_lamp: {
    id: "8b3a35b9-2a9b-4b14-84d3-5c7e84f9b8f8",
    slug: "米菲臺燈",
    fileStem: "米菲臺燈"
  },
  razer_mouse: {
    id: "29b827a7-f2e3-47dc-8ade-7a03e0fd473c",
    slug: "Razer皮卡丘滑鼠",
    fileStem: "Razer皮卡丘滑鼠"
  }
};

/** Fixed purchase disclaimer (draft has no ◈ block). Note only in compare table. */
export const FIXED_BUY_NOTICE =
  "本商品為正版授權選品，實際規格以包裝標示為準。潮巢代購商品到貨後經檢視再寄出；如有瑕疵請於收貨後三天內聯繫客服。";

export const WATERMARK = "SYN-0 打樣 · 非正式上架";

export function loadEnvLocal() {
  const p = join(ROOT, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

export function ensureDirs() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, "templates"), { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });
}

export function getSupabase() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

export function getOpenAiKey() {
  loadEnvLocal();
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) throw new Error("OPENAI_API_KEY is not configured");
  return key;
}

/** Parse spec_text into rows; keep raw values (no rewrite). */
export function parseSpecRows(specText) {
  const lines = String(specText || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return lines.map((line) => {
    const idx = line.search(/[：:]/);
    if (idx > 0) {
      return { key: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() };
    }
    return { key: "", value: line };
  });
}

/** Extract numbers/units for B comparison checklist. */
export function extractSpecNumbers(specText, highlights = []) {
  const blobs = [specText, ...(highlights || [])].filter(Boolean).join("\n");
  const items = [];
  const re =
    /(\d+(?:\.\d+)?)\s*(cm|mm|m|g|kg|克|公斤|公分|厘米|mAh|mah|DPI|dpi|K|k|年|天|m\b|ghz|GHz|Hz)?/gi;
  let m;
  while ((m = re.exec(blobs))) {
    const num = m[1];
    const unit = (m[2] || "").trim();
    const raw = m[0].trim();
    if (!items.some((x) => x.raw === raw)) {
      items.push({ raw, num, unit });
    }
  }
  return items;
}

export async function loadProductBundle(productKey) {
  const meta = PRODUCTS[productKey];
  if (!meta) throw new Error(`Unknown product key: ${productKey}`);
  const sb = getSupabase();
  const { data: draft, error } = await sb
    .from("product_drafts")
    .select(
      "id,title_zh,product_brand,product_type,ip_name,character_name,product_highlights,spec_text,why_we_chose_it,image_description,status"
    )
    .eq("id", meta.id)
    .maybeSingle();
  if (error) throw new Error(`draft fetch: ${error.message}`);
  if (!draft) throw new Error(`draft not found: ${meta.id}`);

  const { data: images, error: ie } = await sb
    .from("product_images")
    .select(
      "id,image_type,sort_order,processed_file_url,original_file_url,generated_file_url"
    )
    .eq("draft_id", meta.id)
    .order("sort_order", { ascending: true });
  if (ie) throw new Error(`images fetch: ${ie.message}`);

  const mains = (images || []).filter((x) => x.image_type === "main");
  const main =
    mains.find((x) => x.processed_file_url) ||
    mains.find((x) => x.original_file_url) ||
    (images || []).find((x) => x.processed_file_url || x.original_file_url);
  const mainUrl =
    main?.processed_file_url || main?.original_file_url || main?.generated_file_url || null;

  const highlights = Array.isArray(draft.product_highlights)
    ? draft.product_highlights
    : [];

  return {
    key: productKey,
    meta,
    draft,
    mainUrl,
    highlights,
    specRows: parseSpecRows(draft.spec_text),
    specNumbers: extractSpecNumbers(draft.spec_text, highlights),
    images: images || []
  };
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function fileSha256(filePath) {
  const buf = readFileSync(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

export function writeJson(path, obj) {
  writeFileSync(path, JSON.stringify(obj, null, 2), "utf8");
}

export function estimateImageCostUsd(quality = "medium") {
  // Mirrors openai-image-provider rough estimate (not billing).
  if (quality === "high") return 0.2;
  if (quality === "low") return 0.02;
  return 0.07;
}

export async function fetchImageBuffer(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: { Accept: "image/*,*/*" }
  });
  if (!res.ok) throw new Error(`fetch image HTTP ${res.status}`);
  const ct = res.headers.get("content-type") || "image/png";
  const mimeType = ct.split(";")[0].trim() || "image/png";
  const ab = await res.arrayBuffer();
  if (!ab.byteLength) throw new Error("empty image body");
  return { buffer: Buffer.from(ab), mimeType };
}
