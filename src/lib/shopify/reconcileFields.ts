import { htmlDescriptionToPlainText } from "@/lib/contentGenerator/htmlFormat";
import {
  listAllSaleStatusNotices,
  saleStatusNoticeText
} from "@/lib/contentGenerator/saleStatusNotice";
import { normalizeFaqOutput } from "@/lib/contentGenerator/copyFormatRepair";
import { isAutoSku, skuPrefix } from "@/lib/variants/variantSku";
import type { ShopifySyncSnapshot } from "@/lib/shopify/fullSyncGraphQL";
import type { ProductVariantRow, ShopifySyncBaseline } from "@/types/domain";

export const PRODUCT_RECONCILE_FIELDS = [
  { key: "title", label: "標題" },
  { key: "description", label: "商品描述" },
  { key: "seoTitle", label: "SEO 標題" },
  { key: "seoDescription", label: "SEO 描述" },
  { key: "why", label: "為什麼選它" },
  { key: "highlights", label: "商品賣點" },
  { key: "faq", label: "問與答" },
  { key: "specs", label: "商品規格" },
  { key: "tags", label: "標籤" },
  { key: "vendor", label: "廠商" },
  { key: "productType", label: "商品類型" },
  { key: "handle", label: "網址代稱" }
] as const;

export const VARIANT_RECONCILE_FIELDS = [
  { key: "price", label: "售價" },
  { key: "compareAtPrice", label: "原價（劃線價）" },
  { key: "sku", label: "SKU" }
] as const;

export type ProductFieldKey = (typeof PRODUCT_RECONCILE_FIELDS)[number]["key"];
export type VariantFieldKey = (typeof VARIANT_RECONCILE_FIELDS)[number]["key"];

