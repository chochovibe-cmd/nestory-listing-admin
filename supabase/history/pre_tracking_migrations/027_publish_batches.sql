-- D7-open: publish batches — rate-limited batch publish ledger + C5 records skeleton.
-- Apply after 026 in Supabase SQL Editor. SQL only — do not run CLI.
--
-- Separate from image_batches (025). One row per 批次發布 / 單件發布 (Q4-A).
-- notify_sent_at reserved for event #2 (not wired this package).

-- ---------------------------------------------------------------------------
-- 1) Header table
-- ---------------------------------------------------------------------------
create table if not exists public.publish_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'shopify_api'
    constraint publish_batches_kind_check
      check (kind in ('shopify_api')),
  status text not null default 'queued'
    constraint publish_batches_status_check
      check (status in (
        'queued',
        'processing',
        'completed',
        'partial_failed',
        'failed'
      )),
  publish_mode text not null default 'draft'
    constraint publish_batches_publish_mode_check
      check (publish_mode in ('draft', 'active')),
  total_count integer not null default 0
    check (total_count >= 0),
  done_count integer not null default 0
    check (done_count >= 0),
  failed_count integer not null default 0
    check (failed_count >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  -- Event #2 hook only (D7-open does not send notify)
  notify_sent_at timestamptz,
  error_summary text,
  -- Create-time draftId + title snapshot
  snapshot_json jsonb not null default '[]'::jsonb
);

comment on table public.publish_batches is
  'D7: one row per Shopify publish batch (single or multi); C5 records page source.';

comment on column public.publish_batches.kind is
  'D7-open: only shopify_api; Showmore/Matrixify kinds later (D8).';

comment on column public.publish_batches.status is
  'processing during run; always terminal completed|partial_failed|failed after runPublishBatch (Q2-A).';

comment on column public.publish_batches.notify_sent_at is
  'Reserved for notify event #2 publish_batch_done; null until wired.';

comment on column public.publish_batches.snapshot_json is
  'Create-time [{ draftId, title }] for records UI and Make payload.';

create index if not exists publish_batches_status_created_at_idx
  on public.publish_batches (status, created_at desc);

create index if not exists publish_batches_created_by_idx
  on public.publish_batches (created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Membership table
-- ---------------------------------------------------------------------------
create table if not exists public.publish_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.publish_batches(id) on delete cascade,
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  item_status text not null default 'queued'
    constraint publish_batch_items_status_check
      check (item_status in (
        'queued',
        'processing',
        'done',
        'failed',
        'skipped'
      )),
  error_message text,
  shopify_product_id text,
  shopify_admin_url text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (batch_id, draft_id)
);

comment on table public.publish_batch_items is
  'D7: per-draft outcomes in a publish batch; skipped = time_budget or pre-check.';

comment on column public.publish_batch_items.item_status is
  'done|failed|skipped terminal; time_budget uses skipped + error_message.';

create index if not exists publish_batch_items_batch_id_idx
  on public.publish_batch_items (batch_id);

create index if not exists publish_batch_items_draft_id_idx
  on public.publish_batch_items (draft_id);

create index if not exists publish_batch_items_status_idx
  on public.publish_batch_items (batch_id, item_status);

-- ---------------------------------------------------------------------------
-- 3) Draft pointer to latest publish batch
-- ---------------------------------------------------------------------------
alter table public.product_drafts
  add column if not exists current_publish_batch_id uuid
    references public.publish_batches(id) on delete set null;

comment on column public.product_drafts.current_publish_batch_id is
  'D7: latest publish batch for this draft; re-run failed (Q3 A-lite) updates pointer only.';

create index if not exists product_drafts_current_publish_batch_id_idx
  on public.product_drafts (current_publish_batch_id)
  where current_publish_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 4) updated_at helper
-- ---------------------------------------------------------------------------
create or replace function public.touch_publish_batches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists publish_batches_touch_updated_at on public.publish_batches;
create trigger publish_batches_touch_updated_at
  before update on public.publish_batches
  for each row
  execute function public.touch_publish_batches_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RLS (mirror 025 image_batches spirit)
-- ---------------------------------------------------------------------------
alter table public.publish_batches enable row level security;
alter table public.publish_batch_items enable row level security;

drop policy if exists "team can read publish batches" on public.publish_batches;
create policy "team can read publish batches"
on public.publish_batches for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or created_by = auth.uid()
  or exists (
    select 1
    from public.publish_batch_items i
    join public.product_drafts d on d.id = i.draft_id
    where i.batch_id = publish_batches.id
      and d.created_by = auth.uid()
  )
);

-- Writes go through service_role in runPublishBatch; optional insert for parity
drop policy if exists "publishers can insert publish batches" on public.publish_batches;
create policy "publishers can insert publish batches"
on public.publish_batches for insert
with check (
  public.current_user_role() in ('admin', 'reviewer')
  and (created_by is null or created_by = auth.uid())
);

drop policy if exists "team can read publish batch items" on public.publish_batch_items;
create policy "team can read publish batch items"
on public.publish_batch_items for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or exists (
    select 1 from public.publish_batches b
    where b.id = batch_id and b.created_by = auth.uid()
  )
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id and d.created_by = auth.uid()
  )
);

drop policy if exists "publishers can insert publish batch items" on public.publish_batch_items;
create policy "publishers can insert publish batch items"
on public.publish_batch_items for insert
with check (
  public.current_user_role() in ('admin', 'reviewer')
  and exists (
    select 1 from public.publish_batches b
    where b.id = batch_id
      and (b.created_by = auth.uid() or public.current_user_role() in ('admin', 'reviewer'))
  )
);

-- ---------------------------------------------------------------------------
-- 6) Grants
-- ---------------------------------------------------------------------------
grant select, insert on public.publish_batches to authenticated;
grant select, insert on public.publish_batch_items to authenticated;
grant all privileges on public.publish_batches to service_role;
grant all privileges on public.publish_batch_items to service_role;
