import { NextRequest } from "next/server";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";

export const runtime = "nodejs";
export const maxDuration = 30;

type AuthSelfTestResult = {
  data?: {
    shop?: {
      name?: string;
      myshopifyDomain?: string;
      currencyCode?: string;
    };
  };
  errors?: Array<{ message?: string }>;
};

export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const expectedToken = process.env.SHOPIFY_AUTH_SELFTEST_TOKEN?.trim();
  if (!expectedToken) {
    return Response.json(
      { error: "Preview auth self-test is not configured", code: "SELFTEST_TOKEN_MISSING" },
      { status: 503 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const suppliedToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!suppliedToken || suppliedToken !== expectedToken) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasShopifyAdminCredentials()) {
    return Response.json(
      { error: "Shopify Admin credentials are not configured", code: "SHOPIFY_CREDENTIALS_MISSING" },
      { status: 503 }
    );
  }

  try {
    const { response, result } = await callShopifyAdminGraphQL<AuthSelfTestResult>(
      `query NestoryShopifyAuthSelfTest {
        shop {
          name
          myshopifyDomain
          currencyCode
        }
      }`,
      {}
    );

    const graphErrors = Array.isArray(result?.errors) ? result.errors : [];
    const shop = result?.data?.shop;
    if (!response.ok || graphErrors.length > 0 || !shop?.myshopifyDomain) {
      return Response.json(
        {
          ok: false,
          code: "SHOPIFY_AUTH_SELFTEST_FAILED",
          adminStatus: response.status,
          errorCount: graphErrors.length
        },
        { status: 502 }
      );
    }

    return Response.json({
      ok: true,
      runtime: "vercel-preview",
      tokenExchange: "pass",
      shop: {
        name: shop.name ?? null,
        myshopifyDomain: shop.myshopifyDomain,
        currencyCode: shop.currencyCode ?? null
      }
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        code: "SHOPIFY_AUTH_SELFTEST_EXCEPTION",
        message: error instanceof Error ? error.message.replace(/shpat_[A-Za-z0-9_-]+/g, "[redacted]") : "Unknown error"
      },
      { status: 502 }
    );
  }
}
