-- Align sale_status to the exact canonical strings in the boss's tool's
-- src/lib/saleStatus.ts SALE_STATUS_OPTIONS (2026-07-02). 009 used the
-- values the user first gave verbally (海外代購/台灣現貨/預購商品/二手商品),
-- but the actual source code's normalizeSaleStatusLabel() only recognizes
-- bare '海外代購' via no branch at all -- it needs the '（約14天）' suffix to
-- match, otherwise Tags V2 silently fails to produce a 銷售_ tag. 台灣現貨
-- stays as-is (already canonical); 預購商品 and 二手商品 already normalize
-- correctly at runtime, but we store the canonical form directly instead of
-- relying on normalization on every read.

-- Fix (2026-07-02): the old check constraint (from 009) only allows
-- '海外代購'/'預購商品'/'二手商品'. Running the UPDATEs below before dropping
-- that constraint made every one of them fail with
-- "violates check constraint product_drafts_sale_status_check", so this
-- migration never actually applied. Drop the old constraint first so the
-- UPDATEs are unconstrained, then add the new constraint once all rows
-- already hold a canonical value.

alter table public.product_drafts
  drop constraint if exists product_drafts_sale_status_check;

update public.product_drafts set sale_status = '海外代購（約14天）' where sale_status = '海外代購';
update public.product_drafts set sale_status = '預購中' where sale_status = '預購商品';
update public.product_drafts set sale_status = '二手現貨' where sale_status = '二手商品';

alter table public.product_drafts
  alter column sale_status set default '海外代購（約14天）',
  add constraint product_drafts_sale_status_check
    check (sale_status in ('海外代購（約14天）', '台灣現貨', '預購中', '二手現貨'));
