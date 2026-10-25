/** 4a: buyer-review summary the extension read from the source page (raw_capture.payload.source_reviews). */
export type SourceReviews = {
  source: "ice" | "dom";
  total_text: string | null;
  good_rate_text: string | null;
  tags: Array<{ text: string; count: number | null }>;
  samples: Array<{ text: string; sku: string | null; date: string | null }>;
  signals: string[];
};

export const SOURCE_REVIEW_LIMITS = { tags: 12, samples: 5, sampleChars: 300, signals: 6 };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Whitelists the 6 known keys, applies the limits, drops buyer identity; null when nothing is left. */
export function normalizeSourceReviews(value: unknown): SourceReviews | null {
  if (!isPlainObject(value) || (value.source !== "ice" && value.source !== "dom")) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const tags = list(value.tags)
    .filter(isPlainObject)
    .map((t) => ({ text: text(t.text, 40), count: typeof t.count === "number" && Number.isFinite(t.count) ? t.count : null }))
    .filter((t) => t.text)
    .slice(0, SOURCE_REVIEW_LIMITS.tags);
  const samples = list(value.samples)
    .filter(isPlainObject)
    .map((s) => ({ text: text(s.text, SOURCE_REVIEW_LIMITS.sampleChars), sku: text(s.sku, 80) || null, date: text(s.date, 20) || null }))
    .filter((s) => s.text)
    .slice(0, SOURCE_REVIEW_LIMITS.samples);
  const signals = list(value.signals).map((s) => text(s, 40)).filter(Boolean).slice(0, SOURCE_REVIEW_LIMITS.signals);
  const out: SourceReviews = {
    source: value.source,
    total_text: text(value.total_text, 20) || null,
    good_rate_text: text(value.good_rate_text, 40) || null,
    tags,
    samples,
    signals
  };
  if (!out.total_text && !out.good_rate_text && !tags.length && !samples.length && !signals.length) return null;
  return out;
}

export function readSourceReviews(rawCapture: unknown): SourceReviews | null {
  if (!isPlainObject(rawCapture) || !isPlainObject(rawCapture.payload)) return null;
  return normalizeSourceReviews(rawCapture.payload.source_reviews);
}
