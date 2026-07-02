import Link from "next/link";
import { ResultCard } from "@/components/listing/ResultCard";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { WorkspaceInputPanel } from "@/components/listing/WorkspaceInputPanel";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import type { ProductDraft, ProductImage } from "@/types/domain";

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

  const { data: drafts } = await supabase
    .from("product_drafts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(30);

  const typedDrafts = (drafts ?? []) as ProductDraft[];
  const draftIds = typedDrafts.map((draft) => draft.id);

  const { data: images } = draftIds.length
    ? await supabase.from("product_images").select("*").in("draft_id", draftIds).order("sort_order")
    : { data: [] as ProductImage[] };

  const typedImages = (images ?? []) as ProductImage[];
  const imagesByDraft = new Map<string, ProductImage[]>();
  for (const image of typedImages) {
    const list = imagesByDraft.get(image.draft_id) ?? [];
    list.push(image);
    imagesByDraft.set(image.draft_id, list);
  }

  return (
    <main className="container">
      <div className="grid">
        <WorkspaceInputPanel userId={user.id} />
        <section className="panel">
          <div className="panel-header">
            <h2>◈ 生成結果</h2>
          </div>
          <div className="panel-body">
            {typedDrafts.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">◈</div>
                <p className="muted">在左側輸入商品資料並送出，生成結果會出現在這裡</p>
              </div>
            ) : (
              <div className="results-list">
                {typedDrafts.map((draft) => (
                  <ResultCard draft={draft} images={imagesByDraft.get(draft.id) ?? []} key={draft.id} />
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
