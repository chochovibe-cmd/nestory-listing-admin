/**
 * SYN-1 detail compose pure surface.
 */

export {
  HORIZON,
  DETAIL_COMPOSE_WIDTH,
  FONT_TITLE_STACK,
  FONT_BODY_STACK,
  DEFAULT_BUY_NOTICE
} from "@/lib/images/detailCompose/horizonTokens";

export {
  SELLER_SERVICE_CORE_TERMS,
  SELLER_SERVICE_FILTER_TERMS,
  TAOBAO_NOISE_SPEC_KEYS
} from "@/lib/images/detailCompose/sellerServiceTerms";

export {
  parseSpecRows,
  filterSpecsForDetailImage,
  parseAndFilterSpecText,
  looksKeyValueSwapped,
  type SpecRow
} from "@/lib/images/detailCompose/filterSpecs";

export {
  isGenerateDetailEnabled,
  isDetailRetainedForListingFlags
} from "@/lib/images/detailCompose/flags";

export {
  prepareDetailComposeCopy,
  extractBuyNotice,
  type DetailComposeCopy,
  type DetailComposeCopyInput
} from "@/lib/images/detailCompose/prepareCopy";

export {
  appendGenerationCostUsd,
  nextGenerationCostEstimate,
  type CostServiceClient
} from "@/lib/images/detailCompose/cost";

export { resolveDetailComposeFonts } from "@/lib/images/detailCompose/fonts";
export {
  buildDetailComposeSvg,
  buildDetailComposeSvgWithLayout,
  estimateDetailSvgHeight,
  measureDetailSvgLayout,
  assertDetailLayoutSound,
  wrapText,
  type DetailSvgLayout,
  type BuildDetailSvgResult
} from "@/lib/images/detailCompose/buildSvg";
export {
  rasterizeDetailComposeSvg,
  probeCjkTextInk,
  countNonCreamPixels,
  DETAIL_CREAM_RGB
} from "@/lib/images/detailCompose/rasterize";
export {
  runComposeDetailForDraft,
  type RunComposeDetailInput,
  type RunComposeDetailResult
} from "@/lib/images/detailCompose/runComposeDetail";
