/**
 * CAP-2.5: map a pending_input product_draft (+ variants/images) → workbench form seed.
 * Pure helpers — page / WorkspaceInputPanel / verify scripts.
 */

import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { dbRowsToForm } from "@/lib/variants/variantMapping";
import type { VariantDimension, VariantFormRow } from "@/lib/variants/types";
import type { ProductDraft, ProductImage } from "@/types/domain";

/** Minimal image seed for ImageUploader (回饋 16). */
export type WorkspaceSeedImage = {
  id: string;
  image_type: string;
  original_file_url: string | null;
  processed_file_url: string | null;
  sort_order: number | null;
  process_intent?: string | null;
  is_spec_process?: boolean | null;
};

export type WorkspaceFormSeed = {
  draftId: string;
  title: string;
  source: string;
  price: string;
  costCurrency: "CNY" | "TWD";
  taobaoUrl: string;
  note: string;
  specText: string;
  videoUrlsText: string;
  saleStatus: string;
  isSecondhand: boolean;
  secondhandGrade: string;
  secondhandCondition: string;
  secondhandNotes: string;
  inventoryUnlimited: boolean;
  inventoryQuantity: string;
  inventoryOpen: boolean;
  priceMode: "sale" | "single";
  variantDimensions: VariantDimension[];
  variants: VariantFormRow[];
  seedImages: WorkspaceSeedImage[];
};

export type DraftVariantDbRow = {
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  option1_name?: string | null;
  option2_name?: string | null;
  option3_name?: string | null;
  cny_price?: number | null;
  twd_price?: number | null;
  compare_at_price?: number | null;
  price_locked?: boolean | null;
  sort_order?: number | null;
  inventory_quantity?: number | null;
  inventory_policy?: string | null;
  sku?: string | null;
  image_id?: string | null;
};

/** SOURCE_OPTIONS-aligned labels used by WorkspaceInputPanel. */
const SOURCE_LABELS = ["淘寶", "閑魚", "蝦皮"] as const;

/**
 * Capture stores source_platform as taobao/tmall/shopee; form uses Chinese labels.
 * Unknown → 淘寶 (capture-first default).
 */
export function mapSourcePlatformToForm(
  platform: string | null | undefined
): (typeof SOURCE_LABELS)[number] {
  const raw = String(platform ?? "").trim();
  if (!raw) return "淘寶";
  if ((SOURCE_LABELS as readonly string[]).includes(raw)) {
    return raw as (typeof SOURCE_LABELS)[number];
  }
  const s = raw.toLowerCase();
  if (s.includes("shopee") || s.includes("蝦皮")) return "蝦皮";
  if (s.includes("xianyu") || s.includes("闲鱼") || s.includes("閑魚") || s.includes("goofish")) {
    return "閑魚";
  }
  if (s.includes("taobao") || s.includes("tmall") || s.includes("淘寶") || s.includes("天貓") || s.includes("天猫")) {
    return "淘寶";
  }
  return "淘寶";
}

