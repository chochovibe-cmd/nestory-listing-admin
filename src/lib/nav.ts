/**
 * C1/C2 App Shell — shared nav destinations for desktop sidebar + mobile tabbar.
 * Future pages use dead placeholders until their Phase lands.
 */

export type NavHref =
  | "/drafts/new"
  | "/drafts"
  | "/review"
  | "/records"
  | "/dashboard"
  | "/scouting"
  | "/settings";

export type NavItem = {
  href: NavHref;
  icon: string;
  label: string;
  /** Shorter label for mobile tabbar */
  shortLabel: string;
};

/** Desktop sidebar main order (Q5-A: 佇列 kept; Mockup items + 佇列). */
export const SIDEBAR_NAV: readonly NavItem[] = [
  { href: "/drafts/new", icon: "✦", label: "新增商品", shortLabel: "新增" },
  { href: "/drafts", icon: "☰", label: "商品佇列", shortLabel: "佇列" },
  { href: "/review", icon: "🖼", label: "圖片審核", shortLabel: "圖審" },
  { href: "/records", icon: "🧾", label: "發布紀錄", shortLabel: "紀錄" },
  { href: "/dashboard", icon: "📈", label: "儀表板", shortLabel: "儀表板" },
  { href: "/scouting", icon: "🔭", label: "選品情報", shortLabel: "選品" }
] as const;

/**
 * C2 Q1-C: settings entry only at sidebar bottom + mobile「更多」— not topbar.
 * Kept separate from SIDEBAR_NAV so sidebar can pin it under main items.
 */
export const SETTINGS_NAV: NavItem = {
  href: "/settings",
  icon: "⚙",
  label: "設定",
  shortLabel: "設定"
};

/** Mobile primary tabs (Q2-C): 新增 / 佇列 / 圖審 / 更多 */
export const MOBILE_PRIMARY_TABS: readonly NavItem[] = [
  { href: "/drafts/new", icon: "✦", label: "新增商品", shortLabel: "新增" },
  { href: "/drafts", icon: "☰", label: "商品佇列", shortLabel: "佇列" },
  { href: "/review", icon: "🖼", label: "圖片審核", shortLabel: "圖審" }
] as const;

/**
 * Q2-C「更多」sheet + C2 settings (Q1-C): 紀錄 / 儀表板 / 選品 / 設定.
 * Topbar does not get a settings gear.
 */
export const MOBILE_MORE_LINKS: readonly NavItem[] = [
  { href: "/records", icon: "🧾", label: "發布紀錄", shortLabel: "紀錄" },
  { href: "/dashboard", icon: "📈", label: "儀表板", shortLabel: "儀表板" },
  { href: "/scouting", icon: "🔭", label: "選品情報", shortLabel: "選品" },
  SETTINGS_NAV
] as const;

export const NAV_STORAGE_KEY = "nestory_nav";

/** Active match: /drafts must not light up on /drafts/new. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/drafts") return pathname === "/drafts";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isMoreSectionActive(pathname: string): boolean {
  return MOBILE_MORE_LINKS.some((item) => isNavActive(pathname, item.href));
}
