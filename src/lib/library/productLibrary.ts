/**
 * C4 product library (header modal) — pure helpers.
 * Q3-A: only published-side statuses. Q5-A: client-side search.
 */

export const LIBRARY_STATUSES = [
  "active_published",
  "draft_created",
  "csv_ready"
] as const;

export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const LIBRARY_FETCH_LIMIT = 150;

export const LIBRARY_SELECT_COLUMNS =
  "id, title_zh, taobao_title, original_title, status, created_by, published_at, created_at, shopify_product_id, ip_name, character_name";

export type LibraryDraftRow = {
  id: string;
  title_zh: string | null;
  taobao_title: string | null;
  original_title: string | null;
  status: string;
  created_by: string | null;
  published_at: string | null;
  created_at: string;
  shopify_product_id: string | null;
  ip_name: string | null;
  character_name: string | null;
};

/** Human title: zh → taobao/original → placeholder. */
export function libraryDisplayTitle(row: Pick<
  LibraryDraftRow,
  "title_zh" | "taobao_title" | "original_title"
>): string {
  const zh = row.title_zh?.trim();
  if (zh) return zh;
  const tao = row.taobao_title?.trim();
  if (tao) return tao;
  const orig = row.original_title?.trim();
  if (orig) return orig;
  return "（無標題）";
}

const STATUS_LABELS: Record<string, string> = {
  active_published: "已上架",
  draft_created: "已建草稿",
  csv_ready: "CSV已備妥"
};

export function libraryStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Published-side statuses use ok chip. */
export function libraryStatusSchipClass(status: string): string {
  if (status === "active_published" || status === "draft_created" || status === "csv_ready") {
    return "schip schip--ok";
  }
  return "schip schip--idle";
}

/**
 * Time line: prefer published_at (標「上架」), else created_at (標「建立」).
 */
export function libraryTimeMeta(row: Pick<LibraryDraftRow, "published_at" | "created_at">): {
  kind: "上架" | "建立";
  iso: string;
  label: string;
} {
  if (row.published_at) {
    return {
      kind: "上架",
      iso: row.published_at,
      label: formatLibraryDate(row.published_at)
    };
  }
  return {
    kind: "建立",
    iso: row.created_at,
    label: formatLibraryDate(row.created_at)
  };
}

export function formatLibraryDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
}

/**
 * Q2-A: show profiles.name when resolved; else「成員」or short id — never fake names.
 */
export function libraryCreatorLabel(
  createdBy: string | null,
  nameById: ReadonlyMap<string, string>
): string {
  if (!createdBy) return "成員";
  const name = nameById.get(createdBy)?.trim();
  if (name) return name;
  return `成員 · ${createdBy.slice(0, 8)}`;
}

/** Q5-A client filter (all tokens must match). */
export function matchesLibraryQuery(row: LibraryDraftRow, query: string): boolean {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return true;

  const hay = [
    row.title_zh,
    row.original_title,
    row.taobao_title,
    row.ip_name,
    row.character_name,
    row.shopify_product_id
  ]
    .map((s) => (s ?? "").toLowerCase())
    .join("\n");

  return tokens.every((t) => hay.includes(t));
}

export function filterLibraryRows(rows: LibraryDraftRow[], query: string): LibraryDraftRow[] {
  return rows.filter((row) => matchesLibraryQuery(row, query));
}
