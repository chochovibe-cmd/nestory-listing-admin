/**
 * SYN-1 R1: prepare Traditional Chinese copy for detail-image render.
 * Source = post-generate intermediate (title_zh / product_highlights / spec_text).
 * Never use raw Simplified capture. Localize again as insurance before render.
 * P4: stripCustomerSourceMarkers so old drafts with residual「（來源：網路）」never hit the image.
 */

import {
  filterSpecsForDetailImage,
  parseSpecRows,
  type SpecRow
} from "@/lib/images/detailCompose/filterSpecs";
import { DEFAULT_BUY_NOTICE } from "@/lib/images/detailCompose/horizonTokens";
import {
  stripCustomerSourceMarkers,
  stripCustomerSourceMarkersList
} from "@/lib/providers/stripCustomerSourceMarkers";
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";

export type DetailComposeCopyInput = {
  titleZh?: string | null;
  productBrand?: string | null;
  ipName?: string | null;
  characterName?: string | null;
  productType?: string | null;
  productHighlights?: string[] | null;
  /** Post-generate Traditional intermediate — not raw capture. */
  specText?: string | null;
  descriptionHtml?: string | null;
  descriptionPlain?: string | null;
};

export type DetailComposeCopy = {
  title: string;
  brand: string;
  ip: string;
  productType: string;
  highlights: string[];
  specs: SpecRow[];
  buyNotice: string;
  /** R1 audit: we localized again before render. */
  localized: true;
};

/** Localize then strip P4 source markers (idempotent). */
function loc(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return "";
  const localized = localizeToTaiwanTraditionalText(String(s).trim());
  return stripCustomerSourceMarkers(localized).trim();
}

/**
 * Extract ◈ 購買提醒 section from description if present.
 */
export function extractBuyNotice(
  descriptionHtml?: string | null,
  descriptionPlain?: string | null
): string {
  const raw = [descriptionPlain, descriptionHtml]
    .map((x) => (x == null ? "" : String(x)))
    .join("\n");
  if (!raw.trim()) return DEFAULT_BUY_NOTICE;

  // Strip tags lightly for HTML
  const text = raw
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");

  const markers = ["◈ 購買提醒", "◈購買提醒", "購買提醒"];
  for (const m of markers) {
    const idx = text.indexOf(m);
    if (idx < 0) continue;
    let rest = text.slice(idx + m.length).replace(/^[\s:：]+/, "");
    // Stop at next section marker
    const stop = rest.search(/\n\s*◈|\n\s*【|\n\s*##/);
    if (stop >= 0) rest = rest.slice(0, stop);
    const cleaned = rest.replace(/\s+/g, " ").trim();
    if (cleaned.length >= 8) return loc(cleaned);
  }
  return DEFAULT_BUY_NOTICE;
}

/**
 * R1+R2: build fully localized, filtered copy for the template.
 */
export function prepareDetailComposeCopy(
  input: DetailComposeCopyInput
): DetailComposeCopy {
  const title =
    loc(input.titleZh) ||
    "未命名商品";

  const brand = loc(input.productBrand);
  const ip = loc(input.ipName) || loc(input.characterName);
  const productType = loc(input.productType);

  const highlightsRaw = Array.isArray(input.productHighlights)
    ? input.productHighlights
    : [];
  // loc each line, then list strip as belt-and-suspenders (P4 helper)
  const highlights = stripCustomerSourceMarkersList(
    highlightsRaw.map((h) => loc(h)).filter(Boolean)
  ).slice(0, 4);

  // R1: localize + P4 strip full spec_text, then parse, then R2 filter
  const localizedSpec = loc(input.specText);
  const specs = filterSpecsForDetailImage(parseSpecRows(localizedSpec)).map(
    (row) => ({
      key: stripCustomerSourceMarkers(row.key).trim(),
      value: stripCustomerSourceMarkers(row.value).trim()
    })
  ).filter((row) => row.value || row.key);

  const buyNotice = extractBuyNotice(
    input.descriptionHtml,
    input.descriptionPlain
  );

  return {
    title,
    brand,
    ip,
    productType,
    highlights,
    specs,
    buyNotice,
    localized: true
  };
}
