/**
 * PUBLISH-BATCH: publish ONE item of a stepwise batch per request.
 *
 * The client creates the batch with POST /api/drafts/batch/publish { stepwise:true } and
 * then calls this route repeatedly until it answers done:true. One item per request keeps
 * every publish inside its own 60s budget, so a slow first image upload can no longer
 * strand the rest of the batch.
 *
 * Auth: admin | reviewer (canPublish), same live-test guard as the batch route.
 */
import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import { stepPublishBatch } from "@/lib/shopify/publishBatchStepwise";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const { batchId } = await params;

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Reviewer role is required to publish" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();
  const result = await stepPublishBatch({
    serviceSupabase,
    batchId,
    actorId: user.id
  });

  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json(result);
}