export function videoUrlsToTextarea(videoUrls: unknown): string {
  if (!Array.isArray(videoUrls)) {
    if (typeof videoUrls === "string" && videoUrls.trim()) return videoUrls.trim();
    return "";
  }
  return videoUrls
    .map((u) => String(u ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * CAP-2.5 seed images for ImageUploader + CAP-2.6 variant thumbs for VariantEditor.
 * F1: variant images are included so imageId binding can resolve thumbs;
 * they are not forced into the main/detail uploader UX beyond type label.
 */
export function imagesToSeedRows(images: ProductImage[] | null | undefined): WorkspaceSeedImage[] {
  if (!images?.length) return [];
  return images
    .filter(
      (img) =>
        img.image_type === "main" ||
        img.image_type === "detail" ||
        img.image_type === "variant"
    )
    .slice()
    .sort((a, b) => {
      const rank = (t: string) =>
        t === "main" ? 0 : t === "detail" ? 1 : t === "variant" ? 2 : 3;
      const dr = rank(a.image_type) - rank(b.image_type);
      if (dr !== 0) return dr;
      return (a.sort_order ?? 0) - (b.sort_order ?? 0);
    })
    .map((img) => ({
      id: img.id,
      image_type: img.image_type,
      original_file_url: img.original_file_url ?? null,
      processed_file_url: img.processed_file_url ?? null,
      sort_order: img.sort_order ?? 0,
      process_intent: img.process_intent ?? null,
      is_spec_process: img.is_spec_process ?? null
    }));
}

/**
 * CAP-2.5 gate: only status === "pending_input" may load into the form.
 * Returns redirect target for all other statuses (A1).
 */
export function resolveNonPendingInputRedirect(status: string | null | undefined): {
  href: string;
  message: string;
} {
  const s = status ?? "";
  const stage = mapStatusToPipelineStage(s);

  if (stage === "image_review") {
    return {
      href: "/review",
      message: "此草稿已在標圖／生圖階段，請到生圖工廠繼續。"
    };
  }
  if (stage === "ready" || stage === "published" || stage === "archived") {
    return {
      href: "/records",
      message: "此草稿已不在待輸入佇列，請到發布紀錄查看。"
    };
  }
  // copy_review + leftover input-stage non-pending_input (e.g. pending_copy)
  return {
    href: "/drafts/new",
    message: "此草稿已離開「待輸入」，不能再當擷取表單開啟。請到下方審核區繼續。"
  };
}

export function isPendingInputStatus(status: string | null | undefined): boolean {
  return status === "pending_input";
}

/**
 * Build form seed from DB draft. Caller must ensure status === pending_input.
 * Cost currency fixed CNY for capture drafts (Fable G).
 */
export function mapDraftToWorkspaceForm(
  draft: Pick<
    ProductDraft,
    | "id"
    | "taobao_title"
    | "original_title"
    | "title_zh"
    | "taobao_url"
    | "source_url"
    | "source_platform"
    | "cny_price"
    | "note"
    | "spec_text"
    | "video_urls"
    | "sale_status"
    | "is_secondhand"
    | "secondhand_grade"
    | "secondhand_condition"
    | "secondhand_notes"
    | "inventory_quantity"
    | "inventory_policy"
    | "price_mode"
    | "variant_dimensions"
  >,
  variants: DraftVariantDbRow[] = [],
  images: ProductImage[] = []
): WorkspaceFormSeed {
  const title =
    draft.taobao_title?.trim() ||
    draft.original_title?.trim() ||
    draft.title_zh?.trim() ||
    "";

  const taobaoUrl = draft.taobao_url?.trim() || draft.source_url?.trim() || "";

  const dimsRaw = Array.isArray(draft.variant_dimensions)
    ? (draft.variant_dimensions as VariantDimension[])
    : [];
  const { dimensions, rows } = dbRowsToForm(dimsRaw, variants);

  const invUnlimited =
    draft.inventory_policy !== "deny" || draft.inventory_quantity == null;
  const invQty =
    !invUnlimited && draft.inventory_quantity != null
      ? String(draft.inventory_quantity)
      : "";

  const price =
    draft.cny_price != null && Number.isFinite(Number(draft.cny_price))
      ? String(draft.cny_price)
      : "";

  return {
    draftId: draft.id,
    title,
    source: mapSourcePlatformToForm(draft.source_platform),
    price,
    costCurrency: "CNY",
    taobaoUrl,
    note: draft.note?.trim() || "",
    specText: draft.spec_text?.trim() || "",
    videoUrlsText: videoUrlsToTextarea(draft.video_urls),
    saleStatus: draft.sale_status?.trim() || "台灣現貨",
    isSecondhand: Boolean(draft.is_secondhand),
    secondhandGrade: draft.secondhand_grade?.trim() || "",
    secondhandCondition: draft.secondhand_condition?.trim() || "",
    secondhandNotes: draft.secondhand_notes?.trim() || "",
    inventoryUnlimited: invUnlimited,
    inventoryQuantity: invQty,
    inventoryOpen: !invUnlimited,
    priceMode: draft.price_mode === "single" ? "single" : "sale",
    variantDimensions: dimensions,
    variants: rows,
    seedImages: imagesToSeedRows(images)
  };
}

/** Build open_path for CAP-1 responses. */
export function captureOpenPath(draftId: string): string {
  return `/drafts/new?draft=${encodeURIComponent(draftId)}`;
}
