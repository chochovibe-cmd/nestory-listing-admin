import type { SourceReviews } from "@/lib/import/sourceReviews";

export type VariantEvidenceRow = { option1_value?: string | null; option2_value?: string | null; option3_value?: string | null };
export type EvidenceLevel = "thin" | "normal" | "rich";

/** Preserve every option axis and their first-seen ordering. Never flatten into a truncated row list. */
export function buildVariantStructure(rows: readonly VariantEvidenceRow[]): { count: number; axes: string[][]; text: string } {
  const axes = [new Set<string>(), new Set<string>(), new Set<string>()];
  for (const row of rows) {
    [row.option1_value, row.option2_value, row.option3_value].forEach((raw, i) => {
      const value = (raw ?? "").trim();
      if (value) axes[i]!.add(value);
    });
  }
  const present = axes.map((values) => [...values]).filter((values) => values.length > 0);
  if (!rows.length) return { count: 0, axes: present, text: "" };
  const lines = ["款式共 " + rows.length + " 款"];
  present.forEach((values, index) => {
    const prefix = present.length === 1 ? "款式" : "第 " + (index + 1) + " 軸";
    const shown = values.slice(0, 60).join("、");
    const suffix = values.length > 60 ? "、…等 " + values.length + " 種" : "";
    lines.push("- " + prefix + "（" + values.length + " 種）：" + shown + suffix);
  });
  return { count: rows.length, axes: present, text: lines.join("\n").slice(0, 2500) };
}

/** Untrusted buyer reviews are evidence for understanding only. Never publish verbatim. */
export function buildReviewEvidence(reviews: SourceReviews | null): string {
  if (!reviews) return "";
  const lines = ["買家評價（淘寶原頁；只能用來理解商品，不可寫成「買家說」、不可引用原句）"];
  const count = reviews.total_text ? "評價數：" + reviews.total_text : "";
  const rate = reviews.good_rate_text ? "好評率：" + reviews.good_rate_text : "";
  if (count || rate) lines.push("- " + [count, rate].filter(Boolean).join("；"));
  const tags = reviews.tags.slice(0, 12).map((t) => t.text + (t.count === null ? "" : "(" + t.count + ")"));
  if (tags.length) lines.push("- 印象標籤：" + tags.join("、"));
  for (const sample of reviews.samples.slice(0, 5)) {
    lines.push("- 短評：" + sample.text.trim().slice(0, 120) + (sample.sku ? "（款式：" + sample.sku.trim() + "）" : ""));
  }
  if (reviews.signals.length) lines.push("- 店鋪訊號：" + reviews.signals.join("、"));
  return lines.length > 1 ? lines.join("\n") : "";
}

export function scoreEvidence(input: { factCount: number; specCount: number; visionTextChars: number; hasReviews: boolean; noteChars: number }): { score: number; level: EvidenceLevel } {
  const count = (v: number, cap: number) => Math.min(Math.max(0, v), cap);
  const score = count(input.specCount, 6) * 2 + count(input.factCount, 8) + (input.hasReviews ? 2 : 0)
    + (input.visionTextChars >= 80 ? 2 : 0) + (input.noteChars >= 20 ? 1 : 0);
  return { score, level: score < 6 ? "thin" : score >= 14 ? "rich" : "normal" };
}
