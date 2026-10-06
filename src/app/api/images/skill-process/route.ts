import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import {
  resolveAuthorizedDraftId,
  resolveRequestPrincipal
} from "@/lib/api/requestPrincipal";
import { jsonError } from "@/lib/api/auth";
import { appendGenerationCostUsd } from "@/lib/images/detailCompose/cost";
import { renderAdCreativeCard } from "@/lib/images/adCreative";
import { fetchServerImage } from "@/lib/images/fetchServerImage";
import {
  buildGeneratedStoragePath,
  ownerSegmentFromOriginalPath,
  storagePathFromProductImagesPublicUrl
} from "@/lib/images/imagePipeline";
import {
  buildImageSkillPrompt,
  imageSkillUsesApi,
  isImageSkillQuality,
  isImageSkillStyle,
  isImageSkillTask,
  markImageSkillSource,
  qualityForSkill,
  sizeForSkill,
  type ImageSkillQuality,
  type ImageSkillStyle,
  type ImageSkillTask
} from "@/lib/images/imageSkills";
import { clearImageReviewApproved } from "@/lib/images/imageReview";
import { processImageBuffer } from "@/lib/images/sharpProcess";
import { padImageToSquare, type SquarePadBackground } from "@/lib/images/squarePad";
import { createOpenAiImageProvider } from "@/lib/providers/openai-image-provider";
import { createServiceSupabaseClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const PRODUCT_IMAGES_BUCKET = "product-images";
const MAX_REFERENCE_IMAGES = 4;

type SkillImageRow = {
  id: string;
  draft_id: string;
  image_type: string;
  original_file_url: string | null;
  processed_file_url: string | null;
  generated_file_url: string | null;
  sort_order: number | null;
};

function textValue(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function parseBackground(value: unknown): SquarePadBackground {
  return value === "white" || value === "black" ? value : "cream";
}

function imageMimeExt(mime: string): string {
  if (mime.includes("webp")) return "webp";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  return "png";
}

function sourceUrl(row: SkillImageRow): string | null {
  // Original remains the identity anchor. This avoids compounding old AI errors.
  return row.original_file_url?.trim() || row.processed_file_url?.trim() || null;
}

export async function POST(request: NextRequest) {
  const principalResult = await resolveRequestPrincipal(request, { allowWorker: false });
  if (!principalResult.ok) return principalResult.response;
  const principal = principalResult.principal;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return jsonError("Invalid JSON body", 400);

  const draftId = textValue((body as Record<string, unknown>).draftId, 100);
  if (!draftId) return jsonError("draftId is required", 400);

  const taskRaw = (body as Record<string, unknown>).task;
  if (!isImageSkillTask(taskRaw)) return jsonError("Unsupported image skill task", 400);
  const task: ImageSkillTask = taskRaw;

  const rawIds = (body as Record<string, unknown>).imageIds;
  if (!Array.isArray(rawIds) || !rawIds.every((id) => typeof id === "string")) {
    return jsonError("imageIds must be a string array", 400);
  }
  const imageIds = [...new Set(rawIds.map((id) => id.trim()).filter(Boolean))];
  if (imageIds.length < 1 || imageIds.length > MAX_REFERENCE_IMAGES) {
    return jsonError(`imageIds must contain 1-${MAX_REFERENCE_IMAGES} images`, 400);
  }

  if (
    (task === "square_pad" || task === "square_ai" || task === "hero_enhance") &&
    imageIds.length !== 1
  ) {
    return jsonError(`${task} requires exactly one source image`, 400);
  }

  const qualityRaw = (body as Record<string, unknown>).quality;
  const quality: ImageSkillQuality = isImageSkillQuality(qualityRaw) ? qualityRaw : "economy";
  const styleRaw = (body as Record<string, unknown>).style;
  const style: ImageSkillStyle = isImageSkillStyle(styleRaw) ? styleRaw : "chocho";
  const instruction = textValue((body as Record<string, unknown>).instruction, 500);
  const headline = textValue((body as Record<string, unknown>).headline, 180);
  const subline = textValue((body as Record<string, unknown>).subline, 240);
  const background = parseBackground((body as Record<string, unknown>).background);

  const authorizedDraft = await resolveAuthorizedDraftId(principal, draftId);
  if (!authorizedDraft.ok) return authorizedDraft.response;
  const canonicalDraftId = authorizedDraft.id;

  let service: ReturnType<typeof createServiceSupabaseClient>;
  try {
    service = createServiceSupabaseClient();
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Supabase unavailable", 500);
  }

  const { data: draft, error: draftError } = await service
    .from("product_drafts")
    .select(
      "id, title_zh, taobao_title, original_title, image_description, image_flags, image_status, product_highlights, product_type"
    )
    .eq("id", canonicalDraftId)
    .maybeSingle();

  if (draftError) return jsonError(draftError.message, 500);
  if (!draft) return jsonError("Draft not found", 404);

  const { data: rows, error: imageError } = await service
    .from("product_images")
    .select(
      "id, draft_id, image_type, original_file_url, processed_file_url, generated_file_url, sort_order"
    )
    .eq("draft_id", canonicalDraftId);

  if (imageError) return jsonError(imageError.message, 500);
  const allRows = (rows ?? []) as SkillImageRow[];
  const byId = new Map(allRows.map((row) => [row.id, row]));
  const images = imageIds.map((id) => byId.get(id)).filter(Boolean) as SkillImageRow[];
  if (images.length !== imageIds.length) return jsonError("One or more imageIds were not found", 404);

  const urls = images.map(sourceUrl);
  if (urls.some((url) => !url)) return jsonError("One or more source images have no usable URL", 400);
  const sourceUrls = urls as string[];
  const primary = images[0]!;
  const primaryUrl = sourceUrls[0]!;

  const title =
    (draft.title_zh as string | null)?.trim() ||
    (draft.taobao_title as string | null)?.trim() ||
    (draft.original_title as string | null)?.trim() ||
    "";
  const imageDescription = (draft.image_description as string | null) ?? null;

  let outputBuffer: Buffer;
  let outputMime = "image/webp";
  let costUsd = 0;
  let model: string | null = null;
  const warnings: string[] = [];

  try {
    if (task === "square_pad") {
      const fetched = await fetchServerImage(primaryUrl, { maxBytes: 25 * 1024 * 1024 });
      if (!fetched.ok) return jsonError(fetched.message, 400);
      const padded = await padImageToSquare(fetched.bytes, { background });
      outputBuffer = padded.buffer;
      outputMime = "image/webp";
    } else {
      const provider = createOpenAiImageProvider();
      const prompt = buildImageSkillPrompt({
        task,
        title,
        imageDescription,
        style,
        instruction,
        adHeadline: headline || null
      });
      const out = await provider.process({
        sourceImages: sourceUrls,
        imageType: task === "ad_creative" ? "generated_detail" : primary.image_type,
        task,
        prompt,
        imageDescription,
        title,
        size: sizeForSkill(task),
        quality: qualityForSkill(task, quality)
      });
      model = out.model;
      costUsd = typeof out.cost === "number" && Number.isFinite(out.cost) ? out.cost : 0;
      if (out.warning) warnings.push(out.warning);

      if (task === "ad_creative") {
        const highlights = Array.isArray(draft.product_highlights)
          ? (draft.product_highlights as unknown[]).filter((x): x is string => typeof x === "string")
          : [];
        const adHeadline = headline || highlights[0]?.trim() || title || "潮巢選物";
        const adSubline = subline || (draft.product_type as string | null)?.trim() || "";
        const card = await renderAdCreativeCard(out.resultBytes, {
          headline: adHeadline.slice(0, 180),
          subline: adSubline.slice(0, 240),
          eyebrow: "CHOCHO NESTORY"
        });
        outputBuffer = card.buffer;
        outputMime = "image/webp";
        warnings.push(...card.fontWarnings);
      } else {
        const normalized = await processImageBuffer(out.resultBytes, {
          square: false,
          maxLongEdge: 2048,
          quality: 88
        });
        outputBuffer = normalized.buffer;
        outputMime = "image/webp";
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonError(message.slice(0, 600), 500);
  }

  if (task === "ad_creative") {
    const imageId = randomUUID();
    const originalPath = storagePathFromProductImagesPublicUrl(primary.original_file_url || primaryUrl);
    const owner = ownerSegmentFromOriginalPath(originalPath, "system");
    const storagePath = buildGeneratedStoragePath({
      ownerSegment: owner,
      draftId: canonicalDraftId,
      imageId,
      ext: "webp"
    }).replace("/generated/", "/generated_detail/");

    const { error: uploadError } = await service.storage
      .from(PRODUCT_IMAGES_BUCKET)
      .upload(storagePath, outputBuffer, { contentType: outputMime, upsert: true });
    if (uploadError) return jsonError(`storage upload failed: ${uploadError.message}`, 500);
    const { data: publicData } = service.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath);
    const publicUrl = publicData.publicUrl;

    const maxSort = allRows.reduce(
      (max, row) => Math.max(max, Number(row.sort_order) || 0),
      0
    );

    const { error: insertError } = await service.from("product_images").insert({
      id: imageId,
      draft_id: canonicalDraftId,
      image_type: "generated_detail",
      original_file_url: primaryUrl,
      processed_file_url: publicUrl,
      generated_file_url: publicUrl,
      alt_text: `${title || "潮巢商品"} 廣告詳情圖`,
      sort_order: maxSort + 10,
      processing_status: "done",
      processing_error: null,
      process_intent: null,
      is_spec_process: false
    });
    if (insertError) return jsonError(insertError.message, 500);

    const nextFlags = clearImageReviewApproved(draft.image_flags);
    await service
      .from("product_drafts")
      .update({ image_flags: nextFlags })
      .eq("id", canonicalDraftId);

    if (costUsd > 0) await appendGenerationCostUsd(service, canonicalDraftId, costUsd);

    return Response.json({
      ok: true,
      draftId: canonicalDraftId,
      task,
      imageId,
      processedFileUrl: publicUrl,
      usedApi: imageSkillUsesApi(task),
      quality,
      model,
      estimatedCostUsd: costUsd,
      warnings
    });
  }

  const originalPath = storagePathFromProductImagesPublicUrl(primary.original_file_url || primaryUrl);
  const owner = ownerSegmentFromOriginalPath(originalPath, "system");
  const storagePath = buildGeneratedStoragePath({
    ownerSegment: owner,
    draftId: canonicalDraftId,
    imageId: primary.id,
    ext: imageMimeExt(outputMime)
  });

  const { error: uploadError } = await service.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(storagePath, outputBuffer, { contentType: outputMime, upsert: true });
  if (uploadError) return jsonError(`storage upload failed: ${uploadError.message}`, 500);
  const { data: publicData } = service.storage.from(PRODUCT_IMAGES_BUCKET).getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;

  const { error: updateImageError } = await service
    .from("product_images")
    .update({
      generated_file_url: publicUrl,
      processed_file_url: publicUrl,
      processing_status: "done",
      processing_error: null,
      process_intent: "keep"
    })
    .eq("id", primary.id);
  if (updateImageError) return jsonError(updateImageError.message, 500);

  const nextFlags = markImageSkillSource(
    clearImageReviewApproved(draft.image_flags),
    primary.id,
    task
  );
  const { error: draftUpdateError } = await service
    .from("product_drafts")
    .update({ image_flags: nextFlags })
    .eq("id", canonicalDraftId);
  if (draftUpdateError) return jsonError(draftUpdateError.message, 500);

  if (costUsd > 0) await appendGenerationCostUsd(service, canonicalDraftId, costUsd);

  return Response.json({
    ok: true,
    draftId: canonicalDraftId,
    task,
    imageId: primary.id,
    processedFileUrl: publicUrl,
    usedApi: imageSkillUsesApi(task),
    quality,
    model,
    estimatedCostUsd: costUsd,
    warnings
  });
}
