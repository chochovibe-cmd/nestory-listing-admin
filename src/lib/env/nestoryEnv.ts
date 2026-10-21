// STAGING 1.6 (2026-10-21): environment identity + Shopify fence.
//
// Pure functions only -- no supabase / next imports -- so scripts and server
// code can both use them. The production identifiers are hard-coded on purpose:
// an environment variable can be mistyped, a literal constant cannot.
// Spec: docs/STAGING-施工規格-2026-10-21.md section 3.1.

export const PROD_SUPABASE_REF = "tbgtqwvuohmdxnxisrgr";
export const PROD_SHOP_DOMAIN = "e0jg81-qe.myshopify.com";

export type NestoryEnv = "production" | "staging" | "local";

export type EnvProblem =
  | "invalid_nestory_env"
  | "prod_env_non_prod_db"
  | "prod_env_non_prod_shop"
  | "non_prod_env_prod_db"
  | "non_prod_env_prod_shop";

type EnvSource = Record<string, string | undefined>;

export interface NestoryEnvironment {
  declared: NestoryEnv | null;
  effective: NestoryEnv;
  supabaseRef: string | null;
  supabaseIsProd: boolean;
  shopDomain: string | null;
  shopIsProd: boolean;
  problems: EnvProblem[];
}

const NESTORY_ENVS: readonly string[] = ["production", "staging", "local"];

/** https://<ref>.supabase.co[/...] -> <ref>; anything else -> null. */
export function supabaseRefFromUrl(url: string | undefined): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return null;
  const match = /^https:\/\/([a-z0-9]+)\.supabase\.co(?:[/?#].*)?$/i.exec(trimmed);
  return match ? match[1].toLowerCase() : null;
}

/** Strip scheme, path and trailing slash; lowercase. Empty -> null. */
export function normalizeShopDomain(d: string | undefined): string | null {
  const trimmed = (d ?? "").trim();
  if (!trimmed) return null;
  const host = trimmed.replace(/^https?:\/\//i, "").split("/")[0]?.trim().toLowerCase() ?? "";
  return host || null;
}

export function readNestoryEnvironment(env: EnvSource = process.env): NestoryEnvironment {
  const problems: EnvProblem[] = [];

  const rawDeclared = (env.NESTORY_ENV ?? "").trim();
  let declared: NestoryEnv | null = null;
  if (rawDeclared) {
    if (NESTORY_ENVS.includes(rawDeclared)) {
      declared = rawDeclared as NestoryEnv;
    } else {
      problems.push("invalid_nestory_env");
    }
  }

  const supabaseRef = supabaseRefFromUrl(env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseIsProd = supabaseRef === PROD_SUPABASE_REF;
  const shopDomain = normalizeShopDomain(env.SHOPIFY_STORE_DOMAIN);
  const shopIsProd = shopDomain === PROD_SHOP_DOMAIN;

  // Until NESTORY_ENV is set, a prod DB + prod shop pair behaves exactly like
  // the pre-STAGING production site; anything else is treated as local.
  const effective: NestoryEnv = declared ?? (supabaseIsProd && shopIsProd ? "production" : "local");

  if (effective === "production") {
    if (!supabaseIsProd) problems.push("prod_env_non_prod_db");
    if (!shopIsProd) problems.push("prod_env_non_prod_shop");
  } else {
    if (supabaseIsProd) problems.push("non_prod_env_prod_db");
    if (shopIsProd) problems.push("non_prod_env_prod_shop");
  }

  return { declared, effective, supabaseRef, supabaseIsProd, shopDomain, shopIsProd, problems };
}

const PROBLEM_TEXT: Record<EnvProblem, string> = {
  invalid_nestory_env: "NESTORY_ENV 的值不正確",
  prod_env_non_prod_db: "正式站連到的不是正式資料庫",
  prod_env_non_prod_shop: "正式站連到的不是正式商店",
  non_prod_env_prod_db: "測試／本機環境連到了正式資料庫",
  non_prod_env_prod_shop: "測試／本機環境連到了正式商店"
};

export function environmentBannerModel(
  r: ReturnType<typeof readNestoryEnvironment>
): { tone: "staging" | "danger"; text: string } | null {
  if (r.problems.length > 0) {
    const reasons = r.problems.map((problem) => PROBLEM_TEXT[problem]).join("、");
    return {
      tone: "danger",
      text: `⛔ 環境設定錯誤：${reasons}。已停止寫入 Shopify，請找 Claude。`
    };
  }
  if (r.effective === "staging") {
    return { tone: "staging", text: "🧪 測試場：資料庫和 Shopify 都是測試用的，可以放心按。" };
  }
  if (r.effective === "local") {
    return { tone: "staging", text: "💻 本機開發環境" };
  }
  return null;
}

export class ShopifyEnvironmentMismatchError extends Error {
  problems: EnvProblem[];

  constructor(problems: EnvProblem[]) {
    super(`Shopify environment mismatch (${problems.join(", ")}); Shopify access was blocked before requesting a token.`);
    this.name = "ShopifyEnvironmentMismatchError";
    this.problems = problems;
  }
}

/** Throws when the declared environment and the DB / shop identities disagree. */
export function assertShopifyEnvironment(env: EnvSource = process.env): void {
  const { problems } = readNestoryEnvironment(env);
  if (problems.length > 0) {
    throw new ShopifyEnvironmentMismatchError(problems);
  }
}
