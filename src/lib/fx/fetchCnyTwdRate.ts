/**
 * C6: shared CNY→TWD rate fetch (server-side only).
 * Honest failure — never invent a rate or reuse a previous day as "today".
 *
 * Source: open.er-api.com (free, no key). Same provider C2 used from the browser;
 * now only the server calls it so cron + settings share one path.
 */

export const FX_SOURCE = "open.er-api.com/v6/latest/CNY";
export const FX_URL = "https://open.er-api.com/v6/latest/CNY";

export type FxFetchOk = {
  ok: true;
  rate: number;
  /** ISO timestamp of the quote (provider update time when available). */
  asOf: string;
  source: string;
};

export type FxFetchErr = {
  ok: false;
  error: string;
};

export type FxFetchResult = FxFetchOk | FxFetchErr;

type OpenErApiResponse = {
  result?: string;
  rates?: { TWD?: number };
  time_last_update_utc?: string;
};

/**
 * Round half-up style to 2 decimal places (storefront display).
 * Rejects non-finite / non-positive values so callers never get junk.
 */
export function roundFxRate(raw: number): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

/**
 * Parse open.er-api JSON body into a success result or honest error.
 * Exported for unit-style verification without network.
 */
export function parseOpenErApiCnyTwd(data: unknown, fetchedAt = new Date()): FxFetchResult {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "parse" };
  }
  const body = data as OpenErApiResponse;
  if (body.result && body.result !== "success") {
    return { ok: false, error: `provider_${body.result}` };
  }
  const rounded = roundFxRate(body.rates?.TWD as number);
  if (rounded == null) {
    return { ok: false, error: "parse" };
  }

  let asOf = fetchedAt.toISOString();
  if (typeof body.time_last_update_utc === "string" && body.time_last_update_utc.trim()) {
    const parsed = new Date(body.time_last_update_utc);
    if (!Number.isNaN(parsed.getTime())) {
      asOf = parsed.toISOString();
    }
  }

  return {
    ok: true,
    rate: rounded,
    asOf,
    source: FX_SOURCE
  };
}

export type FetchCnyTwdRateOptions = {
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Abort / network timeout in ms (default 12s). */
  timeoutMs?: number;
};

/**
 * Fetch live CNY→TWD. Safe to call from Route Handlers / Cron only
 * (uses absolute URL; no browser CORS issues).
 */
export async function fetchCnyTwdRate(
  options: FetchCnyTwdRateOptions = {}
): Promise<FxFetchResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(FX_URL, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      headers: { Accept: "application/json" }
    });

    if (!response.ok) {
      return { ok: false, error: `http_${response.status}` };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      return { ok: false, error: "invalid_json" };
    }

    return parseOpenErApiCnyTwd(json);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return { ok: false, error: "timeout" };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network"
    };
  } finally {
    clearTimeout(timer);
  }
}
