export const WORKSPACE_PREFS_KEY = "nestory_workspace_prefs_v1";
export const FACTORY_DEFAULT_PRICE_MODE = "single" as const;
export const FACTORY_DEFAULT_TONE = "潮巢導購版";

export type WorkspacePrefs = { priceMode: "sale" | "single"; tone: string };

export function readWorkspacePrefs(
  storage: Storage | null | undefined,
  validTones: readonly string[],
): WorkspacePrefs {
  const fallback: WorkspacePrefs = {
    priceMode: FACTORY_DEFAULT_PRICE_MODE,
    tone: FACTORY_DEFAULT_TONE,
  };
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(WORKSPACE_PREFS_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const priceMode = parsed?.priceMode === "sale" || parsed?.priceMode === "single"
      ? parsed.priceMode
      : FACTORY_DEFAULT_PRICE_MODE;
    const tone =
      typeof parsed?.tone === "string" && validTones.includes(parsed.tone)
        ? parsed.tone
        : FACTORY_DEFAULT_TONE;
    return { priceMode, tone };
  } catch {
    return fallback;
  }
}

export function writeWorkspacePref(
  storage: Storage | null | undefined,
  patch: Partial<WorkspacePrefs>,
): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(WORKSPACE_PREFS_KEY);
    const current =
      raw && typeof JSON.parse(raw) === "object" && JSON.parse(raw) !== null
        ? (JSON.parse(raw) as Partial<WorkspacePrefs>)
        : {};
    storage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    /* quota / private mode / broken JSON — ignore */
  }
}
