/**
 * CAP-1: request/response shapes for POST /api/import/product-page.
 * Chrome extension (CAP-2) and curl fixtures must match this contract.
 */

export type CaptureVariantFlat = {
  option1_name?: string | null;
  option1_value?: string | null;
  option2_name?: string | null;
  option2_value?: string | null;
  option3_name?: string | null;
  option3_value?: string | null;
  cny_price?: number | null;
  sku?: string | null;
};

export type CaptureMeta = {
  adapter?: string;
  page_host?: string;
  /** ≥2 triggers multi-dim flatten warning (spec §9). */
  sku_dimensions?: number;
  warnings_from_client?: string[];
};

/** Incoming body from extension / curl. Missing fields = not captured (do not invent). */
export type CaptureImportBody = {
  source_url?: string;
  source_platform?: string | null;
  title?: string | null;
  price_cny?: number | null;
  /** 劃線原價 CNY → note line only (not compare_at_price). */
  list_price_cny?: number | null;
  sku_table?: unknown;
  variants_flat?: CaptureVariantFlat[];
  main_image_urls?: string[];
  detail_image_urls?: string[];
  video_urls?: string[] | string;
  params?: Record<string, string | number | null | undefined>;
  /** Prefer when client already formatted; else built from params. */
  spec_text?: string | null;
  captured_at?: string | null;
  capture_meta?: CaptureMeta;
  /** Optional full raw dump merged into raw_capture.payload. */
  raw?: unknown;
};

export type CaptureFilledSummary = {
  title: boolean;
  price_cny: boolean;
  list_price_cny: boolean;
  spec_text: boolean;
  product_brand: boolean;
  variants: number;
  videos: number;
  main_images: number;
  detail_images: number;
};

export type CaptureImportCreated = {
  ok: true;
  status: "created";
  draft_id: string;
  open_path: string;
  filled: CaptureFilledSummary;
  warnings: string[];
  images: { ok: number; failed: number };
};

export type CaptureImportExists = {
  ok: true;
  status: "exists";
  draft_id: string;
  open_path: string;
  message: string;
};

export type CaptureImportError = {
  ok: false;
  error: string;
  message?: string;
};

export type CaptureImportResponse =
  | CaptureImportCreated
  | CaptureImportExists
  | CaptureImportError;

export const PRICE_PLACEHOLDER_CNY = 0.01;

export const WARNING_MISSING_PRICE =
  "未抓到售價，已用占位值，請在表單填實際成本";

export const WARNING_MULTIDIM_SKU =
  "多維規格已壓平為單維／列舉款式，展開待包二；完整表見 raw_capture.sku_table";

/** Per-field size cap for raw_capture.payload (Fable CAP-1). */
export const RAW_CAPTURE_FIELD_MAX_BYTES = 256 * 1024;

export const MAX_MAIN_IMAGES = 12;
export const MAX_DETAIL_IMAGES = 20;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_FETCH_TIMEOUT_MS = 10_000;
