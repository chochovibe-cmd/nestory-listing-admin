/**
 * PUBLISH-GUARD: pure pre-publish readiness checks (no I/O, no server-only imports).
 *
 * Shared by publishDraft (server), the verify script and client code. The rules
 * exist because Tmall/Taobao pages carry "款式" that are not sellable products
 * (購買須知 / 勿拍 / 補差價 …) and hide per-SKU prices, so a bundle variant such
 * as 「端盒 6 款」 silently inherits the single-box cost.
 *
 * - FAKE_VARIANT is never bypassable: the operator must delete the row.
 * - BUNDLE_VARIANT_PRICE / VARIANT_PRICE_UNCONFIRMED are confirmable: the
 *   operator can tick "I checked every variant cost" and publish.
 */

export type PublishBlockerCode =
  | "FAKE_VARIANT"
  | "BUNDLE_VARIANT_PRICE"
  | "VARIANT_PRICE_UNCONFIRMED";

/** HTTP 409 code: confirmable blockers only → ask the operator; otherwise the data must be fixed. */
export type PublishBlockCode = "PUBLISH_NEEDS_PRICE_CONFIRM" | "PUBLISH_BLOCKED";

export type PublishBlocker = {
  code: PublishBlockerCode;
  message: string;
  /** true = operator can confirm and continue; false = must fix the data first. */
  confirmable: boolean;
  variantLabels?: string[];
};

/** Minimal variant shape (ProductVariantRow and capture rows both satisfy it). */
export type ReadinessVariantRow = {
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  cny_price?: number | string | null;
  cost_is_inherited?: boolean | null;
};

export type PublishReadinessResult = {
  /** Blockers still standing after any confirmation. */
  blockers: PublishBlocker[];
  blocked: boolean;
  /** Blocked, and every remaining blocker can be cleared by operator confirmation. */
  needsPriceConfirm: boolean;
  /** Confirmable blockers that were waived (by flag or persisted confirmation). */
  bypassed: PublishBlocker[];
};

/**
 * Non-product "款式" (Traditional + Simplified). Bare 客服 is NOT here: real, sellable
 * variants end with 「定製務必聯繫客服」. Only a label that LEADS with a contact-CS
 * instruction is fake (see FAKE_VARIANT_CS_LEAD_PATTERN).
 */
export const FAKE_VARIANT_PATTERN =
  /勿拍|不要拍|拍下不[發发]|拍下不出|不[發发][貨货]|不出[貨货]|不單獨[發发]|不单独[发發]|補差|补差|差價|差价|補郵|补邮|郵費|邮费|運費|运费|定金|訂金|订金|須知|须知|說明(?!書)|说明(?!书)|售罄|售完|已售空|專拍|专拍/;

/** 「聯繫客服免費定製賀卡…」 — starts with a contact-CS instruction, optionally after a leading 【…】 tag. */
export const FAKE_VARIANT_CS_LEAD_PATTERN = /^\s*(?:【[^】]*】\s*)?(?:聯繫|联系|聯系|諮詢|咨询)客服/;

/**
 * Bundle / whole-box wording (Traditional + Simplified). The quantity alternative needs
 * a count of 2+ plus a unit (2個盲盒 / 3個 / 12入), so 1個盲盒, 32G and 16G do not match.
 */
export const BUNDLE_VARIANT_PATTERN =
  /套組|套组|套裝|套装|整套|全套|一套|端盒|整盒|整端|一端|全端|組合|组合|合集|全\s*\d+\s*款|(?:^|[^\d.])(?:[2-9]|\d{2,})\s*(?:個|个|只|件|入|盒|顆|颗|支|隻)|[x×＊*]\s*(?:[2-9]|\d{2,})\b/;

/** Mirrors PRICE_PLACEHOLDER_CNY in captureTypes (kept local: this module has no imports). */
const PRICE_PLACEHOLDER_CNY = 0.01;
const COST_EPSILON = 0.001;

