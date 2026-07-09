import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import { canOperate } from "@/lib/auth/roles";

// A12: pre-listing duplicate check. Two independent signals:
//   1) URL match  -- the same 淘寶/來源網址 (or same item id) already in the catalog
//   2) classification match -- same IP + 角色 + 類型 three-dimension combo
// Read-only and warn-only: it never blocks; the operator decides. Runs against
// the whole team catalog (service client) because the point is to catch a
// product a *different* member already listed; only minimal fields are returned.

// Pull a stable match key out of a source URL: the marketplace item id when
// present (survives tracking-param churn), else the host+path with query/hash
// and a trailing slash stripped. Returns "" when nothing usable is found.
function extractUrlMatchKey(rawUrl: string): string {
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
  // Strip chars that would break the PostgREST .or() filter grammar.
  core = core.replace(/[(),*]/g, "");
  return core;
}

type MinimalDraft = {
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

const SELECT_COLUMNS =
  "id,title_zh,status,created_by,source_url,taobao_url,ip_name,character_name,product_type,created_at";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const sourceUrl = typeof body.sourceUrl === "string" ? body.sourceUrl : "";
  const ip = typeof body.ip === "string" ? body.ip.trim() : "";
  const character = typeof body.character === "string" ? body.character.trim() : "";
  const productType = typeof body.productType === "string" ? body.productType.trim() : "";
  const excludeDraftId = typeof body.excludeDraftId === "string" ? body.excludeDraftId : null;

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const urlKey = extractUrlMatchKey(sourceUrl);

  // --- URL match ---
  const urlPromise = (async (): Promise<MinimalDraft[]> => {
    if (!urlKey) return [];
    let query = serviceSupabase
      .from("product_drafts")
      .select(SELECT_COLUMNS)
      .or(`source_url.ilike.%${urlKey}%,taobao_url.ilike.%${urlKey}%`)
      .limit(20);
    if (excludeDraftId) query = query.neq("id", excludeDraftId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MinimalDraft[];
  })();

  // --- Classification match (IP + 角色 + 類型) ---
  // Require at least IP + 類型; 角色 narrows further when supplied.
  const classificationPromise = (async (): Promise<MinimalDraft[]> => {
    if (!ip || !productType) return [];
    let query = serviceSupabase
      .from("product_drafts")
      .select(SELECT_COLUMNS)
      .eq("ip_name", ip)
      .eq("product_type", productType)
      .limit(20);
    if (character) query = query.eq("character_name", character);
    if (excludeDraftId) query = query.neq("id", excludeDraftId);
    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as MinimalDraft[];
  })();

  let urlRows: MinimalDraft[];
  let classificationRows: MinimalDraft[];
  try {
    [urlRows, classificationRows] = await Promise.all([urlPromise, classificationPromise]);
  } catch (queryError) {
    return Response.json(
      { error: queryError instanceof Error ? queryError.message : "Duplicate check failed" },
      { status: 500 },
    );
  }

  const toSummary = (row: MinimalDraft) => ({
    id: row.id,
    title: row.title_zh,
    status: row.status,
    createdBy: row.created_by,
    url: row.source_url ?? row.taobao_url,
    ip: row.ip_name,
    character: row.character_name,
    productType: row.product_type,
    createdAt: row.created_at,
  });

  const urlMatches = urlRows.map(toSummary);
  const classificationMatches = classificationRows.map(toSummary);

  return Response.json({
    ok: true,
    urlKey: urlKey || null,
    urlMatches,
    classificationMatches,
    hasDuplicates: urlMatches.length > 0 || classificationMatches.length > 0,
  });
}
