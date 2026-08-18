-- Realign sale_status to the boss's tool's updated status values (2026-07-02).
-- 005 originally used ('海外代購','預購','現貨'); the boss's tool has since
-- changed to a 4-value set including 二手商品 as a sale_status value rather
-- than only tracking secondhand-ness via is_secondhand/secondhand_grade.
-- Existing '預購' rows become '預購商品', '現貨' rows become '台灣現貨'.

update public.product_drafts set sale_status = '預購商品' where sale_status = '預購';
update public.product_drafts set sale_status = '台灣現貨' where sale_status = '現貨';

alter table public.product_drafts
  drop constraint if exists product_drafts_sale_status_check,
  add constraint product_drafts_sale_status_check
    check (sale_status in ('海外代購', '台灣現貨', '預購商品', '二手商品'));
