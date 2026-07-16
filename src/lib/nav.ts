/**
 * C1/C2 App Shell — shared nav destinations for desktop sidebar + mobile tabbar.
 * Future pages use dead placeholders until their Phase lands.
 *
 * 2026-07-14 nav demotion (老闆): 商品佇列 ≠ 一級主線。
 * 對齊 Mockup 主流程順序：新增 → 生圖工廠 → 紀錄 → …；佇列改次要（側欄最底、手機「更多」、設定前）。
 * R2 §14：/review 頁名「生圖工廠」；站②佇列籤仍叫「圖片審核」。
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

/** 全部草稿列表（次要入口；路由仍為 /drafts） */
export const QUEUE_NAV: NavItem = {
  href: "/drafts",
  icon: "☰",
  label: "全部草稿",
  shortLabel: "草稿"
};

/**
 * Desktop sidebar main order — Mockup-first, 佇列墊底（設定仍在 sidebar-bottom）。
 * 順序：新增 → 圖審 → 發布紀錄 → 儀表板 → 選品 → 全部草稿
 */
export const SIDEBAR_NAV: readonly NavItem[] = [
  { href: "/drafts/new", icon: "✦", label: "新增商品", shortLabel: "新增" },
  { href: "/review", icon: "🏭", label: "生圖工廠", shortLabel: "生圖" },
  { href: "/records", icon: "🧾", label: "發布紀錄", shortLabel: "紀錄" },
  { href: "/dashboard", icon: "📈", label: "儀表板", shortLabel: "儀表板" },
  { href: "/scouting", icon: "🔭", label: "選品情報", shortLabel: "選品" },
  QUEUE_NAV
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

/**
 * Mobile primary tabs — Mockup 向：新增／圖審／紀錄／更多。
 * 佇列不再佔四格之一（2026-07-14）。
 */
export const MOBILE_PRIMARY_TABS: readonly NavItem[] = [
  { href: "/drafts/new", icon: "✦", label: "新增商品", shortLabel: "新增" },
  { href: "/review", icon: "🏭", label: "生圖工廠", shortLabel: "生圖" },
  { href: "/records", icon: "🧾", label: "發布紀錄", shortLabel: "紀錄" }
] as const;

/**
 * 「更多」抽屜：全部草稿（設定前）／儀表板／選品／設定。
 */
export const MOBILE_MORE_LINKS: readonly NavItem[] = [
  QUEUE_NAV,
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
