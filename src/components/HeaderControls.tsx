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
 * UX-G T34: high-freq tools stay flat; Provider / Mode / Deploy live in ⋯ 更多.
 * C4: signed-in users also get 🔍 商品庫 modal (Q6-A: same control in mobile ☰ tools).
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
        {open ? "✕ 關閉" : "☰ 選單"}
      </button>
      <nav className={`nav${open ? " open" : ""}`}>
        {signedIn ? (
          <>
            <button
              className="hdr-btn"
              onClick={() => {
                setLibraryOpen(true);
                setOpen(false);
              }}
              type="button"
            >
              🔍 商品庫
            </button>
            <ExchangeRateWidget />
            <HeaderToolsMore />
          </>
        ) : null}
        <ThemeSwitcher />
        <AuthNav />
      </nav>
      <ProductLibraryModal open={libraryOpen} onClose={() => setLibraryOpen(false)} />
    </>
  );
}
