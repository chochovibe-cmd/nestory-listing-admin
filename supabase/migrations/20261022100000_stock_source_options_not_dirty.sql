-- STOCK (4b), 2026-10-22.
-- product_variants.source_options holds source-site stock (CAPTURE-FIX re-capture) and the
-- Shopify stock bookkeeping (STOCK "來源庫存同步到 Shopify"). Neither is Shopify product content,
-- so an UPDATE that only changes source_options must NOT flip the linked draft to
-- shopify_sync_status = 'dirty' ("Shopify 有未同步修改").
-- Only the function body changes; the triggers created in 20260903100000 stay as they are.
-- Revert: re-run the function definition from 20260903100000_shopify_full_sync_state.sql in a new migration.

create or replace function public.mark_linked_product_child_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_draft_id uuid;
begin
  if tg_op = 'DELETE' then
    target_draft_id := old.draft_id;
  else
    target_draft_id := new.draft_id;
  end if;

  if tg_op = 'UPDATE'
    and tg_table_name = 'product_variants'
    and (to_jsonb(new) - 'source_options' - 'updated_at')
      = (to_jsonb(old) - 'source_options' - 'updated_at')
  then
    return new;
  end if;

  update public.product_drafts
  set shopify_sync_status = 'dirty',
      shopify_sync_error = null
  where id = target_draft_id
    and shopify_product_id is not null
    and shopify_product_id <> 'mock-product-id'
    and shopify_sync_status not in ('syncing', 'remote_deleted');

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

-- create or replace keeps existing privileges; repeat the 20260903 revoke so a fresh replay matches.
revoke all on function public.mark_linked_product_child_dirty() from public;
