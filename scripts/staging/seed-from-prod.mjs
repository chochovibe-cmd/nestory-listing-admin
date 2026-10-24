// STAGING 1.6: copy a few representative drafts (+ catalog tables) from PRODUCTION into
// STAGING. Production is opened through a read-only Proxy; every write goes to staging.
//
//   node scripts/staging/seed-from-prod.mjs --drafts <id,id,...> --owner <staging profile uuid> --yes-staging <ref>
//
// Source: .env.prod-readonly.local (NEXT_PUBLIC_SUPABASE_URL must be the production ref)
// Target: .env.local (assertStagingTarget must pass, --yes-staging must equal the ref)
// Idempotent: upsert, so re-running is safe.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile, requireVars } from "./env-file.mjs";
import { PROD_SUPABASE_REF, assertStagingTarget, refFromSupabaseUrl } from "./fence.mjs";

// ---------------------------------------------------------------------------
// Read-only guard for the production client
// ---------------------------------------------------------------------------
const BLOCKED_CALLS = new Set([
  "insert",
  "update",
  "upsert",
  "delete",
  "rpc",
  // storage
  "upload",
  "uploadToSignedUrl",
  "createSignedUploadUrl",
  "remove",
  "move",
  "copy",
  "createBucket",
  "updateBucket",
  "emptyBucket",
  "deleteBucket"
]);
// Whole sub-clients that are not needed for reads at all.
const BLOCKED_PROPS = new Set(["auth", "functions", "realtime"]);

/**
 * Only client / builder objects (class instances) are wrapped. Plain data -- rows, arrays,
 * Blobs, promises -- passes through untouched, so a column that happens to be called
 * "update" or "copy" can never be mistaken for a blocked method.
 */
function isChainable(value) {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  if (value instanceof Promise || (typeof Blob !== "undefined" && value instanceof Blob)) return false;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return false;
  const proto = Object.getPrototypeOf(value);
  return proto !== null && proto !== Object.prototype && proto !== Array.prototype;
}

/** Wrap a supabase-js client so anything that could write throws as soon as it is used. */
export function makeReadOnlySource(client) {
  const wrap = (target, isRoot = false) => {
    if (!isRoot && !isChainable(target)) return target;
    return new Proxy(target, {
      get(obj, prop) {
        if (typeof prop === "string") {
          if (BLOCKED_CALLS.has(prop)) {
            return () => {
              throw new Error(`唯讀保護：禁止對正式站呼叫 ${prop}()`);
            };
          }
          if (BLOCKED_PROPS.has(prop)) {
            throw new Error(`唯讀保護：禁止存取正式站的 ${prop}`);
          }
        }
        // Receiver = target so private fields / getters keep working.
        const value = Reflect.get(obj, prop, obj);
        if (typeof value === "function") {
          return (...args) => wrap(value.apply(obj, args));
        }
        return wrap(value);
      }
    });
  };
  return wrap(client, true);
}

// ---------------------------------------------------------------------------
// Row transforms
// ---------------------------------------------------------------------------
/**
 * Pre-publish state chosen for drafts that were published / archived in production.
 * Mirrors src/lib/drafts/pipelineStage.ts: mapStatusToPipelineStage("approved") without a
 * Shopify product id = "image_review" (verify-staging-fence.mjs keeps these in sync).
 */
export const PRE_PUBLISH_STATUS = "approved";
export const PRE_PUBLISH_PIPELINE_STAGE = "image_review";

const RESET_STATUSES = new Set([
  "publishing",
  "active_published",
  "draft_created",
  "api_failed",
  "csv_ready",
  "archived"
]);

/** NOT NULL shopify_* columns cannot be set to null; they go back to their column default. */
const SHOPIFY_NOT_NULL_DEFAULTS = {
  shopify_tags: () => [],
  shopify_collections: () => [],
  shopify_payload_preview: () => ({}),
  shopify_sync_status: () => "never",
  shopify_media_mode: () => "tool"
};

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/** Every column starting with "shopify_" -> null (or its NOT NULL default). */
export function resetShopifyColumns(row) {
  const out = { ...row };
  for (const key of Object.keys(out)) {
    if (!key.startsWith("shopify_")) continue;
    out[key] = key in SHOPIFY_NOT_NULL_DEFAULTS ? SHOPIFY_NOT_NULL_DEFAULTS[key]() : null;
  }
  return out;
}

