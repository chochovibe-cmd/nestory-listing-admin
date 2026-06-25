import Link from "next/link";
import { ProductInputForm } from "@/components/listing/ProductInputForm";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function NewDraftPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="新增商品需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="container">
        <div className="notice">
          請先 <Link href="/login">登入</Link> 後再新增商品草稿。
        </div>
      </main>
    );
  }

  return (
    <main className="container">
      <div className="grid">
        <ProductInputForm userId={user.id} />
        <section className="panel">
          <div className="panel-header">
            <h2>v0.1 資料流</h2>
          </div>
          <div className="panel-body">
            <p className="muted">
              這一版會先把商品基礎資料寫入 Supabase，狀態預設為 <code>pending_copy</code>，
              後續由扣哥 Skill 透過 scoped worker API claim 商品並回寫文案。
            </p>
            <div className="notice">
              前端不會存放 AI API key、Shopify Admin token 或 Supabase service role key。
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
