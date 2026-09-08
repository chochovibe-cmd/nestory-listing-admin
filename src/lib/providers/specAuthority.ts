import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import { stripCustomerSourceMarkers } from "@/lib/providers/stripCustomerSourceMarkers";

/**
 * Production 21e9 spec authority: preserve a non-empty saved spec verbatim.
 * Only when saved spec is empty may a non-empty provider spec be adopted.
 * This helper performs no evidence merge, key selection, Web Search parsing,
 * derived-field generation, or source-priority reconciliation.
 */
export function finalizeCustomerSpecText(
  providerSpec: string | null | undefined,
  existingSpec: string | null | undefined,
): string | null {
  const existing = existingSpec ?? "";
  if (existing.trim()) return existing;

  const provider = stripCustomerSourceMarkers(
    localizeToTaiwanTraditionalText(providerSpec ?? ""),
  ).trim();
  if (!provider || provider === "（無）" || provider === "(無)") return null;
  return provider;
}
