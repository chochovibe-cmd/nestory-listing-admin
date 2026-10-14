-- VARIANT-CLEAN: keep what the Taobao import originally said, separate from what we sell.
-- Additive and idempotent. This file is handed to the operator; local work never runs it.
--   source_sku_id  Taobao skuId (internal / purchasing use; never sent to Shopify as SKU)
--   source_options imported axis names + values before 款式名稱整理, e.g.
--                  {"names":["颜色分类",null,null],"values":["Pingu屏幕耳机【升级版】",null,null]}

alter table public.product_variants
  add column if not exists source_sku_id text,
  add column if not exists source_options jsonb;

comment on column public.product_variants.source_sku_id is
  'VARIANT-CLEAN: Taobao skuId from the import; internal only, not the Shopify SKU.';
comment on column public.product_variants.source_options is
  'VARIANT-CLEAN: imported option names/values before 整理款式名稱 (names[3], values[3]).';
