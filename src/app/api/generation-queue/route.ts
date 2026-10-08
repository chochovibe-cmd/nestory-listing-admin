import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";

const QUEUE_VERSION = "v1.1";
const MAX_CONCURRENCY = 2;
const LOCK_MINUTES = 10;
const IMAGE_READY_TIMEOUT_MS = 2 * 60_000;

type QueueJobKind = "full" | "regen_full" | "regen_field";

const REGEN_FIELDS = new Set([
  "enriched_title",
  "generated_description_html",
  "generated_faq_html",
  "seo_title",
  "meta_description",
  "why_we_chose_it",
  "product_highlights",
]);

type QueueInput = {
  queueVersion: typeof QUEUE_VERSION;
  jobKind?: QueueJobKind;
  title: string;
  provider: "openai" | "claude";
  mode: "test" | "llm";
  useWebSearch: boolean;
  source?: string;
  variantSummary?: string;
  tone: string;
  copyLength: "精簡" | "標準" | "詳細";
  hasImages: boolean;
  expectedImageCount?: number;
  waitForCaptureImages?: boolean;
  regenField?: string;
  regenNotes?: string;
  currentValues?: Record<string, unknown>;
};

type QueueRunRow = {
  id: string;
  draft_id: string;
  status: string;
  input_payload: QueueInput | Record<string, unknown> | null;
  created_at: string;
};

function isQueueInput(value: unknown): value is QueueInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<QueueInput>;
  return (
    input.queueVersion === QUEUE_VERSION &&
    typeof input.title === "string" &&
    (input.provider === "openai" || input.provider === "claude") &&
    (input.mode === "test" || input.mode === "llm") &&
    typeof input.useWebSearch === "boolean" &&
    typeof input.tone === "string" &&
    ["精簡", "標準", "詳細"].includes(String(input.copyLength)) &&
    typeof input.hasImages === "boolean"
  );
}

function generationProvider(provider: QueueInput["provider"]): "openai" | "anthropic" {
  return provider === "claude" ? "anthropic" : "openai";
}

function queueJobKind(input: QueueInput): QueueJobKind {
  return input.jobKind ?? "full";
}

function isRegenJob(input: QueueInput): boolean {
  return queueJobKind(input) !== "full";
}

function captureImageFetchStatus(rawCapture: unknown): string | null {
  if (!rawCapture || typeof rawCapture !== "object" || Array.isArray(rawCapture)) return null;
  const server = (rawCapture as Record<string, unknown>).server;
  if (!server || typeof server !== "object" || Array.isArray(server)) return null;
  const status = (server as Record<string, unknown>).image_fetch_status;
  return typeof status === "string" ? status : null;
}

async function requireOperator() {
  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user) {
    return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await authSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!canOperate(profile?.role)) {
    return {
      ok: false as const,
      response: Response.json({ error: "Operator role is required" }, { status: 403 }),
    };
  }

  return { ok: true as const, user };
}

async function markNetworkFailure(
  serviceSupabase: ReturnType<typeof createServiceSupabaseClient>,
  draftId: string,
  runId: string,
  message: string,
) {
  const completedAt = new Date().toISOString();
  await serviceSupabase
    .from("generation_runs")
    .update({
      status: "failed",
      error_message: message,
      completed_at: completedAt,
    })
    .eq("id", runId)
    .eq("draft_id", draftId);

  await serviceSupabase
    .from("product_drafts")
    .update({
      status: "failed",
      pipeline_stage: mapStatusToPipelineStage("failed"),
      generation_status: "failed",
      generation_error: message,
      worker_id: null,
      worker_locked_at: null,
      worker_lock_expires_at: null,
      next_retry_at: null,
    })
    .eq("id", draftId);
}

