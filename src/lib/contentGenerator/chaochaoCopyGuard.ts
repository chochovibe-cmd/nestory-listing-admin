const INSTRUCTION_ECHO = /逐行整理|本次資料可確認|依本品資料換寫|不要原句輸出|例如由黃色雨衣|這是內部組織方式|不要輸出素材清單|格式示意|只取格式|我們選入這款，是因為\[/;

/** Drop lines that repeat prompt instructions. No extra model call. */
export function stripChaochaoInstructionEcho(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .split("\n")
    .filter((line) => !INSTRUCTION_ECHO.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
