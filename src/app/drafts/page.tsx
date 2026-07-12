import Link from "next/link";
import { redirect } from "next/navigation";
import { DraftQueueList, type DraftQueueRow } from "@/components/drafts/DraftQueueList";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function DraftQueuePage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="商品佇列需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // B12: active + archived so stage filter「已封存」有資料；client 預設「全部」藏 archived。
  const selectCols =
    "id, title_zh, taobao_title, original_title, category, status, generation_status, publish_mode, publish_status, twd_price";
  const [{ data: activeDrafts, error: activeError }, { data: archivedDrafts, error: archivedError }] =
    await Promise.all([
      supabase
        .from("product_drafts")
        .select(selectCols)
        .neq("status", "archived")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("product_drafts")
        .select(selectCols)
        .eq("status", "archived")
        .order("updated_at", { ascending: false })
        .limit(100)
    ]);

  const error = activeError ?? archivedError;
  const drafts = [
    ...((activeDrafts as DraftQueueRow[] | null) ?? []),
    ...((archivedDrafts as DraftQueueRow[] | null) ?? [])
  ];

  return (
    <main className="container">
      <section className="panel">
        <div className="panel-header">
          <h1>商品佇列</h1>
          <Link className="button primary" href="/drafts/new">新增商品</Link>
        </div>
        <div className="panel-body">
          {error ? <div className="notice">{error.message}</div> : null}
          <DraftQueueList drafts={drafts} />
        </div>
      </section>
    </main>
  );
}
