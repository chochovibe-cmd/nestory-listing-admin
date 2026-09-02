import type { NextRequest } from "next/server";
import { jsonError, requireWorkerToken } from "@/lib/api/auth";
import { canOperate } from "@/lib/auth/roles";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UserRole } from "@/types/domain";

type RlsSupabaseClient = Awaited<ReturnType<typeof createServerSupabaseClient>>;

/**
 * A route actor with a deliberately narrow authority model:
 *
 * - session: an authenticated human request. Its draft IDs must be loaded through
 *   the cookie-backed RLS client before a service-role client may act on them.
 * - worker: an explicit, server-to-server exception authenticated by
 *   WORKER_API_TOKEN. Worker callers are trusted pipeline actors, not browser users.
 */
export type RequestPrincipal =
  | {
      kind: "session";
      via: "session";
      userId: string;
      role: UserRole;
      rlsSupabase: RlsSupabaseClient;
    }
  | {
      kind: "worker";
      via: "worker";
    };

export type SessionPrincipal = Extract<RequestPrincipal, { kind: "session" }>;

type PrincipalResult =
  | { ok: true; principal: RequestPrincipal }
  | { ok: false; response: Response };

type AuthorizedDraftResult =
  | { ok: true; id: string }
  | { ok: false; response: Response };

type AuthorizedDraftIdsResult =
  | { ok: true; ids: string[] }
  | { ok: false; response: Response };

function hasBearerAuthorization(request: NextRequest): boolean {
  return /^Bearer\s+/i.test(request.headers.get("authorization") ?? "");
}

/**
 * Resolves either a normal session principal or, only when explicitly enabled by
 * the route, the trusted worker principal. A bad Bearer token never falls back to
 * the browser session path.
 */
export async function resolveRequestPrincipal(
  request: NextRequest,
  options: { allowWorker?: boolean } = {}
): Promise<PrincipalResult> {
  if (hasBearerAuthorization(request)) {
    if (!options.allowWorker) {
      return { ok: false, response: jsonError("Unauthorized", 401) };
    }

    const worker = requireWorkerToken(request);
    if (!worker.ok) {
      const status = worker.error.includes("configured") ? 500 : 401;
      return { ok: false, response: jsonError(worker.error, status) };
    }
    return { ok: true, principal: { kind: "worker", via: "worker" } };
  }

  try {
    const rlsSupabase = await createServerSupabaseClient();
    const {
      data: { user }
    } = await rlsSupabase.auth.getUser();
    if (!user) {
      return { ok: false, response: jsonError("Unauthorized", 401) };
    }

    const { data: profile, error: profileError } = await rlsSupabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return { ok: false, response: jsonError("Unable to verify account access", 500) };
    }

    const role = profile?.role as UserRole | undefined;
    if (!canOperate(role)) {
      return { ok: false, response: jsonError("Operator role is required", 403) };
    }

    return {
      ok: true,
      principal: {
        kind: "session",
        via: "session",
        userId: user.id,
        role,
        rlsSupabase
      }
    };
  } catch {
    return { ok: false, response: jsonError("Unable to verify account access", 500) };
  }
}

/**
 * Resolves a user-visible draft through RLS. Never replace this with a
 * service-role lookup for a browser-supplied ID: absence and no-access are both
 * intentionally returned as 404 so the API does not disclose another user's data.
 */
export async function loadAuthorizedDraft(
  principal: SessionPrincipal,
  draftId: string
): Promise<AuthorizedDraftResult> {
  const requestedId = draftId.trim();
  if (!requestedId) {
    return { ok: false, response: jsonError("Draft not found", 404) };
  }

  const { data, error } = await principal.rlsSupabase
    .from("product_drafts")
    .select("id")
    .eq("id", requestedId)
    .maybeSingle();

  if (error) {
    return { ok: false, response: jsonError("Unable to load draft", 500) };
  }
  if (!data?.id) {
    return { ok: false, response: jsonError("Draft not found", 404) };
  }

  return { ok: true, id: data.id as string };
}

/**
 * Returns only RLS-visible IDs. Callers may use this list as the exclusive input
 * to subsequent service-role reads/writes for a batch request.
 */
export async function loadAuthorizedDraftIds(
  principal: SessionPrincipal,
  draftIds: string[]
): Promise<AuthorizedDraftIdsResult> {
  const requestedIds = [...new Set(draftIds.map((id) => id.trim()).filter(Boolean))];
  if (requestedIds.length === 0) return { ok: true, ids: [] };

  const { data, error } = await principal.rlsSupabase
    .from("product_drafts")
    .select("id")
    .in("id", requestedIds);

  if (error) {
    return { ok: false, response: jsonError("Unable to load drafts", 500) };
  }

  return {
    ok: true,
    ids: (data ?? [])
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string")
  };
}

/**
 * Session requests receive a canonical ID read through RLS. Worker callers are
 * the documented trusted-pipeline exception and retain their supplied ID.
 */
export async function resolveAuthorizedDraftId(
  principal: RequestPrincipal,
  draftId: string
): Promise<AuthorizedDraftResult> {
  if (principal.kind === "worker") {
    const trustedDraftId = draftId.trim();
    return trustedDraftId
      ? { ok: true, id: trustedDraftId }
      : { ok: false, response: jsonError("Draft not found", 404) };
  }
  return loadAuthorizedDraft(principal, draftId);
}
