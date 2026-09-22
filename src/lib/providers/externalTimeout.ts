/** Bound external waits so a slow vendor cannot hold generation open forever. */

export const VISION_TIMEOUT_MS = 25_000;
export const WEB_SEARCH_TIMEOUT_MS = 12_000;
export const COPY_TIMEOUT_MS = 45_000;

export function externalTimeoutSignal(ms: number): AbortSignal {
  return AbortSignal.timeout(ms);
}

export function isExternalTimeout(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("name" in error)) return false;
  const name = String((error as { name?: unknown }).name);
  return name === "TimeoutError" || name === "AbortError";
}

export function externalTimeoutMessage(kind: "vision" | "search" | "copy"): string {
  if (kind === "vision") return "圖片辨識逾時，已略過圖片資訊。";
  if (kind === "search") return "Web Search 逾時，本次文案未使用網路搜尋結果。";
  return "文案 AI 逾時，請再試一次，或改用另一個模型。";
}
