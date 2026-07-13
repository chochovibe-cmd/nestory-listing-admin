import { Suspense } from "react";
import { SettingsPanel } from "@/components/settings/SettingsPanel";

/**
 * C2: independent settings page (Q3-A).
 * Suspense: SettingsPanel uses useSearchParams for ?section= deep links.
 */
export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <main className="container settings-page">
          <h1 className="settings-page-title">⚙ 設定</h1>
          <p className="settings-page-lead">載入中…</p>
        </main>
      }
    >
      <SettingsPanel />
    </Suspense>
  );
}
