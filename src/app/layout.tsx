import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { AuthNav } from "@/components/AuthNav";
import { ProviderSwitcher } from "@/components/ProviderSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nestory Listing Admin",
  description: "Chocho Nestory team listing workflow",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  },
  applicationName: "Nestory 團隊後台"
};

export const viewport: Viewport = {
  themeColor: "#c8ff00"
};

// Applies the saved theme before React hydrates so there's no flash of the
// default dark theme on load for nordic/kitty users.
const themeInitScript = `
  try {
    var theme = window.localStorage.getItem('nestory_theme');
    if (theme) document.body.dataset.theme = theme;
  } catch (e) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body data-theme="dark">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-dot" />
              <div>
                <strong>潮巢 商品上架助手</strong>
                <span>CHOCHONEST · Nestory Admin</span>
              </div>
            </Link>
            <nav className="nav">
              <Link href="/drafts/new">新增商品</Link>
              <Link href="/drafts">商品佇列</Link>
              <Link href="/review">待審核</Link>
              <ProviderSwitcher />
              <ThemeSwitcher />
              <AuthNav />
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
