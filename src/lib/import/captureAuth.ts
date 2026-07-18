/**
 * CAP-1: personal capture token (generate / hash / verify).
 * Token can only create drafts via /api/import/product-page — no read/delete.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const CAPTURE_TOKEN_PREFIX = "ncap_";

/** ncap_ + 32-byte hex = 69 chars. */
export function generateCaptureToken(): string {
  return `${CAPTURE_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

export function isCaptureTokenFormat(token: string): boolean {
  return /^ncap_[0-9a-f]{64}$/i.test(token.trim());
}

export function hashCaptureToken(token: string): string {
  return createHash("sha256").update(token.trim(), "utf8").digest("hex");
}

/** Display mask for settings: ncap_a1b2…f9e0 */
export function captureTokenDisplayPrefix(token: string): string {
  const t = token.trim();
  if (!isCaptureTokenFormat(t)) {
    return `${CAPTURE_TOKEN_PREFIX}••••`;
  }
  const body = t.slice(CAPTURE_TOKEN_PREFIX.length);
  return `${CAPTURE_TOKEN_PREFIX}${body.slice(0, 4)}…${body.slice(-4)}`;
}

export function safeEqualHex(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "hex");
    const bb = Buffer.from(b, "hex");
    if (ba.length === 0 || ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

export type CaptureTokenProfile = {
  id: string;
  role: string | null;
  capture_token_hash: string | null;
  capture_token_prefix: string | null;
  capture_token_created_at: string | null;
};

export type CaptureAuthOk = {
  ok: true;
  userId: string;
  role: string | null;
};

export type CaptureAuthFail = {
  ok: false;
  error: "missing_token" | "invalid_token" | "migration_required" | "server_error";
  message: string;
  status: number;
};

/**
 * Resolve Authorization: Bearer ncap_… against profiles.capture_token_hash.
 * Uses service client (token not available via session).
 */
export async function verifyCaptureToken(
  serviceSupabase: { from: (table: string) => any },
  authorizationHeader: string | null
): Promise<CaptureAuthOk | CaptureAuthFail> {
  const raw = (authorizationHeader ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!raw) {
    return {
      ok: false,
      error: "missing_token",
      message: "請在 Authorization 帶 Bearer 擷取 token",
      status: 401
    };
  }
  if (!isCaptureTokenFormat(raw)) {
    return {
      ok: false,
      error: "invalid_token",
      message: "擷取 token 格式不正確",
      status: 401
    };
  }

  const hash = hashCaptureToken(raw);

  const { data, error } = await serviceSupabase
    .from("profiles")
    .select("id, role, capture_token_hash")
    .eq("capture_token_hash", hash)
    .maybeSingle();

  if (error) {
    const msg = error.message ?? "";
    if (/capture_token_hash|column .* does not exist/i.test(msg)) {
      return {
        ok: false,
        error: "migration_required",
        message: "請先在 Supabase SQL Editor 執行 migration 036（capture token 欄位）",
        status: 503
      };
    }
    return {
      ok: false,
      error: "server_error",
      message: `驗證 token 失敗：${msg}`,
      status: 500
    };
  }

  if (!data?.id || !data.capture_token_hash) {
    return {
      ok: false,
      error: "invalid_token",
      message: "擷取 token 無效或已重設",
      status: 401
    };
  }

  // Defense in depth: re-check hash equality with constant-time compare
  if (!safeEqualHex(hash, data.capture_token_hash)) {
    return {
      ok: false,
      error: "invalid_token",
      message: "擷取 token 無效或已重設",
      status: 401
    };
  }

  return { ok: true, userId: data.id as string, role: (data.role as string) ?? null };
}

export type IssueCaptureTokenResult =
  | {
      ok: true;
      token: string;
      prefix: string;
      created_at: string;
    }
  | {
      ok: false;
      error: "migration_required" | "server_error";
      message: string;
    };

/** Generate a new token, store hash on profile, return plaintext once. */
export async function issueCaptureToken(
  serviceSupabase: { from: (table: string) => any },
  userId: string
): Promise<IssueCaptureTokenResult> {
  const token = generateCaptureToken();
  const hash = hashCaptureToken(token);
  const prefix = captureTokenDisplayPrefix(token);
  const created_at = new Date().toISOString();

  const { error } = await serviceSupabase
    .from("profiles")
    .update({
      capture_token_hash: hash,
      capture_token_prefix: prefix,
      capture_token_created_at: created_at
    })
    .eq("id", userId);

  if (error) {
    const msg = error.message ?? "";
    if (/capture_token|column .* does not exist/i.test(msg)) {
      return {
        ok: false,
        error: "migration_required",
        message: "請先在 Supabase SQL Editor 執行 migration 036（capture token 欄位）"
      };
    }
    return {
      ok: false,
      error: "server_error",
      message: `寫入 token 失敗：${msg}`
    };
  }

  return { ok: true, token, prefix, created_at };
}

export async function readCaptureTokenStatus(
  serviceSupabase: { from: (table: string) => any },
  userId: string
): Promise<
  | {
      ok: true;
      hasToken: boolean;
      prefix: string | null;
      created_at: string | null;
    }
  | {
      ok: false;
      error: "migration_required" | "server_error";
      message: string;
    }
> {
  const { data, error } = await serviceSupabase
    .from("profiles")
    .select("capture_token_hash, capture_token_prefix, capture_token_created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    const msg = error.message ?? "";
    if (/capture_token|column .* does not exist/i.test(msg)) {
      return {
        ok: false,
        error: "migration_required",
        message: "請先在 Supabase SQL Editor 執行 migration 036（capture token 欄位）"
      };
    }
    return {
      ok: false,
      error: "server_error",
      message: `讀取 token 狀態失敗：${msg}`
    };
  }

  return {
    ok: true,
    hasToken: Boolean(data?.capture_token_hash),
    prefix: (data?.capture_token_prefix as string) ?? null,
    created_at: (data?.capture_token_created_at as string) ?? null
  };
}
