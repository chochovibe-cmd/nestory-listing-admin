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

  return Response.json({
    supabase: supabaseOk,
    aiProvider: {
      openai: Boolean(process.env.OPENAI_API_KEY),
      claude: Boolean(process.env.ANTHROPIC_API_KEY)
    },
    shopify: Boolean(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN && process.env.SHOPIFY_STORE_DOMAIN),
    shopifyMock: process.env.SHOPIFY_PUBLISH_MOCK !== "false"
  });
}
