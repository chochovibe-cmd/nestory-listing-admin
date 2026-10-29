"use client";

import { useState } from "react";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";
import {
  CopyReferenceBadge,
  CopyReferenceRow,
  type CopyReferenceController,
} from "@/components/listing/CopyReferenceControls";
import { Button } from "@/components/ui/Button";
import { pickShopifyMainImage } from "@/lib/images/shopifyMainImage";
import { pickDescriptionDetailRows } from "@/lib/images/descriptionDetailRows";
import type { ExcludedDetailImage } from "@/lib/import/captureSharedImages";
import {
  imageSlotLabel,
  PROCESS_INTENT_LABELS,
  PROCESS_INTENT_OPTIONS
} from "@/lib/images/processMarks";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";

/** S2: 站③ 圖片分頁（可檢視／標記）— 從 ResultCard 展開區拆出。站② 仍用 Station2ImagePanel。 */
export function ResultCardImagesPanel({
  copyReference,
  descriptionImagesBusy,
  descriptionImagesOn,
  imageMarks,
  pipelineImages,
  fadingImageIds,
  unmarkedImages,
  unmarkedBlockMessage,
  excludedDetailImages,
  restoreImageBusyIndex,
  restoreImageDisabledReason,
  onRestoreExcludedImage,
  onRemoveImage,
  onSetProcessIntent,
  onToggleDescriptionImages
}: {
  /** 4f 文案參考圖 (state lives in ResultCard via useCopyReference). */
  copyReference: CopyReferenceController;
  descriptionImagesBusy: boolean;
  descriptionImagesOn: boolean;
  imageMarks: ProductImage[];
  pipelineImages: ProductImage[];
  fadingImageIds: Set<string>;
  unmarkedImages: ProductImage[];
  unmarkedBlockMessage: string | null;
  excludedDetailImages: ExcludedDetailImage[];
  restoreImageBusyIndex: number | null;
  restoreImageDisabledReason: string | null;
  onRestoreExcludedImage: (index: number) => void;
  onRemoveImage: (image: ProductImage) => void;
  onSetProcessIntent: (image: ProductImage, intent: ImageProcessIntent) => void;
  onToggleDescriptionImages: (enabled: boolean) => void;
}) {
  const [excludedOpen, setExcludedOpen] = useState(false);

  if (imageMarks.length === 0) {
    return (
      <div className="rc-tabpanel" role="tabpanel">
        <div className="muted">尚無商品圖。</div>
      </div>
    );
  }

  const shopifyMainId = pickShopifyMainImage(imageMarks)?.id ?? null;
  // 4e: same order as the description — generated_detail first, then detail.
  const descriptionDetailImages = pickDescriptionDetailRows(imageMarks);

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-field">
        <div className="rc-label">圖片（站③ 可檢視；改標記請回標圖站）</div>
        {/* 4f: 文案參考圖 — AI 先自動挑，可點圖上的「文案參考」改選 */}
        <CopyReferenceRow
          busy={copyReference.busy}
          onReset={copyReference.reset}
          selection={copyReference.selection}
        />
        {pipelineImages.length > 0 ? (
          <div className="imgmark-list">
            {pipelineImages.map((image, index) => {
              const src =
                image.processed_file_url ?? image.original_file_url ?? image.generated_file_url ?? "";
              const slot = imageSlotLabel(image, index + 1);
              const intents = PROCESS_INTENT_OPTIONS;
              return (
                <div
                  className={`imgmark-row${fadingImageIds.has(image.id) ? " is-fading" : ""}`}
                  key={image.id}
                >
                  <div className="thumb-wrap rc-img-thumb-wrap">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt={image.alt_text ?? slot} className="imgmark-thumb" src={src} />
                    {/* 4f: 文案參考 corner badge (was 規格圖; same .pthumb-spec-badge slot) */}
                    <CopyReferenceBadge
                      disabled={copyReference.busy}
                      onToggle={() => copyReference.toggle(image.id)}
                      state={copyReference.badgeState(image.id)}
                    />
                    {/* ✕ left — free top-right for .pthumb-spec-badge */}
                    <button
                      className="thumb-remove rc-img-thumb-remove"
                      onClick={() => onRemoveImage(image)}
                      title="移除這張圖片"
                      type="button"
                    >
                      ✕
                    </button>
                  </div>
                  <span className="imgmark-slot-label">
                    {image.id === shopifyMainId ? "⭐ Shopify 主圖" : slot}
                  </span>
                  <span className="imgmark-btns">
                    {intents.map((intent) => (
                      <button
                        aria-pressed={image.process_intent === intent}
                        className={`img-mark-btn${image.process_intent === intent ? " active" : ""}`}
                        key={intent}
                        onClick={() => onSetProcessIntent(image, intent)}
                        title={
                          intent === "to_trad"
                            ? "需先在 Supabase 執行 migration 030；D4 尚未真的做圖編會誠實跳過"
                            : PROCESS_INTENT_LABELS[intent]
                        }
                        type="button"
                      >
                        {image.process_intent === intent
                          ? `✓ ${PROCESS_INTENT_LABELS[intent]}`
                          : PROCESS_INTENT_LABELS[intent]}
                      </button>
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        ) : null}
        {descriptionDetailImages.length > 0 ? (
          <div className="s2-compose-row rc-desc-images-row" style={{ marginTop: 10, marginBottom: 0 }}>
            <div className="s2-compose-copy">
              <span className="s2-compose-title">詳情圖放進商品描述</span>
              <span className="s2-compose-hint">
                {descriptionImagesOn
                  ? `發布／同步時，這 ${descriptionDetailImages.length} 張會放進商品描述（主圖排最前）；不要的按 ✕`
                  : "已關閉：商品描述不放圖，詳情圖留在工具給 AI 讀字"}
              </span>
            </div>
            <label className="toggle" title={descriptionImagesOn ? "點一下關閉" : "點一下開啟"}>
              <input
                aria-label="詳情圖放進商品描述"
                checked={descriptionImagesOn}
                disabled={descriptionImagesBusy}
                onChange={(event) => onToggleDescriptionImages(event.target.checked)}
                type="checkbox"
              />
              <span className="toggle-slider" />
            </label>
          </div>
        ) : null}
        {descriptionDetailImages.length > 0 ? (
          <div className="thumbs" style={{ marginTop: 10 }}>
            {descriptionDetailImages
              .map((image) => (
                <div
                  className={`thumb-wrap${fadingImageIds.has(image.id) ? " is-fading" : ""}`}
                  key={image.id}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={image.alt_text ?? (image.image_type === "generated_detail" ? "繁中合成詳情圖" : "詳情圖")}
                    src={
                      image.processed_file_url ??
                      image.original_file_url ??
                      image.generated_file_url ??
                      ""
                    }
                  />
                  {/* 4f: 60px thumb → compact 文案參考 badge along the bottom (✕ stays top-right) */}
                  <CopyReferenceBadge
                    compact
                    disabled={copyReference.busy}
                    onToggle={() => copyReference.toggle(image.id)}
                    state={copyReference.badgeState(image.id)}
                  />
                  <button
                    className="thumb-remove"
                    onClick={() => onRemoveImage(image)}
                    title="移除這張圖片"
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              ))}
          </div>
        ) : null}
        {excludedDetailImages.length > 0 ? (
          <CollapsibleSection
            className="vc-excluded"
            onToggle={() => setExcludedOpen((open) => !open)}
            open={excludedOpen}
            summary="點開看縮圖"
            title={`已排除 ${excludedDetailImages.length} 張店家共用宣傳圖`}
          >
            <p className="vc-note">這些圖也出現在同一家店的其他商品，通常是店家介紹、合作通路或購物須知，匯入時先排除。需要的話可以加回，會排在詳情圖最後。</p>
            {restoreImageDisabledReason ? <p className="price-soft-warn">{restoreImageDisabledReason}</p> : null}
            <ul className="vc-list">
              {excludedDetailImages.map((entry, index) => (
                <li className="vc-excluded-row" key={entry.key}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="已排除的宣傳圖" className="imgmark-thumb" referrerPolicy="no-referrer" src={entry.url} />
                  <span className="vc-excluded-label">出現在另外 {entry.other_items} 件商品</span>
                  <Button
                    disabled={Boolean(restoreImageDisabledReason) || restoreImageBusyIndex !== null}
                    loading={restoreImageBusyIndex === index}
                    onClick={() => onRestoreExcludedImage(index)}
                    size="sm"
                    type="button"
                  >
                    加回
                  </Button>
                </li>
              ))}
            </ul>
          </CollapsibleSection>
        ) : null}
        {unmarkedImages.length > 0 && unmarkedBlockMessage ? (
          <div className="img-mark-warn" role="status">
            {unmarkedBlockMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
