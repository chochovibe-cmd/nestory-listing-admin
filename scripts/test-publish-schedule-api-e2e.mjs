import assert from "node:assert/strict";
import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const baseUrl = process.env.SCHEDULE_E2E_BASE_URL ?? "http://127.0.0.1:3019";

function assertLocalUrl(value, label) {
  const parsed = new URL(value);
  assert.ok(
    parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost",
    `${label} must be local-only, got ${parsed.hostname}`
  );
}

assert.ok(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL is required");
assert.ok(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY is required");
assert.ok(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY is required");
assert.equal(process.env.PUBLISH_SCHEDULE_DB_WRITE_ENABLED, "true");
assert.notEqual(process.env.PUBLISH_SCHEDULE_STAGING_ENABLED, "true");
assert.notEqual(process.env.PUBLISH_SCHEDULE_EXECUTION_ENABLED, "true");
assert.equal(process.env.SHOPIFY_PUBLISH_MOCK, "true");
assertLocalUrl(supabaseUrl, "Supabase URL");
assertLocalUrl(baseUrl, "Schedule API base URL");

const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const runId = Date.now().toString(36);
const email = `schedule-e2e-${runId}@example.test`;
const password = `E2e-${runId}-Nestory!9`;

let userId = null;
let groupId = null;
let originalDrafts = [];

function taipeiDateOnly(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  assert.ok(year && month && day, "Unable to resolve Asia/Taipei date");
  return `${year}-${month}-${day}`;
}

async function countRows(table) {
  const { count, error } = await service
    .from(table)
    .select("*", { count: "exact", head: true });
  assert.ifError(error);
  return count ?? 0;
}

async function api(path, { method = "GET", body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers["content-type"] = "application/json";

  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual"
  });
  const raw = await response.text();
  let payload = null;
  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = raw;
    }
  }
  return { response, payload };
}

async function setDraftPipelineStage(id, pipelineStage) {
  const { error } = await service
    .from("product_drafts")
    .update({ pipeline_stage: pipelineStage })
    .eq("id", id);
  assert.ifError(error);
}

async function getGroup(id) {
  const { data, error } = await service
    .from("publish_schedule_groups")
    .select("id,status,total_count,completed_count,failed_count")
    .eq("id", id)
    .single();
  assert.ifError(error);
  return data;
}

async function getItems(id) {
  const { data, error } = await service
    .from("publish_schedule_items")
    .select("id,draft_id,status,scheduled_for,position,error_message")
    .eq("group_id", id)
    .order("position", { ascending: true });
  assert.ifError(error);
  return data ?? [];
}

