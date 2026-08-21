"use client";

import type {
  Dispatch,
  ReactNode,
  SetStateAction,
  TouchEvent as ReactTouchEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent
} from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";
import type { PriceMode, PriceResult } from "@/lib/pricing";
import {
  MAX_VARIANT_ROWS,
  formatVariantPriceLine,
  isVariantRowFilled,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";

export type EditorModal =
  | null
  | { kind: "character" }
  | { kind: "add-dimension" }
  | { kind: "add-value"; dimIndex: number }
  | { kind: "edit-option"; rowIndex: number; dimIndex: number }
  | { kind: "edit-price"; rowIndex: number }
  | { kind: "batch-cost" }
  | { kind: "add-variant" };

type ImageOption = { id: string; url: string; label: string };
type ZoomPreview = { url: string; label: string } | null;
type CharacterOption = { id: string; name: string; ip: string };

type VariantEditorRenderContext = {
  addAxisValue: (dimIndex: number, value: string) => boolean;
  addDimension: (name: string) => boolean;
  addRow: (optionValues?: string[]) => boolean;
  applyBatchCost: () => void;
  applyCharacters: () => void;
  applyRowReorder: (fromKey: string, toKey: string) => void;
  batchPreview: PriceResult | null;
  cancelRowLongPress: () => void;
  charLoading: boolean;
  charQuery: string;
  charSelected: Record<string, boolean>;
  clearPickLpTimer: () => void;
  closeEditorModal: () => void;
  costLabel: string;
  dimensions: VariantDimension[];
  dimHeaders: VariantDimension[];
  duplicateRow: (index: number) => void;
  editorModal: EditorModal;
  filteredChars: CharacterOption[];
  finishTouchDrag: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  gridCols: string;
  images: ImageOption[];
  isNarrow: boolean;
  mobileSelected: Set<number>;
  modalCompareAt: string;
  modalValue: string;
  onCostChange: (index: number, cost: string) => void;
  onManualPrice: (index: number, sellPrice: string, compareAt: string) => void;
  onMobileRowClick: (index: number, event: ReactMouseEvent<HTMLDivElement>) => void;
  onPickTouchMove: (event: ReactTouchEvent) => void;
  onTouchDragPointerDown: (index: number, event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTouchDragPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  openEditorModal: (next: Exclude<EditorModal, null>) => void;
  pickIndex: number | null;
  portalReady: boolean;
  priceMode: PriceMode;
  productCost: number | null;
  removeRow: (index: number) => void;
  renameAxisValue: (dimIndex: number, oldValue: string, nextValue: string) => boolean;
  reorderDragKey: string | null;
  reorderOverKey: string | null;
  rows: VariantFormRow[];
  rowsAtMax: boolean;
  selectPickImage: (rowIndex: number, imageId: string | null) => void;
  setCharQuery: Dispatch<SetStateAction<string>>;
  setCharSelected: Dispatch<SetStateAction<Record<string, boolean>>>;
  setModalCompareAt: Dispatch<SetStateAction<string>>;
  setModalValue: Dispatch<SetStateAction<string>>;
  setPickIndex: Dispatch<SetStateAction<number | null>>;
  setReorderDragKey: Dispatch<SetStateAction<string | null>>;
  setReorderOverKey: Dispatch<SetStateAction<string | null>>;
  setVariantDraft: Dispatch<SetStateAction<string[]>>;
  setZoomPreview: Dispatch<SetStateAction<ZoomPreview>>;
  showGrid: boolean;
  startPickLongPress: (image: ImageOption, touch: { clientX: number; clientY: number }) => void;
  startRowLongPress: (index: number, event: ReactPointerEvent<HTMLDivElement>) => void;
  updateRow: (index: number, patch: Partial<VariantFormRow>) => void;
  variantDraft: string[];
  zoomPreview: ZoomPreview;
};

const QUICK_DIMS = ["尺寸", "顏色"] as const;

function renderImagePicker(ctx: VariantEditorRenderContext, row: VariantFormRow, index: number) {
  const { clearPickLpTimer, images, onPickTouchMove, pickIndex, selectPickImage, setPickIndex, startPickLongPress } = ctx;
  return (
    <span className="vthumb-wrap">
      <button
        className="vthumb"
        onClick={() => setPickIndex(pickIndex === index ? null : index)}
        type="button"
        aria-label={`選擇第 ${index + 1} 列圖片`}
      >
        {row.imageId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={images.find((image) => image.id === row.imageId)?.label ?? "規格圖"}
            src={images.find((image) => image.id === row.imageId)?.url ?? ""}
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
              {images.map((image) => (
                <button
                  className={`pk${row.imageId === image.id ? " sel" : ""}`}
                  key={image.id}
                  onClick={() => selectPickImage(index, image.id)}
                  onTouchStart={(event) => {
                    const touch = event.touches[0];
                    if (touch) startPickLongPress(image, touch);
                  }}
                  onTouchMove={onPickTouchMove}
                  onTouchEnd={clearPickLpTimer}
                  onTouchCancel={clearPickLpTimer}
                  title={image.label}
                  type="button"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={image.label} src={image.url} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" aria-hidden className="pk-zoom-preview" src={image.url} />
                </button>
              ))}
            </div>
          )}
          <Button size="sm" className="v-pop-full" onClick={() => selectPickImage(index, null)} type="button">
            移除目前圖片
          </Button>
        </div>
      ) : null}
    </span>
  );
}

