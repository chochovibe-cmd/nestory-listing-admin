/**
 * B4: normalize character / IP identity strings before compare or insert.
 * NFKC folds full-width forms; trim + collapse internal whitespace so
 * 「米菲」 and 「米菲 」 / 「米 菲」 do not become separate dictionary rows.
 */
export function normalizeCharacterIdentity(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** True when two labels refer to the same character after identity normalize. */
export function isSameCharacterIdentity(a: string, b: string): boolean {
  const left = normalizeCharacterIdentity(a);
  const right = normalizeCharacterIdentity(b);
  if (!left || !right) return false;
  return left === right;
}
