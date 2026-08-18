-- B14: image send batches — data foundation for Phase D pipeline + 【自動·二】 notifications.
-- Apply after 024 in Supabase SQL Editor. SQL only — do not run CLI.
--
-- When the operator presses ▶ 送圖 / 批次送圖 and every pipeline image is marked,
-- create one image_batches row + image_batch_items, and point product_drafts.current_image_batch_id.
-- Pipeline is still Phase D: status stays queued; image_status / draft.status are NOT changed (2A).

-- ---------------------------------------------------------------------------
-- 1) Header table
-- ---------------------------------------------------------------------------
create table if not exists public.image_batches (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'image_process'
    constraint image_batches_kind_check
      check (kind in ('image_process')),
  status text not null default 'queued'
    constraint image_batches_status_check
      check (status in (
        'queued',
        'processing',
        'completed',
        'partial_failed',
        'failed',
        'stuck'
      )),
  total_count integer not null default 0
    check (total_count >= 0),
  done_count integer not null default 0
    check (done_count >= 0),
  failed_count integer not null default 0
    check (failed_count >= 0),
  -- 4A: drafts with ≥1 process_intent = regenerate (not raw image count)
  regenerate_item_count integer not null default 0
    check (regenerate_item_count >= 0),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  -- D6: set when batch-done notify was sent (idempotent)
  notify_sent_at timestamptz,
  -- Cron stuck reminder (idempotent)
  stuck_notified_at timestamptz,
  error_summary text,
  -- Lightweight snapshot at create time: per-draft process_intent summary.
  -- Phase D webhook must use this, not live product_images (marks may drift).
  snapshot_json jsonb not null default '[]'::jsonb
);

comment on table public.image_batches is
  'B14: one row per 送圖 batch; Phase D pipeline + batch-complete notifications.';

comment on column public.image_batches.kind is
  'B14: only image_process for now; publish batches stay separate.';

comment on column public.image_batches.status is
  'queued at create (B14); Phase D moves processing → completed|partial_failed|failed|stuck.';

comment on column public.image_batches.regenerate_item_count is
  '4A: number of drafts in batch with at least one regenerate mark.';

comment on column public.image_batches.snapshot_json is
  'B14: create-time per-draft process_intent summary for Make webhook; ignore live mark drift.';

comment on column public.image_batches.notify_sent_at is
  'D6: when batch-done email/LINE was sent; null until notified.';

comment on column public.image_batches.stuck_notified_at is
  'Cron: when stuck-batch reminder was sent; null until reminded.';

create index if not exists image_batches_status_created_at_idx
  on public.image_batches (status, created_at desc);

create index if not exists image_batches_created_by_idx
  on public.image_batches (created_by, created_at desc);

create index if not exists image_batches_stuck_scan_idx
  on public.image_batches (status, updated_at)
  where status in ('queued', 'processing');

-- ---------------------------------------------------------------------------
-- 2) Membership table
-- ---------------------------------------------------------------------------
create table if not exists public.image_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.image_batches(id) on delete cascade,
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  item_status text not null default 'queued'
    constraint image_batch_items_status_check
      check (item_status in (
        'queued',
        'processing',
        'done',
        'failed',
        'skipped'
      )),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (batch_id, draft_id)
);

comment on table public.image_batch_items is
  'B14: drafts belonging to an image send batch; per-item terminal states feed batch notify.';

comment on column public.image_batch_items.item_status is
  'queued at create; Phase D updates. 3A simplified: old queued rows are not auto-skipped on re-send.';

create index if not exists image_batch_items_batch_id_idx
  on public.image_batch_items (batch_id);

create index if not exists image_batch_items_draft_id_idx
  on public.image_batch_items (draft_id);

create index if not exists image_batch_items_status_idx
  on public.image_batch_items (batch_id, item_status);

-- ---------------------------------------------------------------------------
-- 3) Draft pointer to latest batch (history remains in image_batch_items)
-- ---------------------------------------------------------------------------
alter table public.product_drafts
  add column if not exists current_image_batch_id uuid
    references public.image_batches(id) on delete set null;

comment on column public.product_drafts.current_image_batch_id is
  'B14: latest image send batch for this draft; re-send (3A) updates pointer only.';

create index if not exists product_drafts_current_image_batch_id_idx
  on public.product_drafts (current_image_batch_id)
  where current_image_batch_id is not null;

-- ---------------------------------------------------------------------------
-- 4) updated_at helper for image_batches
-- ---------------------------------------------------------------------------
create or replace function public.touch_image_batches_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists image_batches_touch_updated_at on public.image_batches;
create trigger image_batches_touch_updated_at
  before update on public.image_batches
  for each row
  execute function public.touch_image_batches_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RLS
-- ---------------------------------------------------------------------------
alter table public.image_batches enable row level security;
alter table public.image_batch_items enable row level security;

-- Read: admin/reviewer all; operator own batches or batches containing own drafts
drop policy if exists "team can read image batches" on public.image_batches;
create policy "team can read image batches"
on public.image_batches for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or created_by = auth.uid()
  or exists (
    select 1
    from public.image_batch_items i
    join public.product_drafts d on d.id = i.draft_id
    where i.batch_id = image_batches.id
      and d.created_by = auth.uid()
  )
);

-- Insert: operators create batches (API typically uses service_role; this covers direct client if any)
drop policy if exists "operators can insert image batches" on public.image_batches;
create policy "operators can insert image batches"
on public.image_batches for insert
with check (
  public.current_user_role() in ('admin', 'operator', 'reviewer')
  and (created_by is null or created_by = auth.uid())
);

-- Updates of status counters are server/worker (service_role bypasses RLS).
-- Allow creator to touch nothing critical via client — no general update policy for operators.

drop policy if exists "team can read image batch items" on public.image_batch_items;
create policy "team can read image batch items"
on public.image_batch_items for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or exists (
    select 1 from public.image_batches b
    where b.id = batch_id and b.created_by = auth.uid()
  )
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id and d.created_by = auth.uid()
  )
);

drop policy if exists "operators can insert image batch items" on public.image_batch_items;
create policy "operators can insert image batch items"
on public.image_batch_items for insert
with check (
  public.current_user_role() in ('admin', 'operator', 'reviewer')
  and exists (
    select 1 from public.image_batches b
    where b.id = batch_id
      and (b.created_by = auth.uid() or public.current_user_role() in ('admin', 'reviewer'))
  )
);

-- ---------------------------------------------------------------------------
-- 6) Grants (mirror 003 style)
-- ---------------------------------------------------------------------------
grant select, insert on public.image_batches to authenticated;
grant select, insert on public.image_batch_items to authenticated;
grant all privileges on public.image_batches to service_role;
grant all privileges on public.image_batch_items to service_role;

-- draft column already covered by product_drafts update grants
