/**
 * A12 / B4: shared URL + classification duplicate helpers.
 * Used by POST /api/drafts/check-duplicate and /api/generate (B4 3A).
 */

export type MinimalDraftRow = {
  id: string;
  title_zh: string | null;
  status: string;
  created_by: string | null;
  source_url: string | null;
  taobao_url: string | null;
  ip_name: string | null;
  character_name: string | null;
  product_type: string | null;
  created_at: string;
};

export type DuplicateSummary = {
  id: string;
  title: string | null;
  status: string;
  createdBy: string | null;
  url: string | null;
  ip: string | null;
  character: string | null;
  productType: string | null;
  createdAt: string;
};

export const DUPLICATE_SELECT_COLUMNS =
  "id,title_zh,status,created_by,source_url,taobao_url,ip_name,character_name,product_type,created_at";

/** Stable URL match key: marketplace item id, else host+path stripped. */
export function extractUrlMatchKey(rawUrl: string): string {
  const url = rawUrl.trim();
  if (!url) return "";

  const idMatch = url.match(/[?&](?:id|itemId|item_id)=(\d{6,})/i);
  if (idMatch) return idMatch[1];

  let core = url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split("#")[0]
    .split("?")[0]
    .replace(/\/+$/, "")
    .toLowerCase();
  core = core.replace(/[(),*]/g, "");
  return core;
}

export function toDuplicateSummary(row: MinimalDraftRow): DuplicateSummary {
  return {
    id: row.id,
    title: row.title_zh,
    status: row.status,
    createdBy: row.created_by,
    url: row.source_url ?? row.taobao_url,
    ip: row.ip_name,
    character: row.character_name,
    productType: row.product_type,
    createdAt: row.created_at,
  };
}

/**
 * B4 3A: yellow-only classification warning for draft.warnings.
 * Returns null when no hits.
 */
export function buildClassificationDuplicateWarning(
  matches: Array<Pick<DuplicateSummary, "title" | "id">>,
): string | null {
  if (!matches.length) return null;
  const firstTitle = (matches[0].title ?? "").trim() || "（無標題）";
  const n = matches.length;
  if (n === 1) {
    return `⚠ 同 IP＋角色＋類型已有類似商品：「${firstTitle}」`;
  }
  return `⚠ 同 IP＋角色＋類型已有類似商品：「${firstTitle}」等（共 ${n} 件）`;
}

type ServiceClient = {
  from: (table: string) => {
    select: (columns: string) => {
      or: (filter: string) => QueryBuilder;
      eq: (column: string, value: string) => QueryBuilder;
      neq: (column: string, value: string) => QueryBuilder;
      limit: (n: number) => QueryBuilder;
    };
  };
};

type QueryBuilder = {
  or: (filter: string) => QueryBuilder;
  eq: (column: string, value: string) => QueryBuilder;
  neq: (column: string, value: string) => QueryBuilder;
  limit: (n: number) => QueryBuilder | PromiseLike<{ data: MinimalDraftRow[] | null; error: { message: string } | null }>;
  then?: (
    onfulfilled?: (value: { data: MinimalDraftRow[] | null; error: { message: string } | null }) => unknown,
  ) => PromiseLike<unknown>;
};

/** Run URL + classification match against product_drafts via service client. */
export async function queryDuplicateMatches(
  serviceSupabase: {
    from: (table: string) => any;
  },
  input: {
    sourceUrl?: string;
    ip?: string;
    character?: string;
    productType?: string;
    excludeDraftId?: string | null;
  },
): Promise<{
  urlMatches: DuplicateSummary[];
  classificationMatches: DuplicateSummary[];
  hasDuplicates: boolean;
  urlKey: string | null;
}> {
  const sourceUrl = input.sourceUrl ?? "";
  const ip = (input.ip ?? "").trim();
  const character = (input.character ?? "").trim();
  const productType = (input.productType ?? "").trim();
  const excludeDraftId = input.excludeDraftId ?? null;
  const urlKey = extractUrlMatchKey(sourceUrl);

  const urlPromise = (async (): Promise<MinimalDraftRow[]> => {
    if (!urlKey) return [];
    let query = serviceSupabase
      .from("product_drafts")
      .select(DUPLICATE_SELECT_COLUMNS)
      .or(`source_url.ilike.%${urlKey}%,taobao_url.ilike.%${urlKey}%`)
      .limit(20);
    if (excludeDraftId) query = query.neq("id", excludeDraftId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MinimalDraftRow[];
  })();

  // Require at least IP + 類型; 角色 narrows further when supplied.
  const classificationPromise = (async (): Promise<MinimalDraftRow[]> => {
    if (!ip || !productType) return [];
    let query = serviceSupabase
      .from("product_drafts")
      .select(DUPLICATE_SELECT_COLUMNS)
      .eq("ip_name", ip)
      .eq("product_type", productType)
      .limit(20);
    if (character) query = query.eq("character_name", character);
    if (excludeDraftId) query = query.neq("id", excludeDraftId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MinimalDraftRow[];
  })();

  const [urlRows, classificationRows] = await Promise.all([urlPromise, classificationPromise]);
  const urlMatches = urlRows.map(toDuplicateSummary);
  const classificationMatches = classificationRows.map(toDuplicateSummary);

  return {
    urlKey: urlKey || null,
    urlMatches,
    classificationMatches,
    hasDuplicates: urlMatches.length > 0 || classificationMatches.length > 0,
  };
}
