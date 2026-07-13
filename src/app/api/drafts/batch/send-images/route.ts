/**
 * B14 + D2-open: create image_batches + items, then optional auto chain.
 *
 * - Create batch (status queued) when marks ready
 * - D2: runSendImagesAutoChain (all-keep → sharp → finalize in-process; no HTTP self-fetch)
 * - Optional MAKE_WEBHOOK_URL notifyMake("image_batch_submitted"); missing/fail never 500
 * - Does not invent fake CDN URLs
 */
import { NextRequest } from "next/server";
import { canOperate } from "@/lib/auth/roles";
import {
  evaluateCreateImageBatch,
  type ImageBatchItemInput
} from "@/lib/drafts/createImageBatch";
import {
  formatAutoChainOperatorMessage,
  runSendImagesAutoChain
} from "@/lib/images/sendImagesAutoChain";
import { notifyMake } from "@/lib/notifications/make";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const draftIds: unknown = body.draftIds;

  if (!Array.isArray(draftIds) || draftIds.length === 0 || !draftIds.every((id) => typeof id === "string")) {
    return Response.json({ error: "draftIds must be a non-empty string array" }, { status: 400 });
  }

  const uniqueIds = [...new Set(draftIds as string[])];

  const authSupabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
  if (!canOperate(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Operator role is required" }, { status: 403 });
  }

  const serviceSupabase = createServiceSupabaseClient();

  const { data: drafts, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, original_title")
    .in("id", uniqueIds);

  if (draftError) {
    return Response.json({ error: draftError.message }, { status: 500 });
  }

  const { data: images, error: imageError } = await serviceSupabase
    .from("product_images")
    .select("id, draft_id, image_type, process_intent, is_spec_process, sort_order, created_at")
    .in("draft_id", uniqueIds)
    .order("sort_order", { ascending: true });

  if (imageError) {
    return Response.json(
      {
        error: imageError.message,
        hint:
          imageError.message.includes("process_intent") || imageError.message.includes("is_spec_process")
            ? "請先在 Supabase SQL Editor 執行 migration 019（圖片標記欄位）。"
            : undefined
      },
      { status: 500 }
    );
  }

  const imagesByDraft = new Map<string, NonNullable<typeof images>>();
  for (const row of images ?? []) {
    const list = imagesByDraft.get(row.draft_id) ?? [];
    list.push(row);
    imagesByDraft.set(row.draft_id, list);
  }

  const draftById = new Map((drafts ?? []).map((d) => [d.id, d]));

  const items: ImageBatchItemInput[] = uniqueIds.map((id) => {
    const draft = draftById.get(id);
    const title =
      draft?.title_zh?.trim() ||
      draft?.taobao_title?.trim() ||
      draft?.original_title?.trim() ||
      (draft ? "未命名草稿" : "找不到草稿");
    return {
      draftId: id,
      title,
      images: (imagesByDraft.get(id) ?? []).map((img) => ({
        id: img.id,
        image_type: img.image_type,
        process_intent: img.process_intent,
        is_spec_process: img.is_spec_process ?? false,
        sort_order: img.sort_order ?? 0,
        created_at: img.created_at ?? ""
      }))
    };
  });

  const knownItems = items.filter((item) => draftById.has(item.draftId));
  const missingIds = uniqueIds.filter((id) => !draftById.has(id));

  const evaluated = evaluateCreateImageBatch(knownItems);

  for (const id of missingIds) {
    evaluated.blocked.push({
      draftId: id,
      title: "找不到草稿",
      reason: "草稿不存在或無權限。"
    });
    evaluated.blockedCount += 1;
  }

  if (evaluated.readyCount === 0) {
    const blockedLines = evaluated.blocked.map((b) => `「${b.title}」：${b.reason}`);
    const message =
      blockedLines.length === 0
        ? "請先勾選商品再批次送圖。"
        : ["0 件可建立送圖批次。", `${evaluated.blockedCount} 件被擋：`, ...blockedLines].join("\n");
    return Response.json({
      ok: false,
      batchId: null,
      readyCount: 0,
      blockedCount: evaluated.blockedCount,
      blocked: evaluated.blocked,
      message
    });
  }

  const now = new Date().toISOString();
  const { data: batchRow, error: batchError } = await serviceSupabase
    .from("image_batches")
    .insert({
      kind: "image_process",
      status: "queued",
      total_count: evaluated.readyCount,
      done_count: 0,
      failed_count: 0,
      regenerate_item_count: evaluated.regenerateItemCount,
      created_by: user.id,
      created_at: now,
      updated_at: now,
      snapshot_json: evaluated.snapshot
    })
    .select("id")
    .single();

  if (batchError || !batchRow) {
    const msg = batchError?.message ?? "建立送圖批次失敗";
    const migrationHint =
      msg.includes("image_batches") || msg.includes("schema cache") || msg.includes("does not exist")
        ? "請先在 Supabase SQL Editor 執行 migration 025（送圖批次表）。"
        : undefined;
    return Response.json(
      {
        error: msg,
        hint: migrationHint
      },
      { status: 500 }
    );
  }

  const batchId = batchRow.id as string;

  const itemRows = evaluated.ready.map((item) => ({
    batch_id: batchId,
    draft_id: item.draftId,
    item_status: "queued" as const,
    created_at: now
  }));

  const { error: itemsError } = await serviceSupabase.from("image_batch_items").insert(itemRows);
  if (itemsError) {
    await serviceSupabase.from("image_batches").delete().eq("id", batchId);
    return Response.json(
      {
        error: itemsError.message,
        hint: itemsError.message.includes("image_batch_items")
          ? "請先在 Supabase SQL Editor 執行 migration 025（送圖批次表）。"
          : undefined
      },
      { status: 500 }
    );
  }

  const readyIds = evaluated.ready.map((r) => r.draftId);
  let pointerUpdateFailed = false;
  const { error: pointerError } = await serviceSupabase
    .from("product_drafts")
    .update({ current_image_batch_id: batchId })
    .in("id", readyIds);

  if (pointerError) {
    pointerUpdateFailed = true;
  }

  // D2-open: in-process auto chain (never fetch self sharp-batch/finalize URLs)
  let chain: Awaited<ReturnType<typeof runSendImagesAutoChain>> | null = null;
  let chainError: string | null = null;
  try {
    chain = await runSendImagesAutoChain({
      serviceSupabase,
      batchId,
      readyDrafts: evaluated.ready.map((r) => ({ draftId: r.draftId, title: r.title })),
      snapshot: evaluated.snapshot,
      autoFinalize: true
    });
  } catch (err) {
    // Batch already created — do not 500 the whole send
    chainError = err instanceof Error ? err.message : String(err);
    chain = null;
  }

  const blockedLines = evaluated.blocked.map((b) => `「${b.title}」：${b.reason}`);
  let message = formatAutoChainOperatorMessage({
    readyCount: evaluated.readyCount,
    blockedLines,
    chain
  });
  if (chainError) {
    message = `${message}\n（提醒：自動處理鏈發生例外，批次已建立：${chainError.slice(0, 120)}）`;
  }
  if (pointerUpdateFailed) {
    message = `${message}\n（提醒：批次已建立，但草稿指標更新失敗：${pointerError?.message}）`;
  }

  // Q3-A: one image_batch_submitted webhook after receipt (+ chain summary if any)
  await notifyMake("image_batch_submitted", {
    batchId,
    readyCount: evaluated.readyCount,
    blockedCount: evaluated.blockedCount,
    blocked: evaluated.blocked,
    regenerateItemCount: evaluated.regenerateItemCount,
    snapshot: evaluated.snapshot,
    autoChain: chain
      ? {
          policy: chain.policy,
          batchStatus: chain.batchStatus,
          doneCount: chain.doneCount,
          failedCount: chain.failedCount,
          stoppedEarly: chain.stoppedEarly,
          elapsedMs: chain.elapsedMs,
          drafts: chain.drafts.map((d) => ({
            draftId: d.draftId,
            decision: d.decision,
            outcome: d.outcome,
            sharp: d.sharp,
            finalize: d.finalize,
            reason: d.reason
          }))
        }
      : chainError
        ? { error: chainError, policy: "all_keep_then_sharp_then_finalize" }
        : null
  });

  return Response.json({
    ok: true,
    batchId,
    readyCount: evaluated.readyCount,
    blockedCount: evaluated.blockedCount,
    blocked: evaluated.blocked,
    regenerateItemCount: evaluated.regenerateItemCount,
    snapshot: evaluated.snapshot,
    autoChain: chain,
    chainError,
    message,
    pointerUpdateFailed: pointerUpdateFailed || undefined
  });
}
