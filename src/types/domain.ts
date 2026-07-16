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

/**
 * R1: three-station pipeline stage (migration 029).
 * Dual-written with status; R2+ may retire status gradually.
 */
export type PipelineStage =
  | "input"
  | "copy_review"
  | "image_review"
  | "ready"
  | "published"
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

/**
 * B5/R2: how the Phase D pipeline should process this product image.
 * null = unmarked (legacy; R2 station① approve writes keep for pipeline images).
 * to_trad = 簡轉繁 — requires migration 030; do not write until SQL applied.
 */
export type ImageProcessIntent = "keep" | "de_text" | "regenerate" | "to_trad";

/** B14: image_batches.status — queued until Phase D pipeline runs. */
export type ImageBatchStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partial_failed"
  | "failed"
  | "stuck";

/** B14: image_batch_items.item_status */
export type ImageBatchItemStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

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
  /**
   * R1: three-station stage (migration 029). Optional until SQL applied;
   * dual-written with status. Prefer this for R2+ queue filters.
   */
  pipeline_stage?: PipelineStage | null;
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
  /** 夜工包（回饋 27）：聯名品牌；migration 031（未跑時為 undefined，程式視同 null）。 */
  product_brand?: string | null;
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
  /** D10: YouTube URL strings (max 3). migration 005; empty = []. */
  video_urls: string[];
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
  /**
   * B8/B19: cached web search payload for this draft (migration 023).
   * Reused on regenerate when queryFingerprint still matches.
   */
  web_search_cache?: unknown;
  /**
   * B12: snapshot of status before soft-archive (migration 024).
   * Restored on 解除封存; null when not archived / after restore.
   */
  status_before_archive?: DraftStatus | null;
  /** B12: when soft-archived (migration 024). */
  archived_at?: string | null;
  /**
   * B14: latest image send batch (migration 025).
   * Re-send updates pointer only; history stays in image_batch_items (3A simplified).
   */
  current_image_batch_id?: string | null;
  /**
   * D7: latest publish batch (migration 027).
   * Retry-failed (Q3 A-lite) updates pointer only; history stays in publish_batch_items.
   */
  current_publish_batch_id?: string | null;
}

/** D7: publish_batches.status — always terminal after runPublishBatch (Q2-A). */
export type PublishBatchStatus =
  | "queued"
  | "processing"
  | "completed"
  | "partial_failed"
  | "failed";

/** D7: publish_batch_items.item_status */
export type PublishBatchItemStatus =
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "skipped";

/** D7: one Shopify publish batch header (publish_batches). */
export interface PublishBatch {
  id: string;
  kind: "shopify_api";
  status: PublishBatchStatus;
  publish_mode: PublishMode;
  total_count: number;
  done_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  /** Event #2 publish_batch_done: claimed when ≥1 notify channel sent (Q3b). */
  notify_sent_at: string | null;
  error_summary: string | null;
  snapshot_json: unknown;
}

/** D7: draft membership in a publish batch. */
export interface PublishBatchItem {
  id: string;
  batch_id: string;
  draft_id: string;
  item_status: PublishBatchItemStatus;
  error_message: string | null;
  shopify_product_id: string | null;
  shopify_admin_url: string | null;
  created_at: string;
  completed_at: string | null;
}

/** B14: one 送圖 batch header (image_batches). */
export interface ImageBatch {
  id: string;
  kind: "image_process";
  status: ImageBatchStatus;
  total_count: number;
  done_count: number;
  failed_count: number;
  regenerate_item_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  notify_sent_at: string | null;
  stuck_notified_at: string | null;
  error_summary: string | null;
  /** Create-time process_intent summary; Phase D webhook must prefer this over live marks. */
  snapshot_json: unknown;
}

/** B14: draft membership in an image batch. */
export interface ImageBatchItem {
  id: string;
  batch_id: string;
  draft_id: string;
  item_status: ImageBatchItemStatus;
  error_message: string | null;
  created_at: string;
  completed_at: string | null;
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
