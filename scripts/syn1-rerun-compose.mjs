/**
 * One-shot: recompose detail for a draft (SYN-1 fix re-verify).
 * Usage: node scripts/syn1-rerun-compose.mjs [draftId]
 * Needs .env.local SUPABASE + optional OPENAI.
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const draftId = process.argv[2] || "b45259ef-????";

function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

loadEnvLocal();

// Resolve full draft id if prefix given
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

let id = process.argv[2];
if (!id) {
  console.error("Usage: node scripts/syn1-rerun-compose.mjs <draftId>");
  process.exit(1);
}

if (id.length < 36) {
  const { data, error } = await sb
    .from("product_drafts")
    .select("id, title_zh")
    .ilike("id", `${id}%`)
    .limit(5);
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (!data?.length) {
    console.error("No draft match for", id);
    process.exit(1);
  }
  if (data.length > 1) {
    console.error("Multiple matches:", data.map((d) => d.id));
    process.exit(1);
  }
  id = data[0].id;
  console.log("Resolved draft", id, data[0].title_zh);
}

// Use tsx-less path: spawn next isn't available. Import via dynamic ts compile?
// Prefer calling the API route if WORKER_API_TOKEN set, else use compiled path.

const token = process.env.WORKER_API_TOKEN?.trim();
const base =
  process.env.SYN1_COMPOSE_BASE?.trim() ||
  process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
  "http://localhost:3000";

if (token) {
  console.log("POST", `${base}/api/images/compose-detail`, { draftId: id, force: true });
  const res = await fetch(`${base}/api/images/compose-detail`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ draftId: id, force: true })
  });
  const json = await res.json().catch(() => ({}));
  console.log("status", res.status);
  console.log(JSON.stringify(json, null, 2));
  if (json.processedFileUrl) {
    console.log("\nNEW_URL=", json.processedFileUrl);
  }
  // List latest generated_detail
  const { data: imgs } = await sb
    .from("product_images")
    .select("id, image_type, processed_file_url, created_at, processing_status")
    .eq("draft_id", id)
    .eq("image_type", "generated_detail")
    .order("created_at", { ascending: false })
    .limit(3);
  console.log("latest generated_detail rows:", imgs);
  process.exit(res.ok ? 0 : 1);
}

// Fallback: list only if no token (worker will be needed)
console.log("No WORKER_API_TOKEN / local server — listing current generated_detail only");
const { data: imgs, error } = await sb
  .from("product_images")
  .select("id, image_type, processed_file_url, generated_file_url, created_at, processing_status")
  .eq("draft_id", id)
  .eq("image_type", "generated_detail")
  .order("created_at", { ascending: false })
  .limit(5);
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(JSON.stringify(imgs, null, 2));
console.log(
  "\nTo recompose: start app, set WORKER_API_TOKEN, then:\n  node scripts/syn1-rerun-compose.mjs",
  id
);
