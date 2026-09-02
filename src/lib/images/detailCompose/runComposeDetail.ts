/**
 * SYN-1 core: compose one generated_detail image for a draft.
 * R3-A default: original main product as hero (zero AI).
 * R3-B optional via DETAIL_COMPOSE_BASE_MODE=edits.
 * Output: Supabase temp only (F — no Shopify Files unless listing retain).
 */

import { randomUUID } from "node:crypto";
import {
  appendGenerationCostUsd,
  type CostServiceClient
} from "@/lib/images/detailCompose/cost";
import { isGenerateDetailEnabled } from "@/lib/images/detailCompose/flags";
import { prepareDetailComposeCopy } from "@/lib/images/detailCompose/prepareCopy";
import { rasterizeDetailComposeSvg } from "@/lib/images/detailCompose/rasterize";
import {
  buildGeneratedStoragePath,
  ownerSegmentFromOriginalPath,
  storagePathFromProductImagesPublicUrl
} from "@/lib/images/imagePipeline";
import { fetchServerImage } from "@/lib/images/fetchServerImage";
import {
  createOpenAiImageProvider,
  estimateImageCostUsd,
  getOpenAiImageModel,
  getOpenAiImageQuality,
  modelSupportsImageEdit
} from "@/lib/providers/openai-image-provider";
import type { ImageProvider } from "@/lib/providers/image";

const PRODUCT_IMAGES_BUCKET = "product-images";

/** Service-role (or any) Supabase client used by compose; avoid importing next/headers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ComposeDetailServiceClient = CostServiceClient & { storage: any };

type ComposeImageRow = {
  id: string;
  image_type: string;
  sort_order: number | null;
  original_file_url: string | null;
  processed_file_url: string | null;
  generated_file_url: string | null;
};

export type RunComposeDetailInput = {
  serviceSupabase: ComposeDetailServiceClient;
  draftId: string;
  /**
   * Force run even if generate_detail flag is off (manual API).
   * Default false — respects flag.
   */
  force?: boolean;
  /** Inject for tests. */
  imageProvider?: ImageProvider;
  /** Skip storage/db (unit tests). */
  dryRun?: boolean;
};

export type RunComposeDetailResult =
  | {
      ok: true;
      draftId: string;
      status: "done" | "skipped";
      reason?: string;
      imageId?: string;
      processedFileUrl?: string | null;
      storage?: "supabase_temp" | "none";
      baseMode: "original" | "edits" | "none";
      costUsd: number;
      warnings: string[];
      reviewBadge?: string | null;
      width?: number;
      height?: number;
      textInkOk?: boolean;
    }
  | {
      ok: false;
      draftId: string;
      error: string;
      httpStatus: number;
      warnings?: string[];
      baseMode?: "original" | "edits" | "none";
      costUsd?: number;
    };

function baseModeFromEnv(): "original" | "edits" {
  const v = process.env.DETAIL_COMPOSE_BASE_MODE?.trim().toLowerCase();
  if (v === "edits" || v === "r3b" || v === "b") return "edits";
  return "original";
}

