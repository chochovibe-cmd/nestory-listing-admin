import type { Metadata, Viewport } from "next";
import Link from "next/link";
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
  themeColor: "#f4c15d"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>
        <div className="shell">
          <header className="topbar">
            <Link className="brand" href="/">
              <strong>潮巢 Nestory 團隊上架後台</strong>
              <span>PWA queue / Codex Skill copy / Shopify publish</span>
            </Link>
            <nav className="nav">
              <Link href="/drafts/new">新增商品</Link>
              <Link href="/drafts">商品佇列</Link>
              <Link href="/review">待審核</Link>
              <Link href="/login">登入</Link>
            </nav>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
