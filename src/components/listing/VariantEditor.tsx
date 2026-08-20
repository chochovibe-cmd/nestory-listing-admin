"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import type { CostCurrency, PriceMode, PricingSettings } from "@/lib/pricing";
import {
  MAX_VARIANT_DIMENSIONS,
  MAX_VARIANT_ROWS,
  appendCharacterRows,
  appendDimensionValue,
  applyProductCostToBlankRows,
  canExpandFromDimensions,
  clampDimensions,
  clampVariantRows,
  countLockedVariants,
  emptyVariantRow,
  expandAndMergeVariantRows,
  formatVariantPriceLine,
  isVariantRowFilled,
  lockVariantPrice,
  planVariantAxisChange,
  recalculateUnlockedVariantPrices,
  removeDimensionMergingRows,
  removeDimensionValue,
  syncInheritedVariantCosts,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";
import { createClient } from "@/lib/supabase/client";

export type VariantImageOption = {
  id: string;
  url: string;
  label: string;
};

type Props = {
  dimensions: VariantDimension[];
  rows: VariantFormRow[];
  onDimensionsChange: (dims: VariantDimension[]) => void;
  onRowsChange: (rows: VariantFormRow[]) => void;
  currency: CostCurrency;
  priceMode: PriceMode;
  pricingSettings: PricingSettings;
  /** P1-5: product-level cost; blank variant cost inherits this. */
  productCost?: number | null;
  /** Product images for picker (main preferred). */
  images: VariantImageOption[];
  /** Optional: draft id for loading characters — not required. */
  warning: string | null;
  onWarning: (w: string | null) => void;
  /** B3 spec-shot slot rendered by parent below the grid. */
  footer?: ReactNode;
};

const QUICK_DIMS = ["尺寸", "顏色"] as const;
const MOBILE_QUICK_DIMS = ["尺寸", "顏色", "款式"] as const;

/** UX-AB T104: inline double-confirm arm (3s auto-reset; no window.confirm). */
const ARM_MS = 3000;
/** UX-B3-P06: mobile pick-grid long-press zoom (slightly under P04 500ms). */
const PICK_LONG_PRESS_MS = 450;
const PICK_MOVE_PX = 10;
/** D3.4A: mobile handle activation threshold before vertical reorder begins. */
const ROW_DRAG_ACTIVATION_PX = 8;

type ConfirmArm =
  | null
  | { kind: "remove-dim"; dimIndex: number; count: number }
  | {
      kind: "expand";
      count: number;
      /** P0-1: candidate axis change stays pending until the second confirm click. */
      nextDimensions?: VariantDimension[];
    };

type AxisValueModal = {
  dimIndex: number;
  dimName: string;
};

type OptionEditModal = {
  rowIndex: number;
  dimIndex: number;
  label: string;
};

type MobilePointerDrag = {
  pointerId: number;
  fromKey: string;
  startX: number;
  startY: number;
  active: boolean;
  handle: HTMLButtonElement;
};

/** Reorder rows by index-key string; updates sortOrder. */
function reorderVariantRows(
  list: VariantFormRow[],
  fromKey: string,
  toKey: string
): VariantFormRow[] | null {
  const from = Number(fromKey);
  const to = Number(toKey);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= list.length ||
    to >= list.length
  ) {
    return null;
  }
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (!item) return null;
  next.splice(to, 0, item);
  return next.map((r, i) => ({ ...r, sortOrder: i }));
}

