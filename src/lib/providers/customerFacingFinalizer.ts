import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";
import {
  stripCustomerSourceMarkers,
  stripCustomerSourceMarkersList,
} from "@/lib/providers/stripCustomerSourceMarkers";

/** Customer-facing AI text is localized to Taiwan Traditional and stripped of source markers. */
export function finalizeCustomerText(value: string | null | undefined): string {
  return stripCustomerSourceMarkers(
    localizeToTaiwanTraditionalText(value ?? ""),
  ).trim();
}

export function finalizeCustomerTextList(values: string[] | null | undefined): string[] {
  return stripCustomerSourceMarkersList(
    (values ?? [])
      .map((value) => localizeToTaiwanTraditionalText(value))
      .filter((value) => value.trim()),
  );
}

// Compatibility export only; spec authority lives in specAuthority.ts.
export { finalizeCustomerSpecText } from "./specAuthority";