export function renderVariantEditorModal(ctx: VariantEditorRenderContext): ReactNode {
  const {
    addAxisValue, addDimension, addRow, applyBatchCost, applyCharacters, batchPreview, charLoading,
    charQuery, charSelected, closeEditorModal, costLabel, dimensions, editorModal, filteredChars,
    mobileSelected, modalCompareAt, modalValue, onManualPrice, portalReady, priceMode, renameAxisValue,
    rows, setCharQuery, setCharSelected, setModalCompareAt, setModalValue, setVariantDraft, variantDraft
  } = ctx;
  return portalReady && editorModal
    ? createPortal(
        <div
          className="variant-editor-modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeEditorModal();
          }}
        >
          <div className="variant-editor-modal" role="dialog" aria-modal="true">
            {editorModal.kind === "character" ? (
              <>
                <div className="variant-editor-modal-title">依角色建立</div>
                <label className="variant-editor-modal-field">
                  <span>搜尋角色 / IP</span>
                  <input className="v-char-search" onChange={(event) => setCharQuery(event.target.value)} placeholder="搜尋角色／IP…" value={charQuery} autoFocus />
                </label>
                {charLoading ? <div className="variant-empty">載入角色字典…</div> : (
                  <div className="v-char-list v-char-list--modal">
                    {filteredChars.map((character) => (
                      <label key={character.id}>
                        <input type="checkbox" checked={Boolean(charSelected[character.name])} onChange={(event) => setCharSelected((current) => ({ ...current, [character.name]: event.target.checked }))} />
                        <span>{character.name}{character.ip ? <span className="v-char-ip"> · {character.ip}</span> : null}</span>
                      </label>
                    ))}
                  </div>
                )}
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" onClick={applyCharacters}>建立所選角色列</Button>
                </div>
              </>
            ) : editorModal.kind === "add-dimension" ? (
              <>
                <div className="variant-editor-modal-title">新增維度</div>
                <div className="variant-editor-modal-quick">
                  {QUICK_DIMS.map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="rc-tag"
                      disabled={dimensions.some((dimension) => dimension.name === name)}
                      onClick={() => {
                        if (addDimension(name)) closeEditorModal();
                      }}
                    >
                      ＋ {name}
                    </button>
                  ))}
                </div>
                <label className="variant-editor-modal-field">
                  <span>自訂維度名稱</span>
                  <input value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus />
                </label>
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" onClick={() => { if (addDimension(modalValue)) closeEditorModal(); }}>新增</Button>
                </div>
              </>
            ) : editorModal.kind === "add-value" ? (
              <>
                <div className="variant-editor-modal-title">新增「{dimensions[editorModal.dimIndex]?.name ?? "規格"}」值</div>
                <label className="variant-editor-modal-field">
                  <span>規格值</span>
                  <input value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus />
                </label>
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" onClick={() => { if (addAxisValue(editorModal.dimIndex, modalValue)) closeEditorModal(); }}>新增</Button>
                </div>
              </>
            ) : editorModal.kind === "edit-option" ? (
              <>
                <div className="variant-editor-modal-title">編輯規格值</div>
                <label className="variant-editor-modal-field">
                  <span>{dimensions[editorModal.dimIndex]?.name ?? "規格"}</span>
                  <input value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus />
                </label>
                <div className="variant-editor-modal-note">修改會同步上方規格 chip 與所有使用同一值的列。</div>
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" onClick={() => {
                    const oldValue = rows[editorModal.rowIndex]?.optionValues[editorModal.dimIndex] ?? "";
                    if (renameAxisValue(editorModal.dimIndex, oldValue, modalValue)) closeEditorModal();
                  }}>儲存</Button>
                </div>
              </>
            ) : editorModal.kind === "edit-price" ? (
              <>
                <div className="variant-editor-modal-title">手動調整價格</div>
                <label className="variant-editor-modal-field"><span>售價 NT$</span><input type="number" value={modalValue} onChange={(event) => setModalValue(event.target.value)} /></label>
                {priceMode === "sale" ? (
                  <label className="variant-editor-modal-field"><span>定價 NT$</span><input type="number" value={modalCompareAt} onChange={(event) => setModalCompareAt(event.target.value)} /></label>
                ) : null}
                <div className="variant-editor-modal-note">儲存後此列維持既有 ✎ 手動鎖定語意。</div>
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" onClick={() => {
                    onManualPrice(editorModal.rowIndex, modalValue, modalCompareAt);
                    closeEditorModal();
                  }}>儲存</Button>
                </div>
              </>
            ) : editorModal.kind === "batch-cost" ? (
              <>
                <div className="variant-editor-modal-title">批次手動覆蓋價格</div>
                <div className="variant-editor-modal-note">已選 {mobileSelected.size} 列。確認後，選取列不論原成本是否空白／繼承／手填，都會覆寫成新成本。</div>
                <label className="variant-editor-modal-field"><span>{costLabel}</span><input type="number" value={modalValue} onChange={(event) => setModalValue(event.target.value)} autoFocus /></label>
                {batchPreview ? (
                  <div className="variant-batch-preview">
                    <span>公式預覽售價 NT${batchPreview.sellPrice.toLocaleString()}</span>
                    {priceMode === "sale" && batchPreview.compareAtPrice != null ? <span>定價 NT${batchPreview.compareAtPrice.toLocaleString()}</span> : null}
                  </div>
                ) : null}
                <div className="variant-editor-modal-note">未鎖定列依既有公式重算售價／定價；已手動鎖定 ✎ 的列保留原售價／定價。</div>
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" disabled={mobileSelected.size === 0} onClick={applyBatchCost}>確認覆蓋</Button>
                </div>
              </>
            ) : (
              <>
                <div className="variant-editor-modal-title">新增 Variant</div>
                {(dimensions.length > 0 ? dimensions : [{ name: "款式", values: [] }]).map((dimension, dimIndex) => (
                  <label className="variant-editor-modal-field" key={`${dimension.name}-${dimIndex}`}>
                    <span>{dimension.name}</span>
                    {(dimension.values ?? []).length > 0 ? (
                      <select value={variantDraft[dimIndex] ?? ""} onChange={(event) => setVariantDraft((current) => current.map((value, index) => index === dimIndex ? event.target.value : value))}>
                        {(dimension.values ?? []).map((value) => <option key={value} value={value}>{value}</option>)}
                      </select>
                    ) : (
                      <input value={variantDraft[dimIndex] ?? ""} onChange={(event) => setVariantDraft((current) => current.map((value, index) => index === dimIndex ? event.target.value : value))} />
                    )}
                  </label>
                ))}
                <div className="variant-editor-modal-actions">
                  <Button variant="ghost" type="button" onClick={closeEditorModal}>取消</Button>
                  <Button type="button" onClick={() => { if (addRow(variantDraft)) closeEditorModal(); }}>新增</Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )
    : null;
}

