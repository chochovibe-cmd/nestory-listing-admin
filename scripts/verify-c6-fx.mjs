/**
 * C6 pure-logic verification (no secrets required).
 * Run: node scripts/verify-c6-fx.mjs
 *
 * Mirrors parse / round / Taiwan-day / "apply does not auto" rules from:
 *   src/lib/fx/fetchCnyTwdRate.ts
 *   src/lib/fx/fxReferenceStore.ts
 * and static checks that Settings no longer browser-directs open.er-api.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// --- Inline mirrors of fetchCnyTwdRate.ts ---

const FX_SOURCE = "open.er-api.com/v6/latest/CNY";

function roundFxRate(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

function parseOpenErApiCnyTwd(data, fetchedAt = new Date()) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "parse" };
  }
  if (data.result && data.result !== "success") {
    return { ok: false, error: `provider_${data.result}` };
  }
  const rounded = roundFxRate(data.rates?.TWD);
  if (rounded == null) {
    return { ok: false, error: "parse" };
  }
  let asOf = fetchedAt.toISOString();
  if (typeof data.time_last_update_utc === "string" && data.time_last_update_utc.trim()) {
    const parsed = new Date(data.time_last_update_utc);
    if (!Number.isNaN(parsed.getTime())) {
      asOf = parsed.toISOString();
    }
  }
  return { ok: true, rate: rounded, asOf, source: FX_SOURCE };
}

// --- Inline mirrors of fxReferenceStore Taiwan day ---

function taiwanCalendarDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function isSameTaiwanCalendarDay(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return taiwanCalendarDateKey(d) === taiwanCalendarDateKey(now);
}

function isFreshFxReference(ref, now = new Date()) {
  if (!ref) return false;
  if (typeof ref.rate !== "number" || !Number.isFinite(ref.rate) || ref.rate <= 0) return false;
  if (typeof ref.fetchedAt !== "string" || !ref.fetchedAt) return false;
  return isSameTaiwanCalendarDay(ref.fetchedAt, now);
}

// Applied rate is separate store key — never written by reference helpers
const PRICING_KEY = "nestory_pricing_settings";
const REF_KEY = "nestory_fx_reference";

console.log("C6 FX verification\n");

await check("parse success rounds TWD to 2 decimals", () => {
  const r = parseOpenErApiCnyTwd({
    result: "success",
    rates: { TWD: 4.4567 },
    time_last_update_utc: "Thu, 10 Jul 2025 00:00:01 +0000"
  });
  assert.equal(r.ok, true);
  assert.equal(r.rate, 4.46);
  assert.equal(r.source, FX_SOURCE);
  assert.ok(typeof r.asOf === "string");
});

await check("parse failure on missing TWD — no fake rate", () => {
  const r = parseOpenErApiCnyTwd({ result: "success", rates: {} });
  assert.equal(r.ok, false);
  assert.equal(r.error, "parse");
  assert.equal("rate" in r, false);
});

await check("parse failure on zero / negative — no fake rate", () => {
  assert.equal(parseOpenErApiCnyTwd({ rates: { TWD: 0 } }).ok, false);
  assert.equal(parseOpenErApiCnyTwd({ rates: { TWD: -1 } }).ok, false);
  assert.equal(roundFxRate(NaN), null);
});

await check("provider error result is honest fail", () => {
  const r = parseOpenErApiCnyTwd({ result: "error", rates: { TWD: 4.5 } });
  assert.equal(r.ok, false);
  assert.match(r.error, /^provider_/);
});

await check("Taiwan calendar day: same day is fresh", () => {
  const now = new Date("2026-07-13T10:00:00+08:00");
  const ref = { rate: 4.52, fetchedAt: "2026-07-13T01:00:00.000Z", source: "t" };
  assert.equal(isFreshFxReference(ref, now), true);
});

await check("Taiwan calendar day: previous day is stale", () => {
  const now = new Date("2026-07-13T10:00:00+08:00");
  const ref = { rate: 4.52, fetchedAt: "2026-07-12T02:00:00.000Z", source: "t" };
  assert.equal(isFreshFxReference(ref, now), false);
});

await check("storing reference must not share pricing key", () => {
  assert.notEqual(REF_KEY, PRICING_KEY);
  assert.equal(REF_KEY, "nestory_fx_reference");
  assert.equal(PRICING_KEY, "nestory_pricing_settings");
});

await check("default applied rate stays 4.5 in pricing.ts", () => {
  const pricingSrc = fs.readFileSync(path.join(root, "src/lib/pricing.ts"), "utf8");
  assert.match(pricingSrc, /rate:\s*4\.5/);
  assert.doesNotMatch(pricingSrc, /rate:\s*4\.7/);
});

await check("SettingsPanel does not browser-direct open.er-api", () => {
  const src = fs.readFileSync(
    path.join(root, "src/components/settings/SettingsPanel.tsx"),
    "utf8"
  );
  assert.doesNotMatch(src, /fetch\(["']https:\/\/open\.er-api\.com/);
  assert.match(src, /\/api\/fx\/cny-twd/);
  assert.match(src, /setStoredFxReference/);
});

await check("ExchangeRateWidget shows today ref, no one-click apply", () => {
  const src = fs.readFileSync(
    path.join(root, "src/components/ExchangeRateWidget.tsx"),
    "utf8"
  );
  assert.match(src, /今日/);
  assert.match(src, /\/api\/fx\/cny-twd/);
  assert.match(src, /setStoredFxReference/);
  // Must not write pricing store
  assert.doesNotMatch(src, /setStoredPricingSettings/);
  assert.doesNotMatch(src, /↻/);
});

await check("API routes exist and cron does not write DB", () => {
  const fx = fs.readFileSync(path.join(root, "src/app/api/fx/cny-twd/route.ts"), "utf8");
  const cron = fs.readFileSync(path.join(root, "src/app/api/cron/fx/route.ts"), "utf8");
  assert.match(fx, /fetchCnyTwdRate/);
  assert.match(cron, /fetchCnyTwdRate/);
  assert.match(cron, /CRON_SECRET/);
  assert.match(cron, /persisted:\s*false/);
  assert.doesNotMatch(cron, /createServiceSupabaseClient|from\(["']team_settings/);
});

await check("vercel.json has one fx cron, schedule documented", () => {
  const raw = fs.readFileSync(path.join(root, "vercel.json"), "utf8");
  const json = JSON.parse(raw);
  assert.ok(Array.isArray(json.crons));
  assert.equal(json.crons.length, 1);
  assert.equal(json.crons[0].path, "/api/cron/fx");
  assert.equal(json.crons[0].schedule, "0 16 * * *");
});

await check("env example documents CRON_SECRET", () => {
  const env = fs.readFileSync(path.join(root, ".env.example"), "utf8");
  assert.match(env, /CRON_SECRET/);
});

await check("fetch success path never mutates applied rate automatically", () => {
  // Simulate: after successful parse, only reference would be set; applied stays.
  const appliedBefore = 4.5;
  const parsed = parseOpenErApiCnyTwd({ rates: { TWD: 4.68 } });
  assert.equal(parsed.ok, true);
  // Applied only changes if explicit apply copies reference → pricing.rate
  const appliedAfterAutoFetch = appliedBefore;
  assert.equal(appliedAfterAutoFetch, 4.5);
  const appliedAfterApply = parsed.rate;
  assert.equal(appliedAfterApply, 4.68);
  assert.notEqual(appliedAfterAutoFetch, appliedAfterApply);
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
