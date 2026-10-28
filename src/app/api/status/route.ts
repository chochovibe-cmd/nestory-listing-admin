import { readNestoryEnvironment } from "@/lib/env/nestoryEnv";
import { resolveTextAiEndpoint } from "@/lib/providers/textAiEndpoint";
import { createServiceSupabaseClient, hasSupabaseServerEnv } from "@/lib/supabase/server";

export async function GET() {
  let supabaseOk = false;

  if (hasSupabaseServerEnv() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const supabase = createServiceSupabaseClient();
      const { error } = await supabase.from("team_settings").select("key").limit(1);
      supabaseOk = !error;
    } catch {
      supabaseOk = false;
    }
  }

  // Public store domain only (for storefront product iframe / new-tab preview).
  // Not a secret — same host customers already hit. Sanitize path/protocol.
  const rawDomain = process.env.SHOPIFY_STORE_DOMAIN?.trim() ?? "";
  const shopifyStoreDomain = rawDomain
    ? rawDomain.replace(/^https?:\/\//i, "").split("/")[0]?.toLowerCase() || null
    : null;

  // STAGING 1.6: which environment this deployment believes it is in. Never
  // includes the shop domain or any key (spec section 3.4).
  const env = readNestoryEnvironment();

  return Response.json({
    supabase: supabaseOk,
    aiProvider: {
      openai: resolveTextAiEndpoint() !== null,
      claude: Boolean(process.env.ANTHROPIC_API_KEY)
    },
    // A1 (2026-07-10): Shopify's static Admin API token was replaced by a
    // client_credentials OAuth exchange -- see src/lib/shopify/adminToken.ts.
    shopify: Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET && process.env.SHOPIFY_STORE_DOMAIN),
    shopifyMock: process.env.SHOPIFY_PUBLISH_MOCK !== "false",
    /** D9: Online Store host for product iframe (e.g. shop.myshopify.com) */
    shopifyStoreDomain,
    environment: {
      effective: env.effective,
      declared: env.declared,
      supabaseRef: env.supabaseRef,
      supabaseIsProd: env.supabaseIsProd,
      shopIsProd: env.shopIsProd,
      problems: env.problems
    }
  });
}
