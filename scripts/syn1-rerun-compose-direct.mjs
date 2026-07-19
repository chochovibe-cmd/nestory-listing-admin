/**
 * Direct recompose (node --experimental-strip-types) with @/ alias hook.
 * Usage: node --experimental-strip-types scripts/syn1-rerun-compose-direct.mjs [draftId]
 */
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = join(root, "src").replace(/\\/g, "/");

register(
  "data:text/javascript," +
    encodeURIComponent(`
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
const SRC = ${JSON.stringify(srcRoot)};
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = SRC + "/" + specifier.slice(2);
    const candidates = [base + ".ts", base + ".tsx", base + "/index.ts", base];
    for (const c of candidates) {
      if (existsSync(c)) {
        return nextResolve(pathToFileURL(c).href, context);
      }
    }
    return nextResolve(pathToFileURL(base + ".ts").href, context);
  }
  return nextResolve(specifier, context);
}
`),
  pathToFileURL("./")
);

function loadEnvLocal() {
  const p = join(root, ".env.local");
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m || process.env[m[1]]) continue;
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

const draftId =
  process.argv[2] || "b45259ef-6012-4488-9387-d6f50e82b97b";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const sb = createClient(url, key, { auth: { persistSession: false } });

const modUrl = pathToFileURL(
  join(root, "src/lib/images/detailCompose/runComposeDetail.ts")
).href;
const { runComposeDetailForDraft } = await import(modUrl);

const result = await runComposeDetailForDraft({
  serviceSupabase: sb,
  draftId,
  force: true
});
console.log(JSON.stringify(result, null, 2));
if (result.ok && result.processedFileUrl) {
  console.log("\nNEW_URL=" + result.processedFileUrl);
  console.log("NEW_IMAGE_ID=" + result.imageId);
}
const { data: imgs } = await sb
  .from("product_images")
  .select("id, processed_file_url, created_at, processing_status")
  .eq("draft_id", draftId)
  .eq("image_type", "generated_detail")
  .order("created_at", { ascending: false })
  .limit(3);
console.log("latest generated_detail", JSON.stringify(imgs, null, 2));
process.exit(result.ok ? 0 : 1);
