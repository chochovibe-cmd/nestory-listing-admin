import { scanStuckBatches } from "@/lib/notifications/scanStuckBatches";

/**
 * D6-open: daily Vercel Cron — stuck image batches + optional catch-up notify.
 *
 * Auth: same pattern as /api/cron/fx (Bearer CRON_SECRET).
 * vercel.json: second free cron slot (fx uses the first).
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

  if (isProductionRuntime()) {
    return { ok: false, reason: "cron_secret_not_configured" };
  }

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

  try {
    const result = await scanStuckBatches({ catchUpTerminal: true });
    return Response.json({
      ok: result.ok,
      scanned: result.scanned,
      markedStuck: result.markedStuck,
      notifyAttempted: result.notifyAttempted,
      notifyClaimed: result.notifyClaimed,
      catchUpAttempted: result.catchUpAttempted,
      errors: result.errors,
      note: result.note
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Honest failure — never fake a successful notify
    return Response.json(
      {
        ok: false as const,
        error: "scan_failed",
        message: message.slice(0, 200)
      },
      { status: 500 }
    );
  }
}
