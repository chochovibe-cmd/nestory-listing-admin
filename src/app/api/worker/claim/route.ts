import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

type ClaimedDraft = {
  id: string;
  [key: string]: unknown;
};

type ClaimedDraftWithImages = ClaimedDraft & {
  product_images?: unknown[];
};

export async function POST(request: NextRequest) {
  const auth = requireWorkerToken(request);
  if (!auth.ok) return jsonError(auth.error, auth.error.includes("configured") ? 500 : 401);

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 10);
  const ruleVersion = String(body.ruleVersion ?? "chochonest-copywriter@manual-dev");
  const workerId = String(body.workerId ?? "codex-worker");
  const supabase = createServiceSupabaseClient();

  const { data: claimedDraftRows, error } = await supabase.rpc("claim_pending_generation", {
    batch_limit: limit,
    rule_version: ruleVersion,
    p_worker_id: workerId
  });

  if (error) return jsonError(error.message, 500);

  const claimedDrafts = (claimedDraftRows ?? []) as ClaimedDraft[];
  const ids = claimedDrafts.map((draft) => draft.id);
  if (!ids.length) return Response.json({ claimed: [] });

  // R1 dual-write: RPC claim sets status=processing but not pipeline_stage.
  await supabase
    .from("product_drafts")
    .update({ pipeline_stage: mapStatusToPipelineStage("processing") })
    .in("id", ids);

  const { data: draftRowsWithImages, error: readError } = await supabase
    .from("product_drafts")
    .select("*, product_images(*)")
    .in("id", ids);

  if (readError) return jsonError(readError.message, 500);
  const draftsWithImages = (draftRowsWithImages ?? []) as ClaimedDraftWithImages[];

  await supabase.from("generation_runs").insert(
    ids.map((draftId) => ({
      draft_id: draftId,
      mode: "codex_skill",
      provider: "codex",
      rule_version: ruleVersion,
      worker_id: workerId,
      status: "processing",
      input_payload: draftsWithImages.find((draft) => draft.id === draftId) ?? {},
      started_at: new Date().toISOString()
    }))
  );

  await supabase.from("automation_logs").insert(
    ids.map((draftId) => ({
      draft_id: draftId,
      action: "worker.claim",
      status: "processing",
      message: `Claimed by ${workerId} with ${ruleVersion}`
    }))
  );

  return Response.json({ claimed: draftsWithImages.length ? draftsWithImages : claimedDrafts });
}
