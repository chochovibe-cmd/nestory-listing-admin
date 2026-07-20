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

/**
 * C1 Q1-A: page links moved to AppSidebar / MobileTabbar.
 * UX-G T34: high-freq tools stay flat; Provider / Mode / Deploy live in ⋯ 更多.
 * C4: signed-in users also get 🔍 商品庫 modal.
 * UX-B2-P15-r2 (mobile ≤959):
 *   row1 匯率 → 商品庫 → 主題；row2 ⋯更多 popover（設定 sheet／登出／工具）
 *   不再整頁跳 /settings；頂欄無獨立 ⚙／登出.
 */
export function HeaderControls() {
  const pathname = usePathname();
  const settingsTitleId = useId();
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Collapse the mobile tools menu after navigating.
  useEffect(() => {
    setOpen(false);
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

  // Settings sheet: lock scroll + Esc (same as product library)
  useEffect(() => {
    if (!settingsOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setSettingsOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [settingsOpen]);

  function openSettingsSheet() {
    setSettingsOpen(true);
    setOpen(false);
  }

  const settingsPortal =
    mounted && settingsOpen
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
            <div className="modal-box settings-sheet-modal">
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

  return (
    <>
      <button
        aria-expanded={open}
        className="nav-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "✕ 關閉" : "☰ 選單"}
      </button>
      <nav className={`nav${open ? " open" : ""}`}>
        {signedIn ? (
          <>
            <button
              className="hdr-btn hdr-btn-library"
              onClick={() => {
                setLibraryOpen(true);
                setOpen(false);
              }}
              type="button"
            >
              🔍 商品庫
            </button>
            <div className="hdr-fx">
              <ExchangeRateWidget />
            </div>
            <HeaderToolsMore onOpenSettings={openSettingsSheet} />
            <ThemeSwitcher />
            {/* Desktop keeps 登出 here; mobile moves it into ⋯更多 */}
            <span className="hdr-auth-desktop">
              <AuthNav />
            </span>
          </>
        ) : (
          <>
            <ThemeSwitcher />
            <AuthNav />
          </>
        )}
      </nav>
      <ProductLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
      {settingsPortal}
    </>
  );
}
