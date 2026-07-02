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

export function HeaderControls() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Collapse the mobile menu automatically after navigating to another page.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

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
        <span className="nav-links">
          <Link href="/drafts/new">新增商品</Link>
          <Link href="/drafts">商品佇列</Link>
          <Link href="/review">待審核</Link>
        </span>
        <ProviderSwitcher />
        <ModeSwitcher />
        <DeploymentStatus />
        <ThemeSwitcher />
        <ExchangeRateWidget />
        <AuthNav />
      </nav>
    </>
  );
}
