/**
 * HOTFIX-1: repair the two known placeholder-format mistakes at copy boundaries.
 * Pure text transforms; intentionally no server imports.
 */
export const FAQ_PLACEHOLDER_HEADINGS: readonly string[] = ["問題", "問", "題目", "Q", "Question", "問句"];
export const FAQ_PLACEHOLDER_ANSWERS: readonly string[] = ["答案", "回答", "答", "A", "Answer"];
export const SPEC_PLACEHOLDER_LABELS: readonly string[] = ["項目", "規格名稱", "名稱", "規格項目"];

// The prompt shows「Q：問句」「A：答案」; models also write Q1：, **Q：**, 問題：, 答案：.
const FAQ_QUESTION_PREFIX = /^(?:Q|Ｑ|問題|問)\s*\d*\s*[:：]\s*(.*)$/i;
const FAQ_ANSWER_PREFIX = /^(?:A|Ａ|答案|回答|答)\s*\d*\s*[:：]\s*(.*)$/i;
// The prompt example「材質：內容」copied literally carries no information.
const SPEC_PLACEHOLDER_VALUE_LINE = /^[^:：]+[:：]\s*內容\s*$/;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isPlaceholderText(value: string, placeholders: readonly string[]): boolean {
  const normalized = value.trim().replace(/[:：]\s*$/, "").trim();
  return placeholders.some((item) => item.toLowerCase() === normalized.toLowerCase());
}

function isPlaceholderHeading(value: string): boolean {
  return isPlaceholderText(value, FAQ_PLACEHOLDER_HEADINGS);
}

/** Drop list bullets and markdown bold so「- **Q1：** …」reads as「Q1：…」. */
function stripLineDecoration(line: string): string {
  return line.replace(/^[-*•・]+\s+/, "").replace(/\*\*/g, "").trim();
}

/** Repair only the known placeholder heading + first-paragraph-as-question mistake. */
export function repairFaqHtml(html: string): string {
  return html.replace(
    /<h3>\s*<strong>\s*(問題|問|題目|Q|Question)\s*[:：]?\s*<\/strong>\s*<\/h3>\s*<p>([\s\S]*?)<\/p>/gi,
    (_whole, _placeholder: string, question: string) => "<h3><strong>" + question + "</strong></h3>",
  );
}

function appendLine(previous: string, next: string): string {
  if (!previous) return next;
  const needsSpace = /[A-Za-z0-9]$/.test(previous) && /^[A-Za-z0-9]/.test(next);
  return previous + (needsSpace ? " " : "") + next;
}

/** Convert Q/A plaintext to the canonical FAQ HTML, or repair legacy HTML. */
export function normalizeFaqOutput(raw: string): string {
  const source = raw.trim();
  if (!source) return "";
  if (/<h3/i.test(source)) return repairFaqHtml(raw);

  type Pair = { question: string; answer: string };
  const pairs: Pair[] = [];
  let current: Pair | null = null;
  let field: keyof Pair | null = null;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = stripLineDecoration(line);
    if (!trimmed) continue;
    const question = trimmed.match(FAQ_QUESTION_PREFIX);
    if (question) {
      if (current) pairs.push(current);
      current = { question: question[1], answer: "" };
      field = "question";
      continue;
    }
    const answer = trimmed.match(FAQ_ANSWER_PREFIX);
    if (answer) {
      if (current) {
        current.answer = appendLine(current.answer, answer[1]);
        field = "answer";
      }
      continue;
    }
    if (current && field) current[field] = appendLine(current[field], trimmed);
  }
  if (current) pairs.push(current);

  return pairs
    .filter(
      (pair) =>
        pair.question.trim() &&
        pair.answer.trim() &&
        !isPlaceholderHeading(pair.question) &&
        !isPlaceholderText(pair.answer, FAQ_PLACEHOLDER_ANSWERS),
    )
    .slice(0, 5)
    .map((pair) => "<h3><strong>" + escapeHtml(pair.question.trim()) +
      "</strong></h3>\n<p>" + escapeHtml(pair.answer.trim()) + "</p>")
    .join("\n\n");
}

/** Remove placeholder prefixes only; preserve all other spec lines verbatim. */
export function repairSpecText(text: string): string {
  return text.split("\n").flatMap((line) => {
    const placeholder = /^\s*(?:項目|規格名稱|名稱|規格項目)\s*[:：]\s*/;
    if (SPEC_PLACEHOLDER_VALUE_LINE.test(line.trim())) return [];
    if (!placeholder.test(line)) return [line];
    const cleaned = line.replace(placeholder, "");
    return cleaned === "" ? [] : [cleaned];
  }).join("\n");
}
