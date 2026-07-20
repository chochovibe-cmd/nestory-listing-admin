"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthNav } from "@/components/AuthNav";
import { ExchangeRateWidget } from "@/components/ExchangeRateWidget";
import { HeaderToolsMore } from "@/components/HeaderToolsMore";
import { ProductLibraryModal } from "@/components/library/ProductLibraryModal";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

/**
 * C1 Q1-A: page links moved to AppSidebar / MobileTabbar.
 * UX-G T34: high-freq tools stay flat; Provider / Mode / Deploy live in ⋯更多.
 * C4: signed-in users also get 📦 商品庫 modal.
 * UX-B2-P15-r2b (mobile ≤959):
 *   row1 匯率 → 商品庫 → 主題；row2 ⋯更多 = bottom sheet
 *   設定／登出在更多最下方；設定 = 整頁 /settings（不再 sheet）
 *   頂欄按鈕維持桌機扁膠囊（不強制 44px 胖化）
 */
export function HeaderControls() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);

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

  return (
    <>
      <button
        aria-expanded={open}
        className="nav-toggle"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {open ? "▴ 收合" : "▾ 工具"}
      </button>
      <nav className={`nav${open ? " open" : ""}`}>
        {signedIn ? (
          <>
            {/* 桌機順序：匯率 → 主題 → 商品庫 → 更多 → 登出（手機 order 另見 CSS） */}
            <div className="hdr-fx">
              <ExchangeRateWidget />
            </div>
            <ThemeSwitcher />
            <button
              className="hdr-btn hdr-btn-library"
              onClick={() => {
                setLibraryOpen(true);
                setOpen(false);
              }}
              type="button"
            >
              📦 商品庫
            </button>
            <HeaderToolsMore />
            {/* Desktop keeps 登出 here; mobile moves it into ⋯更多 sheet */}
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
    </>
  );
}
