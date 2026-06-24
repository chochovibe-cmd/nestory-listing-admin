import Link from "next/link";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import type { ProductDraft } from "@/types/domain";

export default async function ReviewQueuePage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="待審核清單需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="container">
        <div className="notice">
          請先 <Link href="/login">登入</Link> 後查看待審核商品。
        </div>
      </main>
    );
  }

  const { data: drafts, error } = await supabase
    .from("product_drafts")
    .select("*")
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
          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>狀態</th>
                <th>警告</th>
                <th>發布模式</th>
              </tr>
            </thead>
            <tbody>
              {(drafts as ProductDraft[] | null)?.map((draft) => (
                <tr key={draft.id}>
                  <td><Link href={`/drafts/${draft.id}`}>{draft.title_zh || draft.taobao_title || "未命名商品"}</Link></td>
                  <td><StatusBadge status={draft.status} /></td>
                  <td>{draft.warnings?.length ?? 0}</td>
                  <td>{draft.publish_mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