function optionValues(row: ReadinessVariantRow): string[] {
  return [row.option1_value, row.option2_value, row.option3_value]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

/** Non-empty option values joined by "／" — the label an operator sees on the card. */
export function variantLabel(row: ReadinessVariantRow): string {
  return optionValues(row).join("／");
}

function quoteLabels(labels: string[]): string {
  return labels.map((label) => `「${label}」`).join("");
}

function toFiniteNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pattern hit on any single option value or on the joined label an operator sees. */
function rowMatches(row: ReadinessVariantRow, pattern: RegExp): boolean {
  const values = optionValues(row);
  return values.some((value) => pattern.test(value)) || pattern.test(values.join("／"));
}

function isFakeRow(row: ReadinessVariantRow): boolean {
  return rowMatches(row, FAKE_VARIANT_PATTERN) || rowMatches(row, FAKE_VARIANT_CS_LEAD_PATTERN);
}

/** Labels of rows whose option text is not a sellable product (cannot be bypassed). */
export function findFakeVariantLabels(rows: ReadinessVariantRow[]): string[] {
  return rows.filter(isFakeRow).map(variantLabel);
}

/** True when the row's cost is not independently sourced (follows / equals product cost). */
function rowInheritsProductCost(row: ReadinessVariantRow, productCny: number | null): boolean {
  if (row.cost_is_inherited === true) return true;
  if (row.cny_price == null) return true;
  if (row.cost_is_inherited === false) return false;
  // Legacy rows (flag NULL): equal-to-product cost is indistinguishable from inherited.
  const cny = toFiniteNumber(row.cny_price);
  return cny != null && productCny != null && Math.abs(cny - productCny) < COST_EPSILON;
}

/**
 * Bundle-looking variants (端盒 / 套組 …) whose cost is just the product cost.
 * Only meaningful for multi-variant drafts; fake rows are reported separately.
 */
export function findBundleInheritedVariantLabels(
  rows: ReadinessVariantRow[],
  productCny: number | null
): string[] {
  if (rows.length < 2) return [];
  return rows
    .filter(
      (row) =>
        !isFakeRow(row) &&
        rowMatches(row, BUNDLE_VARIANT_PATTERN) &&
        rowInheritsProductCost(row, productCny)
    )
    .map(variantLabel);
}

function serverCapture(rawCapture: unknown): Record<string, unknown> | null {
  if (!rawCapture || typeof rawCapture !== "object" || Array.isArray(rawCapture)) return null;
  const server = (rawCapture as Record<string, unknown>).server;
  if (!server || typeof server !== "object" || Array.isArray(server)) return null;
  return server as Record<string, unknown>;
}

/** True once an operator confirmation was persisted by a previous publish. */
export function isVariantPriceConfirmed(rawCapture: unknown): boolean {
  const at = serverCapture(rawCapture)?.variant_price_confirmed_at;
  return typeof at === "string" && at.trim().length > 0;
}

function captureFlagsPriceUnconfirmed(rawCapture: unknown): boolean {
  return serverCapture(rawCapture)?.price_requires_confirmation === true;
}

export function checkPublishReadiness(
  draft: { cny_price?: unknown; raw_capture?: unknown },
  rows: ReadinessVariantRow[],
  opts: { confirmVariantPrices?: boolean } = {}
): PublishReadinessResult {
  const productCny = toFiniteNumber(draft.cny_price);
  const found: PublishBlocker[] = [];

  const fakeLabels = findFakeVariantLabels(rows);
  if (fakeLabels.length > 0) {
    found.push({
      code: "FAKE_VARIANT",
      confirmable: false,
      variantLabels: fakeLabels,
      message: `有 ${fakeLabels.length} 個款式不是可賣的商品（像「購買須知」「勿拍」「補差價」「客服」「售罄」這類）：${quoteLabels(fakeLabels)}。請在商品卡刪除這些款式後再發布。`
    });
  }

  const bundleLabels = findBundleInheritedVariantLabels(rows, productCny);
  if (bundleLabels.length > 0) {
    found.push({
      code: "BUNDLE_VARIANT_PRICE",
      confirmable: true,
      variantLabels: bundleLabels,
      message: `款式${quoteLabels(bundleLabels)}看起來是套組／整盒，但成本沿用單個商品的價格，請確認這款的成本。`
    });
  }

  const placeholder = productCny != null && Math.abs(productCny - PRICE_PLACEHOLDER_CNY) < 0.000001;
  if (captureFlagsPriceUnconfirmed(draft.raw_capture) && !placeholder) {
    const inheritCount =
      rows.length >= 2 ? rows.filter((row) => rowInheritsProductCost(row, productCny)).length : 0;
    found.push({
      code: "VARIANT_PRICE_UNCONFIRMED",
      confirmable: true,
      message:
        "抓取時價格被標記為「需確認」（價格來源衝突，或天貓隱藏了各款價格），請逐一核對款式價後再發布。" +
        (inheritCount > 0 ? `目前有 ${inheritCount} 個款式沿用商品成本。` : "")
    });
  }

  const confirmed = opts.confirmVariantPrices === true || isVariantPriceConfirmed(draft.raw_capture);
  const blockers = confirmed ? found.filter((blocker) => !blocker.confirmable) : found;
  const bypassed = confirmed ? found.filter((blocker) => blocker.confirmable) : [];
  return {
    blockers,
    blocked: blockers.length > 0,
    needsPriceConfirm: blockers.length > 0 && blockers.every((blocker) => blocker.confirmable),
    bypassed
  };
}

export function formatPublishBlockMessage(blockers: PublishBlocker[]): string {
  return blockers.map((blocker) => blocker.message).join(" ");
}
