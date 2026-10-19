/** WORKBENCH-UX WB-1: 「耿鬼、路卡利歐」「Hello Kitty, 酷洛米」→ 一隻一隻。不拆空白（Hello Kitty）。 */
export const CHARACTER_NAME_SEPARATOR_RE = /[、，,／/｜|＋+]+/;

export function hasCharacterNameSeparator(value: string | null | undefined): boolean {
  return CHARACTER_NAME_SEPARATOR_RE.test(value ?? "");
}

export function splitCharacterNames(value: string | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of (value ?? "").split(CHARACTER_NAME_SEPARATOR_RE)) {
    const name = part.trim();
    if (!name || name === "不指定" || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
