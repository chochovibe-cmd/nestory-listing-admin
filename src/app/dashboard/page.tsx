import { redirect } from "next/navigation";
import { DashboardTodoPanel } from "@/components/dashboard/DashboardTodoPanel";
import { SetupNotice } from "@/components/listing/SetupNotice";
import { createServerSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** E1-open: real dashboard with 今日待辦 cards (replaces C1 ComingSoon). */
export default async function DashboardPage() {
  if (!hasSupabaseServerEnv()) {
    return <SetupNotice title="儀表板需要 Supabase 測試環境" />;
  }

  const supabase = await createServerSupabaseClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return <DashboardTodoPanel />;
}
