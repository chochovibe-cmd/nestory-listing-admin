"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * UX-G T34: secondary topbar tools behind one「⋯更多」layer.
 * UX-R T71: test mode chip + warn outline on the mode row.
 * UX-B2-P15-r2b:
 *   - Mobile: more = bottom sheet (not floating popover)
 *   - Tools first; 設定／登出 at bottom; 設定 = full page /settings
 *   - Pills stay desktop-sized (no 44px fattening)
 */
export function HeaderToolsMore() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("llm");
  const [isMobile, setIsMobile] = useState(false);
  const [mounted, setMounted] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const sheetTitleId = useId();
  const isTest = runMode === "test";

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const mql = window.matchMedia("(max-width: 959px)");
    function sync() {
      setIsMobile(mql.matches);
    }
    sync();
    mql.addEventListener("change", sync);
    return () => mql.removeEventListener("change", sync);
  }, []);

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

  // Desktop popover: outside click / Esc
  useEffect(() => {
    if (!open || isMobile) return;

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
  }, [open, isMobile]);

  // Mobile sheet: scroll lock + Esc
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, isMobile]);

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

  const toolsBody = (
    <>
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
    </>
  );

  const accountFooter = (
    <div className="hdr-more-account">
      <Link
        className="hdr-more-action"
        href="/settings"
        onClick={() => setOpen(false)}
      >
        <span aria-hidden>⚙</span>
        <span>設定</span>
      </Link>
      <button className="hdr-more-action" onClick={() => void signOut()} type="button">
        <span aria-hidden>↩</span>
        <span>登出</span>
      </button>
    </div>
  );

  const desktopMenu = (
    <div
      className={`hdr-more-menu${open ? " open" : ""}`}
      id={menuId}
      role="group"
      aria-label="次要工具"
    >
      {toolsBody}
    </div>
  );

  const mobileSheet =
    mounted && open && isMobile
      ? createPortal(
          <div
            aria-labelledby={sheetTitleId}
            aria-modal="true"
            className="modal-overlay open"
            onClick={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
            role="dialog"
          >
            <div className="modal-box mobile-more-sheet hdr-more-sheet">
              <div className="modal-hdr">
                <span id={sheetTitleId}>⋯ 更多</span>
                <button
                  aria-label="關閉"
                  className="modal-close"
                  onClick={() => setOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="modal-body hdr-more-sheet-body">
                <div className="hdr-more-sheet-tools">{toolsBody}</div>
                {accountFooter}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="hdr-more" ref={wrapRef}>
      {isTest ? (
        <span className="schip schip--warn hdr-run-mode-badge" title="目前是測試模式：不呼叫 AI">
          測試
        </span>
      ) : null}
      <button
        aria-controls={isMobile ? undefined : menuId}
        aria-expanded={open}
        aria-haspopup={isMobile ? "dialog" : "true"}
        className={`hdr-btn hdr-more-toggle${isTest ? " hdr-more-toggle--test" : ""}`}
        onClick={() => setOpen((current) => !current)}
        title={isTest ? "更多工具（目前：測試模式）" : "更多工具"}
        type="button"
      >
        ⋯ 更多
      </button>
      {isMobile ? mobileSheet : desktopMenu}
    </div>
  );
}
