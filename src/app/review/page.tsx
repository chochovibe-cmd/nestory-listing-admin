import { redirect } from "next/navigation";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { ReviewQueueTable, type ReviewQueueRow } from "@/components/review/ReviewQueueTable";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="待審核清單需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: drafts, error } = await supabase
    .from("product_drafts")
    .select("id, title_zh, taobao_title, status, warnings, publish_mode")
    .in("status", ["ready_for_review", "needs_revision", "approved", "api_failed", "csv_ready"])
    .order("updated_at", { ascending: false });

  return (
    <main className="container">
      <section className="panel">
        <div className="panel-header">
          <h1>待審核商品</h1>
          <span className="status ready">review</span>
        </div>
        <div className="panel-body">
          {error ? <div className="notice">{error.message}</div> : null}
          <ReviewQueueTable drafts={(drafts as ReviewQueueRow[] | null) ?? []} />
        </div>
      </section>
    </main>
  );
}
