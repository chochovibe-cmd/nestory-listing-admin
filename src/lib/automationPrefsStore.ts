/**
 * C2 Q8-A-restricted: non-sensitive automation prefs only (device localStorage).
 * NEVER store Make Webhook URL, tokens, or secrets here — those need server-side storage (Phase D).
 */

export type WorkerMode = "make" | "codex" | "off";

export type AutomationPrefs = {
  workerMode: WorkerMode;
  emailNotify: boolean;
  lineNotify: boolean;
};

export const AUTOMATION_PREFS_KEY = "nestory_automation_prefs";

export const defaultAutomationPrefs: AutomationPrefs = {
  workerMode: "make",
  emailNotify: true,
  lineNotify: false
};

export function getStoredAutomationPrefs(): AutomationPrefs {
  if (typeof window === "undefined") return defaultAutomationPrefs;
  try {
    const raw = window.localStorage.getItem(AUTOMATION_PREFS_KEY);
    if (!raw) return defaultAutomationPrefs;
    const parsed = JSON.parse(raw) as Partial<AutomationPrefs>;
    const workerMode: WorkerMode =
      parsed.workerMode === "codex" || parsed.workerMode === "off" || parsed.workerMode === "make"
        ? parsed.workerMode
        : defaultAutomationPrefs.workerMode;
    return {
      workerMode,
      emailNotify:
        typeof parsed.emailNotify === "boolean"
          ? parsed.emailNotify
          : defaultAutomationPrefs.emailNotify,
      lineNotify:
        typeof parsed.lineNotify === "boolean"
          ? parsed.lineNotify
          : defaultAutomationPrefs.lineNotify
    };
  } catch {
    return defaultAutomationPrefs;
  }
}

export function setStoredAutomationPrefs(patch: Partial<AutomationPrefs>) {
  if (typeof window === "undefined") return;
  // Explicitly drop any accidental webhook/secret fields from patch.
  const safe: Partial<AutomationPrefs> = {};
  if (patch.workerMode === "make" || patch.workerMode === "codex" || patch.workerMode === "off") {
    safe.workerMode = patch.workerMode;
  }
  if (typeof patch.emailNotify === "boolean") safe.emailNotify = patch.emailNotify;
  if (typeof patch.lineNotify === "boolean") safe.lineNotify = patch.lineNotify;

  const next = { ...getStoredAutomationPrefs(), ...safe };
  window.localStorage.setItem(AUTOMATION_PREFS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("nestory:automation-prefs-changed", { detail: next }));
}
