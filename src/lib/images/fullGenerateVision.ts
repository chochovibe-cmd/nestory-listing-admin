export const VISION_EVIDENCE_MISSING_WARNING =
  "圖片辨識未成功，本次文案未使用詳情圖資訊";

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

type AnalyzeImagesPayload = {
  error?: unknown;
  warnings?: unknown;
};

function failureWarning(payload: AnalyzeImagesPayload): string {
  const detail = typeof payload.error === "string" ? payload.error.trim() : "";
  return detail
    ? `${VISION_EVIDENCE_MISSING_WARNING}：${detail}`
    : VISION_EVIDENCE_MISSING_WARNING;
}

/**
 * COPY C1.4 full-generation bridge. The endpoint owns cache validation and the
 * Vision call; this client helper only preserves the required analyze -> copy
 * request boundary and converts failures into non-blocking, honest warnings.
 */
export async function prepareVisionEvidenceForFullGenerate(
  draftId: string,
  fetcher: FetchLike = fetch,
): Promise<string[]> {
  try {
    const response = await fetcher("/api/analyze-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId }),
    });
    const payload = await response.json().catch(() => ({})) as AnalyzeImagesPayload;
    if (!response.ok) return [failureWarning(payload)];
    return Array.isArray(payload.warnings)
      ? payload.warnings.filter(
          (value: unknown): value is string => typeof value === "string" && value.trim().length > 0,
        )
      : [];
  } catch {
    return [VISION_EVIDENCE_MISSING_WARNING];
  }
}
