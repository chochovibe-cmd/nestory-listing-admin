import { canPublish } from "@/lib/auth/roles";
import {
  scheduleExecutionEnabled
} from "@/lib/drafts/publishScheduleCore";
import { runDuePublishSchedules } from "@/lib/shopify/runDuePublishSchedules";
import {
  createServerSupabaseClient,
  createServiceSupabaseClient
} from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await createServerSupabaseClient();
  const {
    data: { user }
  } = await auth.auth.getUser();

  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: profile } = await auth
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!canPublish(profile?.role as UserRole | undefined)) {
    return Response.json({ error: "Reviewer role is required" }, { status: 403 });
  }

  if (scheduleExecutionEnabled()) {
    return Response.json(
      {
        error:
          "Dry-run endpoint is disabled because PUBLISH_SCHEDULE_EXECUTION_ENABLED is true."
      },
      { status: 409 }
    );
  }

  const result = await runDuePublishSchedules({
    serviceSupabase: createServiceSupabaseClient(),
    claimLimit: Number(process.env.PUBLISH_SCHEDULE_CLAIM_LIMIT ?? 50)
  });

  if (!result.ok) {
    return Response.json(result, { status: result.status });
  }

  return Response.json(result);
}
