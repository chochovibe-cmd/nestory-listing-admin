/**
 * B10: per-field copy version history helpers.
 * Backed by append-only `generation_history` (migration 007).
 * Does not invent a new schema — reuses A7 `CopyRegenField` names.
 */

import type { CopyCurrentValues, CopyRegenField } from "@/lib/providers/copy";
import { COPY_REGEN_FIELDS } from "@/lib/providers/copy";
import type { ProductDraft } from "@/types/domain";

export const COPY_VERSION_FIELDS = COPY_REGEN_FIELDS;
export type CopyVersionField = CopyRegenField;

/** history.field_name → product_drafts column */
export const REGEN_FIELD_TO_COLUMN: Record<CopyVersionField, keyof ProductDraft | string> = {
  enriched_title: "title_zh",
  generated_description_html: "description_html",
  generated_faq_html: "generated_faq_html",
  seo_title: "seo_title",
  meta_description: "seo_description",
  why_we_chose_it: "why_we_chose_it",
  product_highlights: "product_highlights",
};

export const COPY_VERSION_FIELD_LABELS: Record<CopyVersionField, string> = {
  enriched_title: "商品標題",
  why_we_chose_it: "為什麼潮巢選它？",
  product_highlights: "商品賣點",
  generated_description_html: "商品描述",
  generated_faq_html: "FAQ",
  seo_title: "SEO 標題",
  meta_description: "Meta 描述",
};

/** Display order in the copy tab (Mockup-aligned + SEO kept in-tab per B9). */
export const COPY_VERSION_FIELD_ORDER: readonly CopyVersionField[] = [
  "enriched_title",
  "why_we_chose_it",
  "product_highlights",
  "generated_description_html",
  "generated_faq_html",
  "seo_title",
  "meta_description",
];

export interface GenerationHistoryRow {
  id: string;
  draft_id: string;
  field_name: string;
  content: string;
  provider: string | null;
  model: string | null;
  created_by: string | null;
  created_at: string;
}

export type VersionEntry =
  | {
      kind: "virtual";
      /** Synthetic key for React lists; never written to DB. */
      key: "virtual";
      content: string;
    }
  | {
      kind: "history";
      key: string;
      id: string;
      content: string;
      provider: string | null;
      model: string | null;
      created_at: string;
    };

export const MANUAL_HISTORY_PROVIDER = "manual";

