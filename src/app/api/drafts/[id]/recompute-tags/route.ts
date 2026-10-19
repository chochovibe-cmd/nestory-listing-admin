import { NextRequest } from "next/server";
import { loadAuthorizedDraft, resolveRequestPrincipal } from "@/lib/api/requestPrincipal";
import { toListingDraftInput } from "@/lib/drafts/listingDraftInput";
import {
  buildRecomputedTags,
  buildRecomputedWarnings,
  isTagDictWarning,
} from "@/lib/drafts/recomputeDraftTags";
import { buildNestoryTagsV2Result } from "@/lib/nestoryTagsV2";
import { createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ProductDraft } from "@/types/domain";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principalResult = await resolveRequestPrincipal(request);
  if (!principalResult.ok) return principalResult.response;
  if (principalResult.principal.kind !== "session") {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const authorizedDraft = await loadAuthorizedDraft(principalResult.principal, id);
  if (!authorizedDraft.ok) return authorizedDraft.response;
  const canonicalDraftId = authorizedDraft.id;
  const serviceSupabase = createServiceSupabaseClient();

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("*")
    .eq("id", canonicalDraftId)
    .maybeSingle();
  if (draftError) return Response.json({ error: draftError.message }, { status: 500 });
  if (!draft) return Response.json({ error: "Draft not found" }, { status: 404 });
  if (draft.status === "archived") {
    return Response.json({ error: "已封存的商品不能重算 tags", code: "archived" }, { status: 409 });
  }
  if (draft.shopify_product_id) {
    return Response.json(
      { error: "已上架商品不能在這裡重算 tags（之後由同步處理）", code: "published" },
      { status: 409 },
    );
  }

  const [ipResult, characterResult] = await Promise.all([
    serviceSupabase.from("ip_catalog").select("ip_name,aliases").eq("is_active", true),
    serviceSupabase
      .from("ip_characters")
      .select("ip_name,character_name,aliases")
      .eq("is_active", true),
  ]);
  if (ipResult.error || characterResult.error) {
    const message = ipResult.error?.message ?? characterResult.error?.message ?? "unknown";
    return Response.json({ error: "讀取字典失敗：" + message }, { status: 500 });
  }

  const detected = {
    ip: draft.ip_name ?? "",
    character: draft.character_name ?? "",
    productType: draft.product_type ?? "",
    category: draft.detected_category ?? "",
    sku: draft.sku ?? "",
  };
  const payload = toListingDraftInput(
    draft as ProductDraft,
    detected,
    null,
    draft.product_brand ?? null,
  );
  const ipCatalog = ipResult.data ?? [];
  const ipCharacters = characterResult.data ?? [];
  const result = buildNestoryTagsV2Result(payload, { ipCatalog, ipCharacters });
  const nextTags = buildRecomputedTags(draft.tags ?? [], result.tags);
  const ipInCatalog = ipCatalog.some((entry) => entry.ip_name === draft.ip_name);
  const nextWarnings = buildRecomputedWarnings(draft.warnings, result.warnings, { ipInCatalog });

  const { error: updateError } = await serviceSupabase
    .from("product_drafts")
    .update({
      tags: nextTags,
      shopify_tags: nextTags,
      warnings: nextWarnings,
      updated_at: new Date().toISOString(),
    })
    .eq("id", canonicalDraftId);
  if (updateError) {
    return Response.json({ error: "重算 tags 寫入失敗：" + updateError.message }, { status: 500 });
  }

  return Response.json({
    ok: true,
    tags: nextTags,
    warnings: nextWarnings,
    remainingDictWarnings: nextWarnings.filter(isTagDictWarning).length,
  });
}
