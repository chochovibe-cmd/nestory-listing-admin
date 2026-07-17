/**
 * P1-75a: sanitize LLM-detected collab brand before writing product_brand.
 * Honesty boundary (Fable A): no confidence → empty → do not overwrite existing.
 */
import { localizeToTaiwanTraditionalText } from "@/lib/zhTwLocalizer";

const MAX_BRAND_LEN = 40;

/** Trailing store / authenticity fluff often glued to brand tokens in 淘寶 titles. */
const TRAILING_NOISE =
  /(官方旗艦店|官方旗舰店|旗艦店|旗舰店|官方店|專賣店|专卖店|官方|正版|旗艦|旗舰)$/u;

const GENERIC_ONLY =
  /^(正版|官方|品牌|無|无|未知|没有|none|n\/a|na|unknown|null|undefined|—|-|－)$/i;

/**
 * Returns a cleaned brand string, or null when the model left it empty /
 * produced noise. Caller must only write product_brand when non-null
 * (empty must never wipe an existing hand-filled brand).
 */
export function normalizeDetectedProductBrand(raw: string | null | undefined): string | null {
  if (raw == null) return null;

  let s = String(raw).normalize("NFKC").trim();
  if (!s) return null;

  // Strip common trailing shop/authenticity tokens before 簡轉繁.
  s = s.replace(TRAILING_NOISE, "").trim();
  if (!s) return null;

  // Simplified brand spellings → Taiwan Traditional before storage.
  s = localizeToTaiwanTraditionalText(s).normalize("NFKC").trim();
  if (!s) return null;

  // Drop leftover trailing noise after conversion (正版 etc.).
  s = s.replace(TRAILING_NOISE, "").trim();
  if (!s) return null;

  if (s.length > MAX_BRAND_LEN) {
    s = s.slice(0, MAX_BRAND_LEN).trim();
  }

  if (s.length < 2) return null;
  if (GENERIC_ONLY.test(s)) return null;

  // Pure punctuation / digits are not brands.
  if (!/[\p{L}\p{N}]/u.test(s)) return null;

  return s;
}
