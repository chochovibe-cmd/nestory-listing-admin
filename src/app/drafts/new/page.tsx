import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SetupNotice } from "@/components/listing/SetupNotice";
import {
  WorkbenchPageClient
} from "@/components/listing/WorkbenchPageClient";
import type { VariantPriceRow } from "@/components/listing/DraftResultsPanel";
import {
  isPendingInputStatus,
  mapDraftToWorkspaceForm,
  resolveNonPendingInputRedirect,
  type WorkspaceFormSeed
} from "@/lib/drafts/mapDraftToWorkspaceForm";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";
import type { ProductDraft, ProductImage } from "@/types/domain";

export const dynamic = "force-dynamic";

export type WorkbenchVariantPrice = VariantPriceRow;

function firstParam(
  value: string | string[] | undefined
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  return undefined;
}

export default async function NewDraftPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
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

  const sp = (await searchParams) ?? {};
  const draftQuery = firstParam(sp.draft)?.trim() || "";
  const noticeQuery = firstParam(sp.notice)?.trim() || "";

  let initialFromServer: WorkspaceFormSeed | null = null;
  let loadNotice: string | null = noticeQuery || null;

  if (draftQuery) {
    const { data: oneDraft, error: oneError } = await supabase
      .from("product_drafts")
      .select("*")
      .eq("id", draftQuery)
      .maybeSingle();

    if (oneError || !oneDraft) {
      loadNotice = "找不到這張草稿（可能已刪除或無權限）。";
    } else {
      const typed = oneDraft as ProductDraft;
      if (!isPendingInputStatus(typed.status)) {
        const gate = resolveNonPendingInputRedirect(typed.status);
        const href =
          gate.href === "/drafts/new"
            ? `/drafts/new?notice=${encodeURIComponent(gate.message)}`
            : `${gate.href}?notice=${encodeURIComponent(gate.message)}`;
        redirect(href);
      }

      const [{ data: seedImages }, { data: seedVariants }] = await Promise.all([
        supabase
          .from("product_images")
          .select("*")
          .eq("draft_id", typed.id)
          .order("sort_order"),
        supabase
          .from("product_variants")
          .select(
            "id, draft_id, twd_price, compare_at_price, sort_order, option1_value, option2_value, option3_value, option1_name, option2_name, option3_name, cny_price, sku, price_locked, inventory_quantity, inventory_policy, image_id"
          )
          .eq("draft_id", typed.id)
          .order("sort_order", { ascending: true })
      ]);

      initialFromServer = mapDraftToWorkspaceForm(
        typed,
        (seedVariants ?? []) as Parameters<typeof mapDraftToWorkspaceForm>[1],
        (seedImages ?? []) as ProductImage[]
      );
      loadNotice = "已載入擷取草稿";
    }
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
        .select(
          "id, draft_id, twd_price, compare_at_price, sort_order, option1_value, option2_value, option3_value, option1_name, option2_name, option3_name, sku, cny_price, price_locked, inventory_quantity, inventory_policy, image_id"
        )
        .in("draft_id", draftIds)
        .order("sort_order", { ascending: true })
    ]);
    typedImages = (images ?? []) as ProductImage[];
    typedVariants = (variants ?? []) as WorkbenchVariantPrice[];
  }

  return (
    <main className="container">
      <Suspense fallback={<p className="muted">載入工作檯…</p>}>
        <WorkbenchPageClient
          userId={user.id}
          drafts={typedDrafts}
          images={typedImages}
          variants={typedVariants}
          initialFromServer={initialFromServer}
          loadNotice={loadNotice}
        />
      </Suspense>
    </main>
  );
}
