import type { ListingDraftInput } from "@/lib/contentGenerator/types";
import { splitCharacterNames } from "@/lib/characters/splitCharacterNames";
import type { ProductDraft } from "@/types/domain";

export type DetectedClassification = {
  ip: string;
  character: string;
  productType: string;
  category: string;
  sku: string;
};

export function toListingDraftInput(
  draft: ProductDraft,
  detected: DetectedClassification,
  variantSummary?: string | null,
  productBrand?: string | null,
): ListingDraftInput {
  return {
    source_url: draft.source_url,
    product_status: draft.is_secondhand ? "secondhand" : "general",
    ip: detected.ip,
    characters: splitCharacterNames(detected.character),
    product_brand: productBrand ?? draft.product_brand ?? null,
    variant_text: variantSummary ?? null,
    product_types: detected.productType ? [detected.productType] : [],
    use_cases: [],
    sale_status: draft.sale_status,
    recommend_tags: [],
    product_name: draft.title_zh ?? draft.taobao_title ?? draft.original_title ?? "",
    variant_feature: null,
    usage_scene: null,
    intro: draft.note,
    notes: draft.note,
    price: draft.twd_price,
    compare_at_price: draft.compare_at_price,
    image_description: draft.image_description,
    sku: detected.sku || null,
    secondhand_grade: draft.secondhand_grade,
    secondhand_condition: draft.secondhand_condition,
    secondhand_notes: draft.secondhand_notes,
  };
}
