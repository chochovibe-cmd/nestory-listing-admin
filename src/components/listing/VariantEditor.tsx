"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type TouchEvent as ReactTouchEvent
} from "react";
import { Button } from "@/components/ui/Button";
import {
  renderVariantEditorModal,
  renderVariantEditorResults,
  renderVariantEditorZoomModal,
  type EditorModal
} from "./VariantEditorRender";
import {
  calculatePrice,
  type CostCurrency,
  type PriceMode,
  type PricingSettings
} from "@/lib/pricing";
import {
  MAX_VARIANT_DIMENSIONS,
  MAX_VARIANT_ROWS,
  appendCharacterRows,
  appendDimensionValue,
  applyProductCostToBlankRows,
  clampDimensions,
  clampVariantRows,
  countLockedVariants,
  emptyVariantRow,
  expandAndMergeVariantRows,
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
  productCost?: number | null;
  images: VariantImageOption[];
  warning: string | null;
  onWarning: (w: string | null) => void;
  footer?: ReactNode;
};

const ARM_MS = 3000;
const PICK_LONG_PRESS_MS = 450;
const PICK_MOVE_PX = 10;
const ROW_LONG_PRESS_MS = 500;
const TOUCH_DRAG_PX = 8;

type ConfirmArm =
  | null
  | { kind: "remove-dim"; dimIndex: number; count: number }
  | { kind: "expand"; count: number; nextDimensions?: VariantDimension[] };

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
  return next.map((row, index) => ({ ...row, sortOrder: index }));
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button,input,select,textarea,a,label"));
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
  const [builderOpen, setBuilderOpen] = useState(() => dimensions.length === 0);
  const [pickIndex, setPickIndex] = useState<number | null>(null);
  const [charQuery, setCharQuery] = useState("");
  const [charList, setCharList] = useState<{ id: string; name: string; ip: string }[]>([]);
  const [charSelected, setCharSelected] = useState<Record<string, boolean>>({});
  const [charLoading, setCharLoading] = useState(false);
  const [confirmArm, setConfirmArm] = useState<ConfirmArm>(null);
  const [isNarrow, setIsNarrow] = useState(false);
  const [reorderDragKey, setReorderDragKey] = useState<string | null>(null);
  const [reorderOverKey, setReorderOverKey] = useState<string | null>(null);
  const [zoomPreview, setZoomPreview] = useState<{ url: string; label: string } | null>(null);
  const [portalReady, setPortalReady] = useState(false);
  const [editorModal, setEditorModal] = useState<EditorModal>(null);
  const [modalValue, setModalValue] = useState("");
  const [modalCompareAt, setModalCompareAt] = useState("");
  const [variantDraft, setVariantDraft] = useState<string[]>([]);
  const [mobileSelected, setMobileSelected] = useState<Set<number>>(() => new Set());
  const characterPickerOpen = charOpen || editorModal?.kind === "character";

  const armTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pickLpTimerRef = useRef<number | null>(null);
  const pickLpTriggeredRef = useRef(false);
  const pickTouchStartRef = useRef({ x: 0, y: 0 });
  const rowLpTimerRef = useRef<number | null>(null);
  const rowLpTriggeredRef = useRef(false);
  const touchDragRef = useRef<{
    pointerId: number;
    fromIndex: number;
    overIndex: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

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

  function clearRowLpTimer() {
    if (rowLpTimerRef.current != null) {
      window.clearTimeout(rowLpTimerRef.current);
      rowLpTimerRef.current = null;
    }
  }

  useEffect(() => () => {
    clearArmTimer();
    clearPickLpTimer();
    clearRowLpTimer();
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

  useEffect(() => {
    if (mobileSelected.size === 0) return;
    setMobileSelected((current) => {
      const next = new Set([...current].filter((index) => index < rows.length));
      return next.size === current.size ? current : next;
    });
  }, [rows.length, mobileSelected.size]);

  const lockedCount = countLockedVariants(rows);
  const costLabel = currency === "CNY" ? "成本 ¥" : "成本 NT$";
  const rowsAtMax = rows.length >= MAX_VARIANT_ROWS;
  const expandArmed = confirmArm?.kind === "expand";
  const expandArmCount = expandArmed ? confirmArm.count : 0;

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setCharOpen(false);
        setPickIndex(null);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    if (!characterPickerOpen) return;
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
        data.map((row) => ({
          id: row.id as string,
          name: String(row.character_name ?? ""),
          ip: String(row.ip_name ?? "")
        }))
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [characterPickerOpen]);

  const filteredChars = useMemo(() => {
    const query = charQuery.trim().toLowerCase();
    if (!query) return charList.slice(0, 80);
    return charList
      .filter((item) =>
        item.name.toLowerCase().includes(query) || item.ip.toLowerCase().includes(query)
      )
      .slice(0, 80);
  }, [charList, charQuery]);

  function setRowsSafe(next: VariantFormRow[]) {
    const clamped = clampVariantRows(next);
    onRowsChange(clamped.rows);
    if (clamped.warning) onWarning(clamped.warning);
  }

  function updateRow(index: number, patch: Partial<VariantFormRow>) {
    setRowsSafe(rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function onCostChange(index: number, cost: string) {
    let next = rows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, cost, costIsInherited: false } : row
    );
    next = recalculateUnlockedVariantPrices(next, {
      currency,
      priceMode,
      settings: pricingSettings,
      productCost
    });
    setRowsSafe(next);
  }

  function withInheritedProductCost(nextRows: VariantFormRow[]) {
    return syncInheritedVariantCosts(nextRows, productCost, {
      currency,
      priceMode,
      settings: pricingSettings
    });
  }

  function onManualPrice(index: number, sellPrice: string, compareAt: string) {
    const row = rows[index];
    if (!row) return;
    setRowsSafe(
      rows.map((item, rowIndex) =>
        rowIndex === index
          ? lockVariantPrice(row, {
              sellPrice,
              ...(priceMode === "sale" ? { compareAt } : {})
            })
          : item
      )
    );
  }

  function addRow(optionValues?: string[]) {
    if (rowsAtMax) {
      onWarning(`款式列已達上限 ${MAX_VARIANT_ROWS} 列，無法再新增。`);
      return false;
    }
    let nextDimensions = dimensions;
    if (nextDimensions.length === 0) {
      nextDimensions = [{ name: "款式", values: [] }];
      onDimensionsChange(nextDimensions);
    }
    const row = emptyVariantRow(rows.length, productCost);
    if (optionValues) {
      row.optionValues = [
        optionValues[0] ?? "",
        optionValues[1] ?? "",
        optionValues[2] ?? ""
      ];
    }
    const duplicate = rows.some((existing) =>
      existing.optionValues.every((value, index) => value === row.optionValues[index])
    );
    if (optionValues && duplicate) {
      onWarning("此 Variant 規格組合已存在，請改用不同規格值。");
      return false;
    }
    setRowsSafe(withInheritedProductCost([...rows, row]));
    onWarning(null);
    return true;
  }

  function removeRow(index: number) {
    setRowsSafe(
      rows
        .filter((_, rowIndex) => rowIndex !== index)
        .map((row, rowIndex) => ({ ...row, sortOrder: rowIndex }))
    );
    setMobileSelected(new Set());
  }

  function applyRowReorder(fromKey: string, toKey: string) {
    const next = reorderVariantRows(rows, fromKey, toKey);
    if (!next) return;
    setRowsSafe(next);
    setMobileSelected(new Set());
  }

  function addDimension(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return false;
    if (dimensions.length >= MAX_VARIANT_DIMENSIONS) {
      onWarning(`維度最多 ${MAX_VARIANT_DIMENSIONS} 個。`);
      return false;
    }
    if (dimensions.some((dimension) => dimension.name === trimmed)) {
      onWarning("這個規格維度已存在。");
      return false;
    }
    onDimensionsChange(clampDimensions([...dimensions, { name: trimmed, values: [] }]));
    onWarning(null);
    return true;
  }

  function removeDimension(dimIndex: number) {
    const result = removeDimensionMergingRows(dimensions, rows, dimIndex);
    if (result.wouldDiscardHandFilled.length > 0) {
      const count = result.wouldDiscardHandFilled.length;
      const armed = confirmArm?.kind === "remove-dim" && confirmArm.dimIndex === dimIndex;
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

  function tryAutoExpandFromDimensions(nextDims: VariantDimension[], currentRows: VariantFormRow[]) {
    const plan = planVariantAxisChange(nextDims, currentRows);
    if (plan.kind === "confirm") {
      armConfirm({
        kind: "expand",
        count: plan.affectedCount,
        nextDimensions: plan.dimensions
      });
      onWarning(`軸值已變更，更新會影響 ${plan.affectedCount} 筆手填 — 請按下方確認`);
      return false;
    }
    clearConfirmArm();
    onDimensionsChange(plan.dimensions);
    setRowsSafe(withInheritedProductCost(plan.rows));
    onWarning(plan.warning ?? null);
    return true;
  }

  function addAxisValue(dimIndex: number, value: string) {
    const draft = value.trim();
    if (!draft) return false;
    const dimension = dimensions[dimIndex];
    if (dimension?.values?.includes(draft)) {
      onWarning("這個規格值已存在。");
      return false;
    }
    const nextDims = appendDimensionValue(dimensions, dimIndex, draft);
    return tryAutoExpandFromDimensions(nextDims, rows);
  }

  function dropAxisValue(dimIndex: number, value: string) {
    const nextDims = removeDimensionValue(dimensions, dimIndex, value);
    tryAutoExpandFromDimensions(nextDims, rows);
  }

  function renameAxisValue(dimIndex: number, oldValue: string, nextValue: string) {
    const trimmed = nextValue.trim();
    if (!trimmed || trimmed === oldValue) return trimmed === oldValue;
    const dimension = dimensions[dimIndex];
    if (!dimension) return false;
    if ((dimension.values ?? []).some((value) => value === trimmed && value !== oldValue)) {
      onWarning("這個規格值已存在，請使用不同名稱。");
      return false;
    }
    const nextDimensions = dimensions.map((item, index) =>
      index === dimIndex
        ? { ...item, values: (item.values ?? []).map((value) => value === oldValue ? trimmed : value) }
        : item
    );
    const nextRows = rows.map((row) => {
      if ((row.optionValues[dimIndex] ?? "") !== oldValue) return row;
      const optionValues = [...row.optionValues] as [string, string, string];
      optionValues[dimIndex] = trimmed;
      return { ...row, optionValues };
    });
    onDimensionsChange(nextDimensions);
    setRowsSafe(nextRows);
    onWarning(null);
    return true;
  }

  function confirmPendingAxisChange() {
    if (confirmArm?.kind !== "expand") return;
    const targetDimensions = confirmArm.nextDimensions ?? dimensions;
    const result = expandAndMergeVariantRows(targetDimensions, rows);
    clearConfirmArm();
    onDimensionsChange(targetDimensions);
    setRowsSafe(withInheritedProductCost(result.rows));
    onWarning(result.warning ?? null);
  }

  function duplicateRow(index: number) {
    if (rowsAtMax) {
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
      sellPriceLocked: source.sellPriceLocked,
      compareAtLocked: source.compareAtLocked,
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
    ].map((row, rowIndex) => ({ ...row, sortOrder: rowIndex }));
    setRowsSafe(next);
    setMobileSelected(new Set());
    onWarning(null);
  }

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

  function applyCharacters() {
    const names = Object.entries(charSelected)
      .filter(([, checked]) => checked)
      .map(([name]) => name);
    if (names.length === 0) {
      setCharOpen(false);
      if (editorModal?.kind === "character") closeEditorModal();
      return;
    }
    const result = appendCharacterRows(dimensions, rows, names);
    onDimensionsChange(result.dimensions);
    setRowsSafe(withInheritedProductCost(result.rows));
    onWarning(result.warning ?? null);
    setCharSelected({});
    setCharOpen(false);
    if (editorModal?.kind === "character") closeEditorModal();
  }

  function openEditorModal(next: Exclude<EditorModal, null>) {
    setModalValue("");
    setModalCompareAt("");
    if (next.kind === "edit-option") {
      setModalValue(rows[next.rowIndex]?.optionValues[next.dimIndex] ?? "");
    } else if (next.kind === "edit-price") {
      setModalValue(rows[next.rowIndex]?.sellPrice ?? "");
      setModalCompareAt(rows[next.rowIndex]?.compareAt ?? "");
    } else if (next.kind === "add-variant") {
      setVariantDraft(
        (dimensions.length > 0 ? dimensions : [{ name: "款式", values: [] }]).map(
          (dimension) => dimension.values?.[0] ?? ""
        )
      );
    }
    setEditorModal(next);
    setCharOpen(false);
    setPickIndex(null);
  }

  function closeEditorModal() {
    setEditorModal(null);
    setModalValue("");
    setModalCompareAt("");
  }

  function toggleMobileRowSelection(index: number) {
    setMobileSelected((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function startRowLongPress(index: number, event: ReactPointerEvent<HTMLDivElement>) {
    if (isInteractiveTarget(event.target)) return;
    rowLpTriggeredRef.current = false;
    clearRowLpTimer();
    rowLpTimerRef.current = window.setTimeout(() => {
      rowLpTriggeredRef.current = true;
      rowLpTimerRef.current = null;
      toggleMobileRowSelection(index);
    }, ROW_LONG_PRESS_MS);
  }

  function cancelRowLongPress() {
    clearRowLpTimer();
  }

  function onMobileRowClick(index: number, event: ReactMouseEvent<HTMLDivElement>) {
    if (rowLpTriggeredRef.current) {
      rowLpTriggeredRef.current = false;
      event.preventDefault();
      return;
    }
    if (mobileSelected.size > 0 && !isInteractiveTarget(event.target)) {
      toggleMobileRowSelection(index);
    }
  }

  function onTouchDragPointerDown(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    touchDragRef.current = {
      pointerId: event.pointerId,
      fromIndex: index,
      overIndex: index,
      startX: event.clientX,
      startY: event.clientY,
      active: false
    };
  }

  function onTouchDragPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < TOUCH_DRAG_PX) return;
      drag.active = true;
    }
    const hit = document.elementFromPoint(event.clientX, event.clientY);
    const rowElement = hit?.closest<HTMLElement>("[data-variant-row-index]");
    if (!rowElement) return;
    const overIndex = Number(rowElement.dataset.variantRowIndex);
    if (Number.isInteger(overIndex)) drag.overIndex = overIndex;
  }

  function finishTouchDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = touchDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    touchDragRef.current = null;
    if (drag.active && drag.fromIndex !== drag.overIndex) {
      applyRowReorder(String(drag.fromIndex), String(drag.overIndex));
    }
  }

  function applyBatchCost() {
    const cost = Number(modalValue);
    if (!Number.isFinite(cost) || cost < 0) {
      onWarning("請輸入有效成本。");
      return;
    }
    if (mobileSelected.size === 0) {
      onWarning("請先長按並選取至少一列 Variant。");
      return;
    }
    const selected = mobileSelected;
    let next = rows.map((row, index) =>
      selected.has(index)
        ? { ...row, cost: String(cost), costIsInherited: false }
        : row
    );
    next = recalculateUnlockedVariantPrices(next, {
      currency,
      priceMode,
      settings: pricingSettings,
      productCost
    });
    setRowsSafe(next);
    setMobileSelected(new Set());
    closeEditorModal();
    onWarning(null);
  }

  function startPickLongPress(image: VariantImageOption, touch: { clientX: number; clientY: number }) {
    pickTouchStartRef.current = { x: touch.clientX, y: touch.clientY };
    pickLpTriggeredRef.current = false;
    clearPickLpTimer();
    pickLpTimerRef.current = window.setTimeout(() => {
      pickLpTriggeredRef.current = true;
      pickLpTimerRef.current = null;
      setZoomPreview({ url: image.url, label: image.label });
    }, PICK_LONG_PRESS_MS);
  }

  function onPickTouchMove(event: ReactTouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - pickTouchStartRef.current.x;
    const dy = touch.clientY - pickTouchStartRef.current.y;
    if (Math.abs(dx) > PICK_MOVE_PX || Math.abs(dy) > PICK_MOVE_PX) clearPickLpTimer();
  }

  function selectPickImage(rowIndex: number, imageId: string | null) {
    if (pickLpTriggeredRef.current) {
      pickLpTriggeredRef.current = false;
      return;
    }
    updateRow(rowIndex, { imageId });
    setPickIndex(null);
  }

  const dimHeaders = dimensions.length > 0 ? dimensions : [];
  const showGrid = rows.length > 0 || dimensions.length > 0;
  const gridCols = `28px 42px ${dimHeaders.map(() => "1fr").join(" ") || "1fr"} 72px 26px`;

  const batchPreview = useMemo(() => {
    const cost = Number(modalValue);
    if (editorModal?.kind !== "batch-cost" || !Number.isFinite(cost) || cost < 0) return null;
    return calculatePrice(cost, {
      currency,
      priceMode,
      settings: pricingSettings
    });
  }, [currency, editorModal, modalValue, priceMode, pricingSettings]);

  const renderContext = {
    addAxisValue,
    addDimension,
    addRow,
    applyBatchCost,
    applyCharacters,
    applyRowReorder,
    batchPreview,
    cancelRowLongPress,
    charLoading,
    charQuery,
    charSelected,
    clearPickLpTimer,
    closeEditorModal,
    costLabel,
    dimensions,
    dimHeaders,
    duplicateRow,
    editorModal,
    filteredChars,
    finishTouchDrag,
    gridCols,
    images,
    isNarrow,
    mobileSelected,
    modalCompareAt,
    modalValue,
    onCostChange,
    onManualPrice,
    onMobileRowClick,
    onPickTouchMove,
    onTouchDragPointerDown,
    onTouchDragPointerMove,
    openEditorModal,
    pickIndex,
    portalReady,
    priceMode,
    productCost,
    removeRow,
    renameAxisValue,
    reorderDragKey,
    reorderOverKey,
    rows,
    rowsAtMax,
    selectPickImage,
    setCharQuery,
    setCharSelected,
    setModalCompareAt,
    setModalValue,
    setPickIndex,
    setReorderDragKey,
    setReorderOverKey,
    setVariantDraft,
    setZoomPreview,
    showGrid,
    startPickLongPress,
    startRowLongPress,
    updateRow,
    variantDraft,
    zoomPreview
  };

  const modal = renderVariantEditorModal(renderContext);

  const zoomModal = renderVariantEditorZoomModal(renderContext);

  return (
    <div className="variant-box" ref={rootRef}>
      <div className="variant-head"><span>款式規格</span></div>

      {isNarrow ? (
        <div className="vh-mobile-primary-actions" role="toolbar" aria-label="規格操作">
          <button type="button" className="vh-add-dim-ghost" disabled={dimensions.length >= MAX_VARIANT_DIMENSIONS} onClick={() => openEditorModal({ kind: "add-dimension" })}>＋新增維度</button>
          <button type="button" className="vh-toolbar-action" onClick={() => openEditorModal({ kind: "character" })}>依角色建立</button>
          <button type="button" className="vh-mobile-batch-btn" disabled={mobileSelected.size === 0} onClick={() => openEditorModal({ kind: "batch-cost" })}>批次手動覆蓋價格{mobileSelected.size ? `（${mobileSelected.size}）` : ""}</button>
        </div>
      ) : null}

      <details className="vh-builder" open={builderOpen} onToggle={(event) => setBuilderOpen(event.currentTarget.open)}>
        <summary className="vh-builder-summary">
          <span>建立規格</span>
          <span className="muted">{dimensions.length ? `${dimensions.length} 個類型` : "尚未建立"}</span>
        </summary>
        <div className="vh-dims">
          {!isNarrow ? (
            <div className="vh-dim-toolbar--top">
              <button type="button" className="vh-add-dim-ghost" disabled={dimensions.length >= MAX_VARIANT_DIMENSIONS} onClick={() => openEditorModal({ kind: "add-dimension" })}>＋ 新增維度</button>
              <button type="button" className="vh-toolbar-action" onClick={() => setCharOpen(true)}>依角色建立</button>
              <button type="button" className="vh-toolbar-action" disabled={!canApplyProductCost} title="只填空白成本列，已填不覆蓋" onClick={applyCostToAllVariants}>套用成本</button>
            </div>
          ) : null}

          {dimensions.length === 0 ? (
            <div className="vh-dims-empty"><span className="vh-dims-empty-text">尚無規格類型，請新增尺寸、顏色或自訂維度。</span></div>
          ) : dimensions.map((dimension, i) => {
            const dimArmed = confirmArm?.kind === "remove-dim" && confirmArm.dimIndex === i;
            return (
              <div className="vh-dim-row" key={`${dimension.name}-${i}`}>
                <div className="vh-dim-heading-row">
                  <span className="vh-dim-heading">{dimension.name}</span>
                  <button type="button" className={`vh-dim-remove${dimArmed ? " v-arm-confirm" : ""}`} onClick={() => removeDimension(i)}>{dimArmed ? `確定移除？${confirmArm.count}筆會丟失` : "移除維度"}</button>
                </div>
                <div className="vh-dim-values rc-tag-group-chips">
                  {(dimension.values ?? []).map((value) => (
                    <span className="rc-tag vh-axis-tag" key={`${dimension.name}-${value}`}>
                      {value}
                      <button type="button" className="rc-tag-remove" aria-label={`移除軸值 ${value}`} onClick={() => dropAxisValue(i, value)}>×</button>
                    </span>
                  ))}
                  <button type="button" className="rc-tag add vh-add-value-chip" onClick={() => openEditorModal({ kind: "add-value", dimIndex: i })}>＋ 新增值</button>
                </div>
              </div>
            );
          })}

          {charOpen ? (
            <div className="pop-menu open v-pop-char vh-inline-pop">
              <div className="pm-title">勾選這款有出的角色（可多選）</div>
              <input className="v-char-search" onChange={(event) => setCharQuery(event.target.value)} placeholder="搜尋角色／IP…" value={charQuery} />
              {charLoading ? <div className="variant-empty">載入角色字典…</div> : (
                <div className="v-char-list">
                  {filteredChars.map((character) => (
                    <label key={character.id}>
                      <input type="checkbox" checked={Boolean(charSelected[character.name])} onChange={(event) => setCharSelected((current) => ({ ...current, [character.name]: event.target.checked }))} />
                      <span>{character.name}{character.ip ? <span className="v-char-ip"> · {character.ip}</span> : null}</span>
                    </label>
                  ))}
                </div>
              )}
              <Button size="sm" className="v-pop-full" onClick={applyCharacters} type="button">建立所選角色列</Button>
            </div>
          ) : null}

          {expandArmed ? (
            <Button size="md" fullWidth variant="danger" className="vh-expand-primary v-arm-confirm" onClick={confirmPendingAxisChange} type="button">確認更新款式（{expandArmCount} 筆手填會丟失）</Button>
          ) : null}
        </div>
      </details>

      {renderVariantEditorResults(renderContext)}

      {lockedCount > 0 ? <div className="v-sync-warn">⚠ {lockedCount} 筆規格因手動修改未同步公式重算，請確認</div> : null}
      {warning ? <div className="v-sync-warn">{warning}</div> : null}
      {footer}
      {zoomModal}
      {modal}
    </div>
  );
}

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
