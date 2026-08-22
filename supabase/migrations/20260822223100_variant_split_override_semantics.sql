-- D3.10A: persist split Variant override semantics without rewriting legacy rows.
-- NULL means the row predates D3.10A and should use the application fallback path.

alter table public.product_variants
  add column if not exists cost_is_inherited boolean,
  add column if not exists sell_price_locked boolean,
  add column if not exists compare_at_locked boolean;

comment on column public.product_variants.cost_is_inherited is
  'D3.10A explicit variant-cost inheritance state; NULL means legacy row fallback.';
comment on column public.product_variants.sell_price_locked is
  'D3.10A explicit manual sell-price lock; NULL means legacy price_locked fallback.';
comment on column public.product_variants.compare_at_locked is
  'D3.10A explicit manual compare-at lock; NULL means legacy price_locked fallback.';
