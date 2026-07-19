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

  return Response.json({
    supabase: supabaseOk,
    aiProvider: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      claude: Boolean(process.env.ANTHROPIC_API_KEY)
    },
    // A1 (2026-07-10): Shopify's static Admin API token was replaced by a
    // client_credentials OAuth exchange -- see src/lib/shopify/adminToken.ts.
    shopify: Boolean(process.env.SHOPIFY_CLIENT_ID && process.env.SHOPIFY_CLIENT_SECRET && process.env.SHOPIFY_STORE_DOMAIN),
    shopifyMock: process.env.SHOPIFY_PUBLISH_MOCK !== "false",
    /** D9: Online Store host for product iframe (e.g. shop.myshopify.com) */
    shopifyStoreDomain
  });
}
