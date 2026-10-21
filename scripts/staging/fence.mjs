// STAGING 1.6: hard fence for every script that writes to a database.
// A script may only touch the staging project; the production ref is hard-coded
// (same literal as src/lib/env/nestoryEnv.ts -- verify-staging-fence.mjs keeps them equal).

export const PROD_SUPABASE_REF = "tbgtqwvuohmdxnxisrgr";

/** https://<ref>.supabase.co[/...] -> <ref>, else null. */
export function refFromSupabaseUrl(url) {
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co(?:[/?#].*)?$/i.exec(String(url ?? "").trim());
  return match ? match[1].toLowerCase() : null;
}

/**
 * Project ref from a Postgres connection string.
 *   Session pooler: postgresql://postgres.<ref>:<pw>@aws-0-<region>.pooler.supabase.com:5432/postgres
 *   Direct:         postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres
 * Anything else (unknown host, user/host refs that disagree) -> null.
 */
export function refFromDbUrl(url) {
  const trimmed = String(url ?? "").trim();
  const schemeMatch = /^postgres(?:ql)?:\/\//i.exec(trimmed);
  if (!schemeMatch) return null;
  const rest = trimmed.slice(schemeMatch[0].length);
  // The password may contain "/" or ":", so anchor on the LAST "@".
  const at = rest.lastIndexOf("@");
  if (at < 0) return null;
  const userInfo = rest.slice(0, at);
  const host = rest
    .slice(at + 1)
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .toLowerCase();
  const user = userInfo.split(":")[0];

  const directRef = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(host)?.[1] ?? null;
  const isPooler = /^[a-z0-9.-]+\.pooler\.supabase\.com$/.test(host);
  const userRef = /^postgres\.([a-z0-9]+)$/i.exec(user)?.[1]?.toLowerCase() ?? null;

  if (directRef) {
    if (userRef && userRef !== directRef) return null;
    return directRef;
  }
  if (isPooler && userRef) return userRef;
  return null;
}

/**
 * Throws unless dbUrl, supabaseUrl and stagingRef all resolve to the SAME
 * non-production project ref. Error messages never include the URLs (they hold passwords).
 */
export function assertStagingTarget({ dbUrl, supabaseUrl, stagingRef }) {
  const wanted = String(stagingRef ?? "").trim().toLowerCase();
  const dbRef = refFromDbUrl(dbUrl);
  const apiRef = refFromSupabaseUrl(supabaseUrl);

  if (!wanted) throw new Error("STAGING_SUPABASE_REF 沒有設定，已停止。");
  if (!dbRef) throw new Error("STAGING_DB_URL 解析不出專案代號（需為 Session pooler 或 db.<ref>.supabase.co 格式），已停止。");
  if (!apiRef) throw new Error("NEXT_PUBLIC_SUPABASE_URL 解析不出專案代號，已停止。");

  for (const [label, ref] of [
    ["STAGING_SUPABASE_REF", wanted],
    ["STAGING_DB_URL", dbRef],
    ["NEXT_PUBLIC_SUPABASE_URL", apiRef]
  ]) {
    if (ref === PROD_SUPABASE_REF) {
      throw new Error(`${label} 指向正式資料庫，已停止。`);
    }
  }
  if (dbRef !== wanted || apiRef !== wanted) {
    throw new Error("STAGING_SUPABASE_REF、STAGING_DB_URL、NEXT_PUBLIC_SUPABASE_URL 三者的專案代號不一致，已停止。");
  }
  return { ref: wanted };
}
