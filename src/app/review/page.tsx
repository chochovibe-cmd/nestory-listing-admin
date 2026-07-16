import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ImageReviewPanel } from "@/components/review/ImageReviewPanel";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** D5 + R4: 生圖工廠（deep link ?section=pending）. */
export default async function ReviewPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="圖片審核需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <Suspense fallback={<p className="muted">載入生圖工廠…</p>}>
      <ImageReviewPanel />
    </Suspense>
  );
}