export function normText(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normPrice(value: unknown): string {
  if (value == null || value === "") return "";
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  return String(Math.round(number * 100) / 100);
}

export function normCompareAt(value: unknown): string {
  const normalized = normPrice(value);
  if (!normalized || Number(normalized) <= 0) return "";
  return normalized;
}

export function normTags(tags: readonly string[] | null | undefined): string {
  return [...new Set((tags ?? []).map((tag) => tag.trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .join("\u0001");
}

const CHAOCHAO_NOTICE_STATUSES = [
  "海外代購（約14天）",
  "預購中",
  "台灣現貨",
  "二手現貨"
] as const;

export function descriptionCompareText(html: string | null | undefined): string {
  if (!html) return "";
  let value = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
  const embedIndex = value.indexOf("<!-- nestory-desc-embed -->");
  if (embedIndex >= 0) value = value.slice(0, embedIndex);
  value = value.replace(/<p>更多[^<]*周邊 → <a\b[^>]*>看看還有什麼<\/a><\/p>/g, "");
  const notices = new Set(listAllSaleStatusNotices().map((item) => item.text.trim()).filter(Boolean));
  for (const status of CHAOCHAO_NOTICE_STATUSES) {
    const notice = saleStatusNoticeText(status, "潮巢導購版").trim();
    if (notice) notices.add(notice);
  }
  const plain = htmlDescriptionToPlainText(value)
    .split("\n")
    .filter((line) => !notices.has(line.trim()))
    .join("\n");
  return normText(plain);
}

export type ReconcileValues = {
  product: Partial<Record<ProductFieldKey, string>>;
  variants: Record<string, { price: string; compareAtPrice: string; sku: string }>;
};

type DesiredLike = {
  core: Record<string, any>;
  desiredVariants: Array<{
    seed: { price: unknown; compareAtPrice: unknown; sku: unknown };
    remote: { id: string } | null;
  }>;
};

function metafieldValue(
  metafields: Array<{ namespace?: string; key?: string; value?: unknown }> | null | undefined,
  key: string
): string {
  const match = (metafields ?? []).find(
    (item) => item.namespace === "custom" && item.key === key
  );
  return normText(match?.value);
}

export function toolValuesFromDesired(input: DesiredLike): ReconcileValues {
  const core = input.core;
  const product: ReconcileValues["product"] = {
    title: normText(core.title),
    description: descriptionCompareText(core.descriptionHtml),
    seoTitle: normText(core.seo?.title),
    seoDescription: normText(core.seo?.description),
    why: metafieldValue(core.metafields, "why_nestory_pick"),
    highlights: metafieldValue(core.metafields, "product_highlights"),
    faq: metafieldValue(core.metafields, "product_faq"),
    specs: metafieldValue(core.metafields, "product_specs"),
    tags: normTags(core.tags),
    vendor: normText(core.vendor),
    productType: normText(core.productType)
  };
  if (core.handle) product.handle = normText(core.handle);

  const variants: ReconcileValues["variants"] = {};
  for (const item of input.desiredVariants) {
    if (!item.remote) continue;
    variants[item.remote.id] = {
      price: normPrice(item.seed.price),
      compareAtPrice: normCompareAt(item.seed.compareAtPrice),
      sku: normText(item.seed.sku)
    };
  }
  return { product, variants };
}

export function shopifyValuesFromSnapshot(snapshot: ShopifySyncSnapshot): ReconcileValues {
  const product: ReconcileValues["product"] = {
    title: normText(snapshot.title),
    description: descriptionCompareText(snapshot.descriptionHtml),
    seoTitle: normText(snapshot.seo?.title),
    seoDescription: normText(snapshot.seo?.description),
    why: metafieldValue(snapshot.metafields?.nodes, "why_nestory_pick"),
    highlights: metafieldValue(snapshot.metafields?.nodes, "product_highlights"),
    faq: metafieldValue(snapshot.metafields?.nodes, "product_faq"),
    specs: metafieldValue(snapshot.metafields?.nodes, "product_specs"),
    tags: normTags(snapshot.tags),
    vendor: normText(snapshot.vendor),
    productType: normText(snapshot.productType),
    handle: normText(snapshot.handle)
  };
  const variants: ReconcileValues["variants"] = {};
  for (const variant of snapshot.variants.nodes) {
    variants[variant.id] = {
      price: normPrice(variant.price),
      compareAtPrice: normCompareAt(variant.compareAtPrice),
      sku: normText(variant.sku)
    };
  }
  return { product, variants };
}

export function buildBaselineFromSnapshot(
  snapshot: ShopifySyncSnapshot,
  capturedAt: string
): ShopifySyncBaseline {
  const values = shopifyValuesFromSnapshot(snapshot);
  return {
    version: 1,
    capturedAt,
    remoteUpdatedAt: snapshot.updatedAt,
    product: values.product,
    variants: values.variants
  };
}

export type ReconcileState = "tool" | "shopify" | "both" | "unknown";
export type ReconcileChoice = "tool" | "shopify";
export type ReconcileRow = {
  key: string;
  group: "product" | "variant";
  field: string;
  label: string;
  variantId?: string;
  variantLabel?: string;
  state: ReconcileState;
  tool: string;
  shopify: string;
  pullable: boolean;
  pullBlockedReason: string | null;
  preselect: ReconcileChoice | null;
};

function hasOwn(value: object | null | undefined, key: string): boolean {
  return Boolean(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function stateFor(
  tool: string,
  shopify: string,
  baseline: string | undefined,
  baselineHasKey: boolean,
  hasBaseline: boolean,
  legacyUnchanged: boolean
): ReconcileState {
  if (hasBaseline) {
    if (!baselineHasKey) return "unknown";
    if (shopify === baseline) return "tool";
    if (tool === baseline) return "shopify";
    return "both";
  }
  return legacyUnchanged ? "tool" : "unknown";
}

export function computeReconcileRows(input: {
  tool: ReconcileValues;
  shopify: ReconcileValues;
  baseline: ShopifySyncBaseline | null;
  legacyUnchanged: boolean;
  variantLabels: Record<string, string>;
  pullability: Record<string, { pullable: boolean; reason: string | null }>;
}): ReconcileRow[] {
  const rows: ReconcileRow[] = [];
  for (const fieldDef of PRODUCT_RECONCILE_FIELDS) {
    const field = fieldDef.key;
    const tool = input.tool.product[field];
    const shopify = input.shopify.product[field];
    if (tool === undefined || shopify === undefined || tool === shopify) continue;
    const baselineHasKey = Boolean(input.baseline) && hasOwn(input.baseline?.product, field);
    const baselineValue = baselineHasKey ? input.baseline?.product[field] : undefined;
    const state = stateFor(
      tool,
      shopify,
      baselineValue,
      baselineHasKey,
      Boolean(input.baseline),
      input.legacyUnchanged
    );
    const key = `product:${field}`;
    const pull = input.pullability[key] ?? { pullable: false, reason: null };
    rows.push({
      key,
      group: "product",
      field,
      label: fieldDef.label,
      state,
      tool,
      shopify,
      pullable: pull.pullable,
      pullBlockedReason: pull.reason,
      preselect: state === "tool" ? "tool" : state === "shopify" && pull.pullable ? "shopify" : null
    });
  }

  const variantIds = [
    ...Object.keys(input.variantLabels),
    ...Object.keys(input.tool.variants).filter((id) => !(id in input.variantLabels))
  ];
  const seen = new Set<string>();
  for (const variantId of variantIds) {
    if (seen.has(variantId)) continue;
    seen.add(variantId);
    const toolVariant = input.tool.variants[variantId];
    const shopifyVariant = input.shopify.variants[variantId];
    if (!toolVariant || !shopifyVariant) continue;
    for (const fieldDef of VARIANT_RECONCILE_FIELDS) {
      const field = fieldDef.key;
      const tool = toolVariant[field];
      const shopify = shopifyVariant[field];
      if (tool === shopify) continue;
      const baselineVariant = input.baseline?.variants?.[variantId];
      const baselineHasKey =
        Boolean(input.baseline) && Boolean(baselineVariant) && hasOwn(baselineVariant, field);
      const baselineValue = baselineHasKey ? baselineVariant?.[field] : undefined;
      const state = stateFor(
        tool,
        shopify,
        baselineValue,
        baselineHasKey,
        Boolean(input.baseline),
        input.legacyUnchanged
      );
      const key = `variant:${variantId}:${field}`;
      const pull = input.pullability[key] ?? { pullable: false, reason: null };
      rows.push({
        key,
        group: "variant",
        field,
        label: fieldDef.label,
        variantId,
        variantLabel: input.variantLabels[variantId] || "單一款式",
        state,
        tool,
        shopify,
        pullable: pull.pullable,
        pullBlockedReason: pull.reason,
        preselect: state === "tool" ? "tool" : state === "shopify" && pull.pullable ? "shopify" : null
      });
    }
  }
  return rows;
}

export function blockingRows(rows: ReconcileRow[]): ReconcileRow[] {
  return rows.filter((row) => row.state !== "tool");
}

function snapshotMetafield(snapshot: ShopifySyncSnapshot, key: string): string {
  return (snapshot.metafields?.nodes ?? []).find(
    (item) => item.namespace === "custom" && item.key === key
  )?.value ?? "";
}

function remoteVariant(snapshot: ShopifySyncSnapshot, id: string | undefined) {
  return id ? snapshot.variants.nodes.find((item) => item.id === id) ?? null : null;
}

export function isBlockedAutoSku(value: string | null | undefined, draftId: string): boolean {
  const sku = (value ?? "").trim();
  if (!isAutoSku(sku)) return false;
  const own = /^NS-([0-9A-F]{6})-\d{2,}$/.exec(sku);
  return !(own && own[1] === skuPrefix(draftId));
}

export function localPatchForChoice(input: {
  row: ReconcileRow;
  snapshot: ShopifySyncSnapshot;
  draftId: string;
  planMode: "multi" | "single";
  variantRowId: string | null;
}): {
  table: "product_drafts" | "product_variants";
  id: string;
  patch: Record<string, unknown>;
} {
  const { row, snapshot, draftId, planMode, variantRowId } = input;
  if (row.group === "product") {
    let patch: Record<string, unknown>;
    switch (row.field as ProductFieldKey) {
      case "title":
        patch = { title_zh: snapshot.title.trim() };
        break;
      case "description":
        patch = { description_html: descriptionCompareText(snapshot.descriptionHtml) };
        break;
      case "seoTitle": {
        const value = snapshot.seo?.title?.trim() ?? "";
        patch = { seo_title: value || null };
        break;
      }
      case "seoDescription": {
        const value = snapshot.seo?.description?.trim() ?? "";
        patch = { seo_description: value || null };
        break;
      }
      case "why": {
        const value = snapshotMetafield(snapshot, "why_nestory_pick").trim();
        patch = { why_we_chose_it: value || null };
        break;
      }
      case "highlights": {
        const value = snapshotMetafield(snapshot, "product_highlights");
        const lines = value
          .split(/\r?\n/)
          .map((line) => line.replace(/^[・･•➼]\s*/, "").trim())
          .filter(Boolean);
        patch = { product_highlights: lines };
        break;
      }
      case "faq": {
        const value = snapshotMetafield(snapshot, "product_faq").trim();
        patch = { generated_faq_html: value ? normalizeFaqOutput(value) : null };
        break;
      }
      case "specs": {
        const value = snapshotMetafield(snapshot, "product_specs").trim();
        patch = { spec_text: value || null };
        break;
      }
      case "tags":
        patch = { shopify_tags: snapshot.tags.map((tag) => tag.trim()).filter(Boolean) };
        break;
      case "vendor":
        patch = { vendor: snapshot.vendor.trim() };
        break;
      case "productType": {
        const value = snapshot.productType.trim();
        patch = { product_type: value || null };
        break;
      }
      case "handle":
        patch = { shopify_handle: snapshot.handle.trim() };
        break;
      default:
        throw new Error(`Unsupported reconcile field: ${row.field}`);
    }
    return { table: "product_drafts", id: draftId, patch };
  }

  const remote = remoteVariant(snapshot, row.variantId);
  if (!remote) throw new Error("Shopify 款式已不存在");
  const field = row.field as VariantFieldKey;
  const compareAt =
    remote.compareAtPrice != null && Number(remote.compareAtPrice) > 0
      ? Number(remote.compareAtPrice)
      : null;
  if (planMode === "multi") {
    if (!variantRowId) throw new Error("找不到工具內對應款式");
    if (field === "price") {
      return {
        table: "product_variants",
        id: variantRowId,
        patch: { twd_price: Number(remote.price), sell_price_locked: true }
      };
    }
    if (field === "compareAtPrice") {
      return {
        table: "product_variants",
        id: variantRowId,
        patch: { compare_at_price: compareAt, compare_at_locked: true }
      };
    }
    return {
      table: "product_variants",
      id: variantRowId,
      patch: { sku: (remote.sku ?? "").trim() }
    };
  }

  if (field === "price") {
    return { table: "product_drafts", id: draftId, patch: { twd_price: Number(remote.price) } };
  }
  if (field === "compareAtPrice") {
    return { table: "product_drafts", id: draftId, patch: { compare_at_price: compareAt } };
  }
  return {
    table: "product_drafts",
    id: draftId,
    patch: { sku: (remote.sku ?? "").trim() }
  };
}

export type ReconcileDisplayRow = ReconcileRow & {
  toolDisplay: string;
  shopifyDisplay: string;
};

export type ShopifyDiffPayload = {
  ok: true;
  productStatus: "ACTIVE" | "DRAFT" | "ARCHIVED" | "UNLISTED";
  remoteUpdatedAt: string;
  draftUpdatedAt: string;
  hasBaseline: boolean;
  rows: ReconcileDisplayRow[];
  variantTotal: number;
  toolOnlyVariants: string[];
  shopifyOnlyVariants: string[];
};

export type ReconcileDraftLike = Record<string, any>;
export type ReconcileVariantRows = ProductVariantRow[];