export function VariantEditor({
  dimensions,
  rows,
  onDimensionsChange,
  productCost = null,
  onRowsChange,
  currency,
  priceMode,
  pricingSettings,
  images,
  warning,
  onWarning,
  footer
}: Props) {
  const [charOpen, setCharOpen] = useState(false);
  const [dimOpen, setDimOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(() => dimensions.length === 0);
  const [customDim, setCustomDim] = useState("");
  const [pickIndex, setPickIndex] = useState<number | null>(null);
  const [charQuery, setCharQuery] = useState("");
  const [charList, setCharList] = useState<{ id: string; name: string; ip: string }[]>([]);
  const [charSelected, setCharSelected] = useState<Record<string, boolean>>({});
  const [charLoading, setCharLoading] = useState(false);
  /** Per-dimension draft for adding an axis value (pkg2b). */
  const [axisValueDraft, setAxisValueDraft] = useState<Record<number, string>>({});
  const [axisValueModal, setAxisValueModal] = useState<AxisValueModal | null>(null);
  const [optionEdit, setOptionEdit] = useState<OptionEditModal | null>(null);
  const [optionEditDraft, setOptionEditDraft] = useState("");
  /** UX-AB T104: first click arms destructive remove/expand; second executes. */
  const [confirmArm, setConfirmArm] = useState<ConfirmArm>(null);
  /** UX-B3-P06 / D3.4A: desktop HTML drag + mobile Pointer Events. */
  const [isNarrow, setIsNarrow] = useState(false);
  const [reorderDragKey, setReorderDragKey] = useState<string | null>(null);
  const [reorderOverKey, setReorderOverKey] = useState<string | null>(null);
  const [reorderDragOffsetY, setReorderDragOffsetY] = useState(0);
  /** Mobile long-press full-screen pick preview (portal). */
  const [zoomPreview, setZoomPreview] = useState<{
    url: string;
    label: string;
  } | null>(null);
  const [portalReady, setPortalReady] = useState(false);

  const armTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickLpTimerRef = useRef<number | null>(null);
  const pickLpTriggeredRef = useRef(false);
  const pickTouchStartRef = useRef({ x: 0, y: 0 });
  const pointerDragRef = useRef<MobilePointerDrag | null>(null);

  function clearArmTimer() {
    if (armTimerRef.current != null) {
      window.clearTimeout(armTimerRef.current);
      armTimerRef.current = null;
    }
  }

  function armConfirm(next: Exclude<ConfirmArm, null>) {
    clearArmTimer();
    setConfirmArm(next);
    armTimerRef.current = window.setTimeout(() => {
      setConfirmArm(null);
      armTimerRef.current = null;
    }, ARM_MS);
  }

  function clearConfirmArm() {
    clearArmTimer();
    setConfirmArm(null);
  }

  function clearPickLpTimer() {
    if (pickLpTimerRef.current != null) {
      window.clearTimeout(pickLpTimerRef.current);
      pickLpTimerRef.current = null;
    }
  }

  useEffect(() => () => {
    clearArmTimer();
    clearPickLpTimer();
  }, []);

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 959px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const lockedCount = countLockedVariants(rows);
  const costLabel = currency === "CNY" ? "成本 ¥" : "成本 NT$";

  // Close desktop/in-flow popovers on outside click. Portal sheets own their backdrop.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const target = e.target;
      if (target instanceof Element && target.closest(".v-mobile-sheet")) return;
      if (!rootRef.current?.contains(target as Node)) {
        setCharOpen(false);
        setDimOpen(false);
        setPickIndex(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  // Load characters when panel opens
  useEffect(() => {
    if (!charOpen) return;
    let cancelled = false;
    setCharLoading(true);
    const supabase = createClient();
    void (async () => {
      const { data, error } = await supabase
        .from("ip_characters")
        .select("id,character_name,ip_name")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .limit(400);
      if (cancelled) return;
      setCharLoading(false);
      if (error || !data) {
        setCharList([]);
        return;
      }
      setCharList(
        data.map((r) => ({
          id: r.id as string,
          name: String(r.character_name ?? ""),
          ip: String(r.ip_name ?? "")
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [charOpen]);

  const filteredChars = useMemo(() => {
    const q = charQuery.trim().toLowerCase();
    if (!q) return charList.slice(0, 80);
    return charList
      .filter(
        (c) =>
          c.name.toLowerCase().includes(q) || c.ip.toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [charList, charQuery]);

  function setRowsSafe(next: VariantFormRow[]) {
    const clamped = clampVariantRows(next);
    onRowsChange(clamped.rows);
    if (clamped.warning) onWarning(clamped.warning);
  }

  function updateRow(index: number, patch: Partial<VariantFormRow>) {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    setRowsSafe(next);
  }

  function updateOption(index: number, dimIndex: number, value: string) {
    const row = rows[index];
    if (!row) return;
    const optionValues = [...row.optionValues] as [string, string, string];
    optionValues[dimIndex] = value;
    updateRow(index, { optionValues });
  }

  function onCostChange(index: number, cost: string) {
    const row = rows[index];
    if (!row) return;
    // Manual edit detaches from product-cost inheritance.
    let next = rows.map((r, i) =>
      i === index ? { ...r, cost, costIsInherited: false } : r
    );
    next = recalculateUnlockedVariantPrices(next, {
      currency,
      priceMode,
      settings: pricingSettings,
      productCost
    });
    setRowsSafe(next);
  }

  /** Prefill blank / newly created rows from product cost, then price. */
  function withInheritedProductCost(nextRows: VariantFormRow[]): VariantFormRow[] {
    return syncInheritedVariantCosts(nextRows, productCost, {
      currency,
      priceMode,
      settings: pricingSettings
    });
  }

  function onManualPrice(index: number, field: "sellPrice" | "compareAt", value: string) {
    const row = rows[index];
    if (!row) return;
    updateRow(index, lockVariantPrice(row, { [field]: value }));
  }

  function addRow() {
    if (rows.length >= MAX_VARIANT_ROWS) {
      onWarning(`款式列已達上限 ${MAX_VARIANT_ROWS} 列，無法再新增。`);
      return;
    }
    let dims = dimensions;
    if (dims.length === 0) {
      dims = [{ name: "款式" }];
      onDimensionsChange(dims);
    }
    const next = [...rows, emptyVariantRow(rows.length, productCost)];
    setRowsSafe(withInheritedProductCost(next));
  }

  function removeRow(index: number) {
    setRowsSafe(rows.filter((_, i) => i !== index).map((r, i) => ({ ...r, sortOrder: i })));
  }

  function applyRowReorder(fromKey: string, toKey: string) {
    const next = reorderVariantRows(rows, fromKey, toKey);
    if (!next) return;
    setRowsSafe(next);
  }

  function addDimension(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (dimensions.length >= MAX_VARIANT_DIMENSIONS) {
      onWarning(`維度最多 ${MAX_VARIANT_DIMENSIONS} 個。`);
      return;
    }
    if (dimensions.some((d) => d.name === trimmed)) {
      setDimOpen(false);
      return;
    }
    // New axis starts empty — no new combos until values are added.
    onDimensionsChange(
      clampDimensions([...dimensions, { name: trimmed, values: [] }])
    );
    setCustomDim("");
    setDimOpen(false);
  }

  function removeDimension(dimIndex: number) {
    const result = removeDimensionMergingRows(dimensions, rows, dimIndex);
    if (result.wouldDiscardHandFilled.length > 0) {
      // UX-AB T104: inline double-confirm (ResultCard / UX-L T61 pattern)
      const count = result.wouldDiscardHandFilled.length;
      const armed =
        confirmArm?.kind === "remove-dim" && confirmArm.dimIndex === dimIndex;
      if (!armed) {
        armConfirm({ kind: "remove-dim", dimIndex, count });
        return;
      }
    }
    clearConfirmArm();
    onDimensionsChange(result.dimensions);
    setRowsSafe(result.rows);
    onWarning(null);
  }

  /**
   * P0-1 / UX-B4-P03: plan axis-value changes before mutating either state surface.
   * dimensions + rows must apply together; destructive changes stay pending until
   * the existing double-confirm CTA is clicked a second time.
   */
  function tryAutoExpandFromDimensions(
    nextDims: VariantDimension[],
    currentRows: VariantFormRow[]
  ): boolean {
    const plan = planVariantAxisChange(nextDims, currentRows);
    if (plan.kind === "confirm") {
      armConfirm({
        kind: "expand",
        count: plan.affectedCount,
        nextDimensions: plan.dimensions
      });
      onWarning(
        `軸值已變更，重新展開會影響 ${plan.affectedCount} 筆手填 — 請按下方確認`
      );
      return false;
    }

    clearConfirmArm();
    onDimensionsChange(plan.dimensions);
    setRowsSafe(withInheritedProductCost(plan.rows));
    if (plan.warning) onWarning(plan.warning);
    else onWarning(null);
    return true;
  }

  function addAxisValue(dimIndex: number) {
    const draft = (axisValueDraft[dimIndex] ?? "").trim();
    if (!draft) return;
    const nextDims = appendDimensionValue(dimensions, dimIndex, draft);
    setAxisValueDraft((cur) => ({ ...cur, [dimIndex]: "" }));
    tryAutoExpandFromDimensions(nextDims, rows);
  }

  function dropAxisValue(dimIndex: number, value: string) {
    const nextDims = removeDimensionValue(dimensions, dimIndex, value);
    tryAutoExpandFromDimensions(nextDims, rows);
  }

  /**
   * UX-B4-P03: manual re-expand (secondary CTA).
   * P0-1: if an axis change is pending, this second click commits the pending
   * dimensions and rows atomically instead of expanding the old dimensions.
   */
  function expandFromAxisValues() {
    const pendingDimensions =
      confirmArm?.kind === "expand" ? confirmArm.nextDimensions : undefined;
    const targetDimensions = pendingDimensions ?? dimensions;

    if (!pendingDimensions && !canExpandFromDimensions(targetDimensions)) {
      onWarning("請先在各維度加上軸值。");
      return;
    }

    const result = expandAndMergeVariantRows(targetDimensions, rows);
    if (result.comboCount === 0) {
      if (pendingDimensions && confirmArm?.kind === "expand") {
        clearConfirmArm();
        onDimensionsChange(targetDimensions);
        setRowsSafe([]);
        onWarning(null);
        return;
      }
      onWarning("沒有可展開的軸值組合。");
      return;
    }
    if (result.wouldDiscardHandFilled.length > 0) {
      // UX-AB T104: inline double-confirm (ResultCard / UX-L T61 pattern)
      const count = result.wouldDiscardHandFilled.length;
      const armed = confirmArm?.kind === "expand";
      if (!armed) {
        armConfirm({ kind: "expand", count });
        onWarning(
          `軸值已變更，重新展開會影響 ${count} 筆手填 — 確認`
        );
        return;
      }
    }
    clearConfirmArm();
    if (pendingDimensions) onDimensionsChange(targetDimensions);
    // New expand base rows start blank; write product cost into value when applicable.
    setRowsSafe(withInheritedProductCost(result.rows));
    if (result.warning) onWarning(result.warning);
    else onWarning(null);
  }

  /** UX-B4-P03 ③: deep-copy form fields; insert at index+1 as a new editable row. */
  function duplicateRow(index: number) {
    if (rows.length >= MAX_VARIANT_ROWS) {
      onWarning(`款式列已達上限 ${MAX_VARIANT_ROWS} 列，無法再複製。`);
      return;
    }
    const source = rows[index];
    if (!source) return;
    const copy: VariantFormRow = {
      optionValues: [
        source.optionValues[0] ?? "",
        source.optionValues[1] ?? "",
        source.optionValues[2] ?? ""
      ],
      cost: source.cost,
      costIsInherited: source.costIsInherited,
      sellPrice: source.sellPrice,
      compareAt: source.compareAt,
      priceLocked: source.priceLocked,
      qty: source.qty,
      sku: source.sku,
      imageId: source.imageId,
      sortOrder: index + 1
    };
    const next = [
      ...rows.slice(0, index + 1),
      copy,
      ...rows.slice(index + 1)
    ].map((r, i) => ({ ...r, sortOrder: i }));
    setRowsSafe(next);
    onWarning(null);
  }

  const expandArmed = confirmArm?.kind === "expand";
  const expandArmCount = expandArmed ? confirmArm.count : 0;
  const canExpand = expandArmed || canExpandFromDimensions(dimensions);
  const rowsAtMax = rows.length >= MAX_VARIANT_ROWS;

  function applyCharacters() {
    const names = Object.entries(charSelected)
      .filter(([, on]) => on)
      .map(([name]) => name);
    if (names.length === 0) {
      setCharOpen(false);
      return;
    }
    const result = appendCharacterRows(dimensions, rows, names);
    onDimensionsChange(result.dimensions);
    setRowsSafe(withInheritedProductCost(result.rows));
    if (result.warning) onWarning(result.warning);
    setCharSelected({});
    setCharOpen(false);
  }

  /** UX-S T72: only fill blank cost cells; never overwrite filled. */
  const canApplyProductCost =
    productCost != null && Number.isFinite(productCost) && productCost > 0 && rows.length > 0;

  function applyCostToAllVariants() {
    if (!canApplyProductCost) {
      onWarning("請先填商品成本");
      return;
    }
    const result = applyProductCostToBlankRows(rows, {
      productCost,
      currency,
      priceMode,
      settings: pricingSettings
    });
    if (result.filledCount === 0) {
      onWarning("所有款式成本已填，未覆蓋既有數字");
      return;
    }
    setRowsSafe(result.rows);
    onWarning(null);
  }

  function closeAllPops() {
    setCharOpen(false);
    setDimOpen(false);
    setPickIndex(null);
    setAxisValueModal(null);
    setOptionEdit(null);
  }

  function openDimensionModal() {
    setAxisValueModal(null);
    setOptionEdit(null);
    setCharOpen(false);
    setPickIndex(null);
    setCustomDim("");
    setDimOpen(true);
  }

  function openAxisValueEditor(dimIndex: number, dimName: string) {
    setDimOpen(false);
    setOptionEdit(null);
    setCharOpen(false);
    setPickIndex(null);
    setAxisValueDraft((cur) => ({ ...cur, [dimIndex]: "" }));
    setAxisValueModal({ dimIndex, dimName });
  }

  function confirmAxisValueEditor() {
    if (!axisValueModal) return;
    if (!(axisValueDraft[axisValueModal.dimIndex] ?? "").trim()) return;
    addAxisValue(axisValueModal.dimIndex);
    setAxisValueModal(null);
  }

  function openOptionEditor(rowIndex: number, dimIndex: number, label: string) {
    setDimOpen(false);
    setAxisValueModal(null);
    setCharOpen(false);
    setPickIndex(null);
    setOptionEdit({ rowIndex, dimIndex, label });
    setOptionEditDraft(rows[rowIndex]?.optionValues[dimIndex] ?? "");
  }

  function confirmOptionEditor() {
    if (!optionEdit) return;
    if (dimensions.length === 0 && optionEdit.dimIndex === 0) {
      onDimensionsChange([{ name: "款式" }]);
    }
    updateOption(optionEdit.rowIndex, optionEdit.dimIndex, optionEditDraft);
    setOptionEdit(null);
  }

  function startPickLongPress(im: VariantImageOption, touch: { clientX: number; clientY: number }) {
    pickTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
    pickLpTriggeredRef.current = false;
    clearPickLpTimer();
    pickLpTimerRef.current = window.setTimeout(() => {
      pickLpTriggeredRef.current = true;
      pickLpTimerRef.current = null;
      setZoomPreview({ url: im.url, label: im.label });
    }, PICK_LONG_PRESS_MS);
  }

  function onPickTouchMove(e: ReactTouchEvent) {
    const touch = e.touches[0];
    if (!touch) return;
    const dx = touch.clientX - pickTouchStartRef.current.x;
    const dy = touch.clientY - pickTouchStartRef.current.y;
    if (Math.abs(dx) > PICK_MOVE_PX || Math.abs(dy) > PICK_MOVE_PX) {
      clearPickLpTimer();
    }
  }

  function onPickTouchEnd() {
    clearPickLpTimer();
  }

  function selectPickImage(rowIndex: number, imageId: string | null) {
    // Swallow click after successful long-press zoom (P04 pattern).
    if (pickLpTriggeredRef.current) {
      pickLpTriggeredRef.current = false;
      return;
    }
    updateRow(rowIndex, { imageId });
    setPickIndex(null);
  }

  function rowKeyAtPoint(clientX: number, clientY: number): string | null {
    const hit = document.elementFromPoint(clientX, clientY);
    const row = hit?.closest<HTMLElement>("[data-variant-row-key]");
    return row?.dataset.variantRowKey ?? null;
  }

  function releasePointerCapture(handle: HTMLButtonElement, pointerId: number) {
    try {
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    } catch {
      /* pointer may already be released by the browser */
    }
  }

  function resetMobilePointerDrag(drag: MobilePointerDrag | null) {
    if (drag) releasePointerCapture(drag.handle, drag.pointerId);
    pointerDragRef.current = null;
    setReorderDragKey(null);
    setReorderOverKey(null);
    setReorderDragOffsetY(0);
  }

  function onMobileDragPointerDown(event: ReactPointerEvent<HTMLButtonElement>, rowKey: string) {
    if (!isNarrow || event.button !== 0) return;
    pointerDragRef.current = {
      pointerId: event.pointerId,
      fromKey: rowKey,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
      handle: event.currentTarget
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onMobileDragPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (!drag.active) {
      if (Math.max(absX, absY) < ROW_DRAG_ACTIVATION_PX) return;
      if (absX > absY) {
        // Horizontal intent belongs to the row viewport; never activate reorder.
        resetMobilePointerDrag(drag);
        return;
      }
      drag.active = true;
      setReorderDragKey(drag.fromKey);
      closeAllPops();
    }

    if (!drag.active) return;
    event.preventDefault();
    setReorderDragOffsetY(dy);
    const overKey = rowKeyAtPoint(event.clientX, event.clientY);
    setReorderOverKey(overKey && overKey !== drag.fromKey ? overKey : null);
  }

  function finishMobileDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const drag = pointerDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const toKey = drag.active && !cancelled
      ? rowKeyAtPoint(event.clientX, event.clientY) ?? reorderOverKey
      : null;
    resetMobilePointerDrag(drag);
    if (drag.active && toKey && toKey !== drag.fromKey) {
      applyRowReorder(drag.fromKey, toKey);
    }
  }

  const dimHeaders = dimensions.length > 0 ? dimensions : [];
  const showGrid = rows.length > 0 || dimensions.length > 0;
  const gridCols = !isNarrow
    ? `28px 42px ${dimHeaders.map(() => "1fr").join(" ") || "1fr"} 72px 26px`
    : undefined;

  function closeZoomPreview() {
    setZoomPreview(null);
    // Residual synthetic click after long-press may arrive late; keep swallow briefly.
    window.setTimeout(() => {
      pickLpTriggeredRef.current = false;
    }, 400);
  }

  const zoomModal =
    portalReady && zoomPreview
      ? createPortal(
          <div
            className="pk-zoom-modal"
            role="dialog"
            aria-modal="true"
            aria-label={zoomPreview.label || "圖片預覽"}
            onClick={closeZoomPreview}
            onKeyDown={(e) => {
              if (e.key === "Escape") closeZoomPreview();
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt={zoomPreview.label}
              className="pk-zoom-modal-img"
              src={zoomPreview.url}
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              className="pk-zoom-modal-close"
              aria-label="關閉預覽"
              onClick={closeZoomPreview}
            >
              關閉
            </button>
          </div>,
          document.body
        )
      : null;

  const mobileSheets =
    portalReady && isNarrow && (dimOpen || axisValueModal || optionEdit)
      ? createPortal(
          <>
            {dimOpen ? (
              <div
                className="v-mobile-sheet-backdrop"
                onClick={() => setDimOpen(false)}
                role="presentation"
              >
                <div
                  aria-label="新增維度"
                  aria-modal="true"
                  className="v-mobile-sheet v-mobile-sheet--dimension"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                >
                  <div className="v-mobile-sheet-title">新增維度</div>
                  <div className="v-mobile-sheet-options">
                    {MOBILE_QUICK_DIMS.map((name) => (
                      <button
                        className="v-mobile-sheet-option"
                        disabled={dimensions.some((d) => d.name === name)}
                        key={name}
                        onClick={() => addDimension(name)}
                        type="button"
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <label className="v-mobile-sheet-field">
                    <span>自訂維度</span>
                    <input
                      autoFocus
                      onChange={(event) => setCustomDim(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addDimension(customDim);
                        }
                      }}
                      placeholder="例如：材質"
                      value={customDim}
                    />
                  </label>
                  <div className="v-mobile-sheet-actions">
                    <button className="v-mobile-sheet-cancel" onClick={() => setDimOpen(false)} type="button">
                      取消
                    </button>
                    <button className="v-mobile-sheet-confirm" onClick={() => addDimension(customDim)} type="button">
                      確認
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {axisValueModal ? (
              <div
                className="v-mobile-sheet-backdrop"
                onClick={() => setAxisValueModal(null)}
                role="presentation"
              >
                <div
                  aria-label={`新增${axisValueModal.dimName}值`}
                  aria-modal="true"
                  className="v-mobile-sheet v-mobile-sheet--axis-value"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                >
                  <div className="v-mobile-sheet-title">新增「{axisValueModal.dimName}」</div>
                  <label className="v-mobile-sheet-field">
                    <span>規格值</span>
                    <input
                      autoFocus
                      onChange={(event) =>
                        setAxisValueDraft((cur) => ({
                          ...cur,
                          [axisValueModal.dimIndex]: event.target.value
                        }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          confirmAxisValueEditor();
                        }
                      }}
                      placeholder={`輸入${axisValueModal.dimName}值`}
                      value={axisValueDraft[axisValueModal.dimIndex] ?? ""}
                    />
                  </label>
                  <div className="v-mobile-sheet-actions">
                    <button className="v-mobile-sheet-cancel" onClick={() => setAxisValueModal(null)} type="button">
                      取消
                    </button>
                    <button className="v-mobile-sheet-confirm" onClick={confirmAxisValueEditor} type="button">
                      確認
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
            {optionEdit ? (
              <div
                className="v-mobile-sheet-backdrop"
                onClick={() => setOptionEdit(null)}
                role="presentation"
              >
                <div
                  aria-label={`編輯${optionEdit.label}`}
                  aria-modal="true"
                  className="v-mobile-sheet v-mobile-sheet--option-edit"
                  onClick={(event) => event.stopPropagation()}
                  role="dialog"
                >
                  <div className="v-mobile-sheet-title">編輯「{optionEdit.label}」</div>
                  <label className="v-mobile-sheet-field">
                    <span>{optionEdit.label}</span>
                    <input
                      autoFocus
                      onChange={(event) => setOptionEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          confirmOptionEditor();
                        }
                      }}
                      value={optionEditDraft}
                    />
                  </label>
                  <div className="v-mobile-sheet-actions">
                    <button className="v-mobile-sheet-cancel" onClick={() => setOptionEdit(null)} type="button">
                      取消
                    </button>
                    <button className="v-mobile-sheet-confirm" onClick={confirmOptionEditor} type="button">
                      確認
                    </button>
                  </div>
                </div>
              </div>
            ) : null}
          </>,
          document.body
        )
      : null;

  return (
    <div className="variant-box" ref={rootRef}>
      <div className="variant-head">
        <span>款式規格</span>
      </div>

      <details
        className="vh-builder"
        open={builderOpen}
        onToggle={(event) => setBuilderOpen(event.currentTarget.open)}
      >
        <summary className="vh-builder-summary">
          <span>建立規格</span>
          <span className="muted">{dimensions.length ? `${dimensions.length} 個類型` : "尚未建立"}</span>
        </summary>
        <div className="vh-dims">
          {isNarrow ? (
            <div className="vh-mobile-add-dim-row">
              {dimensions.length < MAX_VARIANT_DIMENSIONS ? (
                <button
                  aria-haspopup="dialog"
                  className="vh-add-dim-ghost vh-add-dim-ghost--mobile"
                  onClick={openDimensionModal}
                  type="button"
                >
                  ＋ 新增維度
                </button>
              ) : (
                <span className="vh-add-dim-ghost vh-add-dim-ghost--mobile is-disabled" aria-disabled>
                  維度已滿（{MAX_VARIANT_DIMENSIONS}）
                </span>
              )}
            </div>
          ) : null}

          {dimensions.length === 0 ? (
            <div className="vh-dims-empty">
              <span className="vh-dims-empty-text">
                {isNarrow
                  ? "尚無規格維度，使用上方「＋ 新增維度」建立。"
                  : "尚無規格類型，可一鍵加入常用維度（軸值請自行填）"}
              </span>
              {!isNarrow ? (
                <div className="vh-dims-quick">
                  {QUICK_DIMS.map((name) => (
                    <Button
                      key={name}
                      size="sm"
                      variant="ghost"
                      type="button"
                      onClick={() => addDimension(name)}
                    >
                      ＋ {name}
                    </Button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            dimensions.map((d, i) => {
              const dimArmed =
                confirmArm?.kind === "remove-dim" && confirmArm.dimIndex === i;
              const armCount = dimArmed ? confirmArm.count : 0;
              return (
                <div className="vh-dim-row" key={`${d.name}-${i}`}>
                  <div className="vh-dim-label">
                    <span className="v-dim-chip vh-dim-type">
                      {d.name}
                      <button
                        aria-label={
                          dimArmed
                            ? `再點確認移除維度 ${d.name}（${armCount} 筆會丟失）`
                            : `移除維度 ${d.name}`
                        }
                        className={`v-dim-x${dimArmed ? " v-arm-confirm" : ""}`}
                        onClick={() => removeDimension(i)}
                        title={
                          dimArmed
                            ? `再點一次確認移除（${armCount} 筆手填會丟失）`
                            : "移除整個規格類型"
                        }
                        type="button"
                      >
                        {dimArmed ? `確定移除？${armCount}筆會丟失` : "×"}
                      </button>
                    </span>
                  </div>
                  <div className="vh-dim-values v-dim-values">
                    {(d.values ?? []).map((val) => (
                      <span className="v-axis-val" key={`${d.name}-${val}`}>
                        {val}
                        <button
                          aria-label={`移除軸值 ${val}`}
                          className="v-dim-x"
                          onClick={() => dropAxisValue(i, val)}
                          type="button"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {isNarrow ? (
                      <button
                        aria-haspopup="dialog"
                        aria-label={`新增${d.name}值`}
                        className="v-axis-add-chip"
                        onClick={() => openAxisValueEditor(i, d.name)}
                        type="button"
                      >
                        ＋
                      </button>
                    ) : (
                      <span className="v-axis-add vh-dim-add-input">
                        <input
                          aria-label={`${d.name} 軸值`}
                          onChange={(e) =>
                            setAxisValueDraft((cur) => ({ ...cur, [i]: e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              addAxisValue(i);
                            }
                          }}
                          placeholder="加軸值…"
                          value={axisValueDraft[i] ?? ""}
                        />
                        <Button size="sm" onClick={() => addAxisValue(i)} type="button">
                          加入
                        </Button>
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}

          <div className="vh-dim-toolbar">
            {!isNarrow ? (
              <div className="vh-add-dim-wrap">
                {dimensions.length < MAX_VARIANT_DIMENSIONS ? (
                  <button
                    type="button"
                    className="vh-add-dim-ghost"
                    aria-expanded={dimOpen}
                    onClick={() => {
                      setDimOpen((o) => !o);
                      setCharOpen(false);
                      setPickIndex(null);
                    }}
                  >
                    ＋ 新增規格類型
                  </button>
                ) : (
                  <span className="vh-add-dim-ghost is-disabled" aria-disabled>
                    規格類型已滿（{MAX_VARIANT_DIMENSIONS}）
                  </span>
                )}
                {dimOpen ? (
                  <div className="pop-menu open v-pop-dim vh-inline-pop">
                    <div className="pm-title">新增規格維度</div>
                    {QUICK_DIMS.map((name) => (
                      <label key={name}>
                        <input
                          checked={dimensions.some((d) => d.name === name)}
                          onChange={(e) => {
                            if (e.target.checked) addDimension(name);
                            else {
                              const idx = dimensions.findIndex((d) => d.name === name);
                              if (idx >= 0) removeDimension(idx);
                            }
                          }}
                          type="checkbox"
                        />
                        {name}（常用）
                      </label>
                    ))}
                    <label className="v-custom-dim">
                      <input
                        onChange={(e) => setCustomDim(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addDimension(customDim);
                          }
                        }}
                        placeholder="自訂維度名稱"
                        value={customDim}
                      />
                    </label>
                    <Button size="sm" className="v-pop-full" onClick={() => addDimension(customDim)} type="button">
                      加入
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : null}
            <button
              type="button"
              className="vh-toolbar-action"
              disabled={!canApplyProductCost}
              title={canApplyProductCost ? "只填空白成本列，已填不覆蓋" : rows.length === 0 ? "請先新增款式列" : "請先填商品成本"}
              onClick={applyCostToAllVariants}
            >
              套用成本
            </button>
            <button
              type="button"
              className="vh-toolbar-action"
              onClick={() => {
                setCharOpen(true);
                setDimOpen(false);
                setPickIndex(null);
              }}
            >
              依角色建立
            </button>
          </div>

          {charOpen ? (
            <div className="pop-menu open v-pop-char vh-inline-pop">
              <div className="pm-title">勾選這款有出的角色（可多選）</div>
              <input
                className="v-char-search"
                onChange={(e) => setCharQuery(e.target.value)}
                placeholder="搜尋角色／IP…"
                value={charQuery}
              />
              {charLoading ? (
                <div className="variant-empty">載入角色字典…</div>
              ) : filteredChars.length === 0 ? (
                <div className="variant-empty">沒有符合的角色，可手動加入一列後填寫。</div>
              ) : (
                <div className="v-char-list">
                  {filteredChars.map((c) => (
                    <label key={c.id}>
                      <input
                        checked={Boolean(charSelected[c.name])}
                        onChange={(e) =>
                          setCharSelected((cur) => ({
                            ...cur,
                            [c.name]: e.target.checked
                          }))
                        }
                        type="checkbox"
                      />
                      <span>
                        {c.name}
                        {c.ip ? <span className="v-char-ip"> · {c.ip}</span> : null}
                      </span>
                    </label>
                  ))}
                </div>
              )}
              <Button
                size="sm"
                className="v-pop-full"
                onClick={applyCharacters}
                type="button"
              >
                建立所選角色列
              </Button>
            </div>
          ) : null}

          {/* Normal axis edits auto-expand. Destructive changes keep the existing confirmation. */}
          {expandArmed ? (
            <Button
              size="md"
              fullWidth
              variant="danger"
              className="vh-expand-primary v-arm-confirm"
              onClick={expandFromAxisValues}
              title={`再點一次確認更新款式（${expandArmCount} 筆手填會丟失）`}
              type="button"
            >
              確認更新款式（{expandArmCount} 筆手填會丟失）
            </Button>
          ) : !isNarrow ? (
            <p className="vh-auto-expand-note" role="status">
              {canExpand ? "軸值變更後會自動更新款式列" : "加入軸值後會自動建立款式列"}
            </p>
          ) : null}
        </div>
      </details>

      <div className="vh-results-heading">
        <span>款式結果</span>
        <span className="muted">{rows.length ? `${rows.length} 款` : "尚無款式"}</span>
      </div>

      {!showGrid || rows.length === 0 ? (
        <div className="variant-empty">
          單一款式可留空，或按下方「＋ 加入一列」。有軸值時會自動展開款式列。
        </div>
      ) : (
        <>
          <div
            className="vgrid-hdr"
            style={gridCols ? { gridTemplateColumns: gridCols } : undefined}
          >
            {!isNarrow ? <span aria-hidden /> : null}
            <span>圖</span>
            {dimHeaders.length > 0 ? (
              dimHeaders.map((d, i) => <span key={i}>{d.name}</span>)
            ) : (
              <span>選項</span>
            )}
            <span>{costLabel}</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const rowKey = String(index);
            const isDragging = reorderDragKey === rowKey;
            const isOver =
              reorderOverKey === rowKey && reorderDragKey != null && reorderDragKey !== rowKey;
            return (
              <div
                className={`vgrid-block${isDragging && isNarrow ? " is-touch-dragging" : ""}${isOver && isNarrow ? " is-drop-target" : ""}`}
                data-variant-row-key={rowKey}
                key={index}
                style={
                  isDragging && isNarrow
                    ? { transform: `translate3d(0, ${reorderDragOffsetY}px, 0)` }
                    : undefined
                }
              >
                <div
                  className={`vgrid-row${isDragging ? " is-dragging" : ""}${isOver ? " is-drag-over" : ""}`}
                  style={gridCols ? { gridTemplateColumns: gridCols } : undefined}
                  onDragOver={(event) => {
                    if (isNarrow || reorderDragKey == null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setReorderOverKey(rowKey);
                  }}
                  onDragLeave={() => {
                    setReorderOverKey((cur) => (cur === rowKey ? null : cur));
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const fromKey = reorderDragKey;
                    setReorderDragKey(null);
                    setReorderOverKey(null);
                    if (fromKey == null || fromKey === rowKey) return;
                    applyRowReorder(fromKey, rowKey);
                  }}
                >
                  <button
                    className={`vdrag${isNarrow ? " vdrag--mobile" : ""}`}
                    title="拖曳排序"
                    draggable={!isNarrow}
                    aria-label={`拖曳排序第 ${index + 1} 列`}
                    onDragStart={(event) => {
                      if (isNarrow) return;
                      event.stopPropagation();
                      event.dataTransfer.effectAllowed = "move";
                      try {
                        event.dataTransfer.setData("text/plain", rowKey);
                      } catch {
                        /* ignore */
                      }
                      setReorderDragKey(rowKey);
                      closeAllPops();
                    }}
                    onDragEnd={() => {
                      setReorderDragKey(null);
                      setReorderOverKey(null);
                    }}
                    onPointerDown={(event) => onMobileDragPointerDown(event, rowKey)}
                    onPointerMove={onMobileDragPointerMove}
                    onPointerUp={(event) => finishMobileDrag(event)}
                    onPointerCancel={(event) => finishMobileDrag(event, true)}
                    type="button"
                  >
                    <span className="vdrag-dots" aria-hidden>
                      <svg viewBox="0 0 18 24" focusable="false">
                        <circle cx="6" cy="6" r="1.7" />
                        <circle cx="12" cy="6" r="1.7" />
                        <circle cx="6" cy="12" r="1.7" />
                        <circle cx="12" cy="12" r="1.7" />
                        <circle cx="6" cy="18" r="1.7" />
                        <circle cx="12" cy="18" r="1.7" />
                      </svg>
                    </span>
                  </button>
                  {isNarrow ? (
                    <span className="v-sequence-badge" aria-label={`第 ${index + 1} 款`}>
                      {index + 1}
                    </span>
                  ) : null}
                  <span className="vthumb-wrap">
                    <button
                      className="vthumb"
                      onClick={() => {
                        setPickIndex(pickIndex === index ? null : index);
                        setCharOpen(false);
                        setDimOpen(false);
                      }}
                      type="button"
                    >
                      {row.imageId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          alt={
                            images.find((im) => im.id === row.imageId)?.label ??
                            "規格圖"
                          }
                          src={images.find((im) => im.id === row.imageId)?.url ?? ""}
                        />
                      ) : (
                        <span className="vthumb-ph">＋</span>
                      )}
                    </button>
                    {pickIndex === index ? (
                      <div className="pop-menu open v-pop-pick">
                        <div className="pm-title">選擇對應圖片</div>
                        {images.length === 0 ? (
                          <div className="variant-empty">請先在上方上傳商品圖</div>
                        ) : (
                          <div className="pick-grid">
                            {images.map((im) => (
                              <button
                                className={`pk${row.imageId === im.id ? " sel" : ""}`}
                                key={im.id}
                                onClick={() => selectPickImage(index, im.id)}
                                onTouchStart={(e) => {
                                  const t = e.touches[0];
                                  if (!t) return;
                                  startPickLongPress(im, t);
                                }}
                                onTouchMove={onPickTouchMove}
                                onTouchEnd={onPickTouchEnd}
                                onTouchCancel={onPickTouchEnd}
                                onContextMenu={(e) => {
                                  // avoid OS callout while long-pressing
                                  if (isNarrow) e.preventDefault();
                                }}
                                title={im.label}
                                type="button"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img alt={im.label} src={im.url} />
                                {/* Desktop hover zoom (CSS); hidden on coarse pointers */}
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  alt=""
                                  aria-hidden
                                  className="pk-zoom-preview"
                                  src={im.url}
                                />
                              </button>
                            ))}
                          </div>
                        )}
                        <Button
                          size="sm"
                          className="v-pop-full"
                          onClick={() => {
                            updateRow(index, { imageId: null });
                            setPickIndex(null);
                          }}
                          type="button"
                        >
                          移除目前圖片
                        </Button>
                      </div>
                    ) : null}
                  </span>
                  {(dimHeaders.length > 0 ? dimHeaders : [{ name: "款式" }]).map((_, di) => {
                    const dimLabel = dimHeaders[di]?.name ?? "選項";
                    const optionValue = row.optionValues[di] ?? "";
                    return (
                      <span className={`v-cell${isNarrow ? " v-option-cell" : ""}`} data-label={dimLabel} key={di}>
                        {isNarrow ? (
                          <span className="v-option-readonly">
                            <span className="v-option-dim-label">{dimLabel}</span>
                            <span className="v-option-display-row">
                              <span className="v-option-value">{optionValue || "未填"}</span>
                              <button
                                aria-haspopup="dialog"
                                aria-label={`編輯${dimLabel}`}
                                className="v-option-edit"
                                onClick={() => openOptionEditor(index, di, dimLabel)}
                                type="button"
                              >
                                <svg aria-hidden viewBox="0 0 24 24" fill="none" focusable="false">
                                  <path d="M4 20l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="m14 7 3 3" strokeWidth="1.8" strokeLinecap="round" />
                                </svg>
                              </button>
                            </span>
                          </span>
                        ) : (
                          <input
                            aria-label={dimLabel}
                            onChange={(e) => {
                              // ensure dim exists when typing into default
                              if (dimensions.length === 0 && di === 0) {
                                onDimensionsChange([{ name: "款式" }]);
                              }
                              updateOption(index, di, e.target.value);
                            }}
                            placeholder={dimHeaders[di]?.name ?? "選項值"}
                            value={optionValue}
                          />
                        )}
                      </span>
                    );
                  })}
                  <span className="v-cell" data-label={costLabel}>
                    <input
                      aria-label={costLabel}
                      className={row.costIsInherited ? "v-cost-inherited" : undefined}
                      onChange={(e) => onCostChange(index, e.target.value)}
                      placeholder="成本"
                      type="number"
                      value={row.cost}
                    />
                    {row.costIsInherited ? (
                      <span className="v-cost-badge muted">已套用商品成本，可覆蓋</span>
                    ) : null}
                  </span>
                  <span className="v-row-actions">
                    <button
                      type="button"
                      className="v-row-dup"
                      aria-label="複製規格"
                      title={
                        rowsAtMax
                          ? `已達上限 ${MAX_VARIANT_ROWS} 列，無法再複製`
                          : "複製此列（可再改軸值／成本）"
                      }
                      disabled={rowsAtMax}
                      onClick={() => duplicateRow(index)}
                    >
                      <svg className="v-icon-copy" aria-hidden viewBox="0 0 24 24" fill="none" focusable="false">
                        <rect x="9" y="9" width="10" height="10" rx="2" strokeWidth="1.8" />
                        <path d="M15 9V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" strokeWidth="1.8" strokeLinecap="round" />
                      </svg>
                    </button>
                    <button
                      aria-label="刪除規格"
                      className="variant-del"
                      onClick={() => removeRow(index)}
                      type="button"
                    >
                      <svg className="v-icon-trash" aria-hidden viewBox="0 0 24 24" fill="none" focusable="false">
                        <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                    {row.priceLocked ? (
                      <span className="v-manual" title="已手動調整，公式重算不覆蓋">
                        ✎
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="vgrid-sub">
                  <span className="twd">
                    {formatVariantPriceLine(row, priceMode, { productCost })}
                    {isVariantRowFilled(row) ? (
                      <>
                        {" · "}
                        <button
                          className="v-inline-edit"
                          onClick={() => {
                            const sell = window.prompt("售價 NT$（手動後會鎖定 ✎）", row.sellPrice);
                            if (sell != null) onManualPrice(index, "sellPrice", sell);
                          }}
                          type="button"
                        >
                          改售價
                        </button>
                        {priceMode === "sale" ? (
                          <>
                            {" · "}
                            <button
                              className="v-inline-edit"
                              onClick={() => {
                                const cmp = window.prompt(
                                  "定價 NT$（手動後會鎖定 ✎）",
                                  row.compareAt
                                );
                                if (cmp != null) onManualPrice(index, "compareAt", cmp);
                              }}
                              type="button"
                            >
                              改定價
                            </button>
                          </>
                        ) : null}
                        {" · "}
                        <span className="v-cell v-cell--qty" data-label="庫存">
                          <input
                            aria-label="庫存"
                            className="v-qty"
                            onChange={(e) => updateRow(index, { qty: e.target.value })}
                            placeholder="庫存空白=無上限"
                            type="number"
                            value={row.qty}
                          />
                        </span>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </>
      )}

      <button className="vt-addrow" onClick={addRow} type="button">
        ＋ 加入一列
        {rows.length > 0 ? `（${rows.length}/${MAX_VARIANT_ROWS}）` : ""}
      </button>

      {lockedCount > 0 ? (
        <div className="v-sync-warn">
          ⚠ {lockedCount} 筆規格因手動修改未同步公式重算，請確認
        </div>
      ) : null}
      {warning ? <div className="v-sync-warn">{warning}</div> : null}

      {/* B17: foot note moved off permanent chrome — see FieldHelp on parent if needed */}

      {footer}
      {zoomModal}
      {mobileSheets}
    </div>
  );
}

/**
 * Parent can call when currency/settings/priceMode/productCost change.
 * UX-B2-P04: also syncs cost into rows still marked costIsInherited (or still blank).
 */
export function repriceVariants(
  rows: VariantFormRow[],
  opts: {
    currency: CostCurrency;
    priceMode: PriceMode;
    settings: PricingSettings;
    productCost?: number | null;
  }
): VariantFormRow[] {
  return syncInheritedVariantCosts(rows, opts.productCost, {
    currency: opts.currency,
    priceMode: opts.priceMode,
    settings: opts.settings
  });
}
