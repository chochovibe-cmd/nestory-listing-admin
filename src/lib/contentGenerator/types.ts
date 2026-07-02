import { DraftState, ProductDraftPayload, TagRule } from './sourceTypes';

export type ListingDraftInput = ProductDraftPayload;

export type GeneratedListingContent = {
  display_title: string | null;
  generated_description_html: string;
  generated_faq_html: string;
  seo_title: string;
  meta_description: string;
  shopify_tags: string[];
  validation_errors: string[];
  validation_warnings: string[];
  draft_state: Extract<DraftState, 'ready' | 'blocked'>;
};

export type GeneratorContext = {
  draft: ListingDraftInput;
  errors: string[];
  tagRules: TagRule[];
  warnings: string[];
};
