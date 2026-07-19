"use client";

import { useId, useState } from "react";
import { ImageLightbox } from "@/components/review/ImageLightbox";
import { hasComparableProcessed } from "@/lib/images/imageReview";

/**
 * D5 before/after slider. Labels: 原圖 / 處理後（暫存）— 差異 20.
 * BX9: click image → lightbox zoom / pinch.
 */
export function ImageCompareSlider({
  originalUrl,
  processedUrl,
  label
}: {
  originalUrl: string | null;
  processedUrl: string | null;
  label?: string;
}) {
  const rangeId = useId();
  const [pct, setPct] = useState(50);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(
    null
  );
  const comparable = hasComparableProcessed(originalUrl, processedUrl);

  if (!comparable) {
    const url = (processedUrl || originalUrl || "").trim();
    return (
      <div className="cmp-block">
        {label ? <div className="rc-field-label cmp-field-label">{label}</div> : null}
        <div className="cmp cmp--single">
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              className="cmp-img cmp-img--zoomable"
              src={url}
              alt={label?.trim() ? label : "商品圖"}
              onClick={() =>
                setLightbox({ src: url, alt: label?.trim() ? label : "商品圖" })
              }
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLightbox({ src: url, alt: label?.trim() ? label : "商品圖" });
                }
              }}
              title="點擊放大"
            />
          ) : (
            <div className="cmp-empty">無圖片</div>
          )}
        </div>
        <p className="cmp-hint">
          尚無處理後圖可對比（可能仍在佇列、僅原圖、skip，或 de_text／regenerate 等 D4 尚未接通）
        </p>
        {lightbox ? (
          <ImageLightbox
            alt={lightbox.alt}
            onClose={() => setLightbox(null)}
            src={lightbox.src}
          />
        ) : null}
      </div>
    );
  }

  const original = originalUrl!.trim();
  const processed = processedUrl!.trim();

  return (
    <div className="cmp-block">
      {label ? <div className="rc-field-label cmp-field-label">{label}</div> : null}
      <div className="cmp" aria-label="原圖與處理後比對">
        <div className="cmp-layer cmp-before">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="cmp-img cmp-img--zoomable"
            src={original}
            alt="原圖"
            onClick={() => setLightbox({ src: original, alt: "原圖" })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setLightbox({ src: original, alt: "原圖" });
              }
            }}
            title="點擊放大"
          />
          <span className="cmp-lb cmp-lb--l">原圖</span>
        </div>
        <div
          className="cmp-layer cmp-after"
          style={{ clipPath: `inset(0 0 0 ${pct}%)` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="cmp-img cmp-img--zoomable"
            src={processed}
            alt="處理後（暫存）"
            onClick={() => setLightbox({ src: processed, alt: "處理後（暫存）" })}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setLightbox({ src: processed, alt: "處理後（暫存）" });
              }
            }}
            title="點擊放大"
          />
          <span className="cmp-lb cmp-lb--r">處理後（暫存）</span>
        </div>
      </div>
      {lightbox ? (
        <ImageLightbox
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
          src={lightbox.src}
        />
      ) : null}
      <label className="sr-only" htmlFor={rangeId}>
        比對滑桿
      </label>
      <input
        id={rangeId}
        className="cmp-range"
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => setPct(Number(e.target.value))}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="比對滑桿"
      />
    </div>
  );
}
