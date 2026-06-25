import Link from "next/link";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { categoryLabel } from "@/lib/categories";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import type { ProductDraft } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function DraftQueuePage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="商品佇列需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="container">
        <div className="notice">
          請先 <Link href="/login">登入</Link> 後查看商品佇列。
        </div>
      </main>
    );
  }

  const { data: drafts, error } = await supabase
    .from("product_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="container">
      <section className="panel">
        <div className="panel-header">
          <h1>商品佇列</h1>
          <Link className="button primary" href="/drafts/new">新增商品</Link>
        </div>
        <div className="panel-body">
          {error ? <div className="notice">{error.message}</div> : null}
          <table className="table">
            <thead>
              <tr>
                <th>商品</th>
                <th>狀態</th>
                <th>產文</th>
                <th>發布</th>
                <th>售價</th>
              </tr>
            </thead>
            <tbody>
              {(drafts as ProductDraft[] | null)?.map((draft) => (
                <tr key={draft.id}>
                  <td>
                    <Link href={`/drafts/${draft.id}`}>
                      <strong>{draft.title_zh || draft.taobao_title || draft.original_title || "未命名商品"}</strong>
                    </Link>
                    <div className="muted">{categoryLabel(draft.category)}</div>
                  </td>
                  <td><StatusBadge status={draft.status} /></td>
                  <td>
                    <span>{draft.generation_mode}</span>
                    <div className="muted">{draft.generation_status}</div>
                  </td>
                  <td>
                    <span>{draft.publish_mode}</span>
                    <div className="muted">{draft.publish_status}</div>
                  </td>
                  <td>NT${draft.twd_price?.toLocaleString() ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
