"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { DeploymentStatus } from "@/components/DeploymentStatus";
import {
  ModeSwitcher,
  readStoredRunMode,
  RUN_MODE_CHANGE_EVENT,
  RUN_MODE_STORAGE_KEY,
  type RunMode
} from "@/components/ModeSwitcher";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

/**
 * UX-G T34: secondary topbar tools behind one "⋯ 更多" layer.
 * UX-R T71: test mode gets a small topbar chip + warn outline on the mode row.
 * UX-B2-P15-r2: mobile popover also hosts 設定／登出; pills stay desktop-sized (15r2-6).
 */
export function HeaderToolsMore({
  onOpenSettings
}: {
  /** Mobile: open settings bottom sheet; closes this popover first. */
  onOpenSettings?: () => void;
} = {}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("llm");
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const isTest = runMode === "test";

  useEffect(() => {
    setRunMode(readStoredRunMode());

    function onCustom(event: Event) {
      const detail = (event as CustomEvent<RunMode>).detail;
      if (detail === "test" || detail === "llm") setRunMode(detail);
    }
    function onStorage(event: StorageEvent) {
      if (event.key !== RUN_MODE_STORAGE_KEY) return;
      setRunMode(event.newValue === "test" ? "test" : "llm");
    }

    window.addEventListener(RUN_MODE_CHANGE_EVENT, onCustom);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(RUN_MODE_CHANGE_EVENT, onCustom);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

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

  async function signOut() {
    setOpen(false);
    if (!hasSupabaseBrowserEnv()) {
      router.push("/login");
      return;
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function handleOpenSettings() {
    setOpen(false);
    onOpenSettings?.();
  }

  return (
    <div className="hdr-more" ref={wrapRef}>
      {isTest ? (
        <span className="schip schip--warn hdr-run-mode-badge" title="目前是測試模式：不呼叫 AI">
          測試
        </span>
      ) : null}
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="true"
        className={`hdr-btn hdr-more-toggle${isTest ? " hdr-more-toggle--test" : ""}`}
        onClick={() => setOpen((current) => !current)}
        title={isTest ? "更多工具（目前：測試模式）" : "更多工具"}
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
        {/* Mobile-only account row: 設定 sheet + 登出 (desktop uses sidebar + AuthNav) */}
        <div className="hdr-more-account">
          <button
            className="hdr-more-action"
            onClick={handleOpenSettings}
            type="button"
          >
            <span aria-hidden>⚙</span>
            <span>設定</span>
          </button>
          <button className="hdr-more-action" onClick={() => void signOut()} type="button">
            <span aria-hidden>↩</span>
            <span>登出</span>
          </button>
        </div>

        <div className="hdr-more-row">
          <span className="hdr-more-label">AI 模型</span>
          <ProviderSwitcher />
        </div>
        <div
          className={`hdr-more-row hdr-more-row--section${isTest ? " hdr-more-row--test" : ""}`}
        >
          <span className="hdr-more-label">生成模式</span>
          <ModeSwitcher />
        </div>
        <div className="hdr-more-row hdr-more-row--section hdr-more-row--deploy">
          <span className="hdr-more-label">部署／連線</span>
          <DeploymentStatus />
        </div>
      </div>
    </div>
  );
}
