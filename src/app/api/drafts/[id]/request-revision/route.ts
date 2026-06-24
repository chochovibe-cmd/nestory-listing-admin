import { NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const authSupabase = await createServerSupabaseClient();
  const { data: { user } } = await authSupabase.auth.getUser();

  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["admin", "reviewer"].includes(profile.role)) {
    return Response.json({ error: "Reviewer role is required" }, { status: 403 });
  }

  const comment = typeof body.comment === "string" ? body.comment : null;
  const serviceSupabase = createServiceSupabaseClient();
  const { error } = await serviceSupabase
    .from("product_drafts")
    .update({
      status: "needs_revision",
      reviewed_by: user.id,
      error_message: comment
    })
    .eq("id", id);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  await serviceSupabase.from("review_logs").insert({
    draft_id: id,
    action: "needs_revision",
    reviewer: user.id,
    comment
  });

  return Response.json({ ok: true, status: "needs_revision" });
}
