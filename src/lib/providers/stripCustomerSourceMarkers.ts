/**
 * P4｜出處標記退出顧客文案（後製防呆）
 *
 * Prompt 已改為禁止「（來源：網路）」等出處註記；此 helper 窄剝殘留標記，
 * 冪等、不掃正文所有 URL（Fable Q2）。內部 warnings 的 🔍 文案不經此函式。
 */

/** Parenthetical: （來源：網路） / (來源:網路) / （来源：网络） */
const PAREN_SOURCE_NETWORK_RE =
  /[（(]\s*來\s*源\s*[:：]\s*網\s*路\s*[）)]|[（(]\s*来\s*源\s*[:：]\s*网\s*络\s*[）)]/gi;

/**
 * Bare suffix (no parens): 「…30cm 來源：網路」／行尾「來源:網路」
 * Note: JS `\b` is ASCII-word only and does not work after CJK; use end/punct look-ahead.
 */
const BARE_SOURCE_NETWORK_RE =
  /[ \t]*來源\s*[:：]\s*網路(?:搜尋)?(?=$|[\s）)\]】，。、；;,.…])|[ \t]*来源\s*[:：]\s*网络(?=$|[\s）)\]】，。、；;,.…])/gi;

/**
 * Trailing source+URL annotation only (Q2 narrow):
 * 「（來源：https://…）」／「 來源: https://…」／「來源：http://…」
 * Does NOT strip bare URLs in running prose.
 */
const SOURCE_URL_ANNOTATION_RE =
  /[ \t]*[（(]?\s*來源\s*[:：]\s*https?:\/\/[^\s）)\n]+[）)]?|[ \t]*[（(]?\s*来源\s*[:：]\s*https?:\/\/[^\s）)\n]+[）)]?/gi;

/** Empty parens left after strip: （） () */
const EMPTY_PARENS_RE = /[（(]\s*[）)]/g;

/**
 * Strip customer-facing source attribution markers from a single string.
 * Idempotent: stripCustomerSourceMarkers(stripCustomerSourceMarkers(x)) === stripCustomerSourceMarkers(x).
 */
export function stripCustomerSourceMarkers(value: string | null | undefined): string {
  if (value == null) return "";
  let s = String(value);
  if (!s) return "";

  // Apply a few passes so nested / adjacent markers and cleanup settle.
  for (let i = 0; i < 3; i += 1) {
    const before = s;
    s = s.replace(PAREN_SOURCE_NETWORK_RE, "");
    s = s.replace(SOURCE_URL_ANNOTATION_RE, "");
    s = s.replace(BARE_SOURCE_NETWORK_RE, "");
    s = s.replace(EMPTY_PARENS_RE, "");
    // Collapse runs of spaces/tabs (preserve newlines)
    s = s.replace(/[^\S\n]{2,}/g, " ");
    // Space before punctuation leftovers: "30cm 。" / "30cm ,"
    s = s.replace(/[ \t]+([，。、；;,.])/g, "$1");
    // Trim trailing spaces per line
    s = s.replace(/[ \t]+$/gm, "");
    // Drop lines that became only whitespace or only punctuation crumbs
    s = s
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line, idx, arr) => {
        // keep structural blank lines that separate paragraphs, but collapse pure empty after strip
        if (line.trim() === "") return true;
        // drop lines that are only "：" or ":" left from "來源：網路" partials (rare)
        if (/^[:：\-\u2014\u2013]+$/.test(line.trim())) return false;
        return true;
      })
      .join("\n");
    // Collapse 3+ newlines → 2 (paragraph break)
    s = s.replace(/\n{3,}/g, "\n\n");
    // Trim leading/trailing blank lines on the whole string without eating inner structure
    s = s.replace(/^\n+/, "").replace(/\n+$/, "");
    if (s === before) break;
  }

  return s;
}

/** Map helper for product_highlights arrays. */
export function stripCustomerSourceMarkersList(
  values: ReadonlyArray<string> | null | undefined,
): string[] {
  if (!values || values.length === 0) return [];
  return values.map((v) => stripCustomerSourceMarkers(v)).filter((v) => v.trim().length > 0);
}
