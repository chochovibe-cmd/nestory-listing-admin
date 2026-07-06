"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/drafts/new", icon: "✦", label: "新增" },
  { href: "/drafts", icon: "☰", label: "佇列" }
] as const;

function isActive(pathname: string, href: string): boolean {
  // /drafts/new is its own tab, so the bare /drafts tab must NOT also light up
  // when we're on /drafts/new.
  if (href === "/drafts") return pathname === "/drafts";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function MobileTabbar() {
  const pathname = usePathname();

  return (
    <nav className="mobile-tabbar" aria-label="行動導覽">
      {TABS.map((tab) => (
        <Link className={isActive(pathname, tab.href) ? "active" : ""} href={tab.href} key={tab.href}>
          <span className="mtb-ic">{tab.icon}</span>
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
