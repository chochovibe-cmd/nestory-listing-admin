/**
 * D3: sharp batch for ONE draft (≤12 images).
 * Aligns with docs/自動化流程設計 Scenario 1 path /api/images/sharp-batch.
 *
 * - Auth: WORKER_API_TOKEN Bearer OR cookie session + canOperate
 * - Body: { draftId, imageIds? } — no multipart, no arbitrary external URLs
 * - keep → WebP → Supabase …/processed/{imageId}.webp → processed_file_url
 * - de_text/regenerate → skip; detail → skip; unmarked whole-draft → skip
 * - storage label: supabase_temp (NOT shopify CDN)
 */

import { NextRequest } from "next/server";
import { requireWorkerToken, jsonError } from "@/lib/api/auth";
import { canOperate } from "@/lib/auth/roles";
import {
  aggregateImageStatusAfterSharp,
  buildProcessedStoragePath,
  decideSharpAction,
  ownerSegmentFromOriginalPath,
  storagePathFromProductImagesPublicUrl,
  type ProcessedImageStorage
} from "@/lib/images/imagePipeline";
import { processImageBuffer, SHARP_BATCH_MAX_IMAGES } from "@/lib/images/sharpProcess";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { ImageProcessIntent, ImageType, UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

const PRODUCT_IMAGES_BUCKET = "product-images";
const STORAGE_LABEL: ProcessedImageStorage = "supabase_temp";

type ImageRow = {
  id: string;
  draft_id: string;
  image_type: ImageType | string;
  original_file_url: string | null;
  processed_file_url: string | null;
  process_intent: ImageProcessIntent | null;
  processing_status: string;
  sort_order: number;
};

type PerImageResult = {
  imageId: string;
  status: "done" | "skipped" | "failed";
  reason?: string;
  processedFileUrl?: string | null;
  storage?: ProcessedImageStorage;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
};

async function authorize(request: NextRequest): Promise<
  { ok: true; via: "worker" | "session" } | { ok: false; response: Response }
> {
  const worker = requireWorkerToken(request);
  if (worker.ok) return { ok: true, via: "worker" };

  // Worker token present but invalid → hard fail (do not fall through to session).
  const authHeader = request.headers.get("authorization");
  if (authHeader?.toLowerCase().startsWith("bearer ")) {
    const status = worker.error.includes("configured") ? 500 : 401;
    return { ok: false, response: jsonError(worker.error, status) };
  }

  try {
    const authSupabase = await createServerSupabaseClient();
    const {
      data: { user }
    } = await authSupabase.auth.getUser();
    if (!user) {
      return { ok: false, response: jsonError("Unauthorized", 401) };
    }
    const { data: profile } = await authSupabase.from("profiles").select("role").eq("id", user.id).single();
    if (!canOperate(profile?.role as UserRole | undefined)) {
      return { ok: false, response: jsonError("Operator role is required", 403) };
    }
    return { ok: true, via: "session" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed";
    return { ok: false, response: jsonError(message, 500) };
  }
}

async function fetchOriginalBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    // Server-side only; original must already be our Supabase public URL from DB.
    headers: { Accept: "image/*,*/*" }
  });
  if (!response.ok) {
    throw new Error(`fetch original failed: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  // Soft check — some CDNs omit type; still try buffer.
  if (contentType && !contentType.startsWith("image/") && !contentType.includes("octet-stream")) {
    throw new Error(`unexpected content-type: ${contentType}`);
  }
  const ab = await response.arrayBuffer();
  if (!ab.byteLength) {
    throw new Error("empty image body");
  }
  // Soft size guard (~25MB) to avoid memory blow-ups on free plan.
  if (ab.byteLength > 25 * 1024 * 1024) {
    throw new Error(`original too large: ${ab.byteLength} bytes`);
  }
  return Buffer.from(ab);
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if (!auth.ok) return auth.response;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return jsonError("Invalid JSON body", 400);
  }

  const draftId = typeof (body as { draftId?: unknown }).draftId === "string"
    ? (body as { draftId: string }).draftId.trim()
    : "";
  if (!draftId) {
    return jsonError("draftId is required", 400);
  }

  const rawImageIds = (body as { imageIds?: unknown }).imageIds;
  let explicitImageIds = false;
  let imageIdsFilter: string[] | null = null;
  if (rawImageIds !== undefined && rawImageIds !== null) {
    if (!Array.isArray(rawImageIds) || !rawImageIds.every((id) => typeof id === "string")) {
      return jsonError("imageIds must be a string array when provided", 400);
    }
    explicitImageIds = true;
    imageIdsFilter = [...new Set(rawImageIds.map((id) => id.trim()).filter(Boolean))];
    if (imageIdsFilter.length === 0) {
      return jsonError("imageIds is empty", 400);
    }
    if (imageIdsFilter.length > SHARP_BATCH_MAX_IMAGES) {
      return jsonError(`imageIds exceeds max ${SHARP_BATCH_MAX_IMAGES} per request`, 400);
    }
  }

  let serviceSupabase: ReturnType<typeof createServiceSupabaseClient>;
  try {
    serviceSupabase = createServiceSupabaseClient();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Supabase service client unavailable";
    return jsonError(message, 500);
  }

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select("id, image_status")
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return jsonError(draftError.message, 500);
  }
  if (!draft) {
    return jsonError("Draft not found", 404);
  }

  let query = serviceSupabase
    .from("product_images")
    .select(
      "id, draft_id, image_type, original_file_url, processed_file_url, process_intent, processing_status, sort_order"
    )
    .eq("draft_id", draftId)
    .order("sort_order", { ascending: true });

  if (imageIdsFilter) {
    query = query.in("id", imageIdsFilter);
  }

  const { data: imageRows, error: imageError } = await query;
  if (imageError) {
    return jsonError(imageError.message, 500);
  }

  const images = (imageRows ?? []) as ImageRow[];

  if (imageIdsFilter) {
    const found = new Set(images.map((r) => r.id));
    const missing = imageIdsFilter.filter((id) => !found.has(id));
    if (missing.length) {
      return jsonError(`imageIds not found on this draft: ${missing.join(", ")}`, 404);
    }
  }

  if (images.length === 0) {
    return Response.json({
      ok: true,
      draftId,
      auth: auth.via,
      processed: 0,
      skipped: 0,
      failed: 0,
      results: [],
      imageStatus: draft.image_status,
      storageDefault: STORAGE_LABEL,
      finalize: {
        status: "not_run",
        note: "Call POST /api/images/finalize for Shopify Files CDN (D1)."
      },
      message: "No product_images rows to consider."
    });
  }

  if (images.length > SHARP_BATCH_MAX_IMAGES) {
    return jsonError(
      `Draft has ${images.length} candidate rows; max ${SHARP_BATCH_MAX_IMAGES} per request. Pass imageIds to chunk.`,
      400
    );
  }

  // Mark draft processing only if we expect at least one sharp run.
  const willProcess = images.some((img) => {
    const d = decideSharpAction({
      imageType: img.image_type,
      processIntent: img.process_intent,
      originalFileUrl: img.original_file_url,
      explicitImageIds
    });
    return d.action === "process_sharp";
  });

  if (willProcess) {
    await serviceSupabase
      .from("product_drafts")
      .update({ image_status: "processing" })
      .eq("id", draftId);
  }

  const results: PerImageResult[] = [];
  let processed = 0;
  let skipped = 0;
  let failed = 0;

  for (const img of images) {
    const decision = decideSharpAction({
      imageType: img.image_type,
      processIntent: img.process_intent,
      originalFileUrl: img.original_file_url,
      explicitImageIds
    });

    if (decision.action === "skip") {
      skipped += 1;
      results.push({
        imageId: img.id,
        status: "skipped",
        reason: decision.reason,
        processedFileUrl: img.processed_file_url,
        storage: STORAGE_LABEL
      });
      continue;
    }

    // process_sharp
    try {
      await serviceSupabase
        .from("product_images")
        .update({ processing_status: "processing", processing_error: null })
        .eq("id", img.id);

      const originalUrl = img.original_file_url!.trim();
      // SSRF guard: only fetch URLs already stored on this row (from our upload path).
      // We do not accept client-supplied URLs.
      const buffer = await fetchOriginalBuffer(originalUrl);
      const out = await processImageBuffer(buffer, { square: false });

      const originalPath = storagePathFromProductImagesPublicUrl(originalUrl);
      const owner = ownerSegmentFromOriginalPath(originalPath, "system");
      const storagePath = buildProcessedStoragePath({
        ownerSegment: owner,
        draftId,
        imageId: img.id
      });

      const { error: uploadError } = await serviceSupabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .upload(storagePath, out.buffer, {
          contentType: "image/webp",
          upsert: true
        });

      if (uploadError) {
        throw new Error(`storage upload failed: ${uploadError.message}`);
      }

      const { data: publicData } = serviceSupabase.storage
        .from(PRODUCT_IMAGES_BUCKET)
        .getPublicUrl(storagePath);
      const processedUrl = publicData.publicUrl;

      const { error: updateError } = await serviceSupabase
        .from("product_images")
        .update({
          processed_file_url: processedUrl,
          processing_status: "done",
          processing_error: null
        })
        .eq("id", img.id);

      if (updateError) {
        throw new Error(`db update failed: ${updateError.message}`);
      }

      processed += 1;
      results.push({
        imageId: img.id,
        status: "done",
        reason: decision.reason,
        processedFileUrl: processedUrl,
        storage: STORAGE_LABEL,
        width: out.width,
        height: out.height,
        bytes: out.bytes
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failed += 1;
      await serviceSupabase
        .from("product_images")
        .update({
          processing_status: "failed",
          processing_error: message.slice(0, 500)
          // Do NOT overwrite processed_file_url with a fake image.
        })
        .eq("id", img.id);

      results.push({
        imageId: img.id,
        status: "failed",
        error: message,
        processedFileUrl: img.processed_file_url,
        storage: STORAGE_LABEL
      });
    }
  }

  const nextImageStatus = aggregateImageStatusAfterSharp({ processed, failed, skipped });
  let imageStatus = (draft.image_status as string) ?? "pending";
  if (nextImageStatus) {
    await serviceSupabase
      .from("product_drafts")
      .update({ image_status: nextImageStatus })
      .eq("id", draftId);
    imageStatus = nextImageStatus;
  }

  const ok = failed === 0;
  return Response.json({
    ok,
    draftId,
    auth: auth.via,
    processed,
    skipped,
    failed,
    results,
    imageStatus,
    storageDefault: STORAGE_LABEL,
    note:
      "processed_file_url is Supabase temp WebP (supabase_temp), NOT Shopify CDN until finalize.",
    finalize: {
      status: "not_run",
      note: "Call POST /api/images/finalize → stagedUploadsCreate → fileCreate → shopify_cdn (D1)."
    }
  });
}