export function needsPrePublishReset(row) {
  return (
    RESET_STATUSES.has(row.status) ||
    row.pipeline_stage === "published" ||
    row.pipeline_stage === "archived" ||
    hasText(row.shopify_product_id)
  );
}

export function transformDraft(row, { owner }) {
  const reset = needsPrePublishReset(row);
  const out = resetShopifyColumns(row);
  out.created_by = owner;
  out.reviewed_by = row.reviewed_by ? owner : null;
  // The batch tables are not copied, so these pointers would dangle.
  out.current_image_batch_id = null;
  out.current_publish_batch_id = null;
  if (reset) {
    out.status = PRE_PUBLISH_STATUS;
    out.pipeline_stage = PRE_PUBLISH_PIPELINE_STAGE;
    out.publish_status = "pending";
    out.published_at = null;
    out.archived_at = null;
    out.status_before_archive = null;
    out.error_message = null;
  }
  return out;
}

export function transformVariant(row) {
  return resetShopifyColumns(row);
}

export function transformImage(row) {
  return resetShopifyColumns(row);
}

/** Catalog tables are matched on their natural key, so the production id is dropped. */
export function transformCatalogRow(row) {
  const { id: _id, ...rest } = row;
  if ("created_by" in rest) rest.created_by = null;
  return rest;
}

/** Swap the production Supabase host for the staging host everywhere inside a row. */
export function swapSupabaseHost(row, { prodRef, stagingHost }) {
  const text = JSON.stringify(row).split(`${prodRef}.supabase.co`).join(stagingHost);
  return JSON.parse(text);
}

/** Storage paths of product-images objects referenced anywhere inside the given rows. */
export function collectProductImagePaths(rows, { prodRef }) {
  const stop = "[^\"'\\s)?#\\\\]+";
  const pattern = new RegExp(
    `${prodRef}\\.supabase\\.co/storage/v1/object/(?:public|sign|authenticated)/product-images/(${stop})`,
    "g"
  );
  const paths = new Set();
  for (const row of rows) {
    for (const match of JSON.stringify(row).matchAll(pattern)) {
      try {
        paths.add(decodeURIComponent(match[1]));
      } catch {
        paths.add(match[1]);
      }
    }
  }
  return [...paths].sort();
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseArgs(argv) {
  const out = { drafts: [], owner: null, yesStaging: null };
  for (let i = 0; i < argv.length; i += 2) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--drafts") out.drafts = String(value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--owner") out.owner = value;
    else if (arg === "--yes-staging") out.yesStaging = value;
    else throw new Error(`不認得的參數：${arg}`);
  }
  if (out.drafts.length === 0) throw new Error("缺少 --drafts <id,id,…>");
  for (const id of out.drafts) {
    if (!UUID_RE.test(id)) throw new Error(`--drafts 裡有不是完整 UUID 的值：${id}`);
  }
  if (!out.owner || !UUID_RE.test(out.owner)) throw new Error("缺少 --owner <測試場 profile uuid>（需為完整 UUID）");
  if (!out.yesStaging) throw new Error("缺少 --yes-staging <ref>");
  return out;
}