try {
  const before = {
    groups: await countRows("publish_schedule_groups"),
    items: await countRows("publish_schedule_items"),
    batches: await countRows("publish_batches"),
    syncJobs: await countRows("shopify_sync_jobs")
  };

  assert.equal(before.groups, 0, "isolated schedule E2E expects zero pre-existing groups");
  assert.equal(before.items, 0, "isolated schedule E2E expects zero pre-existing items");

  const { data: created, error: createUserError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: "Schedule E2E Reviewer" }
  });
  assert.ifError(createUserError);
  assert.ok(created.user?.id, "local E2E user was not created");
  userId = created.user.id;

  const { error: profileUpsertError } = await service.from("profiles").upsert({
    id: userId,
    email,
    name: "Schedule E2E Reviewer",
    role: "operator"
  });
  assert.ifError(profileUpsertError);

  const cookieJar = new Map();
  const authClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return [...cookieJar.entries()].map(([name, value]) => ({ name, value }));
      },
      setAll(cookies) {
        for (const cookie of cookies) {
          if (cookie.value) cookieJar.set(cookie.name, cookie.value);
          else cookieJar.delete(cookie.name);
        }
      }
    }
  });

  const { error: signInError } = await authClient.auth.signInWithPassword({ email, password });
  assert.ifError(signInError);
  assert.ok(cookieJar.size > 0, "Supabase SSR sign-in produced no auth cookies");
  const cookie = [...cookieJar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");

  const unauthenticated = await api("/api/publish-schedules");
  assert.equal(unauthenticated.response.status, 401, "schedule API must reject unauthenticated callers");

  const operator = await api("/api/publish-schedules", { cookie });
  assert.equal(operator.response.status, 403, "operator must not access publisher schedule API");

  const { error: promoteError } = await service
    .from("profiles")
    .update({ role: "reviewer" })
    .eq("id", userId);
  assert.ifError(promoteError);

  const reviewerRead = await api("/api/publish-schedules", { cookie });
  assert.equal(reviewerRead.response.status, 200, JSON.stringify(reviewerRead.payload));
  assert.equal(reviewerRead.payload?.safety?.dbWriteEnabled, true);
  assert.equal(reviewerRead.payload?.safety?.stagingEnabled, false);
  assert.equal(reviewerRead.payload?.safety?.executionEnabled, false);

  const { data: drafts, error: draftsError } = await service
    .from("product_drafts")
    .select("id,pipeline_stage,status")
    .order("created_at", { ascending: true })
    .limit(2);
  assert.ifError(draftsError);
  assert.equal(drafts?.length, 2, "schedule E2E needs two local product_drafts");
  originalDrafts = drafts.map((draft) => ({
    id: draft.id,
    pipeline_stage: draft.pipeline_stage ?? null
  }));

  for (const draft of originalDrafts) {
    await setDraftPipelineStage(draft.id, "ready");
  }

  const today = taipeiDateOnly();
  const createSchedule = await api("/api/publish-schedules", {
    method: "POST",
    cookie,
    body: {
      draftIds: originalDrafts.map((draft) => draft.id),
      startDate: today,
      dailyLimit: 1,
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6]
    }
  });
  assert.equal(createSchedule.response.status, 200, JSON.stringify(createSchedule.payload));
  assert.equal(createSchedule.payload?.total, 2);
  assert.equal(createSchedule.payload?.staging?.enabled, false);
  groupId = createSchedule.payload?.groupId;
  assert.ok(groupId, "schedule create response is missing groupId");

  let group = await getGroup(groupId);
  assert.equal(group.status, "active");
  assert.equal(group.total_count, 2);
  let items = await getItems(groupId);
  assert.equal(items.length, 2);
  assert.ok(items.every((item) => item.status === "queued"));

  const duplicate = await api("/api/publish-schedules", {
    method: "POST",
    cookie,
    body: {
      draftIds: [originalDrafts[0].id],
      startDate: today,
      dailyLimit: 1,
      activeWeekdays: [0, 1, 2, 3, 4, 5, 6]
    }
  });
  assert.equal(duplicate.response.status, 409, "duplicate active draft must be rejected");
  assert.equal(await countRows("publish_schedule_groups"), before.groups + 1, "duplicate attempt leaked a group");

  const pause = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "pause" }
  });
  assert.equal(pause.response.status, 200, JSON.stringify(pause.payload));
  assert.equal(pause.payload?.status, "paused");

  items = await getItems(groupId);
  const retryTarget = items[0];
  const { error: blockFixtureError } = await service
    .from("publish_schedule_items")
    .update({ status: "blocked", error_message: "schedule-e2e-fixture" })
    .eq("id", retryTarget.id);
  assert.ifError(blockFixtureError);

  const retryWhilePaused = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "retry_blocked", scheduledFor: today }
  });
  assert.equal(retryWhilePaused.response.status, 200, JSON.stringify(retryWhilePaused.payload));
  assert.equal(retryWhilePaused.payload?.retried, 1);
  assert.equal(retryWhilePaused.payload?.status, "paused", "retry must not silently resume a paused schedule");
  group = await getGroup(groupId);
  assert.equal(group.status, "paused");
  items = await getItems(groupId);
  assert.equal(items.find((item) => item.id === retryTarget.id)?.status, "queued");

  const resume = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "resume" }
  });
  assert.equal(resume.response.status, 200, JSON.stringify(resume.payload));
  assert.equal(resume.payload?.status, "active");

  const dryRun = await api("/api/publish-schedules/dry-run", { cookie });
  assert.equal(dryRun.response.status, 200, JSON.stringify(dryRun.payload));
  assert.equal(dryRun.payload?.dryRun, true);
  assert.ok((dryRun.payload?.dueCount ?? 0) >= 1, "dry-run should see at least today's queued item");
  items = await getItems(groupId);
  assert.ok(items.every((item) => item.status === "queued"), "dry-run must not claim schedule items");

  const cancel = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "cancel" }
  });
  assert.equal(cancel.response.status, 200, JSON.stringify(cancel.payload));
  assert.equal(cancel.payload?.status, "canceled");
  group = await getGroup(groupId);
  assert.equal(group.status, "canceled");
  items = await getItems(groupId);
  assert.ok(items.every((item) => item.status === "canceled"), "cancel must cancel queued schedule items");

  const resumeCanceled = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "resume" }
  });
  assert.equal(resumeCanceled.response.status, 409, "canceled schedule must be terminal");

  const retryCanceled = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "retry_blocked", scheduledFor: today }
  });
  assert.equal(retryCanceled.response.status, 409, "canceled schedule must not be retryable");

  const cancelAgain = await api(`/api/publish-schedules/${groupId}`, {
    method: "PATCH",
    cookie,
    body: { action: "cancel" }
  });
  assert.equal(cancelAgain.response.status, 200);
  assert.equal(cancelAgain.payload?.alreadyCanceled, true);

  assert.equal(await countRows("publish_batches"), before.batches, "schedule E2E must not create Shopify publish batches");
  assert.equal(await countRows("shopify_sync_jobs"), before.syncJobs, "schedule E2E must not create Shopify sync jobs");

  console.log("PASS: schedule HTTP API E2E create/pause/retry/resume/dry-run/cancel/terminal guards passed.");
} finally {
  if (groupId) {
    await service.from("publish_schedule_groups").delete().eq("id", groupId);
  }

  for (const draft of originalDrafts) {
    await setDraftPipelineStage(draft.id, draft.pipeline_stage);
  }

  if (userId) {
    await service.auth.admin.deleteUser(userId);
  }

  const finalGroups = await countRows("publish_schedule_groups");
  const finalItems = await countRows("publish_schedule_items");
  assert.equal(finalGroups, 0, "schedule E2E cleanup left schedule groups behind");
  assert.equal(finalItems, 0, "schedule E2E cleanup left schedule items behind");
}
