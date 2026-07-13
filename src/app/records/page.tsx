import { redirect } from "next/navigation";
import { PublishRecordsPanel } from "@/components/records/PublishRecordsPanel";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** D7-open / C5 skeleton: publish batch records (replaces C1 ComingSoon). */
export default async function RecordsPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="發布紀錄需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <PublishRecordsPanel />;
}
