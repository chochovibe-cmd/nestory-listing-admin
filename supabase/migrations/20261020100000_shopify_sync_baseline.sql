-- 1.5a SHOPIFY-RECONCILE: per-field snapshot of what Shopify held right after the
-- last verified full sync or publish. Used to tell "Shopify was edited" apart from
-- "the tool was edited". Additive only; old code ignores it.
alter table public.product_drafts
  add column if not exists shopify_sync_baseline jsonb;

comment on column public.product_drafts.shopify_sync_baseline is
  '1.5a SHOPIFY-RECONCILE baseline: {version:1,capturedAt,remoteUpdatedAt,product:{fieldKey:normalized},variants:{variantGid:{price,compareAtPrice,sku}}}';
