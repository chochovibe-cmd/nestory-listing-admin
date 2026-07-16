import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { notifyMake } from "@/lib/notifications/make";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

interface CompletePayload {
  draftId?: string;
  ruleVersion?: string;
  model?: string;
  workerId?: string;
  output?: {
    title_zh?: string;
    description_html?: string;
    description_plain?: string;
    seo_title?: string;
    seo_description?: string;
    tags?: string[];
    shopify_tags?: string[];
    collection_suggestion?: string;
    shopify_collections?: string[];
    product_type?: string;
    vendor?: string;
    shopify_handle?: string;
    metafields_json?: unknown;
    generated_payload_json?: unknown;
    shopify_payload_preview?: unknown;
    spec_text?: string;
    warnings?: string[];
    image_alt_texts?: Array<{ image_id: string; alt_text: string }>;
  };
}

export async function POST(request: NextRequest) {
  const auth = requireWorkerToken(request);
  if (!auth.ok) return jsonError(auth.error, auth.error.includes("configured") ? 500 : 401);

  const body = (await request.json().catch(() => ({}))) as CompletePayload;
  if (!body.draftId || !body.output) return jsonError("draftId and output are required");

  const supabase = createServiceSupabaseClient();
  const output = body.output;
  const draftUpdate: Record<string, unknown> = {
    title_zh: output.title_zh ?? null,
    description_html: output.description_html ?? null,
    description_plain: output.description_plain ?? null,
    seo_title: output.seo_title ?? null,
    seo_description: output.seo_description ?? null,
    tags: output.tags ?? [],
    shopify_tags: output.shopify_tags ?? [],
    collection_suggestion: output.collection_suggestion ?? null,
    shopify_collections: output.shopify_collections ?? [],
    spec_text: output.spec_text ?? null,
    warnings: output.warnings ?? [],
    status: "ready_for_review",
    pipeline_stage: mapStatusToPipelineStage("ready_for_review"),
    generation_status: "completed",
    generation_rule_version: body.ruleVersion ?? null,
    generation_model: body.model ?? "codex_skill",
    generation_error: null,
    worker_id: null,
    worker_locked_at: null,
    worker_lock_expires_at: null,
    next_retry_at: null
  };

  for (const [key, value] of Object.entries({
    product_type: output.product_type,
    vendor: output.vendor,
    shopify_handle: output.shopify_handle,
    metafields_json: output.metafields_json,
    generated_payload_json: output.generated_payload_json,
    shopify_payload_preview: output.shopify_payload_preview
  })) {
    if (value !== undefined) draftUpdate[key] = value;
  }

  const { error } = await supabase
    .from("product_drafts")
    .update(draftUpdate)
    .eq("id", body.draftId);

  if (error) return jsonError(error.message, 500);

  for (const item of output.image_alt_texts ?? []) {
    await supabase.from("product_images").update({ alt_text: item.alt_text }).eq("id", item.image_id);
  }

  await supabase.from("generation_runs").insert({
    draft_id: body.draftId,
    mode: "codex_skill",
    provider: "codex",
    rule_version: body.ruleVersion ?? null,
    model: body.model ?? "codex_skill",
    worker_id: body.workerId ?? null,
    status: "completed",
    output_payload: output,
    completed_at: new Date().toISOString()
  });

  await supabase.from("automation_logs").insert({
    draft_id: body.draftId,
    action: "worker.complete",
    status: "ready_for_review",
    message: "Codex Skill generation completed",
    raw_payload: body
  });

  await notifyMake("ready_for_review", { draftId: body.draftId });

  return Response.json({ ok: true, status: "ready_for_review" });
}
