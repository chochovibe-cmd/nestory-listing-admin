import type { ProductStatus } from './contentGenerator/sourceTypes';

export const SALE_STATUS_OPTIONS = [
  '海外代購（約14天）',
  '預購中',
  '台灣現貨',
  '二手現貨',
] as const;

export type SaleStatusOption = (typeof SALE_STATUS_OPTIONS)[number];

function normalizeText(value: string | null | undefined): string {
  return (value ?? '').normalize('NFKC').replace(/\s+/g, '').trim();
}

export function normalizeSaleStatusLabel(value: string | null | undefined): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    return '';
  }

  if (normalized === '海外代購(約14天)' || normalized === '海外代購（約14天）') {
    return '海外代購（約14天）';
  }

  if (['海外現貨', '現貨約14天', '下單叫貨', '下單後叫貨', '訂購後叫貨'].includes(normalized)) {
    return '海外代購（約14天）';
  }

  if (['預購中', '預購商品', '預售'].includes(normalized)) {
    return '預購中';
  }

  if (normalized === '台灣現貨') {
    return '台灣現貨';
  }

  if (['二手現貨', '二手商品'].includes(normalized)) {
    return '二手現貨';
  }

  return (value ?? '').trim();
}

export function mapSaleStatusToNestoryTagValue(
  value: string | null | undefined,
  productStatus?: ProductStatus,
): string | null {
  if (productStatus === 'secondhand') {
    return '二手現貨';
  }

  switch (normalizeSaleStatusLabel(value)) {
    case '海外代購（約14天）':
      return '海外現貨';
    case '預購中':
      return '預購商品';
    case '台灣現貨':
      return '台灣現貨';
    case '二手現貨':
      return '二手現貨';
    default:
      return null;
  }
}

export function isPreorderSaleStatus(value: string | null | undefined): boolean {
  return normalizeSaleStatusLabel(value) === '預購中';
}

/**
 * UX-B4-P02: result-card title badge (display-only short labels).
 * Unknown / empty → null (do not render dirty free text).
 */
export function formatSaleStatusBadge(
  value: string | null | undefined,
): string | null {
  switch (normalizeSaleStatusLabel(value)) {
    case '海外代購（約14天）':
      return '海外現貨';
    case '台灣現貨':
      return '台灣現貨';
    case '二手現貨':
      return '二手現貨';
    case '預購中':
      return '預購中';
    default:
      return null;
  }
}
