import { fetchCnyTwdRate } from "@/lib/fx/fetchCnyTwdRate";

/**
 * C6: daily Vercel Cron skeleton for CNY→TWD.
 *
 * - Auth: Authorization: Bearer ${CRON_SECRET}
 *   · production / Vercel production without CRON_SECRET → 401
 *   · local development without secret → allowed (documented; no secret in repo)
 * - Fetches via shared fetchCnyTwdRate; returns JSON for Vercel logs.
 * - Does NOT write Supabase / team_settings in this package.
 *   Future: when Supabase is testable, persist quote for team-wide 今日參考.
 *
 * vercel.json schedule example: "0 16 * * *" = 16:00 UTC ≈ 00:00 Asia/Taipei (no DST).
 * Vercel free tier allows 2 crons — leave the other slot for Phase D stuck-batch scan.
 */

function isProductionRuntime(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview"
  );
}

function authorizeCron(request: Request): { ok: true } | { ok: false; reason: string } {
  const secret = process.env.CRON_SECRET?.trim();
  const auth = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : null;

  if (secret) {
    if (auth === expected) return { ok: true };
    return { ok: false, reason: "invalid_or_missing_bearer" };
  }

  // No CRON_SECRET configured
  if (isProductionRuntime()) {
    return { ok: false, reason: "cron_secret_not_configured" };
  }

  // Dev-only relax: local npm run / next dev without secret.
  return { ok: true };
}

export async function GET(request: Request) {
  const auth = authorizeCron(request);
  if (!auth.ok) {
    return Response.json(
      { ok: false as const, error: "unauthorized", reason: auth.reason },
      { status: 401 }
    );
  }

  const result = await fetchCnyTwdRate();

  if (!result.ok) {
    // Honest failure for logs — no fake rate, no DB write of stale data.
    return Response.json(
      {
        ok: false as const,
        error: result.error,
        // Future team_settings write skipped (no DB in C6).
        persisted: false,
        note: "FX fetch failed; no fake data stored. Applied client rates unchanged."
      },
      { status: 502 }
    );
  }

  return Response.json({
    ok: true as const,
    rate: result.rate,
    asOf: result.asOf,
    source: result.source,
    // C6: cron only proves daily fetch works. Team-wide cache = later package.
    persisted: false,
    note:
      "Fetched successfully. Team shared store (team_settings) deferred until Supabase is available; clients still use /api/fx/cny-twd + local nestory_fx_reference."
  });
}
