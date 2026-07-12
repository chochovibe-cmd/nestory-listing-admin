/**
 * B4: parse generate-time warnings for missing character dictionary entries.
 * Covers both Tags V2 wording and legacy tag_rules wording (filtered after regen).
 */

const MISSING_CHARACTER_PATTERNS: RegExp[] = [
  /角色「([^」]+)」尚未建立\s*V2\s*字典/,
  /角色「([^」]+)」尚未建立正式\s*tag_rules/,
  /角色「([^」]+)」尚未建立二手\s*tag_rules/,
  /角色「([^」]+)」尚未建立\s*tag_rules/,
];

export function extractMissingCharacterNames(warnings: string[] | null | undefined): string[] {
  if (!warnings?.length) return [];
  const found: string[] = [];
  for (const warning of warnings) {
    for (const pattern of MISSING_CHARACTER_PATTERNS) {
      const match = warning.match(pattern);
      if (match?.[1]) {
        const name = match[1].trim();
        if (name && !found.includes(name)) found.push(name);
      }
    }
  }
  return found;
}

export function isCharacterMissingInWarnings(
  characterName: string | null | undefined,
  warnings: string[] | null | undefined,
): boolean {
  if (!characterName?.trim()) return false;
  const missing = extractMissingCharacterNames(warnings);
  const target = characterName.trim();
  return missing.some((name) => name === target || target.includes(name) || name.includes(target));
}

/** Count of warnings that still need operator attention (shown as 待確認). */
export function countPendingConfirmWarnings(warnings: string[] | null | undefined): number {
  return warnings?.length ?? 0;
}
