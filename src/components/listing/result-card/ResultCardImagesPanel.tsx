"use client";

import {
  imageSlotLabel,
  PROCESS_INTENT_LABELS,
  PROCESS_INTENT_OPTIONS
} from "@/lib/images/processMarks";
import type { ImageProcessIntent, ProductImage } from "@/types/domain";

/** S2: 站③ 圖片分頁（可檢視／標記）— 從 ResultCard 展開區拆出。站② 仍用 Station2ImagePanel。 */
export function ResultCardImagesPanel({
  imageMarks,
  pipelineImages,
  fadingImageIds,
  unmarkedImages,
  unmarkedBlockMessage,
  onRemoveImage,
  onSetProcessIntent,
  onToggleSpec
}: {
  imageMarks: ProductImage[];
  pipelineImages: ProductImage[];
  fadingImageIds: Set<string>;
  unmarkedImages: ProductImage[];
  unmarkedBlockMessage: string | null;
  onRemoveImage: (image: ProductImage) => void;
  onSetProcessIntent: (image: ProductImage, intent: ImageProcessIntent) => void;
  onToggleSpec: (image: ProductImage) => void;
}) {
  if (imageMarks.length === 0) {
    return (
      <div className="rc-tabpanel" role="tabpanel">
        <div className="muted">尚無商品圖。</div>
      </div>
    );
  }

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-field">
        <div className="rc-label">圖片（站③ 可檢視；改標記請回標圖站）</div>
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
                    {/* UX-B2-P10: 規格圖 bottom btn → corner badge (align station② language) */}
                    <button
                      type="button"
                      className={`pthumb-spec-badge${image.is_spec_process ? " active" : ""}`}
                      aria-pressed={!!image.is_spec_process}
                      title={image.is_spec_process ? "取消規格圖標記" : "標示為規格圖"}
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSpec(image);
                      }}
                    >
                      {image.is_spec_process ? "📐 規格圖" : "規格圖"}
                    </button>
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
                  <span className="imgmark-slot-label">{slot}</span>
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
        {imageMarks.some((image) => image.image_type === "detail") ? (
          <div className="thumbs" style={{ marginTop: 10 }}>
            {imageMarks
              .filter((image) => image.image_type === "detail")
              .map((image) => (
                <div
                  className={`thumb-wrap${fadingImageIds.has(image.id) ? " is-fading" : ""}`}
                  key={image.id}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    alt={image.alt_text ?? "詳情圖"}
                    src={
                      image.processed_file_url ??
                      image.original_file_url ??
                      image.generated_file_url ??
                      ""
                    }
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
        {unmarkedImages.length > 0 && unmarkedBlockMessage ? (
          <div className="img-mark-warn" role="status">
            {unmarkedBlockMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}
