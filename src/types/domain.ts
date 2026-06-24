export type UserRole = "admin" | "operator" | "reviewer";

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

export interface ProductDraft {
  id: string;
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
  title_zh: string | null;
  description_html: string | null;
  description_plain: string | null;
  seo_title: string | null;
  seo_description: string | null;
  tags: string[];
  collection_suggestion: string | null;
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
  publish_mode: PublishMode;
  publish_method: PublishMethod;
  publish_status: PublishStatus;
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  error_message: string | null;
  created_by: string | null;
  reviewed_by: string | null;
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