/** Normalize for equality checks (version match / dirty). */
export function normalizeCopyContent(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

export function contentsEqual(a: string, b: string): boolean {
  return normalizeCopyContent(a) === normalizeCopyContent(b);
}

/** product_highlights[] ↔ history/UI multiline string (same as A7). */
export function highlightsToContent(lines: string[] | null | undefined): string {
  if (!lines?.length) return "";
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

export function contentToHighlights(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.replace(/^[・•\-\*]\s*/, "").trim())
    .filter(Boolean);
}

export function draftFieldContent(
  draft: Pick<
    ProductDraft,
    | "title_zh"
    | "description_html"
    | "generated_faq_html"
    | "seo_title"
    | "seo_description"
    | "why_we_chose_it"
    | "product_highlights"
  >,
  field: CopyVersionField,
): string {
  switch (field) {
    case "enriched_title":
      return draft.title_zh ?? "";
    case "generated_description_html":
      return draft.description_html ?? "";
    case "generated_faq_html":
      return draft.generated_faq_html ?? "";
    case "seo_title":
      return draft.seo_title ?? "";
    case "meta_description":
      return draft.seo_description ?? "";
    case "why_we_chose_it":
      return draft.why_we_chose_it ?? "";
    case "product_highlights":
      return highlightsToContent(draft.product_highlights);
  }
}

/** Group history rows by field_name, oldest → newest within each field. */
export function groupHistoryByField(
  rows: GenerationHistoryRow[],
): Record<CopyVersionField, GenerationHistoryRow[]> {
  const out = Object.fromEntries(COPY_VERSION_FIELDS.map((f) => [f, [] as GenerationHistoryRow[]])) as Record<
    CopyVersionField,
    GenerationHistoryRow[]
  >;
  const sorted = [...rows].sort((a, b) => {
    const t = a.created_at.localeCompare(b.created_at);
    if (t !== 0) return t;
    return a.id.localeCompare(b.id);
  });
  for (const row of sorted) {
    if ((COPY_VERSION_FIELDS as readonly string[]).includes(row.field_name)) {
      out[row.field_name as CopyVersionField].push(row);
    }
  }
  return out;
}

/**
 * D6: if history is empty but DB has a value, expose a virtual v1 (not written).
 * Once real history exists, only real rows are versions (baseline is inserted on
 * first regen / manual commit before the new value).
 */
export function buildFieldVersions(
  historyForField: GenerationHistoryRow[],
  dbContent: string,
): VersionEntry[] {
  if (historyForField.length === 0) {
    const trimmed = dbContent; // keep raw for display; empty → no versions
    if (!normalizeCopyContent(trimmed)) return [];
    return [{ kind: "virtual", key: "virtual", content: trimmed }];
  }
  return historyForField.map((row) => ({
    kind: "history" as const,
    key: row.id,
    id: row.id,
    content: row.content,
    provider: row.provider,
    model: row.model,
    created_at: row.created_at,
  }));
}

/**
 * Pick initial cursor: prefer a history row matching DB content (latest match),
 * else last version (newest). Virtual-only → index 0.
 */
export function initialVersionIndex(versions: VersionEntry[], dbContent: string): number {
  if (versions.length === 0) return 0;
  for (let i = versions.length - 1; i >= 0; i -= 1) {
    if (contentsEqual(versions[i].content, dbContent)) return i;
  }
  return versions.length - 1;
}

export function versionLabel(index: number, versions: VersionEntry[]): string {
  const total = versions.length;
  if (total === 0) return "版本 —";
  const n = index + 1;
  const entry = versions[index];
  if (entry?.kind === "virtual") return `版本 ${n}/${total}（目前值）`;
  return `版本 ${n}/${total}`;
}

/**
 * When history is empty and we are about to create a new version (regen or
 * manual commit), insert the pre-change content first so the user can always
 * switch back. Returns the row payload or null if not needed.
 */
export function baselineHistoryInsert(params: {
  draftId: string;
  field: CopyVersionField;
  /** Content currently on screen / in DB before the new version. */
  originalContent: string;
  /** The new content about to be saved (regen result or manual edit). */
  nextContent: string;
  userId: string | null;
  historyCount: number;
}): Omit<GenerationHistoryRow, "id" | "created_at"> | null {
  const { draftId, field, originalContent, nextContent, userId, historyCount } = params;
  if (historyCount > 0) return null;
  if (!normalizeCopyContent(originalContent)) return null;
  // Only materialise baseline when something new is actually coming in.
  if (contentsEqual(originalContent, nextContent)) return null;
  return {
    draft_id: draftId,
    field_name: field,
    content: originalContent,
    provider: null,
    model: null,
    created_by: userId,
  };
}

/**
 * Manual commit: if next content is not already the latest history (or any
 * history when we want a new tip), return insert payload.
 * With empty history: baseline is handled separately; this returns the manual row.
 */
export function manualHistoryInsert(params: {
  draftId: string;
  field: CopyVersionField;
  content: string;
  userId: string | null;
  historyContents: string[];
  isDirty: boolean;
}): Omit<GenerationHistoryRow, "id" | "created_at"> | null {
  const { draftId, field, content, userId, historyContents, isDirty } = params;
  if (!normalizeCopyContent(content)) return null;
  // Browsing an old version without edits: no new history row.
  if (!isDirty) return null;
  // Already identical to newest history tip → no duplicate.
  const tip = historyContents[historyContents.length - 1];
  if (tip != null && contentsEqual(tip, content)) return null;
  // Also skip if somehow equal to any history and not dirty — handled by !isDirty.
  return {
    draft_id: draftId,
    field_name: field,
    content,
    provider: MANUAL_HISTORY_PROVIDER,
    model: null,
    created_by: userId,
  };
}

/** Build draft column patch from field → display string map. */
export function buildDraftCopyPatch(
  values: Partial<Record<CopyVersionField, string>>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const field of COPY_VERSION_FIELDS) {
    if (!(field in values)) continue;
    const raw = values[field] ?? "";
    if (field === "product_highlights") {
      patch.product_highlights = contentToHighlights(raw);
    } else {
      const col = REGEN_FIELD_TO_COLUMN[field] as string;
      patch[col] = normalizeCopyContent(raw) ? raw : null;
    }
  }
  return patch;
}

/**
 * D4: merge optional client currentValues over draft columns for A7 context.
 * Unknown / missing keys fall back to draft.
 */
