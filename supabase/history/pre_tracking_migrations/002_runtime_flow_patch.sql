-- Nestory Listing Admin v0.1 runtime flow patch
-- Apply in Supabase SQL Editor after 001 if the initial migration was already run.
-- This is intentionally idempotent: it adds missing runtime columns, refreshes
-- worker/requeue functions, and forces the product-images bucket to public-read.

alter table public.product_drafts
  add column if not exists source_url text,
  add column if not exists worker_id text,
  add column if not exists worker_locked_at timestamptz,
  add column if not exists worker_lock_expires_at timestamptz,
  add column if not exists worker_attempts integer not null default 0 check (worker_attempts >= 0),
  add column if not exists max_worker_attempts integer not null default 3 check (max_worker_attempts > 0),
  add column if not exists next_retry_at timestamptz,
  add column if not exists shopify_handle text,
  add column if not exists shopify_tags text[] not null default '{}',
  add column if not exists shopify_collections text[] not null default '{}',
  add column if not exists metafields_json jsonb not null default '{}'::jsonb,
  add column if not exists generated_payload_json jsonb not null default '{}'::jsonb,
  add column if not exists shopify_payload_preview jsonb not null default '{}'::jsonb;

alter table public.generation_runs
  add column if not exists worker_id text;

alter table public.review_logs
  add column if not exists draft_id uuid references public.product_drafts(id) on delete cascade;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = true,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public can read product images" on storage.objects;
create policy "public can read product images"
on storage.objects for select
to public
using (bucket_id = 'product-images');

drop function if exists public.claim_pending_generation(integer, text);
create or replace function public.claim_pending_generation(
  batch_limit integer default 5,
  rule_version text default 'chochonest-copywriter@manual-dev',
  p_worker_id text default 'codex-worker'
)
returns setof public.product_drafts
security definer
set search_path = public
language plpgsql
as $claim_pending_generation$
begin
  return query
  with candidates as (
    select id
    from public.product_drafts
    where status = 'pending_copy'
      and generation_status = 'pending'
      and worker_attempts < max_worker_attempts
      and (next_retry_at is null or next_retry_at <= now())
      and (worker_lock_expires_at is null or worker_lock_expires_at <= now())
    order by created_at asc
    limit least(greatest(batch_limit, 1), 10)
    for update skip locked
  ),
  updated as (
    update public.product_drafts d
    set
      status = 'processing',
      generation_status = 'processing',
      generation_rule_version = rule_version,
      worker_id = p_worker_id,
      worker_locked_at = now(),
      worker_lock_expires_at = now() + interval '15 minutes',
      worker_attempts = worker_attempts + 1,
      generation_error = null
    from candidates
    where d.id = candidates.id
    returning d.*
  )
  select * from updated;
end;
$claim_pending_generation$;

revoke all on function public.claim_pending_generation(integer, text, text) from public;
revoke all on function public.claim_pending_generation(integer, text, text) from anon;
revoke all on function public.claim_pending_generation(integer, text, text) from authenticated;
grant execute on function public.claim_pending_generation(integer, text, text) to service_role;

drop function if exists public.requeue_revision_for_generation(uuid, text);
create or replace function public.requeue_revision_for_generation(
  target_draft_id uuid,
  requeue_comment text default null
)
returns public.product_drafts
security definer
set search_path = public
language plpgsql
as $requeue_revision_for_generation$
declare
  updated_draft public.product_drafts;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required.';
  end if;

  if not exists (
    select 1
    from public.product_drafts d
    where d.id = target_draft_id
      and (public.is_reviewer() or d.created_by = auth.uid())
  ) then
    raise exception 'Draft not found or not allowed.';
  end if;

  update public.product_drafts
  set
    status = 'pending_copy',
    generation_status = 'pending',
    generation_error = null,
    error_message = null,
    worker_id = null,
    worker_locked_at = null,
    worker_lock_expires_at = null,
    next_retry_at = null
  where id = target_draft_id
    and status = 'needs_revision'
  returning * into updated_draft;

  if updated_draft.id is null then
    raise exception 'Draft must be in needs_revision status before requeue.';
  end if;

  insert into public.review_logs (draft_id, action, reviewer, comment)
  values (target_draft_id, 'requeued_pending_copy', auth.uid(), requeue_comment);

  return updated_draft;
end;
$requeue_revision_for_generation$;

revoke all on function public.requeue_revision_for_generation(uuid, text) from public;
revoke all on function public.requeue_revision_for_generation(uuid, text) from anon;
grant execute on function public.requeue_revision_for_generation(uuid, text) to authenticated;
