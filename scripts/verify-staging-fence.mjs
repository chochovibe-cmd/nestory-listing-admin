/**
 * STAGING 1.6 verification (no secrets, no network, no database).
 * Spec: docs/STAGING-施工規格-2026-10-21.md section 3.6.
 *
 *  1. readNestoryEnvironment matrix (declared x DB x shop)
 *  2. supabaseRefFromUrl / normalizeShopDomain boundaries
 *  3. environmentBannerModel tone + verbatim text
 *  4. adminToken: mismatch -> throws BEFORE any fetch / cache read; consistent -> fetch happens
 *  5. scripts/staging/fence.mjs (pooler + direct URLs, prod ref, mismatched refs)
 *  6. seed-from-prod read-only Proxy (+ row transforms)
 *  7. static guards: banner position, banner CSS, /api/status, env template, wiring
 *  Extra: build-bootstrap ordering, apply-sql gates, post-capture production-host refusal.
 *
 * Run: node scripts/verify-staging-fence.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Load the TS modules standalone (transpile -> temp .mjs -> import)
// ---------------------------------------------------------------------------
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nestory-staging-fence-"));
function transpileTo(rel, outName, rewrite = (s) => s) {
  const source = rewrite(read(rel));
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    fileName: rel
  }).outputText;
  const file = path.join(tmpDir, outName);
  fs.writeFileSync(file, js);
  return pathToFileURL(file).href;
}

const envUrl = transpileTo("src/lib/env/nestoryEnv.ts", "nestoryEnv.mjs");
const tokenSource = read("src/lib/shopify/adminToken.ts");
assert.ok(tokenSource.includes('from "@/lib/env/nestoryEnv"'), "adminToken must import the env fence");
const tokenUrl = transpileTo("src/lib/shopify/adminToken.ts", "adminToken.mjs", (s) =>
  s.replace('"@/lib/env/nestoryEnv"', '"./nestoryEnv.mjs"')
);
const pipelineUrl = transpileTo("src/lib/drafts/pipelineStage.ts", "pipelineStage.mjs");

const nestoryEnv = await import(envUrl);
const {
  PROD_SUPABASE_REF,
  PROD_SHOP_DOMAIN,
  supabaseRefFromUrl,
  normalizeShopDomain,
  readNestoryEnvironment,
  environmentBannerModel,
  assertShopifyEnvironment,
  ShopifyEnvironmentMismatchError
} = nestoryEnv;
const { mapStatusToPipelineStage } = await import(pipelineUrl);

const fence = await import(pathToFileURL(path.join(root, "scripts/staging/fence.mjs")).href);
const seed = await import(pathToFileURL(path.join(root, "scripts/staging/seed-from-prod.mjs")).href);
const bootstrap = await import(pathToFileURL(path.join(root, "scripts/staging/build-bootstrap.mjs")).href);
const applySql = await import(pathToFileURL(path.join(root, "scripts/staging/apply-sql.mjs")).href);
const capture = await import(pathToFileURL(path.join(root, "scripts/staging/post-capture-fixture.mjs")).href);
const envFile = await import(pathToFileURL(path.join(root, "scripts/staging/env-file.mjs")).href);

// ---------------------------------------------------------------------------
// Fixtures for the matrix
// ---------------------------------------------------------------------------
const OTHER_REF = "abcdefghijklmnopqrst";
const DB = {
  prod: `https://${PROD_SUPABASE_REF}.supabase.co`,
  other: `https://${OTHER_REF}.supabase.co`
};
const SHOP = {
  prod: PROD_SHOP_DOMAIN,
  other: "nestory-staging.myshopify.com",
  empty: undefined
};

function makeEnv({ declared, db, shop }) {
  const env = { NEXT_PUBLIC_SUPABASE_URL: DB[db] };
  if (declared !== undefined) env.NESTORY_ENV = declared;
  if (SHOP[shop] !== undefined) env.SHOPIFY_STORE_DOMAIN = SHOP[shop];
  return env;
}

// ===========================================================================
console.log("1. readNestoryEnvironment");
// ===========================================================================
await check("spec constants are written verbatim", () => {
  assert.equal(PROD_SUPABASE_REF, "tbgtqwvuohmdxnxisrgr");
  assert.equal(PROD_SHOP_DOMAIN, "e0jg81-qe.myshopify.com");
  assert.equal(fence.PROD_SUPABASE_REF, PROD_SUPABASE_REF, "fence.mjs constant must equal nestoryEnv.ts");
});

const named = [
  // [label, input, effective, problems]
  ["unset + prod DB + prod shop -> production, no problems", { db: "prod", shop: "prod" }, "production", []],
  ["unset + other DB + other shop -> local, no problems", { db: "other", shop: "other" }, "local", []],
  ["unset + prod DB + other shop -> local, prod DB flagged", { db: "prod", shop: "other" }, "local", ["non_prod_env_prod_db"]],
  ["unset + other DB + prod shop -> local, prod shop flagged", { db: "other", shop: "prod" }, "local", ["non_prod_env_prod_shop"]],
  ["unset + prod DB + empty shop -> local, prod DB flagged", { db: "prod", shop: "empty" }, "local", ["non_prod_env_prod_db"]],
  ["unset + other DB + empty shop -> local, no problems", { db: "other", shop: "empty" }, "local", []],
  ["production + prod/prod -> ok", { declared: "production", db: "prod", shop: "prod" }, "production", []],
  ["production + other DB + prod shop", { declared: "production", db: "other", shop: "prod" }, "production", ["prod_env_non_prod_db"]],
  ["production + prod DB + other shop", { declared: "production", db: "prod", shop: "other" }, "production", ["prod_env_non_prod_shop"]],
  ["production + other/other", { declared: "production", db: "other", shop: "other" }, "production", ["prod_env_non_prod_db", "prod_env_non_prod_shop"]],
  ["production + prod DB + empty shop", { declared: "production", db: "prod", shop: "empty" }, "production", ["prod_env_non_prod_shop"]],
  ["staging + other/other -> ok", { declared: "staging", db: "other", shop: "other" }, "staging", []],
  ["staging + prod DB + other shop", { declared: "staging", db: "prod", shop: "other" }, "staging", ["non_prod_env_prod_db"]],
  ["staging + other DB + prod shop", { declared: "staging", db: "other", shop: "prod" }, "staging", ["non_prod_env_prod_shop"]],
  ["staging + prod/prod", { declared: "staging", db: "prod", shop: "prod" }, "staging", ["non_prod_env_prod_db", "non_prod_env_prod_shop"]],
  ["staging + other DB + empty shop -> ok", { declared: "staging", db: "other", shop: "empty" }, "staging", []],
  ["local + other/other -> ok", { declared: "local", db: "other", shop: "other" }, "local", []],
  ["local + prod/prod", { declared: "local", db: "prod", shop: "prod" }, "local", ["non_prod_env_prod_db", "non_prod_env_prod_shop"]],
  ["local + prod DB + empty shop", { declared: "local", db: "prod", shop: "empty" }, "local", ["non_prod_env_prod_db"]],
  ["garbage + prod/prod -> invalid, derived production", { declared: "prod", db: "prod", shop: "prod" }, "production", ["invalid_nestory_env"]],
  ["garbage + other/other -> invalid, derived local", { declared: "Staging!", db: "other", shop: "other" }, "local", ["invalid_nestory_env"]],
  ["garbage + prod DB + other shop -> invalid first, then prod DB", { declared: "yes", db: "prod", shop: "other" }, "local", ["invalid_nestory_env", "non_prod_env_prod_db"]]
];
for (const [label, input, effective, problems] of named) {
  await check(label, () => {
    const r = readNestoryEnvironment(makeEnv(input));
    assert.equal(r.effective, effective);
    assert.deepEqual(r.problems, problems);
  });
}

await check("declared is reported (valid -> value, unset/garbage -> null)", () => {
  assert.equal(readNestoryEnvironment(makeEnv({ declared: "staging", db: "other", shop: "other" })).declared, "staging");
  assert.equal(readNestoryEnvironment(makeEnv({ db: "other", shop: "other" })).declared, null);
  assert.equal(readNestoryEnvironment(makeEnv({ declared: "nope", db: "other", shop: "other" })).declared, null);
  assert.equal(readNestoryEnvironment(makeEnv({ declared: "", db: "other", shop: "other" })).declared, null);
});

await check("identity fields (ref / isProd / shopDomain)", () => {
  const r = readNestoryEnvironment(makeEnv({ declared: "production", db: "prod", shop: "prod" }));
  assert.equal(r.supabaseRef, PROD_SUPABASE_REF);
  assert.equal(r.supabaseIsProd, true);
  assert.equal(r.shopDomain, PROD_SHOP_DOMAIN);
  assert.equal(r.shopIsProd, true);
  const s = readNestoryEnvironment(makeEnv({ declared: "staging", db: "other", shop: "empty" }));
  assert.equal(s.supabaseRef, OTHER_REF);
  assert.equal(s.supabaseIsProd, false);
  assert.equal(s.shopDomain, null);
  assert.equal(s.shopIsProd, false);
});

await check("full matrix: invariant holds for every declared x DB x shop combination", () => {
  let count = 0;
  for (const declared of [undefined, "production", "staging", "local", "garbage"]) {
    for (const db of ["prod", "other"]) {
      for (const shop of ["prod", "other", "empty"]) {
        const r = readNestoryEnvironment(makeEnv({ declared, db, shop }));
        const dbProd = db === "prod";
        const shopProd = shop === "prod";
        const valid = declared === "production" || declared === "staging" || declared === "local";
        const effective = valid ? declared : dbProd && shopProd ? "production" : "local";
        const expected = [];
        if (declared !== undefined && !valid) expected.push("invalid_nestory_env");
        if (effective === "production") {
          if (!dbProd) expected.push("prod_env_non_prod_db");
          if (!shopProd) expected.push("prod_env_non_prod_shop");
        } else {
          if (dbProd) expected.push("non_prod_env_prod_db");
          if (shopProd) expected.push("non_prod_env_prod_shop");
        }
        assert.equal(r.effective, effective, `${declared}/${db}/${shop} effective`);
        assert.deepEqual(r.problems, expected, `${declared}/${db}/${shop} problems`);
        count += 1;
      }
    }
  }
  assert.equal(count, 30);
});

await check("process.env is the default source", () => {
  const saved = { ...process.env };
  try {
    delete process.env.NESTORY_ENV;
    process.env.NEXT_PUBLIC_SUPABASE_URL = DB.other;
    delete process.env.SHOPIFY_STORE_DOMAIN;
    const r = readNestoryEnvironment();
    assert.equal(r.effective, "local");
    assert.deepEqual(r.problems, []);
  } finally {
    for (const key of ["NESTORY_ENV", "NEXT_PUBLIC_SUPABASE_URL", "SHOPIFY_STORE_DOMAIN"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});

// ===========================================================================
console.log("2. supabaseRefFromUrl / normalizeShopDomain");
// ===========================================================================
await check("supabaseRefFromUrl", () => {
  assert.equal(supabaseRefFromUrl("https://abc123.supabase.co"), "abc123");
  assert.equal(supabaseRefFromUrl("https://abc123.supabase.co/"), "abc123");
  assert.equal(supabaseRefFromUrl("https://abc123.supabase.co/rest/v1/"), "abc123");
  assert.equal(supabaseRefFromUrl("https://ABC123.Supabase.CO"), "abc123");
  assert.equal(supabaseRefFromUrl("  https://abc123.supabase.co  "), "abc123");
  assert.equal(supabaseRefFromUrl("https://abc123.supabase.co?x=1"), "abc123");
  assert.equal(supabaseRefFromUrl(undefined), null);
  assert.equal(supabaseRefFromUrl(""), null);
  assert.equal(supabaseRefFromUrl("   "), null);
  assert.equal(supabaseRefFromUrl("https://example.com"), null);
  assert.equal(supabaseRefFromUrl("http://abc123.supabase.co"), null);
  assert.equal(supabaseRefFromUrl("https://abc123.supabase.co.evil.com"), null);
  assert.equal(supabaseRefFromUrl("https://evil.com/abc123.supabase.co"), null);
  assert.equal(supabaseRefFromUrl("https://a.b.supabase.co"), null);
  assert.equal(supabaseRefFromUrl("postgresql://postgres:pw@db.abc123.supabase.co:5432/postgres"), null);
});

await check("normalizeShopDomain", () => {
  assert.equal(normalizeShopDomain("foo.myshopify.com"), "foo.myshopify.com");
  assert.equal(normalizeShopDomain("FOO.MyShopify.com"), "foo.myshopify.com");
  assert.equal(normalizeShopDomain("https://foo.myshopify.com"), "foo.myshopify.com");
  assert.equal(normalizeShopDomain("HTTPS://Foo.myshopify.com/"), "foo.myshopify.com");
  assert.equal(normalizeShopDomain("http://foo.myshopify.com/admin/products"), "foo.myshopify.com");
  assert.equal(normalizeShopDomain("foo.myshopify.com/"), "foo.myshopify.com");
  assert.equal(normalizeShopDomain("  foo.myshopify.com  "), "foo.myshopify.com");
  assert.equal(normalizeShopDomain(undefined), null);
  assert.equal(normalizeShopDomain(""), null);
  assert.equal(normalizeShopDomain("   "), null);
  assert.equal(normalizeShopDomain("https://"), null);
  assert.equal(normalizeShopDomain("https:///"), null);
});

await check("a prod domain written with scheme / case / slash still counts as prod", () => {
  const r = readNestoryEnvironment({
    NEXT_PUBLIC_SUPABASE_URL: DB.prod + "/",
    SHOPIFY_STORE_DOMAIN: "HTTPS://" + PROD_SHOP_DOMAIN.toUpperCase() + "/"
  });
  assert.equal(r.shopIsProd, true);
  assert.equal(r.supabaseIsProd, true);
  assert.equal(r.effective, "production");
});

// ===========================================================================
console.log("3. environmentBannerModel");
// ===========================================================================
const bannerOf = (input) => environmentBannerModel(readNestoryEnvironment(makeEnv(input)));
await check("production without problems -> no banner", () => {
  assert.equal(bannerOf({ declared: "production", db: "prod", shop: "prod" }), null);
  assert.equal(bannerOf({ db: "prod", shop: "prod" }), null);
});
await check("staging -> staging tone, verbatim text", () => {
  assert.deepEqual(bannerOf({ declared: "staging", db: "other", shop: "other" }), {
    tone: "staging",
    text: "🧪 測試場：資料庫和 Shopify 都是測試用的，可以放心按。"
  });
});
await check("local -> staging tone, verbatim text", () => {
  assert.deepEqual(bannerOf({ declared: "local", db: "other", shop: "other" }), {
    tone: "staging",
    text: "💻 本機開發環境"
  });
  assert.deepEqual(bannerOf({ db: "other", shop: "other" }), { tone: "staging", text: "💻 本機開發環境" });
});
await check("each problem -> danger tone, verbatim text", () => {
  const wrap = (reasons) => `⛔ 環境設定錯誤：${reasons}。已停止寫入 Shopify，請找 Claude。`;
  assert.deepEqual(bannerOf({ declared: "bad", db: "other", shop: "other" }), {
    tone: "danger",
    text: wrap("NESTORY_ENV 的值不正確")
  });
  assert.deepEqual(bannerOf({ declared: "production", db: "other", shop: "prod" }), {
    tone: "danger",
    text: wrap("正式站連到的不是正式資料庫")
  });
  assert.deepEqual(bannerOf({ declared: "production", db: "prod", shop: "other" }), {
    tone: "danger",
    text: wrap("正式站連到的不是正式商店")
  });
  assert.deepEqual(bannerOf({ declared: "staging", db: "prod", shop: "other" }), {
    tone: "danger",
    text: wrap("測試／本機環境連到了正式資料庫")
  });
  assert.deepEqual(bannerOf({ declared: "local", db: "other", shop: "prod" }), {
    tone: "danger",
    text: wrap("測試／本機環境連到了正式商店")
  });
});
await check("several problems are joined with 、 in problem order", () => {
  assert.equal(
    bannerOf({ declared: "production", db: "other", shop: "other" }).text,
    "⛔ 環境設定錯誤：正式站連到的不是正式資料庫、正式站連到的不是正式商店。已停止寫入 Shopify，請找 Claude。"
  );
  assert.equal(
    bannerOf({ declared: "staging", db: "prod", shop: "prod" }).text,
    "⛔ 環境設定錯誤：測試／本機環境連到了正式資料庫、測試／本機環境連到了正式商店。已停止寫入 Shopify，請找 Claude。"
  );
  assert.equal(
    bannerOf({ declared: "oops", db: "prod", shop: "other" }).text,
    "⛔ 環境設定錯誤：NESTORY_ENV 的值不正確、測試／本機環境連到了正式資料庫。已停止寫入 Shopify，請找 Claude。"
  );
});

// ===========================================================================
console.log("4. adminToken fence (fetch must not be called when the environment is inconsistent)");
// ===========================================================================
const ENV_KEYS = [
  "NESTORY_ENV",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET"
];
let importCounter = 0;
async function withTokenModule(envValues, fn) {
  const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ access_token: "shpat_test_token", expires_in: 86399 }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  const setEnv = (values) => {
    for (const key of ENV_KEYS) {
      if (values[key] === undefined) delete process.env[key];
      else process.env[key] = values[key];
    }
  };
  try {
    setEnv(envValues);
    importCounter += 1;
    const mod = await import(`${tokenUrl}?case=${importCounter}`); // fresh module = empty token cache
    await fn({ mod, calls, setEnv });
  } finally {
    globalThis.fetch = savedFetch;
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  }
}
const credentials = { SHOPIFY_CLIENT_ID: "client-id-test", SHOPIFY_CLIENT_SECRET: "client-secret-test" };

await check("production declared but DB/shop are not production -> throws, fetch never called", async () => {
  await withTokenModule(
    {
      NESTORY_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: DB.other,
      SHOPIFY_STORE_DOMAIN: SHOP.other,
      ...credentials
    },
    async ({ mod, calls }) => {
      await assert.rejects(
        () => mod.getShopifyAdminToken(),
        (err) => {
          assert.ok(err instanceof ShopifyEnvironmentMismatchError, "must be ShopifyEnvironmentMismatchError");
          assert.deepEqual(err.problems, ["prod_env_non_prod_db", "prod_env_non_prod_shop"]);
          return true;
        }
      );
      assert.equal(calls.length, 0, "fetch must not be called");
    }
  );
});

await check("staging declared but pointed at the production DB/shop -> throws, fetch never called", async () => {
  await withTokenModule(
    {
      NESTORY_ENV: "staging",
      NEXT_PUBLIC_SUPABASE_URL: DB.prod,
      SHOPIFY_STORE_DOMAIN: PROD_SHOP_DOMAIN,
      ...credentials
    },
    async ({ mod, calls }) => {
      await assert.rejects(() => mod.getShopifyAdminToken(), ShopifyEnvironmentMismatchError);
      assert.equal(calls.length, 0);
    }
  );
});

await check("invalid NESTORY_ENV -> throws, fetch never called", async () => {
  await withTokenModule(
    { NESTORY_ENV: "prod", NEXT_PUBLIC_SUPABASE_URL: DB.prod, SHOPIFY_STORE_DOMAIN: PROD_SHOP_DOMAIN, ...credentials },
    async ({ mod, calls }) => {
      await assert.rejects(() => mod.getShopifyAdminToken(), ShopifyEnvironmentMismatchError);
      assert.equal(calls.length, 0);
    }
  );
});

await check("consistent staging environment -> token fetched from the dev store", async () => {
  await withTokenModule(
    { NESTORY_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: DB.other, SHOPIFY_STORE_DOMAIN: SHOP.other, ...credentials },
    async ({ mod, calls }) => {
      assert.equal(await mod.getShopifyAdminToken(), "shpat_test_token");
      assert.equal(calls.length, 1, "fetch must be called once");
      assert.equal(calls[0].url, `https://${SHOP.other}/admin/oauth/access_token`);
    }
  );
});

await check("consistent production environment -> token fetched", async () => {
  await withTokenModule(
    { NESTORY_ENV: "production", NEXT_PUBLIC_SUPABASE_URL: DB.prod, SHOPIFY_STORE_DOMAIN: PROD_SHOP_DOMAIN, ...credentials },
    async ({ mod, calls }) => {
      assert.equal(await mod.getShopifyAdminToken(), "shpat_test_token");
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, `https://${PROD_SHOP_DOMAIN}/admin/oauth/access_token`);
    }
  );
});

await check("NESTORY_ENV unset + prod DB + prod shop (today's production) behaves as before", async () => {
  await withTokenModule(
    { NEXT_PUBLIC_SUPABASE_URL: DB.prod, SHOPIFY_STORE_DOMAIN: PROD_SHOP_DOMAIN, ...credentials },
    async ({ mod, calls }) => {
      assert.equal(await mod.getShopifyAdminToken(), "shpat_test_token");
      assert.equal(calls.length, 1);
    }
  );
});

await check("the fence runs before the token cache (warm cache + new mismatch -> throws, no new fetch)", async () => {
  await withTokenModule(
    { NESTORY_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: DB.other, SHOPIFY_STORE_DOMAIN: SHOP.other, ...credentials },
    async ({ mod, calls, setEnv }) => {
      assert.equal(await mod.getShopifyAdminToken(), "shpat_test_token");
      assert.equal(calls.length, 1);
      assert.equal(await mod.getShopifyAdminToken(), "shpat_test_token", "second call served from cache");
      assert.equal(calls.length, 1);
      setEnv({ NESTORY_ENV: "staging", NEXT_PUBLIC_SUPABASE_URL: DB.prod, SHOPIFY_STORE_DOMAIN: SHOP.other, ...credentials });
      await assert.rejects(() => mod.getShopifyAdminToken(), ShopifyEnvironmentMismatchError);
      assert.equal(calls.length, 1, "no extra fetch");
    }
  );
});

await check("CI-style env (no shop domain) is not a mismatch; behaviour unchanged", async () => {
  await withTokenModule(
    { NEXT_PUBLIC_SUPABASE_URL: "https://ci-placeholder.supabase.co" },
    async ({ mod, calls }) => {
      await assert.rejects(
        () => mod.getShopifyAdminToken(),
        (err) => {
          assert.ok(!(err instanceof ShopifyEnvironmentMismatchError));
          assert.match(err.message, /not configured/);
          return true;
        }
      );
      assert.equal(calls.length, 0);
    }
  );
});

await check("assertShopifyEnvironment: throws with the problem list, silent when consistent", () => {
  assert.doesNotThrow(() => assertShopifyEnvironment(makeEnv({ declared: "staging", db: "other", shop: "other" })));
  assert.throws(
    () => assertShopifyEnvironment(makeEnv({ declared: "staging", db: "prod", shop: "other" })),
    (err) => err instanceof ShopifyEnvironmentMismatchError && err.problems[0] === "non_prod_env_prod_db"
  );
});

await check("adminToken.ts calls the fence first, before cache read and before fetch", () => {
  const start = tokenSource.indexOf("export async function getShopifyAdminToken");
  assert.ok(start > 0);
  const body = tokenSource.slice(start);
  const assertAt = body.indexOf("assertShopifyEnvironment()");
  assert.ok(assertAt > 0, "assertShopifyEnvironment() missing");
  assert.ok(assertAt < body.indexOf("cached &&"), "fence must come before the cache read");
  assert.ok(assertAt < body.indexOf("exchangeToken()"), "fence must come before the token exchange");
  assert.ok(
    body.slice(0, assertAt).replace(/\/\/.*$/gm, "").replace(/\s+/g, " ").endsWith("Promise<string> { "),
    "assertShopifyEnvironment() must be the first statement"
  );
  assert.equal((tokenSource.match(/oauth\/access_token/g) ?? []).length, 1, "single token endpoint");
});

// ===========================================================================
console.log("5. scripts/staging/fence.mjs");
// ===========================================================================
const POOLER = (ref, pw = "pw-secret-1") =>
  `postgresql://postgres.${ref}:${pw}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const DIRECT = (ref, pw = "pw-secret-1") => `postgresql://postgres:${pw}@db.${ref}.supabase.co:5432/postgres`;

await check("refFromDbUrl parses Session pooler and direct URLs", () => {
  assert.equal(fence.refFromDbUrl(POOLER(OTHER_REF)), OTHER_REF);
  assert.equal(fence.refFromDbUrl(DIRECT(OTHER_REF)), OTHER_REF);
  assert.equal(fence.refFromDbUrl(POOLER(OTHER_REF).replace(":5432", ":6543")), OTHER_REF);
  assert.equal(fence.refFromDbUrl(POOLER(OTHER_REF).replace("postgresql://", "postgres://")), OTHER_REF);
  assert.equal(fence.refFromDbUrl(POOLER(OTHER_REF) + "?sslmode=require"), OTHER_REF);
  assert.equal(fence.refFromDbUrl(POOLER(OTHER_REF, "p%40ss%2Fw")), OTHER_REF);
  assert.equal(fence.refFromDbUrl(POOLER(OTHER_REF, "p@ss/w:rd")), OTHER_REF, "raw special chars in the password");
  assert.equal(fence.refFromDbUrl(DIRECT(OTHER_REF, "p@ss/w:rd")), OTHER_REF);
});

await check("refFromDbUrl returns null for anything it cannot prove", () => {
  assert.equal(fence.refFromDbUrl(undefined), null);
  assert.equal(fence.refFromDbUrl(""), null);
  assert.equal(fence.refFromDbUrl("not a url"), null);
  assert.equal(fence.refFromDbUrl("https://abc.supabase.co"), null);
  assert.equal(fence.refFromDbUrl("postgresql://postgres:pw@localhost:5432/postgres"), null);
  assert.equal(fence.refFromDbUrl("postgresql://postgres.abc:pw@evil.example.com:5432/postgres"), null);
  assert.equal(fence.refFromDbUrl("postgresql://postgres:pw@aws-0-x.pooler.supabase.com:5432/postgres"), null, "pooler without postgres.<ref>");
  assert.equal(fence.refFromDbUrl("postgresql://postgres.aaa:pw@db.bbb.supabase.co:5432/postgres"), null, "user ref disagrees with host ref");
});

const good = (ref = OTHER_REF) => ({
  dbUrl: POOLER(ref),
  supabaseUrl: `https://${ref}.supabase.co`,
  stagingRef: ref
});
await check("assertStagingTarget accepts a consistent staging target", () => {
  assert.deepEqual(fence.assertStagingTarget(good()), { ref: OTHER_REF });
  assert.deepEqual(fence.assertStagingTarget({ ...good(), dbUrl: DIRECT(OTHER_REF) }), { ref: OTHER_REF });
});
await check("assertStagingTarget throws for the production ref in any position", () => {
  assert.throws(() => fence.assertStagingTarget(good(PROD_SUPABASE_REF)), /正式資料庫/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), dbUrl: POOLER(PROD_SUPABASE_REF) }), /正式資料庫|不一致/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), dbUrl: DIRECT(PROD_SUPABASE_REF) }), /正式資料庫|不一致/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), supabaseUrl: DB.prod }), /正式資料庫|不一致/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), stagingRef: PROD_SUPABASE_REF }), /正式資料庫|不一致/);
  assert.throws(() => fence.assertStagingTarget({ ...good(PROD_SUPABASE_REF), dbUrl: DIRECT(PROD_SUPABASE_REF) }), /正式資料庫/);
});
await check("assertStagingTarget throws when the three refs disagree", () => {
  assert.throws(() => fence.assertStagingTarget({ ...good(), dbUrl: POOLER("zzzzzzzzzzzzzzzzzzzz") }), /不一致/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), supabaseUrl: "https://zzzzzzzzzzzzzzzzzzzz.supabase.co" }), /不一致/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), stagingRef: "zzzzzzzzzzzzzzzzzzzz" }), /不一致/);
});
await check("assertStagingTarget throws when a ref cannot be resolved", () => {
  assert.throws(() => fence.assertStagingTarget({ ...good(), dbUrl: "postgresql://postgres:pw@localhost/postgres" }), /解析不出/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), dbUrl: undefined }), /解析不出/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), supabaseUrl: "http://localhost:54321" }), /解析不出/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), supabaseUrl: undefined }), /解析不出/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), stagingRef: "" }), /STAGING_SUPABASE_REF/);
  assert.throws(() => fence.assertStagingTarget({ ...good(), stagingRef: undefined }), /STAGING_SUPABASE_REF/);
});
await check("fence error messages never contain the database password", () => {
  for (const input of [
    { ...good(), dbUrl: POOLER("zzzzzzzzzzzzzzzzzzzz", "pw-secret-LEAK") },
    { ...good(PROD_SUPABASE_REF), dbUrl: POOLER(PROD_SUPABASE_REF, "pw-secret-LEAK") },
    { ...good(), dbUrl: "postgresql://postgres:pw-secret-LEAK@localhost/postgres" }
  ]) {
    try {
      fence.assertStagingTarget(input);
      assert.fail("should have thrown");
    } catch (err) {
      assert.ok(!String(err.message).includes("pw-secret-LEAK"), "message leaked the password");
    }
  }
});

// ===========================================================================
console.log("6. seed-from-prod: read-only Proxy + transforms");
// ===========================================================================
// Class instances, like the real supabase-js objects (the proxy only wraps client / builder objects).
function fakeProdClient() {
  const calls = [];
  class FakeFilter {
    constructor(table, cols) {
      this.table = table;
      this.cols = cols;
    }
    eq() {
      return { data: [{ id: 1, table: this.table, cols: this.cols }], error: null };
    }
  }
  class FakeBuilder {
    constructor(table) {
      this.table = table;
    }
    select(cols) {
      calls.push(`select ${this.table}`);
      return new FakeFilter(this.table, cols);
    }
    insert() {
      calls.push("INSERT");
    }
    update() {
      calls.push("UPDATE");
    }
    upsert() {
      calls.push("UPSERT");
    }
    delete() {
      calls.push("DELETE");
    }
  }
  class FakeBucket {
    async download() {
      return { data: "blob", error: null };
    }
    upload() {
      calls.push("UPLOAD");
    }
    remove() {
      calls.push("REMOVE");
    }
    move() {
      calls.push("MOVE");
    }
    copy() {
      calls.push("COPY");
    }
  }
  class FakeStorage {
    from() {
      return new FakeBucket();
    }
  }
  class FakeAuth {
    get admin() {
      calls.push("AUTH_ADMIN");
      return {};
    }
  }
  class FakeClient {
    constructor() {
      this.storage = new FakeStorage();
      this.auth = new FakeAuth();
    }
    from(table) {
      return new FakeBuilder(table);
    }
    rpc() {
      calls.push("RPC");
    }
  }
  return { calls, client: new FakeClient() };
}

await check("read-only Proxy: insert / update / upsert / delete / rpc throw on call", () => {
  const { client, calls } = fakeProdClient();
  const source = seed.makeReadOnlySource(client);
  for (const method of ["insert", "update", "upsert", "delete"]) {
    assert.throws(() => source.from("product_drafts")[method]({ id: 1 }), /唯讀保護/, method);
  }
  assert.throws(() => source.rpc("anything", {}), /唯讀保護/);
  assert.deepEqual(calls, [], "nothing reached the real client");
});

await check("read-only Proxy: storage upload / remove / move / copy throw on call", () => {
  const { client, calls } = fakeProdClient();
  const source = seed.makeReadOnlySource(client);
  const bucket = source.storage.from("product-images");
  assert.throws(() => bucket.upload("a.png", new Uint8Array(1)), /唯讀保護/);
  assert.throws(() => bucket.remove(["a.png"]), /唯讀保護/);
  assert.throws(() => bucket.move("a.png", "b.png"), /唯讀保護/);
  assert.throws(() => bucket.copy("a.png", "b.png"), /唯讀保護/);
  assert.deepEqual(calls, []);
});

await check("read-only Proxy: auth is unreachable, reads still work", async () => {
  const { client, calls } = fakeProdClient();
  const source = seed.makeReadOnlySource(client);
  assert.throws(() => source.auth.admin, /唯讀保護/);
  const { data } = source.from("product_drafts").select("*").eq();
  assert.deepEqual(data, [{ id: 1, table: "product_drafts", cols: "*" }]);
  const downloaded = await source.storage.from("product-images").download("a.png");
  assert.equal(downloaded.data, "blob");
  assert.deepEqual(calls, ["select product_drafts"]);
});

await check("read-only Proxy works on a real supabase-js client (no network used)", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const real = createClient("https://readonlytest.supabase.co", "anon-key-for-test", {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const source = seed.makeReadOnlySource(real);
  assert.throws(() => source.from("product_drafts").insert({ id: 1 }), /唯讀保護/);
  assert.throws(() => source.from("product_drafts").update({ id: 1 }), /唯讀保護/);
  assert.throws(() => source.from("product_drafts").upsert({ id: 1 }), /唯讀保護/);
  assert.throws(() => source.from("product_drafts").delete(), /唯讀保護/);
  assert.throws(() => source.rpc("x"), /唯讀保護/);
  assert.throws(() => source.storage.from("product-images").upload("a", new Uint8Array(1)), /唯讀保護/);
  assert.throws(() => source.storage.from("product-images").remove(["a"]), /唯讀保護/);
  assert.throws(() => source.storage.from("product-images").move("a", "b"), /唯讀保護/);
  assert.throws(() => source.storage.from("product-images").copy("a", "b"), /唯讀保護/);
  // Building (not awaiting) a select must work and must not throw.
  assert.doesNotThrow(() => source.from("product_drafts").select("*").eq("id", "x"));
});

await check("read-only Proxy: an awaited select through the real library still returns rows (fake fetch)", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const requests = [];
  const fakeFetch = async (url, init) => {
    requests.push({ url: String(url), method: init?.method ?? "GET" });
    return new Response(JSON.stringify([{ id: "a", update: "column-named-update", copy: 1 }]), {
      status: 200,
      headers: { "Content-Type": "application/json", "Content-Range": "0-0/*" }
    });
  };
  const real = createClient("https://readonlytest.supabase.co", "anon-key-for-test", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch }
  });
  const source = seed.makeReadOnlySource(real);
  const { data, error } = await source.from("product_drafts").select("*").in("id", ["a"]).order("id").range(0, 9);
  assert.equal(error, null);
  assert.equal(data.length, 1);
  assert.equal(data[0].update, "column-named-update", "row data must not be intercepted");
  assert.equal(data[0].copy, 1);
  assert.deepEqual(requests.map((r) => r.method), ["GET"]);
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const prodDraft = (over = {}) => ({
  id: "22222222-2222-4222-8222-222222222222",
  status: "active_published",
  pipeline_stage: "published",
  publish_status: "active_published",
  created_by: "99999999-9999-4999-8999-999999999999",
  reviewed_by: "99999999-9999-4999-8999-999999999999",
  shopify_product_id: "gid://shopify/Product/123",
  shopify_admin_url: "https://admin.shopify.com/store/x/products/123",
  shopify_handle: "some-handle",
  shopify_tags: ["a", "b"],
  shopify_collections: ["c"],
  shopify_payload_preview: { product: { title: "x" } },
  shopify_sync_status: "synced",
  shopify_synced_at: "2026-10-01T00:00:00Z",
  shopify_remote_updated_at: "2026-10-01T00:00:00Z",
  shopify_sync_hash: "abc",
  shopify_sync_error: "boom",
  shopify_sync_baseline: { version: 1 },
  current_image_batch_id: "33333333-3333-4333-8333-333333333333",
  current_publish_batch_id: "44444444-4444-4444-8444-444444444444",
  published_at: "2026-10-01T00:00:00Z",
  archived_at: null,
  status_before_archive: null,
  error_message: "old error",
  title_zh: "標題",
  tags: ["keep"],
  ...over
});

await check("transformDraft: published draft goes back to the pre-publish state", () => {
  const out = seed.transformDraft(prodDraft(), { owner: OWNER });
  assert.equal(out.status, "approved");
  assert.equal(out.pipeline_stage, "image_review");
  assert.equal(out.publish_status, "pending");
  assert.equal(out.published_at, null);
  assert.equal(out.error_message, null);
  assert.equal(out.created_by, OWNER);
  assert.equal(out.reviewed_by, OWNER);
  assert.equal(out.current_image_batch_id, null);
  assert.equal(out.current_publish_batch_id, null);
  assert.equal(out.title_zh, "標題");
  assert.deepEqual(out.tags, ["keep"]);
});

await check("transformDraft: every shopify_* column is null (NOT NULL ones fall back to their default)", () => {
  const out = seed.transformDraft(prodDraft(), { owner: OWNER });
  const nullable = [
    "shopify_product_id",
    "shopify_admin_url",
    "shopify_handle",
    "shopify_synced_at",
    "shopify_remote_updated_at",
    "shopify_sync_hash",
    "shopify_sync_error",
    "shopify_sync_baseline"
  ];
  for (const key of nullable) assert.equal(out[key], null, key);
  assert.deepEqual(out.shopify_tags, []);
  assert.deepEqual(out.shopify_collections, []);
  assert.deepEqual(out.shopify_payload_preview, {});
  assert.equal(out.shopify_sync_status, "never");
  for (const key of Object.keys(out).filter((k) => k.startsWith("shopify_"))) {
    assert.ok(out[key] === null || nullable.indexOf(key) === -1, `${key} handled`);
  }
});

await check("transformDraft: archived and csv_ready drafts are reset too; unpublished drafts keep their state", () => {
  assert.equal(seed.transformDraft(prodDraft({ status: "archived", pipeline_stage: "archived", shopify_product_id: null, archived_at: "2026-10-02T00:00:00Z", status_before_archive: "draft_created" }), { owner: OWNER }).status, "approved");
  const archived = seed.transformDraft(prodDraft({ status: "archived", pipeline_stage: "archived", shopify_product_id: null, archived_at: "2026-10-02T00:00:00Z", status_before_archive: "draft_created" }), { owner: OWNER });
  assert.equal(archived.archived_at, null);
  assert.equal(archived.status_before_archive, null);
  assert.equal(seed.transformDraft(prodDraft({ status: "csv_ready", pipeline_stage: "published", shopify_product_id: null }), { owner: OWNER }).status, "approved");
  assert.equal(seed.transformDraft(prodDraft({ status: "approved", pipeline_stage: "published" }), { owner: OWNER }).pipeline_stage, "image_review");
  const unpublished = seed.transformDraft(
    prodDraft({ status: "ready_for_review", pipeline_stage: "copy_review", shopify_product_id: null, publish_status: "pending", published_at: null, error_message: null, reviewed_by: null }),
    { owner: OWNER }
  );
  assert.equal(unpublished.status, "ready_for_review");
  assert.equal(unpublished.pipeline_stage, "copy_review");
  assert.equal(unpublished.reviewed_by, null);
  assert.equal(unpublished.created_by, OWNER);
});

await check("pre-publish state matches the app's own status constants", () => {
  assert.equal(mapStatusToPipelineStage(seed.PRE_PUBLISH_STATUS), seed.PRE_PUBLISH_PIPELINE_STAGE);
  assert.equal(mapStatusToPipelineStage(seed.PRE_PUBLISH_STATUS, { shopifyProductId: null }), "image_review");
  assert.match(read("src/types/domain.ts"), new RegExp(`\\| "${seed.PRE_PUBLISH_STATUS}"`));
  for (const status of ["publishing", "active_published", "draft_created", "api_failed", "csv_ready", "archived"]) {
    assert.ok(seed.needsPrePublishReset({ status }), `${status} must be reset`);
  }
  for (const status of ["pending_input", "pending_copy", "ready_for_review", "needs_revision", "approved", "failed"]) {
    assert.ok(!seed.needsPrePublishReset({ status, pipeline_stage: "copy_review", shopify_product_id: null }), `${status} kept`);
  }
});

await check("every NOT NULL shopify_* column in the SQL history has a non-null reset default", () => {
  const sqlFiles = [
    ...fs.readdirSync(path.join(root, "supabase/history/pre_tracking_migrations")).map((f) => `supabase/history/pre_tracking_migrations/${f}`),
    ...fs.readdirSync(path.join(root, "supabase/migrations")).map((f) => `supabase/migrations/${f}`)
  ].filter((f) => f.endsWith(".sql"));
  const notNull = new Set();
  const seen = new Set();
  for (const file of sqlFiles) {
    for (const line of read(file).split(/\r?\n/)) {
      const m = /^\s*(?:add column if not exists\s+)?(shopify_[a-z_]+)\s+(?:text|jsonb|integer|uuid|timestamptz|boolean)(.*)$/i.exec(line);
      if (!m) continue;
      seen.add(m[1]);
      if (/not null/i.test(m[2])) notNull.add(m[1]);
    }
  }
  assert.ok(seen.size >= 15, `expected to see the shopify_* columns, saw ${seen.size}`);
  assert.ok(notNull.size >= 4, "expected the NOT NULL shopify_* columns");
  for (const column of notNull) {
    const out = seed.resetShopifyColumns({ [column]: "x" });
    assert.notEqual(out[column], null, `${column} is NOT NULL but would be reset to null`);
  }
  for (const column of seen) {
    if (notNull.has(column)) continue;
    assert.equal(seed.resetShopifyColumns({ [column]: "x" })[column], null, `${column} should reset to null`);
  }
});

await check("transformVariant / transformImage: shopify_* ids cleared, other fields kept", () => {
  const variant = seed.transformVariant({ id: "v1", draft_id: "d1", sku: "S1", shopify_variant_id: "gid://v", shopify_inventory_item_id: "gid://i" });
  assert.deepEqual(variant, { id: "v1", draft_id: "d1", sku: "S1", shopify_variant_id: null, shopify_inventory_item_id: null });
  const image = seed.transformImage({ id: "i1", processed_file_url: "u", shopify_media_id: "m", shopify_file_id: "f", shopify_source_hash: "h" });
  assert.deepEqual(image, { id: "i1", processed_file_url: "u", shopify_media_id: null, shopify_file_id: null, shopify_source_hash: null });
});

await check("transformCatalogRow drops the production id and foreign profile ids", () => {
  assert.deepEqual(seed.transformCatalogRow({ id: "x", ip_name: "A", sort_order: 1 }), { ip_name: "A", sort_order: 1 });
  assert.deepEqual(seed.transformCatalogRow({ id: "x", ip_name: "A", character_name: "B", created_by: OWNER }), { ip_name: "A", character_name: "B", created_by: null });
});

await check("production Supabase host is swapped and storage paths are collected", () => {
  const prodHost = `${PROD_SUPABASE_REF}.supabase.co`;
  const url = `https://${prodHost}/storage/v1/object/public/product-images/draft-1/main%201.webp`;
  const row = { processed_file_url: url, description_html: `<img src="${url}"> and https://cdn.shopify.com/x.jpg`, other: "https://img.alicdn.com/a.jpg" };
  assert.deepEqual(seed.collectProductImagePaths([row], { prodRef: PROD_SUPABASE_REF }), ["draft-1/main 1.webp"]);
  const swapped = seed.swapSupabaseHost(row, { prodRef: PROD_SUPABASE_REF, stagingHost: `${OTHER_REF}.supabase.co` });
  assert.ok(!JSON.stringify(swapped).includes(PROD_SUPABASE_REF), "no production host left");
  assert.ok(swapped.processed_file_url.startsWith(`https://${OTHER_REF}.supabase.co/storage/`));
  assert.equal(swapped.other, "https://img.alicdn.com/a.jpg");
});

await check("seed CLI argument validation", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(seed.parseArgs(["--drafts", `${id},${id}`, "--owner", OWNER, "--yes-staging", OTHER_REF]), {
    drafts: [id, id],
    owner: OWNER,
    yesStaging: OTHER_REF
  });
  assert.throws(() => seed.parseArgs(["--owner", OWNER, "--yes-staging", OTHER_REF]), /--drafts/);
  assert.throws(() => seed.parseArgs(["--drafts", "d39a4057", "--owner", OWNER, "--yes-staging", OTHER_REF]), /UUID/);
  assert.throws(() => seed.parseArgs(["--drafts", id, "--yes-staging", OTHER_REF]), /--owner/);
  assert.throws(() => seed.parseArgs(["--drafts", id, "--owner", OWNER]), /--yes-staging/);
  assert.throws(() => seed.parseArgs(["--drafts", id, "--owner", OWNER, "--yes-staging", OTHER_REF, "--force", "1"]), /不認得/);
});

await check("seed-from-prod.mjs source guards: prod source is read-only, target is fenced", () => {
  const source = read("scripts/staging/seed-from-prod.mjs");
  assert.match(source, /makeReadOnlySource\(\s*createClient\(prodEnv\./, "source client must be wrapped");
  assert.match(source, /assertStagingTarget\(/);
  assert.match(source, /refFromSupabaseUrl\(prodEnv\.NEXT_PUBLIC_SUPABASE_URL\) !== PROD_SUPABASE_REF/);
  assert.ok(!/source\.from\([^)]*\)\.(insert|update|upsert|delete)/.test(source), "never write through the source client");
  // Tables that must not be copied.
  for (const table of ["profiles", "generation_", "publish_", "shopify_sync_jobs", "review_logs", "automation_logs", "image_batch", "team_settings"]) {
    assert.ok(!new RegExp(`(?:fetchAll|upsertChunks)\\([^)]*"${table}`).test(source), `${table} must not be copied`);
  }
});

// ===========================================================================
console.log("7. static guards (banner, CSS, /api/status, env template, wiring)");
// ===========================================================================
await check("layout.tsx: <EnvironmentBanner /> is the sibling right before <header className=\"topbar\">", () => {
  const layout = read("src/app/layout.tsx");
  const bannerAt = layout.indexOf("<EnvironmentBanner />");
  const headerAt = layout.indexOf('<header className="topbar">');
  assert.ok(bannerAt > 0, "<EnvironmentBanner /> missing");
  assert.ok(headerAt > 0, "topbar header missing");
  assert.ok(bannerAt < headerAt, "banner must come before the header");
  assert.match(layout.slice(bannerAt, headerAt), /^<EnvironmentBanner \/>\s*$/, "nothing between banner and header");
  assert.match(layout.slice(0, bannerAt), /<div className="app-root">\s*$/, "banner is the first child of .app-root");
  assert.equal((layout.match(/<EnvironmentBanner/g) ?? []).length, 1);
  assert.match(layout, /import \{ EnvironmentBanner \} from "@\/components\/EnvironmentBanner";/);
});

await check("EnvironmentBanner.tsx matches the spec", () => {
  const src = read("src/components/EnvironmentBanner.tsx");
  assert.ok(!/"use client"/.test(src), "must be a server component");
  assert.match(src, /environmentBannerModel\(readNestoryEnvironment\(\)\)/);
  assert.match(src, /if \(!m\) return null;/);
  assert.match(src, /className=\{`env-banner env-banner--\$\{m\.tone\}`\}/);
  assert.match(src, /role=\{m\.tone === "danger" \? "alert" : "status"\}/);
  assert.match(src, /\{m\.text\}/);
});

await check("globals.css banner block: only existing tokens, no !important, no hex colors", () => {
  const css = read("src/app/globals.css");
  const start = css.indexOf("/* STAGING 1.6（10-21）：環境橫幅");
  assert.ok(start > 0, "banner CSS block missing");
  assert.equal(css.split("/* STAGING 1.6（10-21）：環境橫幅").length, 2, "block appears once");
  const rest = css.slice(start);
  const endMatch = /\.env-banner--danger\s*\{[^}]*\}/.exec(rest);
  assert.ok(endMatch, ".env-banner--danger rule missing");
  const block = rest.slice(0, endMatch.index + endMatch[0].length);
  assert.ok(!/!important/i.test(block), "no !important");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(block), "no hex color codes");
  const tokens = new Set([...block.matchAll(/var\(--([a-z0-9-]+)\)/g)].map((m) => m[1]));
  assert.deepEqual([...tokens].sort(), ["danger", "surface2", "text", "warn"]);
  for (const token of tokens) {
    assert.ok(new RegExp(`--${token}:`).test(css.slice(0, start)), `--${token} must already exist`);
  }
  for (const selector of [".env-banner {", ".env-banner--staging {", ".env-banner--danger {"]) {
    assert.ok(block.includes(selector), `${selector} missing`);
  }
});

await check("/api/status exposes environment fields without shop domain or keys", () => {
  const route = read("src/app/api/status/route.ts");
  assert.match(route, /readNestoryEnvironment\(\)/);
  const block = /environment:\s*\{([^}]*)\}/.exec(route);
  assert.ok(block, "environment block missing");
  const keys = [...block[1].matchAll(/^\s*([a-zA-Z]+):/gm)].map((m) => m[1]);
  assert.deepEqual(keys, ["effective", "declared", "supabaseRef", "supabaseIsProd", "shopIsProd", "problems"]);
  assert.ok(!/shopDomain|SERVICE_ROLE|CLIENT_SECRET/.test(block[1]), "no shop domain / secrets in environment");
  for (const field of ["supabase:", "aiProvider:", "shopify:", "shopifyMock:", "shopifyStoreDomain"]) {
    assert.ok(route.includes(field), `existing field ${field} must stay`);
  }
});

await check("nestoryEnv.ts is pure: no supabase / next / react imports", () => {
  const src = read("src/lib/env/nestoryEnv.ts");
  assert.ok(!/^\s*import\s/m.test(src), "no imports at all");
});

await check("env-template.txt: names only, required variables present, no notification variables", () => {
  assert.ok(fs.existsSync(path.join(root, "scripts/staging/env-template.txt")));
  assert.ok(!path.basename("scripts/staging/env-template.txt").startsWith(".env"));
  const parsed = envFile.parseEnvFile(read("scripts/staging/env-template.txt"));
  const required = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STAGING_SUPABASE_REF",
    "STAGING_DB_URL",
    "NESTORY_ENV",
    "SHOPIFY_STORE_DOMAIN",
    "SHOPIFY_CLIENT_ID",
    "SHOPIFY_CLIENT_SECRET",
    "SHOPIFY_PUBLISH_MOCK",
    "SHOPIFY_ACTIVE_PUBLISH_ENABLED",
    "OPENAI_API_KEY",
    "TAVILY_API_KEY",
    "STAGING_CAPTURE_TOKEN",
    "WORKER_API_TOKEN",
    "CRON_SECRET"
  ];
  assert.deepEqual(Object.keys(parsed).sort(), [...required].sort());
  const fixed = { NESTORY_ENV: "local", SHOPIFY_PUBLISH_MOCK: "false", SHOPIFY_ACTIVE_PUBLISH_ENABLED: "true" };
  for (const [name, value] of Object.entries(parsed)) {
    assert.equal(value, fixed[name] ?? "", `${name} must be empty unless it is one of the fixed switches`);
  }
  assert.ok(!/MAKE_WEBHOOK|RESEND|NOTIFY_EMAIL|LINE_/.test(read("scripts/staging/env-template.txt").replace(/^#.*$/gm, "")));
  // Every variable line has a Chinese comment right above it.
  const lines = read("scripts/staging/env-template.txt").split(/\r?\n/);
  lines.forEach((line, i) => {
    if (/^[A-Z_]+=/.test(line)) assert.match(lines[i - 1] ?? "", /^#.*[一-鿿]/, `${line.split("=")[0]} needs a Chinese comment`);
  });
});

await check("env-file parser", () => {
  assert.deepEqual(
    envFile.parseEnvFile('# c\nA=1\nB="two words"\nexport C=3 # note\r\nD=\n  E = \'x\' \nbad line\n'),
    { A: "1", B: "two words", C: "3", D: "", E: "x" }
  );
  assert.throws(() => envFile.requireVars({ A: "1", B: " " }, ["A", "B", "C"], ".env.local"), /B、C/);
});

await check("wiring: verify:all, package.json script, pg devDependency, lockfile", () => {
  assert.match(read("scripts/verify-all.mjs"), /"scripts\/verify-staging-fence\.mjs"/);
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:staging-fence"], "node scripts/verify-staging-fence.mjs");
  assert.ok(pkg.devDependencies?.pg, "pg must be a devDependency");
  assert.ok(!pkg.dependencies?.pg, "pg must not ship as a runtime dependency");
  assert.match(read("pnpm-lock.yaml"), /\n {6}pg:\n {8}specifier: /, "lockfile must list pg for the root importer");
  const fixtureDir = path.join(root, "scripts/staging");
  for (const file of ["fence.mjs", "build-bootstrap.mjs", "apply-sql.mjs", "seed-from-prod.mjs", "post-capture-fixture.mjs", "env-template.txt", "fixtures/sample-capture.json"]) {
    assert.ok(fs.existsSync(path.join(fixtureDir, file)), `scripts/staging/${file} missing`);
  }
});

await check("scripts that write to a database import the fence", () => {
  assert.match(read("scripts/staging/apply-sql.mjs"), /assertStagingTarget\(/);
  assert.match(read("scripts/staging/seed-from-prod.mjs"), /assertStagingTarget\(/);
  assert.match(read("scripts/staging/apply-sql.mjs"), /from "\.\/fence\.mjs"/);
  assert.match(read("scripts/staging/seed-from-prod.mjs"), /from "\.\/fence\.mjs"/);
  const applySource = read("scripts/staging/apply-sql.mjs");
  assert.ok(applySource.indexOf("resolveStagingTarget(env") < applySource.indexOf("new pg.Client"), "fence must run before connecting");
});

// ===========================================================================
console.log("Extra: build-bootstrap / apply-sql / post-capture-fixture");
// ===========================================================================
await check("build-bootstrap: order = history -> baseline before 033 -> reconcile -> migrations", () => {
  const { sql, order, excluded, warnings } = bootstrap.buildBootstrap({ repoRoot: root });
  const history = fs.readdirSync(path.join(root, "supabase/history/pre_tracking_migrations")).filter((f) => f.endsWith(".sql")).sort();
  const migrations = fs
    .readdirSync(path.join(root, "supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .filter((f) => !f.startsWith("20260818142712_") && !f.startsWith("20260818142919_"));
  const expected = [];
  for (const f of history) {
    if (f.startsWith("033_")) expected.push("local-production-baseline.sql");
    expected.push(f);
  }
  expected.push("2026-08-18_production_reconcile_draft.sql", ...migrations);
  assert.deepEqual(order, expected);
  assert.equal(history.length, 39);
  assert.deepEqual(excluded, []);
  assert.equal(warnings.length, 1, "warns when no --prod-ledger is given");
  // Every segment is announced by its marker, in order.
  let cursor = -1;
  for (const name of order) {
    const at = sql.indexOf(`-- ==== ${name} ====\n`, cursor + 1);
    assert.ok(at > cursor, `${name} marker out of order`);
    cursor = at;
  }
  for (const skipped of ["20260818142712_baseline_existing_schema_20260818.sql", "20260818142919_production_reconcile_20260818.sql"]) {
    assert.ok(!sql.includes(`-- ==== ${skipped} ====`), `${skipped} must be skipped`);
  }
  // 032 is wrapped in begin/commit; nothing else gets wrapped by us.
  const at032 = sql.indexOf("-- ==== 032_ip_catalog_v3_100_ips.sql ====\nbegin;\n");
  assert.ok(at032 >= 0, "032 must start with begin;");
  const at033Baseline = sql.indexOf("-- ==== local-production-baseline.sql ====");
  assert.match(sql.slice(at032, at033Baseline), /commit;\n\s*$/, "032 must end with commit;");
  assert.ok(!/precheck|rollback\.sql|postcheck/.test(order.join(",")), "no precheck / rollback / postcheck");
  assert.ok(!sql.includes("\r"), "line endings normalised");
});

await check("build-bootstrap --prod-ledger keeps only recorded versions and lists the rest", () => {
  const ledger = "version\n----------------\n 20260818142712\n 20260818142919\n 20260822223100\n 20260903100000\n(4 rows)\n";
  const { order, excluded, warnings } = bootstrap.buildBootstrap({ repoRoot: root, prodLedgerText: ledger });
  const migrationPart = order.slice(order.indexOf("2026-08-18_production_reconcile_draft.sql") + 1);
  assert.deepEqual(migrationPart, ["20260822223100_variant_split_override_semantics.sql", "20260903100000_shopify_full_sync_state.sql"]);
  assert.ok(excluded.includes("20261020100000_shopify_sync_baseline.sql"));
  assert.ok(excluded.includes("20260902090000_guard_current_image_batch_pointer.sql"));
  assert.ok(!excluded.some((f) => f.startsWith("20260818")), "the two skipped baseline files are not reported as excluded");
  assert.deepEqual(warnings, []);
  assert.throws(() => bootstrap.buildBootstrap({ repoRoot: root, prodLedgerText: "nothing here" }), /找不到任何/);
  assert.deepEqual([...bootstrap.parseLedgerVersions('[{"version":"20260822223100"},{"version":"20260903100000"}]')], ["20260822223100", "20260903100000"]);
});

await check("apply-sql: --query only accepts one read-only statement", () => {
  assert.equal(applySql.validateReadQuery("select 1"), "select 1");
  assert.equal(applySql.validateReadQuery("  SELECT table_name from information_schema.columns order by 1;  "), "SELECT table_name from information_schema.columns order by 1");
  assert.equal(applySql.validateReadQuery("with x as (select 1) select * from x"), "with x as (select 1) select * from x");
  for (const bad of ["delete from product_drafts", "insert into x values (1)", "update x set a=1", "drop table x", "select 1; drop table x", "select 1; select 2", "  ", "", undefined, "-- c\nselect 1", "create table x()"]) {
    assert.throws(() => applySql.validateReadQuery(bad), undefined, `should reject: ${bad}`);
  }
});

await check("apply-sql: exactly one of --file/--query and --yes-staging are required", () => {
  assert.deepEqual(applySql.parseArgs(["--file", "a.sql", "--yes-staging", OTHER_REF]), { file: "a.sql", query: null, yesStaging: OTHER_REF });
  assert.deepEqual(applySql.parseArgs(["--query", "select 1", "--yes-staging", OTHER_REF]), { file: null, query: "select 1", yesStaging: OTHER_REF });
  assert.throws(() => applySql.parseArgs(["--yes-staging", OTHER_REF]), /擇一/);
  assert.throws(() => applySql.parseArgs(["--file", "a.sql", "--query", "select 1", "--yes-staging", OTHER_REF]), /擇一/);
  assert.throws(() => applySql.parseArgs(["--file", "a.sql"]), /--yes-staging/);
  assert.throws(() => applySql.parseArgs(["--file", "a.sql", "--yes-staging", OTHER_REF, "--wat", "x"]), /不認得/);
});

await check("apply-sql: resolveStagingTarget gates on the fence and on --yes-staging", () => {
  const env = { STAGING_DB_URL: POOLER(OTHER_REF), NEXT_PUBLIC_SUPABASE_URL: `https://${OTHER_REF}.supabase.co`, STAGING_SUPABASE_REF: OTHER_REF };
  assert.equal(applySql.resolveStagingTarget(env, OTHER_REF).ref, OTHER_REF);
  assert.equal(applySql.resolveStagingTarget(env, OTHER_REF.toUpperCase()).ref, OTHER_REF);
  assert.throws(() => applySql.resolveStagingTarget(env, "someotherref"), /--yes-staging/);
  assert.throws(() => applySql.resolveStagingTarget(env, undefined), /--yes-staging/);
  assert.throws(() => applySql.resolveStagingTarget({ ...env, STAGING_DB_URL: POOLER(PROD_SUPABASE_REF) }, OTHER_REF));
  assert.throws(() => applySql.resolveStagingTarget({ ...env, NEXT_PUBLIC_SUPABASE_URL: DB.prod }, OTHER_REF));
  assert.throws(() => applySql.resolveStagingTarget({ ...env, STAGING_DB_URL: "" }, OTHER_REF), /STAGING_DB_URL/);
  const prodEnv = { STAGING_DB_URL: POOLER(PROD_SUPABASE_REF), NEXT_PUBLIC_SUPABASE_URL: DB.prod, STAGING_SUPABASE_REF: PROD_SUPABASE_REF };
  assert.throws(() => applySql.resolveStagingTarget(prodEnv, PROD_SUPABASE_REF), /正式資料庫/);
});

await check("post-capture-fixture: refuses production API hosts (read from extension/background.js)", () => {
  const hosts = capture.parseProductionApiHosts(read("extension/background.js"));
  assert.ok(hosts.includes("nestory-listing-admin.vercel.app"));
  assert.ok(hosts.includes("nestory-listing-admin-chocho-nestory.vercel.app"));
  for (const host of hosts) {
    assert.throws(() => capture.assertNotProductionBase(`https://${host}`, hosts), /正式站/);
    assert.throws(() => capture.assertNotProductionBase(`https://${host.toUpperCase()}/`, hosts), /正式站/);
  }
  assert.equal(capture.assertNotProductionBase("http://localhost:3000", hosts), "http://localhost:3000");
  assert.equal(capture.assertNotProductionBase("https://nestory-listing-admin-git-handoff-x.vercel.app/", hosts), "https://nestory-listing-admin-git-handoff-x.vercel.app");
  assert.throws(() => capture.assertNotProductionBase("not a url", hosts), /--base/);
  assert.throws(() => capture.parseProductionApiHosts("var SOMETHING_ELSE = [];"), /PRODUCTION_API_HOSTS/);
});

await check("sample-capture.json is a valid CAP-1 import payload", () => {
  const fixture = JSON.parse(read("scripts/staging/fixtures/sample-capture.json"));
  const payload = capture.payloadFromFixture(fixture);
  assert.ok(!Object.keys(payload).some((key) => key.startsWith("_")), "underscore keys are stripped");
  assert.match(payload.source_url, /^https:\/\/item\.taobao\.com\/item\.htm\?id=\d+$/);
  assert.equal(typeof payload.title, "string");
  assert.ok(payload.price_cny > 0);
  assert.ok(Array.isArray(payload.variants_flat) && payload.variants_flat.length >= 2);
  assert.ok(Array.isArray(payload.main_image_urls) && payload.main_image_urls.length >= 1);
  assert.ok(payload.capture_meta && typeof payload.capture_meta.adapter === "string");
  const cap1 = JSON.parse(read("scripts/fixtures/cap1-sample.json"));
  assert.notEqual(payload.source_url, cap1.source_url, "must not collide with the CAP-1 test fixture");
});

fs.rmSync(tmpDir, { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\nverify-staging-fence: ${failures.length} check(s) failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\nverify-staging-fence: all ${passed} checks passed`);
