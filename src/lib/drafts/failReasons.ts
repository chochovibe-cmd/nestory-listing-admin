/**
 * UX-I T53: display-only fail summary for workbench ResultCard / fail filter.
 * Does not change generate / publish write paths or fail count formulas.
 */

export type DraftFailDisplayInput = {
  generation_status?: string | null;
  status?: string | null;
  generation_error?: string | null;
  error_message?: string | null;
  warnings?: string[] | null;
};

export function isDraftGenerationFailed(input: DraftFailDisplayInput): boolean {
  return (
    input.generation_status === "failed" ||
    input.status === "failed" ||
    input.status === "api_failed"
  );
}

/**
 * Plain-language one/two-line summary. Empty DB fields → fallback sentence.
 * Returns null when draft is not in a generation-failed state.
 */
export function formatDraftFailSummary(input: DraftFailDisplayInput): string | null {
  if (!isDraftGenerationFailed(input)) return null;

  const gen = input.generation_error?.trim();
  if (gen) return stripStackish(gen);

  const err = input.error_message?.trim();
  if (err) return stripStackish(err);

  const warns = Array.isArray(input.warnings) ? input.warnings : [];
  const picked: string[] = [];
  for (const w of warns) {
    if (typeof w !== "string") continue;
    const t = w.trim();
    if (!t) continue;
    if (!picked.includes(t)) picked.push(t);
    if (picked.length >= 3) break;
  }
  if (picked.length > 0) {
    return stripStackish(picked.join("；"));
  }

  return "原因未記錄，請重試或看紀錄";
}

/** Drop obvious stack-trace noise for operator-facing copy. */
function stripStackish(text: string): string {
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? text;
  // Drop "at foo (file:line)" tails if somehow stored
  return firstLine.replace(/\s+at\s+\S+.*/g, "").trim() || text.trim();
}