export function renderVariantEditorZoomModal(ctx: VariantEditorRenderContext): ReactNode {
  const { portalReady, setZoomPreview, zoomPreview } = ctx;
  return portalReady && zoomPreview
    ? createPortal(
        <div className="pk-zoom-modal" role="dialog" aria-modal="true" onClick={() => setZoomPreview(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={zoomPreview.label} className="pk-zoom-modal-img" src={zoomPreview.url} onClick={(event) => event.stopPropagation()} />
          <button type="button" className="pk-zoom-modal-close" onClick={() => setZoomPreview(null)}>關閉</button>
        </div>,
        document.body
      )
    : null;
}

export function renderVariantEditorResults(ctx: VariantEditorRenderContext): ReactNode {
  const {
    addRow, applyRowReorder, cancelRowLongPress, costLabel, dimHeaders, duplicateRow, finishTouchDrag,
    gridCols, isNarrow, mobileSelected, onCostChange, onMobileRowClick, onTouchDragPointerDown,
    onTouchDragPointerMove, openEditorModal, priceMode, productCost, removeRow, reorderDragKey,
    reorderOverKey, rows, rowsAtMax, setReorderDragKey, setReorderOverKey, showGrid, startRowLongPress,
    updateRow
  } = ctx;
  return (
    <>
      <div className="vh-results-heading">
        <span>款式結果</span>
        <span className="muted">{rows.length ? `${rows.length} 款` : "尚無款式"}</span>
      </div>

      {!showGrid || rows.length === 0 ? (
        <div className="variant-empty">加入規格值後會自動建立款式列。</div>
      ) : isNarrow ? (
        <div className="v-mobile-results">
          {mobileSelected.size > 0 ? <div className="vh-mobile-selected-count">已選 {mobileSelected.size} 列；點其他列可繼續多選。</div> : null}
          {rows.map((row, index) => {
            const selected = mobileSelected.has(index);
            const hasPositiveProductCost = productCost != null && Number.isFinite(productCost) && productCost > 0;
            const actualCost = Number(row.cost);
            const manuallyOverridden = hasPositiveProductCost && Number.isFinite(actualCost) && actualCost > 0 && actualCost !== productCost;
            return (
              <div
                key={index}
                data-variant-row-index={index}
                className={`vgrid-block vgrid-block--mobile${selected ? " is-selected" : ""}`}
                onPointerDown={(event) => startRowLongPress(index, event)}
                onPointerMove={cancelRowLongPress}
                onPointerUp={cancelRowLongPress}
                onPointerCancel={cancelRowLongPress}
                onClick={(event) => onMobileRowClick(index, event)}
              >
                <div className="v-mobile-row-core">
                  <button
                    type="button"
                    className="vdrag vdrag--touch"
                    aria-label={`拖曳排序第 ${index + 1} 列`}
                    onPointerDown={(event) => onTouchDragPointerDown(index, event)}
                    onPointerMove={onTouchDragPointerMove}
                    onPointerUp={finishTouchDrag}
                    onPointerCancel={finishTouchDrag}
                  >⠿</button>
                  <button type="button" className="v-row-dup--icon" disabled={rowsAtMax} aria-label="複製此列並插入下一列" onClick={() => duplicateRow(index)}><span className="v-copy-icon" aria-hidden /></button>
                  <span className="v-row-badge">{index + 1}</span>
                  {renderImagePicker(ctx, row, index)}
                  <div className="v-mobile-options">
                    {(dimHeaders.length > 0 ? dimHeaders : [{ name: "款式" }]).map((dimension, dimIndex) => (
                      <div className="v-mobile-option" key={`${dimension.name}-${dimIndex}`}>
                        <span className="v-mobile-option-label">{dimension.name}</span>
                        <span className="v-mobile-option-line">
                          <span className="v-mobile-option-value">{row.optionValues[dimIndex] || "—"}</span>
                          <button type="button" className="v-mobile-edit-icon" aria-label={`編輯${dimension.name}`} onClick={() => openEditorModal({ kind: "edit-option", rowIndex: index, dimIndex })}>✎</button>
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="v-mobile-price-result">
                    <span className="v-mobile-price-copy">
                      <span>售價 NT${row.sellPrice || "—"}</span>
                      {priceMode === "sale" ? <span>定價 NT${row.compareAt || "—"}</span> : null}
                    </span>
                    <button type="button" className="v-mobile-edit-icon" aria-label="編輯售價定價" onClick={() => openEditorModal({ kind: "edit-price", rowIndex: index })}>✎</button>
                    {manuallyOverridden ? <span className="rc-tag v-manual-cost-tag">已手動覆蓋</span> : null}
                  </div>
                  <label className="v-mobile-cost">
                    <span className="muted">{costLabel}</span>
                    <input type="number" aria-label={costLabel} value={row.cost} onChange={(event) => onCostChange(index, event.target.value)} />
                  </label>
                  <div className="v-mobile-inventory">
                    <label className="v-inventory-toggle">
                      <input
                        type="checkbox"
                        checked={!row.qty.trim()}
                        aria-label="庫存視為無限"
                        onChange={(event) => updateRow(index, { qty: event.target.checked ? "" : row.qty.trim() || "0" })}
                      />
                      <span className="v-inventory-toggle-track" aria-hidden><span /></span>
                      <span>庫存視為無限</span>
                    </label>
                    {row.qty.trim() ? <input className="v-qty" type="number" aria-label="庫存數量" value={row.qty} onChange={(event) => updateRow(index, { qty: event.target.value })} /> : null}
                  </div>
                  <button type="button" aria-label="刪除此列" className="variant-del variant-del--trash" onClick={() => removeRow(index)}>🗑</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <div className="vgrid-hdr" style={{ gridTemplateColumns: gridCols }}>
            <span aria-hidden />
            <span>圖</span>
            {dimHeaders.length > 0 ? dimHeaders.map((dimension, index) => <span key={index}>{dimension.name}</span>) : <span>選項</span>}
            <span>{costLabel}</span>
            <span />
          </div>
          {rows.map((row, index) => {
            const rowKey = String(index);
            return (
              <div key={index} className="vgrid-block">
                <div
                  className={`vgrid-row${reorderDragKey === rowKey ? " is-dragging" : ""}${reorderOverKey === rowKey && reorderDragKey !== rowKey ? " is-drag-over" : ""}`}
                  style={{ gridTemplateColumns: gridCols }}
                  onDragOver={(event) => {
                    if (reorderDragKey == null) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setReorderOverKey(rowKey);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const fromKey = reorderDragKey;
                    setReorderDragKey(null);
                    setReorderOverKey(null);
                    if (fromKey != null && fromKey !== rowKey) applyRowReorder(fromKey, rowKey);
                  }}
                >
                  <span
                    className="vdrag"
                    draggable
                    aria-label={`拖曳排序第 ${index + 1} 列`}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", rowKey);
                      setReorderDragKey(rowKey);
                    }}
                    onDragEnd={() => {
                      setReorderDragKey(null);
                      setReorderOverKey(null);
                    }}
                  >⠿</span>
                  {renderImagePicker(ctx, row, index)}
                  {(dimHeaders.length > 0 ? dimHeaders : [{ name: "款式" }]).map((dimension, dimIndex) => (
                    <span className="v-cell" data-label={dimension.name} key={dimIndex}>
                      <input
                        aria-label={dimension.name}
                        value={row.optionValues[dimIndex] ?? ""}
                        onChange={(event) => {
                          const optionValues = [...row.optionValues] as [string, string, string];
                          optionValues[dimIndex] = event.target.value;
                          updateRow(index, { optionValues });
                        }}
                      />
                    </span>
                  ))}
                  <span className="v-cell" data-label={costLabel}>
                    <input aria-label={costLabel} className={row.costIsInherited ? "v-cost-inherited" : undefined} type="number" value={row.cost} onChange={(event) => onCostChange(index, event.target.value)} />
                    {row.costIsInherited ? <span className="v-cost-badge muted">已套用商品成本，可覆蓋</span> : null}
                  </span>
                  <span className="v-row-actions">
                    <button type="button" className="v-row-dup" disabled={rowsAtMax} onClick={() => duplicateRow(index)}>複製</button>
                    <button type="button" aria-label="刪除此列" className="variant-del" onClick={() => removeRow(index)}>🗑</button>
                    {row.priceLocked ? <span className="v-manual" title="已手動調整，公式重算不覆蓋">✎</span> : null}
                  </span>
                </div>
                <div className="vgrid-sub">
                  <span className="twd">
                    {formatVariantPriceLine(row, priceMode, { productCost })}
                    {isVariantRowFilled(row) ? (
                      <>
                        {" · "}<button className="v-inline-edit" type="button" onClick={() => openEditorModal({ kind: "edit-price", rowIndex: index })}>改售價</button>
                        {" · "}<span className="v-cell v-cell--qty" data-label="庫存"><input aria-label="庫存" className="v-qty" type="number" value={row.qty} onChange={(event) => updateRow(index, { qty: event.target.value })} /></span>
                      </>
                    ) : null}
                  </span>
                </div>
              </div>
            );
          })}
        </>
      )}

      {!isNarrow ? <button className="vt-addrow" onClick={() => addRow()} type="button">＋ 加入一列{rows.length > 0 ? `（${rows.length}/${MAX_VARIANT_ROWS}）` : ""}</button> : null}
    </>
  );
}
