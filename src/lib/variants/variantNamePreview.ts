/**
 * VARIANT-CLEAN: builds the 原名／整理後 comparison for the 整理款式名稱 dialog.
 * Rule layer always; AI layer only when asked, and only the validated part of it.
 * Nothing is ever applied here — the dialog shows this, the operator ticks / edits, then 套用.
 */
import {
  cleanVariantRows,
  type CleanedVariantFields,
  type VariantOptionFields
} from "./variantNameRules";
import { validateAiVariantNames } from "./variantNameValidator";
import type { VariantPolishFn } from "./variantNameAiPolish";

export type VariantNamePreviewRow = {
  index: number;
  original: CleanedVariantFields;
  /** Suggested result (rule layer, plus validated AI wording when used). */
  suggested: CleanedVariantFields;
  /** Rule-layer result alone, so the dialog can show what the AI changed. */
  rule: CleanedVariantFields;
  changed: boolean;
  /** Per-cell AI rejections, for a small "AI 建議被退回" note. */
  aiRejected: string[];
};

export type VariantNamePreview = {
  rows: VariantNamePreviewRow[];
  aiUsed: boolean;
  aiModel: string | null;
  warning: string | null;
};

export async function buildVariantNamePreview(input: {
  rows: VariantOptionFields[];
  useAi: boolean;
  productName?: string | null;
  protectNames?: Array<string | null | undefined>;
  polish?: VariantPolishFn;
}): Promise<VariantNamePreview> {
  const rule = cleanVariantRows(input.rows);
  const original: CleanedVariantFields[] = input.rows.map((r) => ({
    names: [r.option1_name ?? null, r.option2_name ?? null, r.option3_name ?? null],
    values: [r.option1_value ?? null, r.option2_value ?? null, r.option3_value ?? null]
  }));
  const suggested: CleanedVariantFields[] = rule.map((r) => ({ names: [...r.names], values: [...r.values] }));
  const rejected: string[][] = input.rows.map(() => []);
  let aiUsed = false;
  let aiModel: string | null = null;
  let warning: string | null = null;

  if (input.useAi && input.polish && input.rows.length > 0) {
    const ruleRows = rule.map((r) => r.values.map((v) => v ?? ""));
    const axisNames = [0, 1, 2].map((axis) => rule.find((r) => r.names[axis])?.names[axis] ?? "");
    const polished = await input.polish({ rows: ruleRows, axisNames, productName: input.productName });
    aiModel = polished.model;
    if (polished.rows == null) {
      warning = polished.warning ?? "AI 潤飾暫不可用，已只套用規則整理。";
    } else {
      aiUsed = true;
      const checked = validateAiVariantNames(ruleRows, polished.rows, { names: input.protectNames });
      checked.rows.forEach((row, r) =>
        row.forEach((value, axis) => {
          if (rule[r].values[axis] != null && value) suggested[r].values[axis] = value;
        })
      );
      for (const cell of checked.cells) {
        if (!cell.accepted && cell.reason) {
          rejected[cell.row].push(`「${cell.rule}」：${cell.reason}`);
        }
      }
    }
  }

  return {
    rows: input.rows.map((_, index) => ({
      index,
      original: original[index],
      rule: rule[index],
      suggested: suggested[index],
      changed:
        suggested[index].values.some((v, i) => v !== original[index].values[i]) ||
        suggested[index].names.some((n, i) => n !== original[index].names[i]),
      aiRejected: rejected[index]
    })),
    aiUsed,
    aiModel,
    warning
  };
}
