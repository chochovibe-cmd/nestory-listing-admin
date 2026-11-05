import type { CopyLength } from "@/lib/providers/copy";

export function resolveCopyLength(requested: CopyLength, level: "thin" | "normal" | "rich"): CopyLength {
  return level === "thin" ? "精簡" : requested;
}
export function lengthBudgetLine(length: CopyLength): string {
  if (length === "精簡") return "【字數】正文約 120–200 字。資料不夠就寫短，不要重複同一件事、不要用空句湊字。";
  if (length === "詳細") return "【字數】正文約 450–600 字。每段都要有新資訊；資料不夠寫滿就寫短。";
  return "【字數】正文約 250–400 字。資料不夠寫滿就寫短，不要用空句湊字。";
}
