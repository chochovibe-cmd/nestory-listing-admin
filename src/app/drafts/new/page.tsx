import { redirect } from "next/navigation";
import { DraftResultsPanel } from "@/components/listing/DraftResultsPanel";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { WorkbenchMobileShell } from "@/components/listing/WorkbenchMobileShell";
import { WorkspaceInputPanel } from "@/components/listing/WorkspaceInputPanel";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";

export const dynamic = "force-dynamic";

export type WorkbenchVariantPrice = Pick<
  ProductVariantRow,
  "id" | "draft_id" | "twd_price" | "compare_at_price" | "sort_order"
>;

export default async function NewDraftPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="新增商品需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // B12 D7-A: load active workbench + recent archived so stage pills can switch without empty 已封存.
  const [{ data: activeDrafts }, { data: archivedDrafts }] = await Promise.all([
    supabase
      .from("product_drafts")
      .select("*")
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(40),
    supabase
      .from("product_drafts")
      .select("*")
      .eq("status", "archived")
      .order("updated_at", { ascending: false })
      .limit(50)
  ]);

  const typedDrafts = [
    ...((activeDrafts ?? []) as ProductDraft[]),
    ...((archivedDrafts ?? []) as ProductDraft[])
  ];
  const draftIds = typedDrafts.map((draft) => draft.id);

  let typedImages: ProductImage[] = [];
  let typedVariants: WorkbenchVariantPrice[] = [];

  if (draftIds.length > 0) {
    const [{ data: images }, { data: variants }] = await Promise.all([
      supabase.from("product_images").select("*").in("draft_id", draftIds).order("sort_order"),
      supabase
        .from("product_variants")
        .select("id, draft_id, twd_price, compare_at_price, sort_order")
        .in("draft_id", draftIds)
        .order("sort_order", { ascending: true })
    ]);
    typedImages = (images ?? []) as ProductImage[];
    typedVariants = (variants ?? []) as WorkbenchVariantPrice[];
  }

  return (
    <main className="container">
      <WorkbenchMobileShell
        input={<WorkspaceInputPanel userId={user.id} />}
        results={
          <DraftResultsPanel
            drafts={typedDrafts}
            images={typedImages}
            variants={typedVariants}
          />
        }
      />
    </main>
  );
}
