/** Original seller capture only. Never derive this block from AI-written spec_text. */
export function buildCaptureEvidence(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const capture = raw as Record<string, unknown>;
  const payload = capture.payload && typeof capture.payload === "object"
    ? capture.payload as Record<string, unknown> : {};
  const lines: string[] = [];
  const add = (label: string, value: unknown, limit = 1000) => {
    if (typeof value === "string" && value.trim()) lines.push(`${label}：${value.trim().slice(0, limit)}`);
  };
  add("擷取原標題", payload.title, 300);
  add("賣家原始規格", payload.spec_text, 1400);
  if (payload.params && typeof payload.params === "object" && !Array.isArray(payload.params)) {
    const entries = Object.entries(payload.params as Record<string, unknown>)
      .filter(([key, value]) => /品牌|尺寸|材質|材料|規格|型号|型號|系列|成分|容量|款式/i.test(key) && (typeof value === "string" || typeof value === "number"))
      .slice(0, 24)
      .map(([key, value]) => `${key}：${String(value).slice(0, 100)}`);
    if (entries.length) lines.push(`賣家屬性：${entries.join("；").slice(0, 1300)}`);
  }
  const flat = Array.isArray(payload.variants_flat) ? payload.variants_flat : [];
  const variants: string[] = [];
  const seen = new Set<string>();
  for (const item of flat) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const parts = [1, 2, 3].map((n) => String(row[`option${n}_value`] ?? "").trim()).filter(Boolean);
    const unique = [...new Set(parts)]; // repeated capture axes are not separate choices
    const text = unique.join(" / ");
    if (text && !seen.has(text)) { seen.add(text); variants.push(text.slice(0, 150)); }
    if (variants.length >= 60) break;
  }
  if (variants.length) lines.push(`擷取款式（去重，非庫存承諾）：${variants.join("、").slice(0, 1900)}`);
  return lines.length ? lines.join("\n").slice(0, 4000) : undefined;
}

export function captureVariantSummary(raw: unknown): string | undefined {
  return buildCaptureEvidence(raw)?.split("\n")
    .find((line) => line.startsWith("擷取款式（"))?.split("：").slice(1).join("：");
}

export function originalCaptureSpec(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const payload = (raw as Record<string, unknown>).payload;
  if (!payload || typeof payload !== "object") return undefined;
  const text = (payload as Record<string, unknown>).spec_text;
  return typeof text === "string" ? text.slice(0, 700) : undefined;
}