async function fetchAll(source, table, apply = (q) => q) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await apply(source.from(table).select("*")).order("id").range(from, from + pageSize - 1);
    if (error) throw new Error(`讀取正式站 ${table} 失敗：${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return rows;
}

async function upsertChunks(target, table, rows, onConflict) {
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const { error } = await target.from(table).upsert(chunk, { onConflict });
    if (error) throw new Error(`寫入測試場 ${table} 失敗：${error.message}`);
  }
  return rows.length;
}

async function copyStorage({ source, target, paths }) {
  let copied = 0;
  const failures = [];
  const queue = [...paths];
  const worker = async () => {
    while (queue.length > 0) {
      const objectPath = queue.shift();
      try {
        const { data, error } = await source.storage.from("product-images").download(objectPath);
        if (error || !data) throw new Error(error?.message ?? "下載失敗");
        const bytes = Buffer.from(await data.arrayBuffer());
        const { error: uploadError } = await target.storage
          .from("product-images")
          .upload(objectPath, bytes, { contentType: data.type || undefined, upsert: true });
        if (uploadError) throw new Error(uploadError.message);
        copied += 1;
      } catch (error) {
        failures.push(`${objectPath}：${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return { copied, failures };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = parseArgs(process.argv.slice(2));

  // Source = production, read-only.
  const prodEnv = loadEnvFile(path.join(repoRoot, ".env.prod-readonly.local"));
  requireVars(prodEnv, ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"], ".env.prod-readonly.local");
  if (refFromSupabaseUrl(prodEnv.NEXT_PUBLIC_SUPABASE_URL) !== PROD_SUPABASE_REF) {
    throw new Error(".env.prod-readonly.local 的 NEXT_PUBLIC_SUPABASE_URL 不是正式資料庫，已停止。");
  }

  // Target = staging, fenced.
  const env = loadEnvFile(path.join(repoRoot, ".env.local"));
  requireVars(
    env,
    ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STAGING_DB_URL", "STAGING_SUPABASE_REF"],
    ".env.local"
  );
  const { ref } = assertStagingTarget({
    dbUrl: env.STAGING_DB_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    stagingRef: env.STAGING_SUPABASE_REF
  });
  if (args.yesStaging.trim().toLowerCase() !== ref) {
    throw new Error("--yes-staging 的值必須等於 STAGING_SUPABASE_REF，已停止。");
  }

  const clientOptions = { auth: { persistSession: false, autoRefreshToken: false } };
  const source = makeReadOnlySource(
    createClient(prodEnv.NEXT_PUBLIC_SUPABASE_URL, prodEnv.SUPABASE_SERVICE_ROLE_KEY, clientOptions)
  );
  const target = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, clientOptions);
  const stagingHost = `${ref}.supabase.co`;

  const { data: ownerRow, error: ownerError } = await target
    .from("profiles")
    .select("id")
    .eq("id", args.owner)
    .maybeSingle();
  if (ownerError) throw new Error(`讀取測試場 profiles 失敗：${ownerError.message}`);
  if (!ownerRow) throw new Error("測試場找不到 --owner 這位使用者的 profile，請先在 Authentication 建立使用者。");

  // ---- read from production ----
  const ipCatalog = await fetchAll(source, "ip_catalog");
  const ipCharacters = await fetchAll(source, "ip_characters");
  const tagRules = await fetchAll(source, "tag_rules");
  const drafts = await fetchAll(source, "product_drafts", (q) => q.in("id", args.drafts));
  const missing = args.drafts.filter((id) => !drafts.some((d) => d.id === id));
  if (missing.length > 0) throw new Error(`正式站找不到這些草稿：${missing.join("、")}`);
  const variants = await fetchAll(source, "product_variants", (q) => q.in("draft_id", args.drafts));
  const images = await fetchAll(source, "product_images", (q) => q.in("draft_id", args.drafts));

  // ---- transform ----
  const draftRows = drafts.map((row) => transformDraft(row, { owner: args.owner }));
  const imageRows = images.map(transformImage);
  const variantRows = variants.map(transformVariant);
  const storagePaths = collectProductImagePaths([...drafts, ...images, ...variants], { prodRef: PROD_SUPABASE_REF });
  const swap = (row) => swapSupabaseHost(row, { prodRef: PROD_SUPABASE_REF, stagingHost });

  const resetCount = drafts.filter(needsPrePublishReset).length;

  // ---- write to staging ----
  const counts = {};
  counts.ip_catalog = await upsertChunks(target, "ip_catalog", ipCatalog.map(transformCatalogRow), "ip_name");
  counts.ip_characters = await upsertChunks(
    target,
    "ip_characters",
    ipCharacters.map(transformCatalogRow),
    "ip_name,character_name"
  );
  counts.tag_rules = await upsertChunks(target, "tag_rules", tagRules.map(transformCatalogRow), "tag_value");

  const storage = await copyStorage({ source, target, paths: storagePaths });

  counts.product_drafts = await upsertChunks(target, "product_drafts", draftRows.map(swap), "id");
  counts.product_images = await upsertChunks(target, "product_images", imageRows.map(swap), "id");
  counts.product_variants = await upsertChunks(target, "product_variants", variantRows.map(swap), "id");

  console.log(`已寫入測試場 ${ref}：`);
  for (const [table, count] of Object.entries(counts)) console.log(`  ${table}: ${count} 筆`);
  console.log(`  storage product-images: ${storage.copied}/${storagePaths.length} 個檔案`);
  console.log(
    `「發布前」狀態：status=${PRE_PUBLISH_STATUS}、pipeline_stage=${PRE_PUBLISH_PIPELINE_STAGE}（改回的草稿 ${resetCount}/${drafts.length} 筆）`
  );
  if (storage.failures.length > 0) {
    console.error(`有 ${storage.failures.length} 個圖片檔複製失敗：`);
    for (const failure of storage.failures) console.error(`  - ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
