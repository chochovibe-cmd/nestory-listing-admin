/**
 * CAP-1: orchestrate dedupe → insert draft → image fetch → variants.
 * CAP-2.6: fetch images (incl. variant thumbs) before persistVariants so image_id can bind.
 * Token-auth only; uses service role client.
 */
import { extractUrlMatchKey, queryDuplicateMatches } from "@/lib/drafts/checkDuplicate";
import { persistVariantsSafe } from "@/lib/variants/variantPersist";
import type {
  CaptureImportBody,
  CaptureImportCreated,
  CaptureImportExists
} from "@/lib/import/captureTypes";
import { mapCaptureToDraftFields } from "@/lib/import/mapCaptureFields";
import {
  applyVariantImageIds,
  fetchAndStoreCaptureImages
} from "@/lib/import/fetchRemoteImages";
import { captureOpenPath } from "@/lib/drafts/mapDraftToWorkspaceForm";

export type CreateCaptureDraftResult =
  | CaptureImportCreated
  | CaptureImportExists
  | { ok: false; error: string; message: string; status: number };

function openPathForDraft(draftId: string): string {
  // CAP-2.5: workbench form with server seed (not legacy /drafts/[id] detail)
  return captureOpenPath(draftId);
}

function isMissingColumnError(message: string): boolean {
  return /raw_capture|capture_token|column .* does not exist/i.test(message);
}

/**
 * Hard-block on same source_url (A12 key), excluding archived drafts.
 */
export async function findExistingCaptureDraft(
  serviceSupabase: { from: (table: string) => any },
  sourceUrl: string
): Promise<{ id: string; createdAt: string } | null> {
  const { urlMatches } = await queryDuplicateMatches(serviceSupabase, {
    sourceUrl
  });
  const active = urlMatches
    .filter((m) => m.status !== "archived")
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (!active.length) return null;
  return { id: active[0].id, createdAt: active[0].createdAt };
}

export async function createCaptureDraft(input: {
  serviceSupabase: any;
  userId: string;
  body: CaptureImportBody;
}): Promise<CreateCaptureDraftResult> {
  const sourceUrl = (input.body.source_url ?? "").trim();
  if (!sourceUrl) {
    return {
      ok: false,
      error: "missing_source_url",
      message: "source_url 必填（查重鍵）",
      status: 400
    };
  }

  // Basic URL shape (not full SSRF — source_url is stored, images gated separately)
  try {
    // eslint-disable-next-line no-new
    new URL(sourceUrl);
  } catch {
    return {
      ok: false,
      error: "invalid_source_url",
      message: "source_url 不是合法網址",
      status: 400
    };
  }

  let existing: { id: string; createdAt: string } | null;
  try {
    existing = await findExistingCaptureDraft(input.serviceSupabase, sourceUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      error: "dedupe_failed",
      message: `查重失敗：${msg}`,
      status: 500
    };
  }

  if (existing) {
    return {
      ok: true,
      status: "exists",
      draft_id: existing.id,
      open_path: openPathForDraft(existing.id),
      message: "已存在草稿，未重複落稿"
    };
  }

  const mapped = mapCaptureToDraftFields(input.body, { userId: input.userId });
  const urlKey = extractUrlMatchKey(sourceUrl);

  // Annotate raw_capture.server with url key before insert
  const rawCapture = {
    ...mapped.rawCapture,
    server: {
      ...(mapped.rawCapture.server as Record<string, unknown>),
      url_match_key: urlKey || null
    }
  };
  const draftRow = { ...mapped.draftRow, raw_capture: rawCapture };

  const { data: inserted, error: insertError } = await input.serviceSupabase
    .from("product_drafts")
    .insert(draftRow)
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    const msg = insertError?.message ?? "insert failed";
    if (isMissingColumnError(msg)) {
      return {
        ok: false,
        error: "migration_required",
        message: "請先在 Supabase SQL Editor 執行 migration 036（raw_capture／token 欄位）",
        status: 503
      };
    }
    return {
      ok: false,
      error: "insert_failed",
      message: `建立草稿失敗：${msg}`,
      status: 500
    };
  }

  const draftId = inserted.id as string;
  const warnings = [...mapped.warnings];

  // CAP-2.6: images first (main/detail/variant) → url→image_id map → then variants
  let imagesOk = 0;
  let imagesFailed = 0;
  let urlToImageId: Record<string, string> = {};
  let imageFetchLog: unknown[] = [];

  try {
    const imgResult = await fetchAndStoreCaptureImages({
      serviceSupabase: input.serviceSupabase,
      userId: input.userId,
      draftId,
      sourceUrl,
      mainImageUrls: mapped.mainImageUrls,
      detailImageUrls: mapped.detailImageUrls,
      variantImageUrls: mapped.variantImageUrls
    });
    imagesOk = imgResult.okCount;
    imagesFailed = imgResult.failedCount;
    urlToImageId = imgResult.urlToImageId ?? {};
    imageFetchLog = imgResult.imageFetchLog;
    warnings.push(...imgResult.warnings);
  } catch (err) {
    // Fetch pipeline must never block variant write (Fable CAP-2.6 risk #2)
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`圖片代抓流程異常（草稿已建，款式仍會寫入）：${msg}`);
    urlToImageId = {};
  }

  // Variants after images so image_id can bind; all image failures → image_id omitted/null
  if (mapped.variantRows.length > 0) {
    const withImages = applyVariantImageIds(mapped.variantRows, urlToImageId);
    const withDraft = withImages.map((r) => ({ ...r, draft_id: draftId }));
    const vr = await persistVariantsSafe(input.serviceSupabase, draftId, withDraft);
    if (!vr.ok) {
      warnings.push(`款式寫入失敗（草稿已建）：${vr.error}`);
    }
  }

  // Patch raw_capture.server.image_fetch + warnings on draft
  try {
    const nextRaw = {
      ...rawCapture,
      server: {
        ...(rawCapture.server as Record<string, unknown>),
        image_fetch: imageFetchLog,
        warnings: [
          ...(((rawCapture.server as Record<string, unknown>)?.warnings as string[]) ?? []),
          ...warnings.filter((w) =>
            /圖片|代抓|Storage|image/i.test(w)
          )
        ]
      }
    };

    const { error: patchError } = await input.serviceSupabase
      .from("product_drafts")
      .update({
        warnings,
        raw_capture: nextRaw
      })
      .eq("id", draftId);

    if (patchError) {
      warnings.push(`更新 raw_capture／warnings 失敗：${patchError.message}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    warnings.push(`更新 raw_capture 異常：${msg}`);
    await input.serviceSupabase
      .from("product_drafts")
      .update({ warnings })
      .eq("id", draftId)
      .then(() => null)
      .catch(() => null);
  }

  const filled = {
    ...mapped.filled,
    main_images: imagesOk > 0 ? mapped.filled.main_images : mapped.filled.main_images,
    detail_images: mapped.filled.detail_images
  };

  return {
    ok: true,
    status: "created",
    draft_id: draftId,
    open_path: openPathForDraft(draftId),
    filled,
    warnings,
    images: { ok: imagesOk, failed: imagesFailed }
  };
}
