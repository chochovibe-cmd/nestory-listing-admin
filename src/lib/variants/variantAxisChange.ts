import { expandAndMergeVariantRows } from "./variantCrossExpand";
import type { VariantDimension, VariantFormRow } from "./types";

export type VariantAxisChangePlan =
  | {
      kind: "apply";
      dimensions: VariantDimension[];
      rows: VariantFormRow[];
      warning: string | null;
    }
  | {
      kind: "confirm";
      dimensions: VariantDimension[];
      affectedCount: number;
    };

/**
 * Plan an axis-value change without mutating UI state.
 *
 * Atomicity rule:
 * - If the next dimensions can be applied without discarding hand-filled rows,
 *   return both dimensions + rows together.
 * - If hand-filled rows would be discarded, return a confirm plan and let the
 *   caller keep the current dimensions/rows untouched until explicit confirm.
 *
 * This prevents the B4-P03 half-state where dimensions changed first while
 * rows stayed on the old cartesian set.
 */
export function planVariantAxisChange(
  nextDimensions: VariantDimension[],
  currentRows: VariantFormRow[]
): VariantAxisChangePlan {
  const result = expandAndMergeVariantRows(nextDimensions, currentRows);

  if (result.wouldDiscardHandFilled.length > 0) {
    return {
      kind: "confirm",
      dimensions: nextDimensions,
      affectedCount: result.wouldDiscardHandFilled.length
    };
  }

  return {
    kind: "apply",
    dimensions: nextDimensions,
    rows: result.comboCount === 0 ? [] : result.rows,
    warning: result.warning
  };
}
