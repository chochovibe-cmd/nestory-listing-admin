"use client";

/**
 * PUBLISH-GUARD: lets publish UIs know whether this deployment is the test site
 * (SHOPIFY_PUBLISH_MOCK). Source: GET /api/status → shopifyMock, the same field
 * DeploymentStatus shows. One request per page load (module-level promise cache);
 * a failed lookup is not cached, so the next mount retries.
 */
import { useEffect, useState } from "react";

let mockLookup: Promise<boolean | null> | null = null;

export function resolveShopifyPublishMock(): Promise<boolean | null> {
  if (!mockLookup) {
    mockLookup = fetch("/api/status", { method: "GET", cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        const body = (await res.json().catch(() => ({}))) as { shopifyMock?: unknown };
        return typeof body.shopifyMock === "boolean" ? body.shopifyMock : null;
      })
      .catch(() => null)
      .then((value) => {
        if (value === null) mockLookup = null;
        return value;
      });
  }
  return mockLookup;
}

/** true = test site (dry run), false = live, null = not known yet / lookup failed. */
export function useShopifyPublishMock(): boolean | null {
  const [mock, setMock] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void resolveShopifyPublishMock().then((value) => {
      if (alive) setMock(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return mock;
}