async function fetchAsDataUri(url: string): Promise<string | null> {
  try {
    const fetched = await fetchServerImage(url, { maxBytes: 12 * 1024 * 1024 });
    if (!fetched.ok) return null;
    return `data:${fetched.contentType};base64,${fetched.bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

async function appendDraftWarning(
  serviceSupabase: ComposeDetailServiceClient,
  draftId: string,
  line: string
): Promise<void> {
  try {
    const { data } = await serviceSupabase
      .from("product_drafts")
      .select("warnings")
      .eq("id", draftId)
      .maybeSingle();
    const list = Array.isArray(data?.warnings)
      ? (data!.warnings as string[]).filter((w) => typeof w === "string")
      : [];
    const trimmed = line.trim().slice(0, 200);
    if (!trimmed || list.includes(trimmed)) return;
    list.push(trimmed);
    await serviceSupabase
      .from("product_drafts")
      .update({ warnings: list.slice(-30) })
      .eq("id", draftId);
  } catch {
    // best-effort
  }
}

/**
 * Compose detail long image for one draft.
 */
export async function runComposeDetailForDraft(
  input: RunComposeDetailInput
): Promise<RunComposeDetailResult> {
  const draftId = input.draftId?.trim();
  if (!draftId) {
    return { ok: false, draftId: "", error: "draftId is required", httpStatus: 400 };
  }

  const { serviceSupabase } = input;
  const warnings: string[] = [];
  let costUsd = 0;
  let baseMode: "original" | "edits" | "none" = "none";

  const { data: draft, error: draftError } = await serviceSupabase
    .from("product_drafts")
    .select(
      "id, title_zh, product_brand, product_type, ip_name, character_name, product_highlights, spec_text, description_html, description_plain, image_flags, warnings, generation_cost_estimate"
    )
    .eq("id", draftId)
    .maybeSingle();

  if (draftError) {
    return { ok: false, draftId, error: draftError.message, httpStatus: 500 };
  }
  if (!draft) {
    return { ok: false, draftId, error: "Draft not found", httpStatus: 404 };
  }

  if (!input.force && !isGenerateDetailEnabled(draft.image_flags)) {
    return {
      ok: true,
      draftId,
      status: "skipped",
      reason: "generate_detail=false",
      baseMode: "none",
      costUsd: 0,
      warnings: []
    };
  }

  const copy = prepareDetailComposeCopy({
    titleZh: draft.title_zh as string | null,
    productBrand: draft.product_brand as string | null,
    ipName: draft.ip_name as string | null,
    characterName: draft.character_name as string | null,
    productType: draft.product_type as string | null,
    productHighlights: draft.product_highlights as string[] | null,
    specText: draft.spec_text as string | null,
    descriptionHtml: draft.description_html as string | null,
    descriptionPlain: draft.description_plain as string | null
  });

  // Hero source: main processed > original
  const { data: images, error: imgErr } = await serviceSupabase
    .from("product_images")
    .select(
      "id, image_type, sort_order, original_file_url, processed_file_url, generated_file_url"
    )
    .eq("draft_id", draftId)
    .order("sort_order", { ascending: true });

  if (imgErr) {
    return { ok: false, draftId, error: imgErr.message, httpStatus: 500 };
  }

  const rows = (images ?? []) as ComposeImageRow[];
  const mains = rows.filter((r: ComposeImageRow) => r.image_type === "main");
  const main =
    mains.find((r: ComposeImageRow) => r.processed_file_url) ||
    mains.find((r: ComposeImageRow) => r.original_file_url) ||
    rows.find((r: ComposeImageRow) => r.processed_file_url || r.original_file_url);

  const mainUrl =
    (main?.processed_file_url as string | null) ||
    (main?.original_file_url as string | null) ||
    (main?.generated_file_url as string | null) ||
    null;

  let heroHref: string | null = null;
  let reviewBadge: string | null = null;
  baseMode = baseModeFromEnv();

  if (baseMode === "edits" && mainUrl) {
    // R3-B: AI no-text base — fidelity risk; mark for image review
    if (!modelSupportsImageEdit()) {
      warnings.push(
        "詳情圖 R3-B 需要 edit 模型；已 fallback 原圖頭圖（R3-A）"
      );
      baseMode = "original";
    } else {
      try {
        const provider = input.imageProvider ?? createOpenAiImageProvider();
        const out = await provider.process({
          sourceImages: [mainUrl],
          imageType: "generated_detail",
          task: "de_text",
          prompt:
            "Edit into a clean cream-white minimal ecommerce hero plate. " +
            "Product centered, generous empty cream zones top and bottom. " +
            "ZERO TEXT anywhere. Keep product shape/colors faithful. Tall portrait."
        });
        const b64 = out.resultBytes.toString("base64");
        heroHref = `data:${out.mimeType || "image/png"};base64,${b64}`;
        const c =
          typeof out.cost === "number" && Number.isFinite(out.cost)
            ? out.cost
            : estimateImageCostUsd(getOpenAiImageModel(), getOpenAiImageQuality());
        costUsd += c;
        reviewBadge = "合成底";
        if (out.warning) warnings.push(out.warning);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        warnings.push(`詳情圖 AI 底失敗，改用原圖：${msg.slice(0, 80)}`);
        baseMode = "original";
      }
    }
  }

  if (baseMode === "original") {
    if (mainUrl) {
      heroHref = await fetchAsDataUri(mainUrl);
      if (!heroHref) {
        // fall back to remote URL in SVG (may fail offline)
        heroHref = mainUrl;
        warnings.push("詳情圖頭圖改嵌遠端 URL（本機 data URI 失敗）");
      }
    } else {
      warnings.push("詳情圖無主圖可嵌，頭圖區留白");
    }
  }

  let raster;
  try {
    raster = await rasterizeDetailComposeSvg({
      copy,
      heroHref,
      reviewBadge
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await appendDraftWarning(serviceSupabase, draftId, `詳情圖合成失敗：${msg.slice(0, 80)}`);
    return {
      ok: false,
      draftId,
      error: msg,
      httpStatus: 500,
      warnings,
      baseMode,
      costUsd
    };
  }

  warnings.push(...raster.fontWarnings);
  if (!raster.textInkOk) {
    warnings.push(
      raster.textInkWarning ||
        "詳情圖 CJK 字型探測失敗，請檢查 server 字型"
    );
  }

  if (input.dryRun) {
    return {
      ok: true,
      draftId,
      status: "done",
      reason: "dryRun",
      baseMode,
      costUsd,
      warnings,
      reviewBadge,
      width: raster.width,
      height: raster.height,
      textInkOk: raster.textInkOk,
      storage: "none"
    };
  }

  const imageId = randomUUID();
  const originalPath = storagePathFromProductImagesPublicUrl(mainUrl);
  const owner = ownerSegmentFromOriginalPath(originalPath, "system");
  const storagePath = buildGeneratedStoragePath({
    ownerSegment: owner,
    draftId,
    imageId,
    ext: "png"
  }).replace("/generated/", "/generated_detail/");

  const { error: uploadError } = await serviceSupabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .upload(storagePath, raster.png, {
      contentType: "image/png",
      upsert: true
    });

  if (uploadError) {
    await appendDraftWarning(
      serviceSupabase,
      draftId,
      `詳情圖上傳失敗：${uploadError.message.slice(0, 80)}`
    );
    return {
      ok: false,
      draftId,
      error: `storage upload failed: ${uploadError.message}`,
      httpStatus: 500,
      warnings,
      baseMode,
      costUsd
    };
  }

  const { data: publicData } = serviceSupabase.storage
    .from(PRODUCT_IMAGES_BUCKET)
    .getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;

  // Replace any prior generated_detail rows? Keep history: insert new, high sort_order
  const maxSort = rows.reduce(
    (m: number, r: ComposeImageRow) => Math.max(m, Number(r.sort_order) || 0),
    0
  );

  const imageFlags: Record<string, string> = {
    // 回饋 45: default not on listing
    include_on_listing: "false",
    compose_base: baseMode,
    ...(reviewBadge ? { review_badge: reviewBadge } : {})
  };

  const { error: insertError } = await serviceSupabase.from("product_images").insert({
    id: imageId,
    draft_id: draftId,
    image_type: "generated_detail",
    original_file_url: mainUrl,
    processed_file_url: publicUrl,
    generated_file_url: publicUrl,
    alt_text: `${copy.title} 詳情圖`,
    sort_order: maxSort + 10,
    processing_status: "done",
    processing_error: null,
    process_intent: "keep",
    is_spec_process: false
  });

  if (insertError) {
    // Some DBs may not have extra cols — retry minimal insert
    const { error: retryErr } = await serviceSupabase.from("product_images").insert({
      id: imageId,
      draft_id: draftId,
      image_type: "generated_detail",
      processed_file_url: publicUrl,
      generated_file_url: publicUrl,
      alt_text: `${copy.title} 詳情圖`,
      sort_order: maxSort + 10,
      processing_status: "done"
    });
    if (retryErr) {
      await appendDraftWarning(
        serviceSupabase,
        draftId,
        `詳情圖寫入失敗：${retryErr.message.slice(0, 80)}`
      );
      return {
        ok: false,
        draftId,
        error: retryErr.message,
        httpStatus: 500,
        warnings,
        baseMode,
        costUsd
      };
    }
  }

  void imageFlags; // reserved for when product_images.image_flags exists

  // Cost only when AI ran
  if (costUsd > 0) {
    const costRes = await appendGenerationCostUsd(
      serviceSupabase,
      draftId,
      costUsd
    );
    if (!costRes.ok) {
      warnings.push(`詳情圖成本入帳失敗：${costRes.reason || "unknown"}`);
    }
  }

  for (const w of warnings) {
    await appendDraftWarning(serviceSupabase, draftId, w);
  }

  return {
    ok: true,
    draftId,
    status: "done",
    imageId,
    processedFileUrl: publicUrl,
    storage: "supabase_temp",
    baseMode,
    costUsd,
    warnings,
    reviewBadge,
    width: raster.width,
    height: raster.height,
    textInkOk: raster.textInkOk
  };
}
