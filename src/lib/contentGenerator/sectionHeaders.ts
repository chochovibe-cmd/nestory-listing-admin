/**
 * 文案呈現包（2026-07-18 Fable）：描述段落標題的唯一解析點。
 *
 * 新制（回饋 22）：段落標題行為「◈ 商品亮點」樣式；開頭段無標題。
 * COPY C1：潮巢導購版共用同一套 section semantics，收藏亮點=B、為什麼會想帶回家=C。
 * 舊制（歷史草稿）：「A｜內容」「B｜商品亮點」字母全形｜前綴。
 * 這裡同時認得兩制，讓 scenarioKeywords / showmoreCopyRewrite / htmlFormat
 * 共用一份對照，避免三處各自 regex 走鐘。
 */

export type SectionLetter = "A" | "B" | "C" | "D" | "E";

/** 標題文字 → 段落字母（B–E；A＝開頭段無標題）。 */
export const SECTION_TITLE_TO_LETTER: ReadonlyArray<readonly [RegExp, SectionLetter]> = [
  [/^(商品亮點|收藏亮點)/, "B"],
  [/^(適合誰|為什麼會想帶回家)/, "C"],
  [/^商品資訊/, "D"],
  [/^(購買提醒|常見問題|FAQ)/i, "E"]
];

const LEGACY_HEADER_RE = /^([A-E])｜\s*(.*)$/;
const DIAMOND_HEADER_RE = /^◈\s*(.+)$/;

export interface SectionHeaderMatch {
  letter: SectionLetter | null;
  /** 標題文字（不含 ◈／字母前綴）；舊制 A 段整行是內文時為 null。 */
  title: string | null;
  /** 舊制字母行的「標題後同行內文」（例如「A｜開頭句…」的開頭句）。 */
  inlineContent: string | null;
  kind: "diamond" | "legacy";
}

function letterForTitle(title: string): SectionLetter | null {
  for (const [pattern, letter] of SECTION_TITLE_TO_LETTER) {
    if (pattern.test(title)) return letter;
  }
  return null;
}

/**
 * 解析一行是否為段落標題。
 * - 「◈ 商品亮點」→ { letter:"B", title:"商品亮點", kind:"diamond" }
 * - 「◈ 收藏亮點」→ { letter:"B", title:"收藏亮點", kind:"diamond" }
 * - 「◈ 為什麼會想帶回家」→ { letter:"C", title:"為什麼會想帶回家", kind:"diamond" }
 * - 「B｜商品亮點」→ { letter:"B", title:"商品亮點", kind:"legacy" }
 * - 「A｜把日常…」→ { letter:"A", title:null, inlineContent:"把日常…", kind:"legacy" }
 * - 「◈ 任意其他標題」→ { letter:null, title:該字串 }（仍當標題渲染，但不參與段落定位）
 * - 非標題行 → null
 */
export function matchSectionHeader(line: string): SectionHeaderMatch | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const diamond = trimmed.match(DIAMOND_HEADER_RE);
  if (diamond) {
    const title = diamond[1].trim();
    return { letter: letterForTitle(title), title, inlineContent: null, kind: "diamond" };
  }

  const legacy = trimmed.match(LEGACY_HEADER_RE);
  if (legacy) {
    const letter = legacy[1] as SectionLetter;
    const rest = (legacy[2] ?? "").trim();
    const restLetter = rest ? letterForTitle(rest) : null;
    if (rest && restLetter) {
      // 「B｜商品亮點」：純標題行
      return { letter, title: rest, inlineContent: null, kind: "legacy" };
    }
    // 「A｜開頭句…」：字母行帶內文（A 段慣例），或無題字母行
    return { letter, title: null, inlineContent: rest || null, kind: "legacy" };
  }

  return null;
}

/** 該行是否為（任一制的）段落標題行。 */
export function isSectionHeaderLine(line: string): boolean {
  return matchSectionHeader(line) !== null;
}
