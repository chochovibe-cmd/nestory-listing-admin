import { NextRequest } from "next/server";
import { canPublish } from "@/lib/auth/roles";
import {
  isMissingScheduleTablesError,
  SCHEDULE_MIGRATION_HINT,
  scheduleDbWriteEnabled,
  taipeiDateOnly
} from "@/lib/drafts/publishScheduleCore";
import { createServerSupabaseClient, createServiceSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

async function requirePublisher() {
  const auth = await createServerSupabaseClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { ok: false as const, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await auth.from("profiles").select("role").eq("id", user.id).single();
  if (!canPublish(profile?.role as UserRole | undefined)) {
    return { ok: false as const, response: Response.json({ error: "Reviewer role is required" }, { status: 403 }) };
  }
  return { ok: true as const, user };
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requirePublisher();
  if (!auth.ok) return auth.response;

  if (!scheduleDbWriteEnabled()) {
    return Response.json(
      {
        error: "排程資料寫入安全鎖目前關閉；Preview 不會修改 Production schedule tables。",
        code: "SCHEDULE_DB_WRITE_DISABLED"
      },
      { status: 409 }
    );
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const service = createServiceSupabaseClient();
  const now = new Date().toISOString();

  const { data: group, error: groupError } = await service
    .from("publish_schedule_groups")
    .select("id,status")
    .eq("id", id)
    .maybeSingle();

  if (groupError) {
    return Response.json(
      {
        error: groupError.message,
        hint: isMissingScheduleTablesError(groupError.message) ? SCHEDULE_MIGRATION_HINT : undefined
      },
      { status: isMissingScheduleTablesError(groupError.message) ? 503 : 500 }
    );
  }
  if (!group) return Response.json({ error: "Schedule group not found" }, { status: 404 });

  if (action === "pause" || action === "resume") {
    const nextStatus = action === "pause" ? "paused" : "active";
    const { error } = await service
      .from("publish_schedule_groups")
      .update({ status: nextStatus, updated_at: now })
      .eq("id", id);
    if (error) return Response.json({ error: error.message }, { status: 500 });
    return Response.json({ ok: true, status: nextStatus });
  }

  if (action === "cancel") {
    const { error: itemError } = await service
      .from("publish_schedule_items")
      .update({ status: "canceled", updated_at: now })
      .eq("group_id", id)
      .in("status", ["queued", "blocked", "failed"]);
    if (itemError) return Response.json({ error: itemError.message }, { status: 500 });

    const { error: updateError } = await service
      .from("publish_schedule_groups")
      .update({ status: "canceled", updated_at: now })
      .eq("id", id);
    if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
    return Response.json({ ok: true, status: "canceled" });
  }

  if (action === "retry_blocked") {
    const scheduledFor =
      typeof body.scheduledFor === "string" && body.scheduledFor
        ? body.scheduledFor
        : taipeiDateOnly();

    const { data, error } = await service
      .from("publish_schedule_items")
      .update({
        status: "queued",
        scheduled_for: scheduledFor,
        claimed_at: null,
        completed_at: null,
        error_message: null,
        updated_at: now
      })
      .eq("group_id", id)
      .in("status", ["blocked", "failed"])
      .select("id");

    if (error) return Response.json({ error: error.message }, { status: 500 });

    await service
      .from("publish_schedule_groups")
      .update({ status: "active", updated_at: now })
      .eq("id", id);

    return Response.json({
      ok: true,
      retried: (data ?? []).length,
      scheduledFor
    });
  }

  return Response.json(
    { error: "action must be pause, resume, cancel, or retry_blocked" },
    { status: 400 }
  );
}
