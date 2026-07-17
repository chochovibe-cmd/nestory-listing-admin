/**
 * P1-76 fix: emoji presence helpers for 小編聊天口吻 soft-check.
 * No stripping anywhere — detection only.
 */

/** Broad emoji / pictograph detector (BMP + common surrogates + variation selectors). */
export function textHasEmoji(text: string | null | undefined): boolean {
  if (!text) return false;
  // Prefer Unicode property escapes when the runtime supports them.
  try {
    if (/\p{Extended_Pictographic}/u.test(text)) return true;
  } catch {
    // ignore older engines
  }
  // Fallback: common emoji ranges + keycap / VS16 sequences.
  return /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/u.test(text);
}

/**
 * Soft warning when 小編聊天口吻 copy still has zero emoji after generation.
 * Never blocks.
 */
export function buildXiaobianMissingEmojiWarning(
  description: string | null | undefined,
  faq: string | null | undefined,
): string | null {
  const has =
    textHasEmoji(description) || textHasEmoji(faq);
  if (has) return null;
  return "小編聊天口吻未偵測到 emoji（描述／FAQ 皆無）。此語氣應自然使用 1–2 個；可重生或手動補上。";
}
