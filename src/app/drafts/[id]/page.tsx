import Link from "next/link";
import { DraftReviewForm } from "@/components/listing/DraftReviewForm";
import { ImageUploader } from "@/components/listing/ImageUploader";
import { ResultTabs } from "@/components/listing/ResultTabs";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { categoryLabel } from "@/lib/categories";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import type { ProductDraft, ProductImage } from "@/types/domain";

export const dynamic = "force-dynamic";

export default async function DraftDetailPage({ params }: { params: Promise<{ id: string }> }) {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="商品詳情需要 Supabase 測試環境" />;
  }

  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="container">
        <div className="notice">
          請先 <Link href="/login">登入</Link> 後查看商品詳情。
        </div>
      </main>
    );
  }

  const [{ data: draft, error }, { data: images }] = await Promise.all([
    supabase.from("product_drafts").select("*").eq("id", id).single(),
    supabase.from("product_images").select("*").eq("draft_id", id).order("sort_order")
  ]);

  if (error || !draft) {
    return (
      <main className="container">
        <div className="notice">{error?.message ?? "找不到商品草稿"}</div>
      </main>
    );
  }

  const typedDraft = draft as ProductDraft;
  const typedImages = (images ?? []) as ProductImage[];

  return (
    <main className="container">
      <section className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-header">
          <h1>{typedDraft.title_zh || typedDraft.taobao_title || "商品草稿"}</h1>
          <StatusBadge status={typedDraft.status} />
        </div>
        <div className="panel-body">
          <div className="row">
            <div>
              <span className="muted">分類</span>
              <p>{categoryLabel(typedDraft.category)}</p>
            </div>
            <div>
              <span className="muted">價格</span>
              <p>CNY {typedDraft.cny_price} / NT${typedDraft.twd_price?.toLocaleString() ?? "-"}</p>
            </div>
          </div>
          <div className="notice">
            generation: {typedDraft.generation_mode} / {typedDraft.generation_status} · publish:{" "}
            {typedDraft.publish_mode} / {typedDraft.publish_status}
          </div>
        </div>
      </section>

      <div className="grid">
        <div style={{ display: "grid", gap: 18 }}>
          <section className="panel">
            <div className="panel-header">
              <h2>圖片上傳</h2>
            </div>
            <div className="panel-body">
              <ImageUploader draftId={typedDraft.id} userId={user.id} />
            </div>
          </section>
          <DraftReviewForm draft={typedDraft} />
        </div>
        <ResultTabs draft={typedDraft} images={typedImages} />
      </div>
    </main>
  );
}
