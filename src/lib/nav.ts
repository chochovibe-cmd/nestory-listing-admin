/**
 * C1/C2 App Shell — shared nav destinations for desktop sidebar + mobile tabbar.
 * Future pages use dead placeholders until their Phase lands.
 *
 * 2026-07-14 nav demotion (老闆): 商品佇列 ≠ 一級主線.
 * R2 §14：/review 頁名「生圖工廠」.
 * UX-B §2.2：站② 使用者可見名「標圖」；手機 tab 工廠 shortLabel「工廠」（勿用「圖審」）.
 * R4 §14-4：紀錄收進更多；/drafts 列表下線.
 * UX-PKG3：手機 tab 審核｜工廠｜(+新增 FAB)｜儀表板｜更多；設定改頂欄 ⚙，不進更多.
 */

export type NavHref =
  | "/drafts/new"
  | "/drafts/new?pane=results"
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
  /** R4: workbench pane for /drafts/new tabs */
  workbenchPane?: "input" | "results";
};

/**
 * Desktop sidebar main order — Mockup-first.
 * R4: 全部草稿 removed (merged into /records).
 * 順序：新增 → 生圖工廠 → 發布紀錄 → 儀表板 → 選品
 */
export const SIDEBAR_NAV: readonly NavItem[] = [
  { href: "/drafts/new", icon: "✦", label: "新增商品", shortLabel: "新增" },
  { href: "/review", icon: "🏭", label: "生圖工廠", shortLabel: "生圖" },
  { href: "/records", icon: "🧾", label: "發布紀錄", shortLabel: "紀錄" },
  { href: "/dashboard", icon: "📈", label: "儀表板", shortLabel: "儀表板" },
  { href: "/scouting", icon: "🔭", label: "選品情報", shortLabel: "選品" }
] as const;

/**
 * Desktop sidebar bottom only. Mobile uses header ⚙ (UX-PKG3) — not MOBILE_MORE_LINKS.
 */
export const SETTINGS_NAV: NavItem = {
  href: "/settings",
  icon: "⚙",
  label: "設定",
  shortLabel: "設定"
};

/**
 * R4 §14-4 + UX-B §2.2 + BX6 + UX-PKG3 mobile tabs.
 * Layout: 審核 | 工廠 | 中央凸起＋新增 | 儀表板 | 更多
 * 審核 = workbench results (Q1-A: /drafts/new?pane=results).
 */
export const MOBILE_PRIMARY_TABS: readonly NavItem[] = [
  {
    href: "/drafts/new?pane=results",
    icon: "◈",
    label: "審核",
    shortLabel: "審核",
    workbenchPane: "results"
  },
  { href: "/review", icon: "🏭", label: "生圖工廠", shortLabel: "工廠" },
  {
    href: "/drafts/new",
    icon: "＋",
    label: "新增商品",
    shortLabel: "新增",
    workbenchPane: "input"
  }
] as const;

/** Side tabs only (exclude center FAB 新增) for BX6 + UX-PKG3 layout. */
export type MobileSideTab = NavItem & { side: "left" | "right" };

export const MOBILE_SIDE_TABS: readonly MobileSideTab[] = [
  {
    href: "/drafts/new?pane=results",
    icon: "◈",
    label: "審核",
    shortLabel: "審核",
    workbenchPane: "results",
    side: "left"
  },
  {
    href: "/review",
    icon: "🏭",
    label: "生圖工廠",
    shortLabel: "工廠",
    side: "left"
  },
  {
    href: "/dashboard",
    icon: "📈",
    label: "儀表板",
    shortLabel: "儀表板",
    side: "right"
  }
] as const;

/**
 * 「更多」抽屜：僅發布紀錄（UX-B2-P15：選品情報在 Dashboard 捷徑；儀表板在右側 tab）。
 * UX-PKG3：設定改頂欄 ⚙，不進更多.
 */
export const MOBILE_MORE_LINKS: readonly NavItem[] = [
  { href: "/records", icon: "🧾", label: "發布紀錄", shortLabel: "紀錄" }
] as const;

export const NAV_STORAGE_KEY = "nestory_nav";

/** Parse workbench pane from search string (`?pane=results`). */
export function workbenchPaneFromSearch(
  search: string | null | undefined
): "input" | "results" {
  if (!search) return "input";
  const q = search.startsWith("?") ? search.slice(1) : search;
  const pane = new URLSearchParams(q).get("pane");
  return pane === "results" ? "results" : "input";
}

/**
 * Active match for nav items.
 * /drafts/new vs /drafts/new?pane=results distinguished by workbenchPane.
 */
export function isNavActive(
  pathname: string,
  href: string,
  search?: string | null,
  workbenchPane?: "input" | "results"
): boolean {
  if (href.startsWith("/drafts/new")) {
    if (pathname !== "/drafts/new") return false;
    if (workbenchPane) {
      return workbenchPaneFromSearch(search) === workbenchPane;
    }
    // Desktop sidebar「新增」：any workbench pane lights 新增
    return true;
  }
  if (href === "/records") {
    return pathname === "/records" || pathname.startsWith("/records/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function isMoreSectionActive(
  pathname: string,
  search?: string | null
): boolean {
  return MOBILE_MORE_LINKS.some((item) =>
    isNavActive(pathname, item.href, search, item.workbenchPane)
  );
}
