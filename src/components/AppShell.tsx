"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileTabbar } from "@/components/MobileTabbar";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login";

  return (
    <>
      <div className={`shell${isLogin ? " shell--login" : ""}`} id="app-shell">
        {!isLogin ? <AppSidebar /> : null}
        <div className="shell-main">{children}</div>
      </div>
      {!isLogin ? (
        <Suspense fallback={null}>
          <MobileTabbar />
        </Suspense>
      ) : null}
    </>
  );
}
