"use client";

import { usePathname } from "next/navigation";
import { Suspense, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { AuthNav } from "@/components/AuthNav";
import { ExchangeRateWidget } from "@/components/ExchangeRateWidget";
import { HeaderToolsMore } from "@/components/HeaderToolsMore";
import { ProductLibraryModal } from "@/components/library/ProductLibraryModal";
import { SettingsPanel } from "@/components/settings/SettingsPanel";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

const MOBILE_MQ = "(max-width: 959px)";

/**
 * C1 Q1-A: page links moved to AppSidebar / MobileTabbar.
 * UX-G T34: high-freq tools stay flat; Provider / Mode / Deploy live in ⋯ 更多.
 * C4: signed-in users also get 🔍 商品庫 modal.
 * UX-B2-P15: mobile topbar = 商品庫 | ⚙設定 sheet | ⋯工具 sheet;
 *   desktop keeps flat row + sidebar /settings.
 */
export function HeaderControls() {
  const pathname = usePathname();
  const [signedIn, setSignedIn] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const settingsTitleId = useId();
  const toolsTitleId = useId();

  useEffect(() => {
    setPortalReady(true);
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Collapse sheets after navigating.
  useEffect(() => {
    setSettingsOpen(false);
    setToolsOpen(false);
  }, [pathname]);

  // Defaults to signed-out so the operator toolbar never flashes on the
  // login screen before Supabase confirms there's no session.
  useEffect(() => {
    if (!hasSupabaseBrowserEnv()) return;
    const supabase = createClient();

    supabase.auth.getUser().then(({ data }) => {
      setSignedIn(Boolean(data.user));
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session?.user));
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  // Body scroll lock + Esc for settings / tools sheets.
  useEffect(() => {
    const anyOpen = settingsOpen || toolsOpen;
    if (!anyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
        setToolsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen, toolsOpen]);

  // Leave mobile: close sheets so desktop doesn't keep overlay state.
  useEffect(() => {
    if (!isMobile) {
      setSettingsOpen(false);
      setToolsOpen(false);
    }
  }, [isMobile]);

  function openLibrary() {
    setLibraryOpen(true);
    setSettingsOpen(false);
    setToolsOpen(false);
  }

  function openSettings() {
    setSettingsOpen(true);
    setToolsOpen(false);
  }

  function openTools() {
    setToolsOpen(true);
    setSettingsOpen(false);
  }

  const settingsSheet =
    portalReady && settingsOpen
      ? createPortal(
          <div
            aria-labelledby={settingsTitleId}
            aria-modal="true"
            className="modal-overlay open"
            onClick={(event) => {
              if (event.target === event.currentTarget) setSettingsOpen(false);
            }}
            role="dialog"
          >
            <div className="modal-box mobile-more-sheet settings-sheet">
              <div className="modal-hdr">
                <span id={settingsTitleId}>⚙ 設定</span>
                <button
                  aria-label="關閉"
                  className="modal-close"
                  onClick={() => setSettingsOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="modal-body settings-sheet-body">
                <Suspense
                  fallback={<p className="settings-page-lead">載入中…</p>}
                >
                  <SettingsPanel embedded />
                </Suspense>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  const toolsSheet =
    portalReady && toolsOpen
      ? createPortal(
          <div
            aria-labelledby={toolsTitleId}
            aria-modal="true"
            className="modal-overlay open"
            onClick={(event) => {
              if (event.target === event.currentTarget) setToolsOpen(false);
            }}
            role="dialog"
          >
            <div className="modal-box mobile-more-sheet tools-sheet">
              <div className="modal-hdr">
                <span id={toolsTitleId}>工具</span>
                <button
                  aria-label="關閉"
                  className="modal-close"
                  onClick={() => setToolsOpen(false)}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="modal-body tools-sheet-body">
                <div className="tools-sheet-block tools-sheet-fx">
                  <span className="tools-sheet-label">匯率</span>
                  <div className="tools-sheet-fx-row">
                    <ExchangeRateWidget />
                  </div>
                </div>
                <div className="tools-sheet-block">
                  <span className="tools-sheet-label">主題</span>
                  <ThemeSwitcher />
                </div>
                <div className="tools-sheet-block">
                  <span className="tools-sheet-label">模型／模式／部署</span>
                  <HeaderToolsMore embedded />
                </div>
                <div className="tools-sheet-block tools-sheet-auth">
                  <AuthNav />
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {/* UX-B2-P15: 已登入手機不再用 ☰ 展開；4 控件常駐。未登入仍可省略 toggle。 */}
      <nav className="nav nav--topbar" aria-label="頂部工具">
        {signedIn ? (
          <>
            <button
              aria-label="商品庫"
              className="hdr-btn hdr-btn-library"
              onClick={openLibrary}
              type="button"
            >
              <span className="hdr-library-full">🔍 商品庫</span>
              <span aria-hidden className="hdr-library-icon">
                🔍
              </span>
            </button>

            {/* Mobile: ⚙ opens settings sheet. Desktop: settings via sidebar. */}
            <button
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-label="設定"
              className="hdr-btn hdr-settings-mobile"
              onClick={openSettings}
              type="button"
            >
              ⚙
            </button>

            {/* Desktop flat tools */}
            <span className="nav-desktop-cluster">
              <ExchangeRateWidget />
              <HeaderToolsMore />
              <ThemeSwitcher />
              <AuthNav />
            </span>

            {/* Mobile: ⋯ tools sheet */}
            <button
              aria-expanded={toolsOpen}
              aria-haspopup="dialog"
              aria-label="更多工具"
              className="hdr-btn hdr-tools-mobile"
              onClick={openTools}
              type="button"
            >
              ⋯
            </button>
          </>
        ) : (
          <>
            <span className="nav-desktop-cluster">
              <ThemeSwitcher />
            </span>
            <AuthNav />
          </>
        )}
      </nav>

      <ProductLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      {settingsSheet}
      {toolsSheet}
    </>
  );
}
