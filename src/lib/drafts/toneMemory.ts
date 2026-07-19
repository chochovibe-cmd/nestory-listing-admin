/**
 * BX10: remember last AI copy tone per IP (device-local).
 * No DB / migration — localStorage only.
 */

export const TONE_MEMORY_KEY = "nestory_tone_by_ip";

export type ToneMemoryMap = Record<string, string>;

function normIp(ip: string | null | undefined): string | null {
  if (ip == null) return null;
  const s = ip.trim();
  if (!s || s === "未知" || s === "unknown") return null;
  return s;
}

export function readToneMemory(storage: Storage | null | undefined): ToneMemoryMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(TONE_MEMORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ToneMemoryMap = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && k.trim() && v.trim()) {
        out[k.trim()] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function rememberToneForIp(
  storage: Storage | null | undefined,
  ipName: string | null | undefined,
  tone: string | null | undefined
): void {
  const ip = normIp(ipName);
  const t = typeof tone === "string" ? tone.trim() : "";
  if (!storage || !ip || !t) return;
  try {
    const map = readToneMemory(storage);
    map[ip] = t;
    storage.setItem(TONE_MEMORY_KEY, JSON.stringify(map));
  } catch {
    /* quota / private mode — ignore */
  }
}

export function recalledToneForIp(
  storage: Storage | null | undefined,
  ipName: string | null | undefined
): string | null {
  const ip = normIp(ipName);
  if (!storage || !ip) return null;
  const map = readToneMemory(storage);
  const t = map[ip];
  return t && t.trim() ? t.trim() : null;
}

/**
 * If title mentions a remembered IP name, return that tone (longest key win).
 * Used when form has no ip_name yet (pre-generate).
 */
export function recalledToneFromTitle(
  storage: Storage | null | undefined,
  title: string | null | undefined
): { ip: string; tone: string } | null {
  if (!storage) return null;
  const text = (title ?? "").trim();
  if (!text) return null;
  const map = readToneMemory(storage);
  let best: { ip: string; tone: string } | null = null;
  for (const [ip, tone] of Object.entries(map)) {
    if (!ip || !tone) continue;
    if (text.includes(ip) && (!best || ip.length > best.ip.length)) {
      best = { ip, tone };
    }
  }
  return best;
}
