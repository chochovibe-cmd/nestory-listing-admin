// STAGING 1.6: run SQL against the STAGING database only (never production).
//
//   node scripts/staging/apply-sql.mjs --file <path.sql>   --yes-staging <ref>
//   node scripts/staging/apply-sql.mjs --query "select ..." --yes-staging <ref>
//
// Reads STAGING_DB_URL, NEXT_PUBLIC_SUPABASE_URL, STAGING_SUPABASE_REF from .env.local.
// assertStagingTarget() must pass AND --yes-staging must equal the ref, or nothing connects.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile, requireVars } from "./env-file.mjs";
import { assertStagingTarget } from "./fence.mjs";

export function parseArgs(argv) {
  const out = { file: null, query: null, yesStaging: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--file") out.file = next;
    else if (arg === "--query") out.query = next;
    else if (arg === "--yes-staging") out.yesStaging = next;
    else throw new Error(`不認得的參數：${arg}`);
    i += 1;
  }
  if (Boolean(out.file) === Boolean(out.query)) {
    throw new Error("--file 和 --query 必須擇一");
  }
  if (!out.yesStaging) throw new Error("缺少 --yes-staging <ref>");
  return out;
}

/** --query accepts one read-only statement: starts with select/with, no extra statements. */
export function validateReadQuery(sql) {
  const text = String(sql ?? "").trim();
  if (!/^(select|with)\b/i.test(text)) {
    throw new Error("--query 只接受 select 或 with 開頭的查詢");
  }
  if (text.replace(/;\s*$/, "").includes(";")) {
    throw new Error("--query 只能是單一查詢（不能含分號串接的多段語句）");
  }
  return text.replace(/;\s*$/, "");
}

/** Resolve + verify the staging target. Throws before any connection is made. */
export function resolveStagingTarget(env, yesStaging) {
  requireVars(env, ["STAGING_DB_URL", "NEXT_PUBLIC_SUPABASE_URL", "STAGING_SUPABASE_REF"], ".env.local");
  const { ref } = assertStagingTarget({
    dbUrl: env.STAGING_DB_URL,
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    stagingRef: env.STAGING_SUPABASE_REF
  });
  if (String(yesStaging ?? "").trim().toLowerCase() !== ref) {
    throw new Error("--yes-staging 的值必須等於 STAGING_SUPABASE_REF，已停止。");
  }
  return { ref, dbUrl: env.STAGING_DB_URL };
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const args = parseArgs(process.argv.slice(2));
  const query = args.query ? validateReadQuery(args.query) : null;
  const env = loadEnvFile(path.join(repoRoot, ".env.local"));
  const { ref, dbUrl } = resolveStagingTarget(env, args.yesStaging);

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    if (query) {
      // Belt and braces: the database itself refuses writes inside a read-only transaction.
      await client.query("begin read only");
      try {
        const result = await client.query(query);
        console.log(JSON.stringify(result.rows, null, 2));
      } finally {
        await client.query("rollback");
      }
    } else {
      const sql = fs.readFileSync(path.resolve(args.file), "utf8");
      // Simple query, one round trip, no wrapping transaction (the file controls its own begin/commit).
      await client.query(sql);
      console.log(`已套用 ${path.basename(args.file)} 到測試場 ${ref}（${Buffer.byteLength(sql)} bytes）`);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    // pg errors can echo statement text; print the message only, never the connection string.
    console.error(`失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
