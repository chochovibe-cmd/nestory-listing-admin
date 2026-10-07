import { timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { hasShopifyAdminCredentials } from "@/lib/shopify/adminToken";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const PREFLIGHT_QUERY = `
  query NestoryShopifyRuntimePreflight {
    shop {
      name
      myshopifyDomain
      currencyCode
    }
  }
`;

type PreflightResult = {
  data?: {
    shop?: {
      name?: string | null;
      myshopifyDomain?: string | null;
      currencyCode?: string | null;
    } | null;
  };
  errors?: unknown[];
};

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0"
    }
  });
}

function tokenMatches(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Temporary operational proof for Vercel Preview only.
 *
 * This endpoint performs a read-only Admin GraphQL shop query through the same
 * client_credentials token code used by Nestory publish/sync. It never returns
 * the access token or any configured secret and cannot run in Production.
 */
export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== "preview") {
    return json({ error: "Not found" }, 404);
  }

  const expected = process.env.SHOPIFY_RUNTIME_PREFLIGHT_TOKEN?.trim() ?? "";
  const provided = request.nextUrl.searchParams.get("token")?.trim() ?? "";
  if (!expected || !provided || !tokenMatches(provided, expected)) {
    return json({ error: "Not found" }, 404);
  }

  if (!hasShopifyAdminCredentials()) {
    return json(
      {
        ok: false,
        credentialMode: "client_credentials",
        code: "shopify_credentials_missing"
      },
      503
    );
  }

  try {
    const { response, result } = await callShopifyAdminGraphQL<PreflightResult>(
      PREFLIGHT_QUERY,
      {}
    );
    const shop = result?.data?.shop;
    if (
      !response.ok ||
      (Array.isArray(result?.errors) && result.errors.length > 0) ||
      !shop?.myshopifyDomain
    ) {
      return json(
        {
          ok: false,
          credentialMode: "client_credentials",
          code: "shopify_admin_read_failed",
          httpStatus: response.status
        },
        502
      );
    }

    return json({
      ok: true,
      credentialMode: "client_credentials",
      tokenExchange: "pass",
      adminGraphqlRead: "pass",
      shop: {
        name: shop.name ?? null,
        myshopifyDomain: shop.myshopifyDomain,
        currencyCode: shop.currencyCode ?? null
      }
    });
  } catch {
    return json(
      {
        ok: false,
        credentialMode: "client_credentials",
        code: "shopify_runtime_preflight_failed"
      },
      502
    );
  }
}
