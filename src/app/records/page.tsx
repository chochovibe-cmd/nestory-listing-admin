import { redirect } from "next/navigation";
import { Suspense } from "react";
import { PublishRecordsPanel } from "@/components/records/PublishRecordsPanel";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** D7 + R4 §9: publish records four-tab (replaces C1 ComingSoon + old /drafts queue). */
export default async function RecordsPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="發布紀錄需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="container">
      <Suspense fallback={<p className="muted">載入發布紀錄…</p>}>
        <PublishRecordsPanel />
      </Suspense>
    </main>
  );
}
