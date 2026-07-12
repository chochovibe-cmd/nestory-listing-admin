import type { SaleStatusOption } from "@/lib/saleStatus";

export type UserRole = "admin" | "operator" | "reviewer";
export type SaleStatus = SaleStatusOption;

export type DraftStatus =
  | "pending_input"
  | "pending_copy"
  | "processing"
  | "ready_for_review"
  | "needs_revision"
  | "approved"
  | "publishing"
  | "active_published"
  | "draft_created"
  | "api_failed"
  | "csv_ready"
  | "failed"
  | "archived";

export type GenerationMode = "codex_skill" | "api_llm" | "manual";
export type GenerationProvider = "codex" | "openai" | "anthropic" | "other";
export type GenerationStatus = "pending" | "processing" | "completed" | "failed";
export type PublishMode = "active" | "draft";
export type PublishMethod = "shopify_api" | "matrixify_csv" | "manual";
export type PublishStatus =
  | "pending"
  | "publishing"
  | "active_published"
  | "draft_created"
  | "api_failed"
  | "csv_ready"
  | "failed";

export type ImageType = "main" | "detail" | "spec" | "generated_detail" | "variant";

export type ImageStatus = "pending" | "processing" | "done" | "failed" | "skipped";

/** B5: how the Phase D pipeline should process this product image. null = unmarked. */
export type ImageProcessIntent = "keep" | "de_text" | "regenerate";

/** B6: sale = 售價＋定價劃線；single = 單一售價（不填 compare_at）。 */
export type PriceMode = "sale" | "single";

export interface ProductDraft {
  id: string;
  source_url: string | null;
  taobao_url: string | null;
  taobao_title: string | null;
  original_title: string | null;
  cny_price: number;
  twd_cost: number | null;
  twd_price: number | null;
  /** B6: 特價／單一售價；migration 020。未跑 migration 時可能缺欄。 */
  price_mode?: PriceMode | null;
  pricing_formula: Record<string, unknown>;
  category: string | null;
  vendor: string;
  product_type: string | null;
  shopify_handle: string | null;
  title_zh: string | null;
  description_html: string | null;
  description_plain: string | null;
  seo_title: string | null;
  seo_description: string | null;
  tags: string[];
  shopify_tags: string[];
  collection_suggestion: string | null;
  shopify_collections: string[];
  metafields_json: unknown;
  note: string | null;
  spec_text: string | null;
  warnings: string[];
  status: DraftStatus;
  generation_mode: GenerationMode;
  generation_provider: GenerationProvider;
  generation_status: GenerationStatus;
  generation_rule_version: string | null;
  generation_model: string | null;
  generation_cost_estimate: number | null;
  generation_input_tokens: number | null;
  generation_output_tokens: number | null;
  generation_error: string | null;
  generated_payload_json: unknown;
  shopify_payload_preview: unknown;
  worker_id: string | null;
  worker_locked_at: string | null;
  worker_lock_expires_at: string | null;
  worker_attempts: number;
  max_worker_attempts: number;
  next_retry_at: string | null;
  publish_mode: PublishMode;
  publish_method: PublishMethod;
  publish_status: PublishStatus;
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  error_message: string | null;
  created_by: string | null;
  reviewed_by: string | null;
  sale_status: SaleStatus;
  inventory_quantity: number | null;
  inventory_policy: "deny" | "continue";
  image_description: string | null;
  image_flags: Record<string, string>;
  image_status: ImageStatus;
  is_secondhand: boolean;
  secondhand_grade: string | null;
  secondhand_condition: string | null;
  secondhand_notes: string | null;
  ip_name: string | null;
  character_name: string | null;
  why_we_chose_it: string | null;
  product_highlights: string[];
  generated_faq_html: string | null;
  compare_at_price: number | null;
  detected_category: string | null;
  sku: string | null;
  source_platform: string | null;
  video_urls: unknown[];
  copy_generated_at: string | null;
  reviewed_at: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  /**
   * B7: option axis defs on the draft, e.g. [{ name: "角色" }, { name: "尺寸" }].
   * Max 3. Empty = single-SKU / no multi-variant form state. migration 022.
   */
  variant_dimensions?: VariantDimensionDef[] | null;
}

/** B7: one product option axis (Shopify productOptions name). */
export interface VariantDimensionDef {
  name: string;
}

/**
 * B7: product_variants row (DB shape).
 * cny_price = cost in source currency (redefined B7; pre-B7 form never wrote it).
 * twd_price = NT$ sell price.
 */
export interface ProductVariantRow {
  id: string;
  draft_id: string;
  option1_name: string | null;
  option1_value: string | null;
  option2_name: string | null;
  option2_value: string | null;
  option3_name: string | null;
  option3_value: string | null;
  sku: string | null;
  /** Cost in source currency (B7). */
  cny_price: number | null;
  /** NT$ sell price. */
  twd_price: number | null;
  compare_at_price: number | null;
  price_locked: boolean;
  sort_order: number;
  inventory_quantity: number;
  inventory_policy: "deny" | "continue";
  image_id: string | null;
  created_at: string;
}

export interface ProductImage {
  id: string;
  draft_id: string;
  image_type: ImageType;
  original_file_url: string | null;
  processed_file_url: string | null;
  generated_file_url: string | null;
  alt_text: string | null;
  sort_order: number;
  ocr_text: string | null;
  translated_text: string | null;
  processing_status: string;
  processing_error: string | null;
  /** B5: null until operator picks keep / de_text / regenerate. */
  process_intent: ImageProcessIntent | null;
  /**
   * B5「規格圖」mark: image-pipeline only (去簡體字). Not OCR source —
   * see docs/Mockup差異備忘.md 差異2. May still be a main product photo.
   */
  is_spec_process: boolean;
  created_at: string;
}
