-- Nestory scheduled publishing core
-- Production ledger truth (read-only verified 2026-10-07): applied as 20261006121816 publish_schedule_core.
-- Source filename is aligned to the hosted ledger; do not replay this migration to Production.

create table if not exists public.publish_schedule_groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references auth.users(id) on delete set null,
  start_date date not null,
  daily_limit integer not null check (daily_limit between 1 and 200),
  timezone text not null default 'Asia/Taipei',
  active_weekdays smallint[] not null default '{0,1,2,3,4,5,6}',
  status text not null default 'active'
    check (status in ('active','paused','completed','canceled')),
  total_count integer not null default 0 check (total_count >= 0),
  completed_count integer not null default 0 check (completed_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.publish_schedule_items (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.publish_schedule_groups(id) on delete cascade,
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  scheduled_for date not null,
  position integer not null check (position >= 1),
  status text not null default 'queued'
    check (status in ('queued','claimed','blocked','completed','failed','canceled')),
  claimed_at timestamptz,
  completed_at timestamptz,
  error_message text,
  publish_batch_id uuid references public.publish_batches(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_publish_schedule_items_due
  on public.publish_schedule_items (scheduled_for, position)
  where status = 'queued';

create index if not exists idx_publish_schedule_items_group
  on public.publish_schedule_items (group_id, scheduled_for, position);

create unique index if not exists uq_publish_schedule_active_draft
  on public.publish_schedule_items (draft_id)
  where status in ('queued','claimed','blocked');

alter table public.publish_schedule_groups enable row level security;
alter table public.publish_schedule_items enable row level security;

-- Schedule mutation/read goes through authenticated server routes using the service client.
-- No broad authenticated-table policies are added here.

create or replace function public.claim_due_publish_schedule_items(
  p_due_date date,
  p_limit integer default 20
)
returns table (
  id uuid,
  group_id uuid,
  draft_id uuid,
  scheduled_for date,
  queue_position integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with picked as (
    select psi.id
    from public.publish_schedule_items psi
    join public.publish_schedule_groups psg on psg.id = psi.group_id
    where psi.status = 'queued'
      and psg.status = 'active'
      and psi.scheduled_for <= p_due_date
    order by psi.scheduled_for asc, psi.position asc
    for update of psi skip locked
    limit greatest(1, least(coalesce(p_limit, 20), 200))
  ),
  claimed as (
    update public.publish_schedule_items psi
    set
      status = 'claimed',
      claimed_at = now(),
      updated_at = now()
    from picked
    where psi.id = picked.id
    returning psi.id, psi.group_id, psi.draft_id, psi.scheduled_for, psi.position
  )
  select c.id, c.group_id, c.draft_id, c.scheduled_for, c.position as queue_position
  from claimed c
  order by c.scheduled_for asc, c.position asc;
end;
$$;

revoke all on function public.claim_due_publish_schedule_items(date, integer) from public, anon, authenticated;
grant execute on function public.claim_due_publish_schedule_items(date, integer) to service_role;