export async function POST(request: NextRequest) {
  const auth = await requireOperator();
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";
  const serviceSupabase = createServiceSupabaseClient();

  if (action === "enqueue") {
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    const rawInput = body.input;
    if (!draftId || !isQueueInput(rawInput)) {
      return Response.json({ error: "draftId and valid queue input are required" }, { status: 400 });
    }

    const { data: draft, error: draftError } = await serviceSupabase
      .from("product_drafts")
      .select("id,status,generation_status,raw_capture")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return Response.json({ error: draftError?.message ?? "Draft not found" }, { status: 404 });
    }
    if (draft.status !== "pending_copy" || draft.generation_status !== "pending") {
      return Response.json(
        { error: "Draft is not ready to enqueue", status: draft.status, generationStatus: draft.generation_status },
        { status: 409 },
      );
    }

    const { data: activeRuns, error: activeError } = await serviceSupabase
      .from("generation_runs")
      .select("id,status,input_payload")
      .eq("draft_id", draftId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (activeError) {
      return Response.json({ error: activeError.message }, { status: 500 });
    }

    const existing = (activeRuns ?? []).find((run) => isQueueInput(run.input_payload));
    if (existing) {
      return Response.json({ ok: true, queued: true, runId: existing.id, duplicate: true });
    }

    const input: QueueInput = {
      queueVersion: QUEUE_VERSION,
      title: rawInput.title.trim().slice(0, 120),
      provider: rawInput.provider,
      mode: rawInput.mode,
      useWebSearch: rawInput.useWebSearch,
      source: typeof rawInput.source === "string" && rawInput.source.trim() ? rawInput.source.trim() : undefined,
      variantSummary:
        typeof rawInput.variantSummary === "string" && rawInput.variantSummary.trim()
          ? rawInput.variantSummary.trim().slice(0, 8000)
          : undefined,
      tone: rawInput.tone.trim().slice(0, 120),
      copyLength: rawInput.copyLength,
      hasImages: rawInput.hasImages,
      expectedImageCount: Math.max(0, Math.min(100, Math.trunc(Number(rawInput.expectedImageCount ?? 0)))),
      waitForCaptureImages: captureImageFetchStatus(draft.raw_capture) === "pending",
    };

    const { data: run, error: runError } = await serviceSupabase
      .from("generation_runs")
      .insert({
        draft_id: draftId,
        mode: "api_llm",
        provider: generationProvider(input.provider),
        rule_version: "nestory-v1.1-queue",
        status: "pending",
        input_payload: input,
        created_by: auth.user.id,
      })
      .select("id")
      .single();

    if (runError || !run) {
      return Response.json({ error: runError?.message ?? "Failed to enqueue generation" }, { status: 500 });
    }

    await serviceSupabase
      .from("product_drafts")
      .update({
        generation_mode: "api_llm",
        generation_provider: generationProvider(input.provider),
        generation_status: "pending",
        generation_error: null,
        worker_id: null,
        worker_locked_at: null,
        worker_lock_expires_at: null,
        next_retry_at: null,
      })
      .eq("id", draftId);

    return Response.json({ ok: true, queued: true, runId: run.id });
  }

  if (action === "enqueue_regen") {
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    const rawInput = body.input;
    const jobKind = rawInput?.jobKind;
    if (
      !draftId ||
      !isQueueInput(rawInput) ||
      (jobKind !== "regen_full" && jobKind !== "regen_field") ||
      (jobKind === "regen_field" && !REGEN_FIELDS.has(String(rawInput.regenField ?? "")))
    ) {
      return Response.json({ error: "draftId and valid regeneration input are required" }, { status: 400 });
    }

    const { data: draft, error: draftError } = await serviceSupabase
      .from("product_drafts")
      .select("id,status")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return Response.json({ error: draftError?.message ?? "Draft not found" }, { status: 404 });
    }
    if (draft.status === "archived") {
      return Response.json({ error: "Archived draft cannot regenerate" }, { status: 409 });
    }

    const { data: activeRuns, error: activeError } = await serviceSupabase
      .from("generation_runs")
      .select("id,status,input_payload")
      .eq("draft_id", draftId)
      .in("status", ["pending", "processing"])
      .order("created_at", { ascending: false })
      .limit(10);

    if (activeError) {
      return Response.json({ error: activeError.message }, { status: 500 });
    }
    const existing = (activeRuns ?? []).find((run) => isQueueInput(run.input_payload));
    if (existing) {
      return Response.json(
        { error: "This draft already has a generation job in progress", runId: existing.id },
        { status: 409 },
      );
    }

    const input: QueueInput = {
      queueVersion: QUEUE_VERSION,
      jobKind,
      title: rawInput.title.trim().slice(0, 120),
      provider: rawInput.provider,
      mode: rawInput.mode,
      useWebSearch: rawInput.useWebSearch,
      tone: rawInput.tone.trim().slice(0, 120),
      copyLength: rawInput.copyLength,
      hasImages: false,
      regenField: jobKind === "regen_field" ? String(rawInput.regenField) : undefined,
      regenNotes:
        jobKind === "regen_full" && typeof rawInput.regenNotes === "string"
          ? rawInput.regenNotes.trim().slice(0, 2000)
          : undefined,
      currentValues:
        jobKind === "regen_field" &&
        rawInput.currentValues &&
        typeof rawInput.currentValues === "object" &&
        !Array.isArray(rawInput.currentValues)
          ? (rawInput.currentValues as Record<string, unknown>)
          : undefined,
    };

    const { data: run, error: runError } = await serviceSupabase
      .from("generation_runs")
      .insert({
        draft_id: draftId,
        mode: "api_llm",
        provider: generationProvider(input.provider),
        rule_version: "nestory-v1.1-regen",
        status: "pending",
        input_payload: input,
        created_by: auth.user.id,
      })
      .select("id")
      .single();

    if (runError || !run) {
      return Response.json({ error: runError?.message ?? "Failed to enqueue regeneration" }, { status: 500 });
    }
    return Response.json({ ok: true, queued: true, runId: run.id });
  }

  if (action === "regen_status") {
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    if (!draftId) return Response.json({ error: "draftId is required" }, { status: 400 });

    const { data: rows, error } = await serviceSupabase
      .from("generation_runs")
      .select("id,status,error_message,input_payload,created_at,started_at,completed_at")
      .eq("draft_id", draftId)
      .contains("input_payload", { queueVersion: QUEUE_VERSION })
      .order("created_at", { ascending: false })
      .limit(10);

    if (error) return Response.json({ error: error.message }, { status: 500 });
    const latest = (rows ?? []).find((row) => isQueueInput(row.input_payload) && isRegenJob(row.input_payload));
    if (!latest) return Response.json({ ok: true, regen: null });
    const input = latest.input_payload as QueueInput;
    return Response.json({
      ok: true,
      regen: latest.status === "completed"
        ? null
        : {
            runId: latest.id,
            status: latest.status,
            field: input.regenField ?? null,
            error: latest.error_message ?? null,
          },
    });
  }

  if (action === "claim") {
    const requested = Math.min(Math.max(Number(body.limit ?? MAX_CONCURRENCY), 1), MAX_CONCURRENCY);

    // Browser close / navigation can interrupt a client runner after it claimed
    // a job. Once the DB lock expires, convert that orphan into a visible failed
    // card instead of letting it consume a queue slot forever.
    const nowIso = new Date().toISOString();
    const { data: staleDrafts } = await serviceSupabase
      .from("product_drafts")
      .select("id")
      .eq("status", "processing")
      .eq("generation_status", "processing")
      .like("worker_id", "pwa-queue:%")
      .lt("worker_lock_expires_at", nowIso)
      .limit(20);

    for (const stale of staleDrafts ?? []) {
      const { data: staleRuns } = await serviceSupabase
        .from("generation_runs")
        .select("id,input_payload")
        .eq("draft_id", stale.id)
        .eq("status", "processing")
        .order("created_at", { ascending: false })
        .limit(10);
      const staleRun = (staleRuns ?? []).find((run) => isQueueInput(run.input_payload));
      if (staleRun) {
        await markNetworkFailure(
          serviceSupabase,
          stale.id,
          staleRun.id,
          "生成工作逾時中斷，已保留為失敗，可單件重試。",
        );
      }
    }

    const staleRegenBefore = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
    const { data: staleRegenRuns } = await serviceSupabase
      .from("generation_runs")
      .select("id,draft_id,input_payload,started_at")
      .eq("status", "processing")
      .contains("input_payload", { queueVersion: QUEUE_VERSION })
      .lt("started_at", staleRegenBefore)
      .limit(20);

    for (const run of staleRegenRuns ?? []) {
      if (!isQueueInput(run.input_payload) || !isRegenJob(run.input_payload)) continue;
      await serviceSupabase
        .from("generation_runs")
        .update({
          status: "failed",
          error_message: "重生工作逾時中斷，原文案保留，可重新送出。",
          completed_at: new Date().toISOString(),
        })
        .eq("id", run.id)
        .eq("status", "processing");
    }

    const { count: processingCount, error: countError } = await serviceSupabase
      .from("generation_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "processing")
      .contains("input_payload", { queueVersion: QUEUE_VERSION });

    if (countError) {
      return Response.json({ error: countError.message }, { status: 500 });
    }

    const available = Math.max(0, MAX_CONCURRENCY - Number(processingCount ?? 0));
    const claimLimit = Math.min(requested, available);
    if (claimLimit <= 0) {
      return Response.json({ ok: true, claimed: [] });
    }

    const { data: candidates, error: candidateError } = await serviceSupabase
      .from("generation_runs")
      .select("id,draft_id,status,input_payload,created_at")
      .eq("status", "pending")
      .contains("input_payload", { queueVersion: QUEUE_VERSION })
      .order("created_at", { ascending: true })
      .limit(Math.max(claimLimit * 4, claimLimit));

    if (candidateError) {
      return Response.json({ error: candidateError.message }, { status: 500 });
    }

    const claimed: Array<{ runId: string; draftId: string; input: QueueInput }> = [];

    for (const candidate of (candidates ?? []) as QueueRunRow[]) {
      if (claimed.length >= claimLimit) break;
      if (!isQueueInput(candidate.input_payload)) continue;

      const { data: draft, error: draftReadError } = await serviceSupabase
        .from("product_drafts")
        .select("id,status,generation_status,worker_id,worker_attempts,max_worker_attempts,raw_capture")
        .eq("id", candidate.draft_id)
        .single();

      if (draftReadError || !draft) continue;
      const kind = queueJobKind(candidate.input_payload);

      if (kind !== "full") {
        if (draft.status === "archived") {
          await serviceSupabase
            .from("generation_runs")
            .update({
              status: "failed",
              error_message: "Archived draft cannot regenerate",
              completed_at: new Date().toISOString(),
            })
            .eq("id", candidate.id)
            .eq("status", "pending");
          continue;
        }

        const workerId = `pwa-regen:${auth.user.id.slice(0, 8)}:${crypto.randomUUID().slice(0, 8)}`;
        const { data: lockedRun, error: runLockError } = await serviceSupabase
          .from("generation_runs")
          .update({
            status: "processing",
            worker_id: workerId,
            started_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", candidate.id)
          .eq("status", "pending")
          .select("id")
          .maybeSingle();

        if (!runLockError && lockedRun) {
          claimed.push({
            runId: candidate.id,
            draftId: candidate.draft_id,
            input: candidate.input_payload,
          });
        }
        continue;
      }

      if (
        draft.status !== "pending_copy" ||
        draft.generation_status !== "pending" ||
        draft.worker_id !== null
      ) {
        continue;
      }

      const queuedAt = Date.parse(candidate.created_at);
      const queuedAgeMs = Number.isFinite(queuedAt) ? Math.max(0, Date.now() - queuedAt) : 0;
      const captureStatus = captureImageFetchStatus(draft.raw_capture);

      if (candidate.input_payload.waitForCaptureImages && captureStatus === "pending") {
        if (queuedAgeMs >= IMAGE_READY_TIMEOUT_MS) {
          await markNetworkFailure(
            serviceSupabase,
            candidate.draft_id,
            candidate.id,
            "擷取圖片背景處理逾時，草稿已保留，可補圖後單件重試。",
          );
        }
        continue;
      }

      const expectedImageCount = Math.max(
        0,
        Math.trunc(Number(candidate.input_payload.expectedImageCount ?? 0)),
      );
      if (expectedImageCount > 0) {
        const { count: uploadedImageCount, error: imageCountError } = await serviceSupabase
          .from("product_images")
          .select("id", { count: "exact", head: true })
          .eq("draft_id", candidate.draft_id)
          .in("image_type", ["main", "detail"]);

        if (imageCountError) continue;
        if (Number(uploadedImageCount ?? 0) < expectedImageCount) {
          if (queuedAgeMs >= IMAGE_READY_TIMEOUT_MS) {
            await markNetworkFailure(
              serviceSupabase,
              candidate.draft_id,
              candidate.id,
              `圖片背景上傳未完成（${Number(uploadedImageCount ?? 0)}/${expectedImageCount}），草稿已保留，可補圖後單件重試。`,
            );
          }
          continue;
        }
      }

      if (Number(draft.worker_attempts ?? 0) >= Number(draft.max_worker_attempts ?? 3)) {
        await markNetworkFailure(
          serviceSupabase,
          candidate.draft_id,
          candidate.id,
          "生成重試次數已達上限，請手動重試。",
        );
        continue;
      }

      const workerId = `pwa-queue:${auth.user.id.slice(0, 8)}:${crypto.randomUUID().slice(0, 8)}`;
      const now = new Date();
      const lockExpiresAt = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
      const attempts = Number(draft.worker_attempts ?? 0) + 1;

      const { data: lockedDraft, error: lockError } = await serviceSupabase
        .from("product_drafts")
        .update({
          status: "processing",
          pipeline_stage: mapStatusToPipelineStage("processing"),
          generation_status: "processing",
          generation_error: null,
          worker_id: workerId,
          worker_locked_at: now.toISOString(),
          worker_lock_expires_at: lockExpiresAt,
          worker_attempts: attempts,
        })
        .eq("id", candidate.draft_id)
        .eq("status", "pending_copy")
        .eq("generation_status", "pending")
        .is("worker_id", null)
        .select("id")
        .maybeSingle();

      if (lockError || !lockedDraft) continue;

      const { data: lockedRun, error: runLockError } = await serviceSupabase
        .from("generation_runs")
        .update({
          status: "processing",
          worker_id: workerId,
          started_at: now.toISOString(),
          error_message: null,
        })
        .eq("id", candidate.id)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();

      if (runLockError || !lockedRun) {
        await serviceSupabase
          .from("product_drafts")
          .update({
            status: "pending_copy",
            pipeline_stage: mapStatusToPipelineStage("pending_copy"),
            generation_status: "pending",
            worker_id: null,
            worker_locked_at: null,
            worker_lock_expires_at: null,
            worker_attempts: Math.max(0, attempts - 1),
          })
          .eq("id", candidate.draft_id)
          .eq("worker_id", workerId);
        continue;
      }

      claimed.push({
        runId: candidate.id,
        draftId: candidate.draft_id,
        input: candidate.input_payload,
      });
    }

    return Response.json({ ok: true, claimed });
  }

  if (action === "fail") {
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    const runId = typeof body.runId === "string" ? body.runId : "";
    const message =
      typeof body.error === "string" && body.error.trim()
        ? body.error.trim().slice(0, 2000)
        : "Generation queue request failed";

    if (!draftId || !runId) {
      return Response.json({ error: "draftId and runId are required" }, { status: 400 });
    }

    const { data: run } = await serviceSupabase
      .from("generation_runs")
      .select("input_payload")
      .eq("id", runId)
      .eq("draft_id", draftId)
      .maybeSingle();
    const input = run && isQueueInput(run.input_payload) ? run.input_payload : null;

    if (input && isRegenJob(input)) {
      await serviceSupabase
        .from("generation_runs")
        .update({
          status: "failed",
          error_message: message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", runId)
        .eq("draft_id", draftId);
    } else {
      await markNetworkFailure(serviceSupabase, draftId, runId, message);
    }
    return Response.json({ ok: true, status: "failed" });
  }

  if (action === "retry") {
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    if (!draftId) {
      return Response.json({ error: "draftId is required" }, { status: 400 });
    }

    const { data: draft, error: draftError } = await serviceSupabase
      .from("product_drafts")
      .select("id,status,generation_status")
      .eq("id", draftId)
      .single();

    if (draftError || !draft) {
      return Response.json({ error: draftError?.message ?? "Draft not found" }, { status: 404 });
    }
    if (draft.status !== "failed" || draft.generation_status !== "failed") {
      return Response.json({ error: "Only failed queued generations can be retried" }, { status: 409 });
    }

    const { data: priorRuns, error: priorError } = await serviceSupabase
      .from("generation_runs")
      .select("id,input_payload,provider")
      .eq("draft_id", draftId)
      .eq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(10);

    if (priorError) {
      return Response.json({ error: priorError.message }, { status: 500 });
    }

    const prior = (priorRuns ?? []).find((run) => isQueueInput(run.input_payload));
    if (!prior || !isQueueInput(prior.input_payload)) {
      return Response.json({ error: "No retryable V1.1 queue request found" }, { status: 409 });
    }

    const { data: run, error: insertError } = await serviceSupabase
      .from("generation_runs")
      .insert({
        draft_id: draftId,
        mode: "api_llm",
        provider: prior.provider,
        rule_version: "nestory-v1.1-queue",
        status: "pending",
        input_payload: prior.input_payload,
        created_by: auth.user.id,
      })
      .select("id")
      .single();

    if (insertError || !run) {
      return Response.json({ error: insertError?.message ?? "Failed to queue retry" }, { status: 500 });
    }

    const { error: retryError } = await serviceSupabase
      .from("product_drafts")
      .update({
        status: "pending_copy",
        pipeline_stage: mapStatusToPipelineStage("pending_copy"),
        generation_status: "pending",
        generation_error: null,
        worker_id: null,
        worker_locked_at: null,
        worker_lock_expires_at: null,
        worker_attempts: 0,
        next_retry_at: null,
      })
      .eq("id", draftId);

    if (retryError) {
      await serviceSupabase.from("generation_runs").update({
        status: "failed",
        error_message: retryError.message,
        completed_at: new Date().toISOString(),
      }).eq("id", run.id);
      return Response.json({ error: retryError.message }, { status: 500 });
    }

    return Response.json({ ok: true, queued: true, runId: run.id });
  }

  return Response.json({ error: "Unknown generation queue action" }, { status: 400 });
}
