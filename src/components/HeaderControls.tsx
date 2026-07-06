"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthNav } from "@/components/AuthNav";
import { DeploymentStatus } from "@/components/DeploymentStatus";
import { ExchangeRateWidget } from "@/components/ExchangeRateWidget";
import { ModeSwitcher } from "@/components/ModeSwitcher";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";

export function HeaderControls() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  // Collapse the mobile menu automatically after navigating to another page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Defaults to signed-out so the operator toolbar (nav links, AI
  // provider/mode switches, deployment status, exchange rate) never flashes
  // on the login screen before Supabase confirms there's no session.
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
            <span className="nav-links">
              <Link href="/drafts/new">新增商品</Link>
              <Link href="/drafts">商品佇列</Link>
              <Link href="/review">待審核</Link>
            </span>
            <ProviderSwitcher />
            <ModeSwitcher />
            <DeploymentStatus />
            <ExchangeRateWidget />
          </>
        ) : null}
        <ThemeSwitcher />
        <AuthNav />
      </nav>
    </>
  );
}
