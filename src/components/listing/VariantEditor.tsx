"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CostCurrency, PriceMode, PricingSettings } from "@/lib/pricing";
import {
  MAX_VARIANT_DIMENSIONS,
  MAX_VARIANT_ROWS,
  appendCharacterRows,
  clampDimensions,
  clampVariantRows,
  countLockedVariants,
  emptyVariantRow,
  formatVariantPriceLine,
  isVariantRowFilled,
  lockVariantPrice,
  recalculateUnlockedVariantPrices,
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
  /** Product images for picker (main preferred). */
  images: VariantImageOption[];
  /** Optional: draft id for loading characters — not required. */
  warning: string | null;
  onWarning: (w: string | null) => void;
  /** B3 spec-shot slot rendered by parent below the grid. */
  footer?: ReactNode;
};

const QUICK_DIMS = ["尺寸", "顏色"] as const;

export function VariantEditor({
  dimensions,
  rows,
  onDimensionsChange,
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
  const rootRef = useRef<HTMLDivElement>(null);

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
      settings: pricingSettings
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
    onDimensionsChange(clampDimensions([...dimensions, { name: trimmed }]));
    setCustomDim("");
    setDimOpen(false);
  }

  function removeDimension(dimIndex: number) {
    const nextDims = dimensions.filter((_, i) => i !== dimIndex);
    onDimensionsChange(nextDims);
    const nextRows = rows.map((row) => {
      const optionValues = [...row.optionValues] as [string, string, string];
      // shift values after removed dim
      for (let i = dimIndex; i < 2; i++) {
        optionValues[i] = optionValues[i + 1] ?? "";
      }
      optionValues[2] = "";
      return { ...row, optionValues };
    });
    setRowsSafe(nextRows);
  }

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

  const dimHeaders = dimensions.length > 0 ? dimensions : [];
  const showGrid = rows.length > 0 || dimensions.length > 0;

  return (
    <div className="variant-box" ref={rootRef}>
      <div className="variant-head">
        <span>款式規格</span>
        <span className="vh-btns">
          <button
            className="btn-mini"
            onClick={() => {
              setCharOpen((o) => !o);
              setDimOpen(false);
              setPickIndex(null);
            }}
            type="button"
          >
            依角色建立 ▾
          </button>
          <button
            className="btn-mini"
            onClick={() => {
              setDimOpen((o) => !o);
              setCharOpen(false);
              setPickIndex(null);
            }}
            type="button"
          >
            ＋新增維度（最多{MAX_VARIANT_DIMENSIONS}）
          </button>
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
              <button className="btn-mini v-pop-full" onClick={applyCharacters} type="button">
                建立所選角色列
              </button>
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
              <button
                className="btn-mini v-pop-full"
                onClick={() => addDimension(customDim)}
                type="button"
              >
                加入
              </button>
            </div>
          ) : null}
        </span>
      </div>

      {dimensions.length > 0 ? (
        <div className="v-dim-chips">
          {dimensions.map((d, i) => (
            <span className="v-dim-chip" key={`${d.name}-${i}`}>
              {d.name}
              <button
                aria-label={`移除維度 ${d.name}`}
                className="v-dim-x"
                onClick={() => removeDimension(i)}
                type="button"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {!showGrid || rows.length === 0 ? (
        <div className="variant-empty">單一款式可留空；多款式再新增維度或依角色建立。</div>
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
                        alt=""
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
                      <button
                        className="btn-mini v-pop-full"
                        onClick={() => {
                          updateRow(index, { imageId: null });
                          setPickIndex(null);
                        }}
                        type="button"
                      >
                        移除目前圖片
                      </button>
                    </div>
                  ) : null}
                </span>
                {(dimHeaders.length > 0 ? dimHeaders : [{ name: "款式" }]).map((_, di) => (
                  <input
                    aria-label={dimHeaders[di]?.name ?? "選項"}
                    key={di}
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
                ))}
                <input
                  aria-label={costLabel}
                  onChange={(e) => onCostChange(index, e.target.value)}
                  placeholder="成本"
                  type="number"
                  value={row.cost}
                />
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
                  {formatVariantPriceLine(row, priceMode)}
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
                      <input
                        aria-label="庫存"
                        className="v-qty"
                        onChange={(e) => updateRow(index, { qty: e.target.value })}
                        placeholder="庫存空白=無上限"
                        type="number"
                        value={row.qty}
                      />
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

      <div className="v-foot-note">
        成本跟上方同幣別；每列庫存預設無上限；SKU 有來源再填（進階略）
      </div>

      {footer}
    </div>
  );
}

/** Parent can call when currency/settings/priceMode change. */
export function repriceVariants(
  rows: VariantFormRow[],
  opts: { currency: CostCurrency; priceMode: PriceMode; settings: PricingSettings }
): VariantFormRow[] {
  return recalculateUnlockedVariantPrices(rows, opts);
}
