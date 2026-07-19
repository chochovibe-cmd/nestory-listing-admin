"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * BX9: full-screen image lightbox — click outside / Esc to close;
 * wheel zoom + pinch on touch; double-click reset.
 */
export function ImageLightbox({
  src,
  alt,
  onClose
}: {
  src: string;
  alt?: string;
  onClose: () => void;
}) {
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(
    null
  );

  const clampScale = useCallback((n: number) => Math.min(4, Math.max(1, n)), []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.15 : 0.15;
    setScale((s) => clampScale(s + delta));
  }

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const d = touchDist(e.touches[0], e.touches[1]);
      pinchRef.current = { dist: d, scale };
      dragRef.current = null;
      return;
    }
    if (e.touches.length === 1 && scale > 1) {
      const t = e.touches[0];
      dragRef.current = { x: t.clientX, y: t.clientY, tx, ty };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const d = touchDist(e.touches[0], e.touches[1]);
      const next = clampScale(pinchRef.current.scale * (d / pinchRef.current.dist));
      setScale(next);
      return;
    }
    if (e.touches.length === 1 && dragRef.current && scale > 1) {
      const t = e.touches[0];
      setTx(dragRef.current.tx + (t.clientX - dragRef.current.x));
      setTy(dragRef.current.ty + (t.clientY - dragRef.current.y));
    }
  }

  function onTouchEnd() {
    pinchRef.current = null;
    dragRef.current = null;
  }

  return (
    <div
      aria-label="圖片放大預覽"
      aria-modal="true"
      className="img-lightbox"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
    >
      <button
        aria-label="關閉"
        className="img-lightbox-close"
        onClick={onClose}
        type="button"
      >
        ×
      </button>
      <div className="img-lightbox-hint" aria-hidden>
        滾輪／雙指縮放 · Esc 關閉
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt={alt?.trim() ? alt : "放大預覽"}
        className="img-lightbox-img"
        draggable={false}
        onDoubleClick={() => {
          setScale(1);
          setTx(0);
          setTy(0);
        }}
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
        onWheel={onWheel}
        src={src}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`
        }}
      />
    </div>
  );
}

function touchDist(a: React.Touch, b: React.Touch): number {
  const dx = a.clientX - b.clientX;
  const dy = a.clientY - b.clientY;
  return Math.hypot(dx, dy);
}
