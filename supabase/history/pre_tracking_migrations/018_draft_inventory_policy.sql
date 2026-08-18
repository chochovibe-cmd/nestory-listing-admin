-- B2: Store single-draft inventory semantics.
-- Default is "unlimited / continue selling"; finite stock is quantity + deny.

alter table public.product_drafts
  add column if not exists inventory_quantity integer,
  add column if not exists inventory_policy text not null default 'continue';

do $$
begin
  alter table public.product_drafts
    add constraint product_drafts_inventory_policy_check
    check (inventory_policy in ('deny', 'continue'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.product_drafts
    add constraint product_drafts_inventory_quantity_check
    check (inventory_quantity is null or inventory_quantity >= 0);
exception
  when duplicate_object then null;
end $$;

alter table public.product_variants
  alter column inventory_policy set default 'continue';

update public.product_variants
set inventory_policy = 'continue'
where inventory_policy = 'deny'
  and inventory_quantity = 0;
