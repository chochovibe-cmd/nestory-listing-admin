import { NextRequest } from "next/server";
import { publishDraft } from "@/lib/shopify/publishDraft";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { PublishMode } from "@/types/domain";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body.draftIds;
  const publishMode = (body.publishMode ?? "draft") as PublishMode;

  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }

  if (!["active", "draft"].includes(publishMode)) {
    return Response.json({ error: "Invalid publishMode" }, { status: 400 });
  }

  if (publishMode === "active" && body.confirmActive !== true) {
    return Response.json({ error: "ACTIVE publish requires explicit confirmActive=true" }, { status: 400 });
  }

  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "Reviewer role is required to publish" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const results = [];
  for (const id of draftIds) {
    const result = await publishDraft(serviceSupabase, id, publishMode);
    results.push({ id, ...result });
  }

  const succeeded = results.filter((result) => result.ok).length;
  return Response.json({ ok: true, succeeded, failed: results.length - succeeded, results });
}
