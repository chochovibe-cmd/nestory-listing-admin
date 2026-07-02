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

export interface ProductDraft {
  id: string;
  source_url: string | null;
  taobao_url: string | null;
  taobao_title: string | null;
  original_title: string | null;
  cny_price: number;
  twd_cost: number | null;
  twd_price: number | null;
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
  video_urls: unknown[];
  created_at: string;
  updated_at: string;
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
  created_at: string;
}
