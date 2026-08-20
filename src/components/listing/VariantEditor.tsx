"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
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

/** UX-AB T104: inline double-confirm arm (3s auto-reset; no window.confirm). */
const ARM_MS = 3000;
/** UX-B3-P06: mobile pick-grid long-press zoom (slightly under P04 500ms). */
const PICK_LONG_PRESS_MS = 450;
const PICK_MOVE_PX = 10;

type ConfirmArm =
  | null
  | { kind: "remove-dim"; dimIndex: number; count: number }
  | {
      kind: "expand";
      count: number;
      /** P0-1: candidate axis change stays pending until the second confirm click. */
      nextDimensions?: VariantDimension[];
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
  const [moreOpen, setMoreOpen] = useState(false);
  const [customDim, setCustomDim] = useState("");
  const [pickIndex, setPickIndex] = useState<number | null>(null);
  const [charQuery, setCharQuery] = useState("");
  const [charList, setCharList] = useState<{ id: string; name: string; ip: string }[]>([]);
  const [charSelected, setCharSelected] = useState<Record<string, boolean>>({});
  const [charLoading, setCharLoading] = useState(false);
  /** Per-dimension draft for adding an axis value (pkg2b). */
  const [axisValueDraft, setAxisValueDraft] = useState<Record<number, string>>({});
  /** UX-AB T104: first click arms destructive remove/expand; second executes. */
  const [confirmArm, setConfirmArm] = useState<ConfirmArm>(null);
  /** UX-B3-P06: desktop row drag / mobile ▲▼; keys = index strings. */
  const [isNarrow, setIsNarrow] = useState(false);
  const [reorderDragKey, setReorderDragKey] = useState<string | null>(null);
  const [reorderOverKey, setReorderOverKey] = useState<string | null>(null);
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

  // Close popovers on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setCharOpen(false);
        setDimOpen(false);
        setMoreOpen(false);
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

  function moveRow(index: number, delta: number) {
    applyRowReorder(String(index), String(index + delta));
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
    setMoreOpen(false);
  }

  function closeAllPops() {
    setCharOpen(false);
    setDimOpen(false);
    setMoreOpen(false);
    setPickIndex(null);
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

  return (
    <div className="variant-box" ref={rootRef}>
      <div className="variant-head">
        <span>款式規格</span>
      </div>

      {/* UX-B3-P06 ①: B 方案 — 維度列常駐 + 主 CTA 展開 + ⋯ 次要 */}
      <div className="vh-dims">
        {dimensions.length === 0 ? (
          <div className="vh-dims-empty">
            <span className="vh-dims-empty-text">尚無規格類型，可一鍵加入常用維度（軸值請自行填）</span>
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
          </div>
        ) : (
          dimensions.map((d, i) => {
            const dimArmed =
              confirmArm?.kind === "remove-dim" && confirmArm.dimIndex === i;
            const armCount = dimArmed ? confirmArm.count : 0;
            return (
              <div className="vh-dim-row" key={`${d.name}-${i}`}>
                {/* UX-B4-P03 ②: type on its own row (heavier chip); values below */}
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
                </div>
              </div>
            );
          })
        )}

        <div className="vh-dim-toolbar">
          {dimensions.length < MAX_VARIANT_DIMENSIONS ? (
            <button
              type="button"
              className="vh-add-dim-ghost"
              onClick={() => {
                setDimOpen((o) => !o);
                setCharOpen(false);
                setMoreOpen(false);
                setPickIndex(null);
              }}
            >
              ＋ 新增一個規格類型
            </button>
          ) : (
            <span className="vh-add-dim-ghost is-disabled" aria-disabled>
              規格類型已滿（{MAX_VARIANT_DIMENSIONS}）
            </span>
          )}

          <div className="vh-more">
            <button
              type="button"
              className="vh-more-btn"
              aria-expanded={moreOpen}
              aria-label="更多規格操作"
              onClick={() => {
                setMoreOpen((o) => !o);
                setDimOpen(false);
                setCharOpen(false);
                setPickIndex(null);
              }}
            >
              ⋯
            </button>
            {moreOpen ? (
              <div className="pop-menu open vh-more-menu">
                <div className="pm-title">更多操作</div>
                <button
                  type="button"
                  className="vh-more-item"
                  disabled={!canApplyProductCost}
                  title={
                    canApplyProductCost
                      ? "只填空白成本列，已填不覆蓋"
                      : rows.length === 0
                        ? "請先新增款式列"
                        : "請先填商品成本"
                  }
                  onClick={applyCostToAllVariants}
                >
                  套用成本到全部款式
                </button>
                <button
                  type="button"
                  className="vh-more-item"
                  onClick={() => {
                    setCharOpen(true);
                    setMoreOpen(false);
                    setDimOpen(false);
                    setPickIndex(null);
                  }}
                >
                  依角色建立
                </button>
              </div>
            ) : null}
          </div>
        </div>

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
            <Button
              size="sm"
              className="v-pop-full"
              onClick={() => addDimension(customDim)}
              type="button"
            >
              加入
            </Button>
          </div>
        ) : null}

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
                      {c.ip ? (
                        <span className="v-char-ip"> · {c.ip}</span>
                      ) : null}
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

        {/* Normal axis edits auto-expand. A button appears only when preserving
            hand-entered data requires an explicit destructive confirmation. */}
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
        ) : (
          <p className="vh-auto-expand-note" role="status">
            {canExpand ? "軸值變更後會自動更新款式列" : "加入軸值後會自動建立款式列"}
          </p>
        )}
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
              <div key={index} className="vgrid-block">
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
                  {!isNarrow ? (
                    <span
                      className="vdrag"
                      title="拖曳排序"
                      draggable
                      aria-label={`拖曳排序第 ${index + 1} 列`}
                      onDragStart={(event) => {
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
                    >
                      ⠿
                    </span>
                  ) : null}
                  <span className="vthumb-wrap">
                    <button
                      className="vthumb"
                      onClick={() => {
                        setPickIndex(pickIndex === index ? null : index);
                        setCharOpen(false);
                        setDimOpen(false);
                        setMoreOpen(false);
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
                    return (
                      <span className="v-cell" data-label={dimLabel} key={di}>
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
                          value={row.optionValues[di] ?? ""}
                        />
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
                    {isNarrow ? (
                      <span className="v-row-move">
                        <button
                          type="button"
                          className="v-row-move-btn"
                          aria-label="上移此列"
                          disabled={index === 0}
                          onClick={() => moveRow(index, -1)}
                        >
                          ▲
                        </button>
                        <button
                          type="button"
                          className="v-row-move-btn"
                          aria-label="下移此列"
                          disabled={index >= rows.length - 1}
                          onClick={() => moveRow(index, 1)}
                        >
                          ▼
                        </button>
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className="v-row-dup"
                      aria-label={
                        rowsAtMax
                          ? `款式列已達上限 ${MAX_VARIANT_ROWS}，無法複製`
                          : "複製此列再編輯"
                      }
                      title={
                        rowsAtMax
                          ? `已達上限 ${MAX_VARIANT_ROWS} 列，無法再複製`
                          : "複製此列（可再改軸值／成本）"
                      }
                      disabled={rowsAtMax}
                      onClick={() => duplicateRow(index)}
                    >
                      複製
                    </button>
                    <button
                      aria-label="刪除此列"
                      className="variant-del"
                      onClick={() => removeRow(index)}
                      type="button"
                    >
                      🗑
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
