"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  recalculateUnlockedVariantPrices,
  removeDimensionMergingRows,
  removeDimensionValue,
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
type ConfirmArm =
  | null
  | { kind: "remove-dim"; dimIndex: number; count: number }
  | { kind: "expand"; count: number };

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
  const armTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

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

  useEffect(() => () => clearArmTimer(), []);

  const lockedCount = countLockedVariants(rows);
  const costLabel = currency === "CNY" ? "成本 ¥" : "成本 NT$";

  // Close popovers on outside click
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
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
    let next = rows.map((r, i) => (i === index ? { ...r, cost } : r));
    next = recalculateUnlockedVariantPrices(next, {
      currency,
      priceMode,
      settings: pricingSettings,
      productCost
    });
    setRowsSafe(next);
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
    setRowsSafe([...rows, emptyVariantRow(rows.length)]);
  }

  function removeRow(index: number) {
    setRowsSafe(rows.filter((_, i) => i !== index).map((r, i) => ({ ...r, sortOrder: i })));
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
    // New axis starts with empty values — does not auto-cartesian (Fable).
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

  function addAxisValue(dimIndex: number) {
    const draft = (axisValueDraft[dimIndex] ?? "").trim();
    if (!draft) return;
    onDimensionsChange(appendDimensionValue(dimensions, dimIndex, draft));
    setAxisValueDraft((cur) => ({ ...cur, [dimIndex]: "" }));
  }

  function dropAxisValue(dimIndex: number, value: string) {
    onDimensionsChange(removeDimensionValue(dimensions, dimIndex, value));
  }

  /**
   * Fable: expand is a separate button — never auto full cartesian.
   * Merge preserves hand-fill on key hit; discard needs double-confirm.
   */
  function expandFromAxisValues() {
    if (!canExpandFromDimensions(dimensions)) {
      onWarning("請先在各維度加上軸值，再按展開。");
      return;
    }
    const result = expandAndMergeVariantRows(dimensions, rows);
    if (result.comboCount === 0) {
      onWarning("沒有可展開的軸值組合。");
      return;
    }
    if (result.wouldDiscardHandFilled.length > 0) {
      // UX-AB T104: inline double-confirm (ResultCard / UX-L T61 pattern)
      const count = result.wouldDiscardHandFilled.length;
      const armed = confirmArm?.kind === "expand";
      if (!armed) {
        armConfirm({ kind: "expand", count });
        return;
      }
    }
    clearConfirmArm();
    onRowsChange(result.rows);
    if (result.warning) onWarning(result.warning);
    else onWarning(null);
  }

  const expandArmed = confirmArm?.kind === "expand";
  const expandArmCount = expandArmed ? confirmArm.count : 0;

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
    onRowsChange(result.rows);
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

  const dimHeaders = dimensions.length > 0 ? dimensions : [];
  const showGrid = rows.length > 0 || dimensions.length > 0;

  return (
    <div className="variant-box" ref={rootRef}>
      <div className="variant-head">
        <span>款式規格</span>
      </div>
      {/* UX-PKG4: ①設定維度 → ②填軸值 → ③展開；左設定／右執行 */}
      <div className="vh-steps-hint">
        <span>① 新增維度</span>
        <span>→</span>
        <span>② 填入軸值</span>
        <span>→</span>
        <span>③ 依軸值展開列</span>
      </div>
      <div className="vh-btns">
        <div className="vh-group vh-group--setup">
          <Button
            size="sm"
            onClick={() => {
              setDimOpen((o) => !o);
              setCharOpen(false);
              setPickIndex(null);
            }}
            type="button"
          >
            ＋新增維度（最多{MAX_VARIANT_DIMENSIONS}）
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setCharOpen((o) => !o);
              setDimOpen(false);
              setPickIndex(null);
            }}
            type="button"
          >
            依角色建立 ▾
          </Button>
        </div>
        <div className="vh-divider" aria-hidden />
        <div className="vh-group vh-group--action">
          <Button
            size="sm"
            variant="secondary"
            disabled={!canApplyProductCost}
            onClick={applyCostToAllVariants}
            title={
              canApplyProductCost
                ? "只填空白成本列，已填不覆蓋"
                : rows.length === 0
                  ? "請先新增款式列"
                  : "請先填商品成本"
            }
            type="button"
          >
            套用成本到全部款式
          </Button>
          <Button
            size="sm"
            variant={expandArmed ? "danger" : "primary"}
            className={expandArmed ? "v-arm-confirm" : undefined}
            disabled={!canExpandFromDimensions(dimensions)}
            onClick={expandFromAxisValues}
            title={
              expandArmed
                ? `再點一次確認展開（${expandArmCount} 筆手填會丟失）`
                : canExpandFromDimensions(dimensions)
                  ? "依各軸值交叉展開款式列（不會自動展開，需按此鈕）"
                  : "請先在維度上加入軸值"
            }
            type="button"
          >
            {expandArmed
              ? `確定展開？${expandArmCount}筆會丟失`
              : "依軸值展開列"}
          </Button>
        </div>
        {charOpen ? (
          <div className="pop-menu open v-pop-char">
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
        {dimOpen ? (
          <div className="pop-menu open v-pop-dim">
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
      </div>

      {dimensions.length > 0 ? (
        <div className="v-dim-axes">
          {dimensions.map((d, i) => (
            <div className="v-dim-axis" key={`${d.name}-${i}`}>
              <div className="v-dim-axis-head">
                <span className="v-dim-chip">
                  {d.name}
                  {(() => {
                    const dimArmed =
                      confirmArm?.kind === "remove-dim" &&
                      confirmArm.dimIndex === i;
                    const armCount = dimArmed ? confirmArm.count : 0;
                    return (
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
                            : undefined
                        }
                        type="button"
                      >
                        {dimArmed ? `確定移除？${armCount}筆會丟失` : "×"}
                      </button>
                    );
                  })()}
                </span>
              </div>
              <div className="v-dim-values">
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
                <span className="v-axis-add">
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
          ))}
        </div>
      ) : null}

      {!showGrid || rows.length === 0 ? (
        <div className="variant-empty">
          單一款式可留空；細節見上方步驟與維度列。
        </div>
      ) : (
        <>
          <div
            className="vgrid-hdr"
            style={{
              gridTemplateColumns: `42px ${dimHeaders.map(() => "1fr").join(" ") || "1fr"} 72px 26px`
            }}
          >
            <span>圖</span>
            {dimHeaders.length > 0 ? (
              dimHeaders.map((d, i) => <span key={i}>{d.name}</span>)
            ) : (
              <span>選項</span>
            )}
            <span>{costLabel}</span>
            <span />
          </div>
          {rows.map((row, index) => (
            <div key={index} className="vgrid-block">
              <div
                className="vgrid-row"
                style={{
                  gridTemplateColumns: `42px ${dimHeaders.map(() => "1fr").join(" ") || "1fr"} 72px 26px`
                }}
              >
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
                              onClick={() => {
                                updateRow(index, { imageId: im.id });
                                setPickIndex(null);
                              }}
                              title={im.label}
                              type="button"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img alt={im.label} src={im.url} />
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
                    onChange={(e) => onCostChange(index, e.target.value)}
                    placeholder={
                      productCost != null && productCost > 0
                        ? `同商品成本 ${currency === "CNY" ? "¥" : "NT$"}${productCost}`
                        : "成本"
                    }
                    type="number"
                    value={row.cost}
                  />
                </span>
                <span className="v-row-actions">
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
          ))}
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
    </div>
  );
}

/** Parent can call when currency/settings/priceMode/productCost change. */
export function repriceVariants(
  rows: VariantFormRow[],
  opts: {
    currency: CostCurrency;
    priceMode: PriceMode;
    settings: PricingSettings;
    productCost?: number | null;
  }
): VariantFormRow[] {
  return recalculateUnlockedVariantPrices(rows, opts);
}
