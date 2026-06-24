import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { notifyMake } from "@/lib/notifications/make";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const auth = requireWorkerToken(request);
  if (!auth.ok) return jsonError(auth.error, auth.error.includes("configured") ? 500 : 401);

  const body = await request.json().catch(() => ({}));
  if (!body.draftId || !body.error) return jsonError("draftId and error are required");

  const supabase = createServiceSupabaseClient();

  const { error } = await supabase
    .from("product_drafts")
    .update({
      status: "failed",
      generation_status: "failed",
      generation_error: String(body.error)
    })
    .eq("id", body.draftId);

  if (error) return jsonError(error.message, 500);

  await supabase.from("generation_runs").insert({
    draft_id: body.draftId,
    mode: "codex_skill",
    provider: "codex",
    rule_version: body.ruleVersion ?? null,
    status: "failed",
    error_message: String(body.error),
    output_payload: body,
    completed_at: new Date().toISOString()
  });

  await supabase.from("automation_logs").insert({
    draft_id: body.draftId,
    action: "worker.fail",
    status: "failed",
    message: String(body.error),
    raw_payload: body
  });

  await notifyMake("generation_failed", { draftId: body.draftId, error: String(body.error) });

  return Response.json({ ok: true, status: "failed" });
}
