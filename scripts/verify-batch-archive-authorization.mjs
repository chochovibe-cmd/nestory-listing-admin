import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("src/app/api/drafts/batch/archive/route.ts", "utf8");
const schema = fs.readFileSync("supabase/history/pre_tracking_migrations/001_initial_schema.sql", "utf8");

// The route may use service role for the final archive/unarchive mutation, but
// requested draft IDs must first be scoped through the signed-in user's RLS.
const handleActionIndex = route.indexOf("async function handleAction");
assert.ok(handleActionIndex > 0, "batch archive handleAction boundary missing");
const authPhase = route.slice(0, handleActionIndex);

assert.match(authPhase, /const authSupabase = await createServerSupabaseClient\(\)/);
assert.match(
  authPhase,
  /const \{ data: rows, error: loadError \} = await authSupabase\s*\.from\("product_drafts"\)/
);
assert.match(
  authPhase,
  /const fallback = await authSupabase\s*\.from\("product_drafts"\)/
);
assert.doesNotMatch(
  authPhase,
  /await serviceSupabase\s*\.from\("product_drafts"\)\s*\.select/,
  "service role must not load requested draft IDs before RLS authorization"
);

// Final writes still use the service client after the RLS-filtered row set is
// passed into handleAction. This preserves archive support for special states
// without granting service-role read scope to the request payload.
assert.match(route, /handleAction\(action as Action, rows \?\? \[\], serviceSupabase, false\)/);
assert.match(route, /serviceSupabase\.from\("product_drafts"\)\.update\(patch\)\.eq\("id", id\)/);

// Lock the DB-side visibility model that the route relies on. Migration 001 is
// now pre-tracking history, so verifier reads it from the historical archive.
// reviewer/admin see team drafts; operators only see their own draft rows.
assert.match(schema, /create policy "team can read product drafts"/);
assert.match(
  schema,
  /public\.current_user_role\(\) in \('admin', 'reviewer'\)[\s\S]*?or created_by = auth\.uid\(\)/
);

console.log("Batch archive authorization checks passed");
