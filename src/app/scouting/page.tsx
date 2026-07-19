import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * UX-AE T136: 選品情報 layout skeleton (static + empty state).
 * Data / tracking logic → Phase F.
 */
export default async function ScoutingPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="選品情報需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="container scout-page">
      <h1 className="scout-page-title">🔭 選品情報</h1>

      {/* Placeholder merchant chips — real list in Phase F */}
      <div aria-label="追蹤中的商家" className="merchant-strip">
        <span className="merchant-chip merchant-chip--placeholder">
          <span aria-hidden>🏪</span>
          <span>範例商家 A</span>
        </span>
        <span className="merchant-chip merchant-chip--placeholder">
          <span aria-hidden>🏪</span>
          <span>範例商家 B</span>
        </span>
      </div>

      <div className="pocket-add">
        <input
          aria-label="商家連結"
          disabled
          placeholder="貼上商家連結"
          type="url"
        />
        <button disabled type="button">
          追蹤
        </button>
      </div>

      <div className="empty-state">
        <div aria-hidden className="empty-icon">
          🔭
        </div>
        <p className="empty-state-title">還沒有追蹤中的新品</p>
        <p className="empty-state-desc">
          新增商家連結，系統會自動追蹤新品
        </p>
      </div>
    </main>
  );
}
