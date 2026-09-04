-- Shopify full-sync state and remote identity tracking.
-- Additive and idempotent: production must apply this migration through the
-- normal tracked migration process; this file is not executed by local work.

begin;

alter table public.product_drafts
  add column if not exists shopify_sync_status text not null default 'never',
  add column if not exists shopify_synced_at timestamptz,
  add column if not exists shopify_remote_updated_at timestamptz,
  add column if not exists shopify_sync_hash text,
  add column if not exists shopify_sync_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_drafts'::regclass
      and conname = 'product_drafts_shopify_sync_status_check'
  ) then
    alter table public.product_drafts
      add constraint product_drafts_shopify_sync_status_check
      check (shopify_sync_status in ('never', 'synced', 'dirty', 'syncing', 'partial', 'error', 'conflict', 'remote_deleted'));
  end if;
end
$$;

alter table public.product_variants
  add column if not exists shopify_variant_id text,
  add column if not exists shopify_inventory_item_id text;

alter table public.product_images
  add column if not exists shopify_media_id text,
  add column if not exists shopify_file_id text,
  add column if not exists shopify_source_hash text;

create table if not exists public.shopify_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  operation text not null,
  status text not null default 'queued',
  shopify_product_id text,
  shopify_remote_id text,
  request_hash text,
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopify_sync_jobs'::regclass
      and conname = 'shopify_sync_jobs_operation_check'
  ) then
    alter table public.shopify_sync_jobs
      add constraint shopify_sync_jobs_operation_check
      check (operation in ('create', 'update', 'verify', 'archive', 'restore', 'delete'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.shopify_sync_jobs'::regclass
      and conname = 'shopify_sync_jobs_status_check'
  ) then
    alter table public.shopify_sync_jobs
      add constraint shopify_sync_jobs_status_check
      check (status in ('queued', 'processing', 'completed', 'failed', 'skipped'));
  end if;
end
$$;

create index if not exists product_drafts_shopify_sync_status_idx
  on public.product_drafts (shopify_sync_status, updated_at desc);
create index if not exists product_drafts_shopify_product_id_idx
  on public.product_drafts (shopify_product_id)
  where shopify_product_id is not null;
create index if not exists product_variants_shopify_variant_id_idx
  on public.product_variants (shopify_variant_id)
  where shopify_variant_id is not null;
create index if not exists product_images_shopify_media_id_idx
  on public.product_images (shopify_media_id)
  where shopify_media_id is not null;
create index if not exists shopify_sync_jobs_draft_idx
  on public.shopify_sync_jobs (draft_id, created_at desc);
create index if not exists shopify_sync_jobs_status_idx
  on public.shopify_sync_jobs (status, created_at desc);

-- Any local payload change on a linked product becomes dirty, regardless of
-- which UI/API made the edit. This prevents edits made outside ResultCard from
-- being mislabeled as already synchronized.
create or replace function public.mark_linked_product_draft_dirty()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.shopify_product_id is not null
    and new.shopify_product_id <> 'mock-product-id'
    and new.shopify_sync_status not in ('syncing', 'remote_deleted')
    and row(
      new.title_zh, new.description_html, new.description_plain,
      new.seo_title, new.seo_description, new.why_we_chose_it,
      new.product_highlights, new.generated_faq_html, new.spec_text,
      new.vendor, new.product_type, new.category, new.ip_name,
      new.character_name, new.generation_tone, new.tags,
      new.shopify_tags, new.shopify_collections, new.collection_suggestion,
      new.metafields_json, new.shopify_handle, new.cny_price, new.twd_cost,
      new.twd_price, new.price_mode, new.compare_at_price,
      new.inventory_quantity, new.inventory_policy, new.sku, new.sale_status,
      new.variant_dimensions, new.video_urls, new.generated_payload_json
    ) is distinct from row(
      old.title_zh, old.description_html, old.description_plain,
      old.seo_title, old.seo_description, old.why_we_chose_it,
      old.product_highlights, old.generated_faq_html, old.spec_text,
      old.vendor, old.product_type, old.category, old.ip_name,
      old.character_name, old.generation_tone, old.tags,
      old.shopify_tags, old.shopify_collections, old.collection_suggestion,
      old.metafields_json, old.shopify_handle, old.cny_price, old.twd_cost,
      old.twd_price, old.price_mode, old.compare_at_price,
      old.inventory_quantity, old.inventory_policy, old.sku, old.sale_status,
      old.variant_dimensions, old.video_urls, old.generated_payload_json
    )
  then
    new.shopify_sync_status := 'dirty';
    new.shopify_sync_error := null;
  end if;
  return new;
end
$$;

drop trigger if exists mark_linked_product_draft_dirty on public.product_drafts;
create trigger mark_linked_product_draft_dirty
before update on public.product_drafts
for each row execute function public.mark_linked_product_draft_dirty();

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

drop trigger if exists mark_linked_product_variant_dirty on public.product_variants;
create trigger mark_linked_product_variant_dirty
after insert or update or delete on public.product_variants
for each row execute function public.mark_linked_product_child_dirty();

drop trigger if exists mark_linked_product_image_dirty on public.product_images;
create trigger mark_linked_product_image_dirty
after insert or update or delete on public.product_images
for each row execute function public.mark_linked_product_child_dirty();

alter table public.shopify_sync_jobs enable row level security;

drop policy if exists "team can read shopify sync jobs" on public.shopify_sync_jobs;
create policy "team can read shopify sync jobs"
on public.shopify_sync_jobs for select
using (
  public.is_reviewer()
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id and d.created_by = auth.uid()
  )
);

grant select on public.shopify_sync_jobs to authenticated;
grant all privileges on public.shopify_sync_jobs to service_role;

revoke all on function public.mark_linked_product_draft_dirty() from public;
revoke all on function public.mark_linked_product_child_dirty() from public;

commit;
