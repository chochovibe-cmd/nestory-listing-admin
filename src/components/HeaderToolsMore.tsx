"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DeploymentStatus } from "@/components/DeploymentStatus";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";

/**
 * UX-G T34: secondary topbar tools behind one "⋯ 更多" layer.
 * Same component for desktop row and mobile ☰ — does not remove capabilities.
 */
export function HeaderToolsMore() {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent | TouchEvent) {
      const root = wrapRef.current;
      if (!root) return;
      const target = event.target;
      if (target instanceof Node && !root.contains(target)) {
        setOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="hdr-more" ref={wrapRef}>
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="true"
        className="hdr-btn hdr-more-toggle"
        onClick={() => setOpen((current) => !current)}
        title="更多工具"
        type="button"
      >
        ⋯ 更多
      </button>
      <div
        className={`hdr-more-menu${open ? " open" : ""}`}
        id={menuId}
        role="group"
        aria-label="次要工具"
      >
        <div className="hdr-more-row">
          <span className="hdr-more-label">AI 模型</span>
          <ProviderSwitcher />
        </div>
        <div className="hdr-more-row">
          <span className="hdr-more-label">生成模式</span>
          <ModeSwitcher />
        </div>
        <div className="hdr-more-row hdr-more-row--deploy">
          <span className="hdr-more-label">部署／連線</span>
          <DeploymentStatus />
        </div>
      </div>
    </div>
  );
}
