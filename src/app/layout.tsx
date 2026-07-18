import type { Metadata, Viewport } from "next";
import { Noto_Sans_TC, Space_Grotesk } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { AppSidebar } from "@/components/AppSidebar";
import { HeaderControls } from "@/components/HeaderControls";
import { MobileTabbar } from "@/components/MobileTabbar";
import { ToastHost } from "@/components/Toast";
import "./globals.css";

/* UX-K T50: self-host via next/font (replaces Google Fonts @import in globals.css). */
const notoSansTC = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
  variable: "--font-noto-sans-tc",
  display: "swap"
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap"
});

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

// C1: restore sidebar open preference before paint (matches Mockup nestory_nav).
const navInitScript = `
  try {
    if (window.localStorage.getItem('nestory_nav') === 'open') {
      var shell = document.getElementById('app-shell');
      if (shell) shell.classList.add('nav-open');
    }
  } catch (e) {}
`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      {/* suppressHydrationWarning: themeInitScript below mutates
          body[data-theme] from localStorage before React hydrates, so the
          server's "dark" attribute intentionally differs from the client's. */}
      <body
        className={`${notoSansTC.variable} ${spaceGrotesk.variable}`}
        data-theme="dark"
        suppressHydrationWarning
      >
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <div className="app-root">
          <header className="topbar">
            <Link className="brand" href="/">
              <span className="brand-dot" />
              <div>
                <strong>潮巢 商品上架助手</strong>
                <span>CHOCHONEST · Nestory Admin</span>
              </div>
            </Link>
            <HeaderControls />
          </header>
          <div className="shell" id="app-shell">
            <AppSidebar />
            <div className="shell-main">{children}</div>
          </div>
          <Suspense fallback={null}>
            <MobileTabbar />
          </Suspense>
          <ToastHost />
        </div>
        <script dangerouslySetInnerHTML={{ __html: navInitScript }} />
      </body>
    </html>
  );
}