export function mergeRegenCurrentValues(
  draft: ProductDraft,
  client: unknown,
): CopyCurrentValues {
  const fromDraft: CopyCurrentValues = {
    enrichedTitle: draft.title_zh ?? undefined,
    generatedDescriptionHtml: draft.description_html ?? undefined,
    generatedFaqHtml: draft.generated_faq_html ?? undefined,
    seoTitle: draft.seo_title ?? undefined,
    metaDescription: draft.seo_description ?? undefined,
    whyWeChoseIt: draft.why_we_chose_it ?? undefined,
    productHighlights: draft.product_highlights?.length ? draft.product_highlights : undefined,
    detectedIpName: draft.ip_name ?? undefined,
    detectedCharacterName: draft.character_name ?? undefined,
    detectedProductType: draft.product_type ?? undefined,
  };

  if (!client || typeof client !== "object") return fromDraft;
  const c = client as Record<string, unknown>;

  const str = (key: string, fallback?: string) =>
    typeof c[key] === "string" ? (c[key] as string) : fallback;

  let productHighlights = fromDraft.productHighlights;
  if (Array.isArray(c.productHighlights)) {
    productHighlights = (c.productHighlights as unknown[])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean);
  } else if (typeof c.productHighlights === "string") {
    productHighlights = contentToHighlights(c.productHighlights);
  }

  return {
    enrichedTitle: str("enrichedTitle", fromDraft.enrichedTitle),
    generatedDescriptionHtml: str("generatedDescriptionHtml", fromDraft.generatedDescriptionHtml),
    generatedFaqHtml: str("generatedFaqHtml", fromDraft.generatedFaqHtml),
    seoTitle: str("seoTitle", fromDraft.seoTitle),
    metaDescription: str("metaDescription", fromDraft.metaDescription),
    whyWeChoseIt: str("whyWeChoseIt", fromDraft.whyWeChoseIt),
    productHighlights,
    detectedIpName: fromDraft.detectedIpName,
    detectedCharacterName: fromDraft.detectedCharacterName,
    detectedProductType: fromDraft.detectedProductType,
  };
}

/** UI payload for /api/generate field regen currentValues. */
export function displayMapToCurrentValues(
  map: Partial<Record<CopyVersionField, string>>,
  draft: ProductDraft,
): CopyCurrentValues {
  return mergeRegenCurrentValues(draft, {
    enrichedTitle: map.enriched_title,
    generatedDescriptionHtml: map.generated_description_html,
    generatedFaqHtml: map.generated_faq_html,
    seoTitle: map.seo_title,
    metaDescription: map.meta_description,
    whyWeChoseIt: map.why_we_chose_it,
    productHighlights: map.product_highlights,
  });
}

/**
 * Plan inserts for combo save (pure). Caller performs DB writes.
 * D6: empty history + dirty → baseline (original DB) then manual (display).
 */
export function planComboSaveHistoryInserts(params: {
  draftId: string;
  userId: string | null;
  /** Current display values. */
  display: Record<CopyVersionField, string>;
  /** DB values at load / last sync (for baseline). */
  dbSnapshot: Record<CopyVersionField, string>;
  /** Real history rows only (no virtual). */
  historyByField: Record<CopyVersionField, GenerationHistoryRow[]>;
  dirty: Partial<Record<CopyVersionField, boolean>>;
}): Array<Omit<GenerationHistoryRow, "id" | "created_at">> {
  const { draftId, userId, display, dbSnapshot, historyByField, dirty } = params;
  const inserts: Array<Omit<GenerationHistoryRow, "id" | "created_at">> = [];

  for (const field of COPY_VERSION_FIELDS) {
    const content = display[field] ?? "";
    const rows = historyByField[field] ?? [];
    const isDirty = Boolean(dirty[field]);

    if (rows.length === 0) {
      const original = dbSnapshot[field] ?? "";
      // Dirty edit that actually changes the virtual DB value → baseline then manual.
      if (isDirty && normalizeCopyContent(content) && !contentsEqual(content, original)) {
        const baseline = baselineHistoryInsert({
          draftId,
          field,
          originalContent: original,
          nextContent: content,
          userId,
          historyCount: 0,
        });
        if (baseline) inserts.push(baseline);
        inserts.push({
          draft_id: draftId,
          field_name: field,
          content,
          provider: MANUAL_HISTORY_PROVIDER,
          model: null,
          created_by: userId,
        });
      }
      continue;
    }

    const manual = manualHistoryInsert({
      draftId,
      field,
      content,
      userId,
      historyContents: rows.map((r) => r.content),
      isDirty,
    });
    if (manual) inserts.push(manual);
  }

  return inserts;
}

/** Whether any copy field is dirty (needs combo commit). */
export function anyCopyDirty(dirty: Partial<Record<CopyVersionField, boolean>>): boolean {
  return COPY_VERSION_FIELDS.some((f) => dirty[f]);
}

/**
 * Whether display differs from DB snapshot for any versioned field
 * (version switch without dirty still needs draft write on combo save).
 */
export function copyDisplayDiffersFromDb(
  display: Partial<Record<CopyVersionField, string>>,
  dbSnapshot: Partial<Record<CopyVersionField, string>>,
): boolean {
  return COPY_VERSION_FIELDS.some(
    (f) => !contentsEqual(display[f] ?? "", dbSnapshot[f] ?? ""),
  );
}
