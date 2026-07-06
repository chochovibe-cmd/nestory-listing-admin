import { redirect } from "next/navigation";
import { DraftResultsPanel } from "@/components/listing/DraftResultsPanel";
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
    redirect("/login");
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

  return (
    <main className="container">
      <div className="grid">
        <WorkspaceInputPanel userId={user.id} />
        <DraftResultsPanel drafts={typedDrafts} images={typedImages} />
      </div>
    </main>
  );
}
