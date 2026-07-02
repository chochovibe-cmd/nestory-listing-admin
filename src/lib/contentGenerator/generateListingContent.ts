import { generateDescriptionHtml } from './descriptionGenerator';
import { generateFaqHtml } from './faqGenerator';
import { generateSeoContent } from './seoGenerator';
import { generateShopifyTags } from './tagGenerator';
import { generateDisplayTitle } from './titleGenerator';
import { DisplayLabelContext } from './displayLabels';
import { GeneratedListingContent, ListingDraftInput } from './types';
import { validateGeneratedContent } from './validation';
import { TagRule } from './sourceTypes';

function uniqueMessages(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function generateListingContent(
  draft: ListingDraftInput,
  tagRules: TagRule[],
  displayContext: DisplayLabelContext = {},
): GeneratedListingContent {
  const errors: string[] = [];
  const warnings: string[] = [];
  const displayTitle = generateDisplayTitle(draft, displayContext);
  const generatedDescriptionHtml = generateDescriptionHtml(draft, displayContext);
  const generatedFaqHtml = generateFaqHtml(draft, displayContext);
  const seoContent = generateSeoContent(draft, displayContext);
  const shopifyTags = generateShopifyTags({
    draft,
    errors,
    tagRules,
    warnings,
  });

  validateGeneratedContent(
    draft,
    displayTitle,
    seoContent.meta_description,
    errors,
    warnings,
  );

  const validationErrors = uniqueMessages(errors);

  return {
    display_title: displayTitle,
    generated_description_html: generatedDescriptionHtml,
    generated_faq_html: generatedFaqHtml,
    seo_title: seoContent.seo_title,
    meta_description: seoContent.meta_description,
    shopify_tags: shopifyTags,
    validation_errors: validationErrors,
    validation_warnings: uniqueMessages(warnings),
    draft_state: validationErrors.length > 0 ? 'blocked' : 'ready',
  };
}
