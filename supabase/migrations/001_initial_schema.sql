-- Nestory Listing Admin v0.1
-- Apply this in Supabase SQL Editor. It creates the queue, review, generation,
-- publish fallback, RLS, and storage foundation.

create extension if not exists pgcrypto;

create type public.user_role as enum ('admin', 'operator', 'reviewer');

create type public.draft_status as enum (
  'pending_input',
  'pending_copy',
  'processing',
  'ready_for_review',
  'needs_revision',
  'approved',
  'publishing',
  'active_published',
  'draft_created',
  'api_failed',
  'csv_ready',
  'failed',
  'archived'
);

create type public.generation_mode as enum ('codex_skill', 'api_llm', 'manual');
create type public.generation_provider as enum ('codex', 'openai', 'anthropic', 'other');
create type public.generation_status as enum ('pending', 'processing', 'completed', 'failed');
create type public.publish_mode as enum ('active', 'draft');
create type public.publish_method as enum ('shopify_api', 'matrixify_csv', 'manual');
create type public.publish_status as enum (
  'pending',
  'publishing',
  'active_published',
  'draft_created',
  'api_failed',
  'csv_ready',
  'failed'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text,
  role public.user_role not null default 'operator',
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'name', new.email),
    'operator'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

create table public.product_drafts (
  id uuid primary key default gen_random_uuid(),
  source_type text not null default 'manual',
  taobao_url text,
  taobao_title text,
  original_title text,
  cny_price numeric(12,2) not null check (cny_price > 0),
  twd_cost integer,
  twd_price integer,
  pricing_formula jsonb not null default '{}'::jsonb,
  category text,
  vendor text not null default 'CHOCHONEST',
  product_type text,
  title_zh text,
  description_html text,
  description_plain text,
  seo_title text,
  seo_description text,
  tags text[] not null default '{}',
  collection_suggestion text,
  note text,
  spec_text text,
  warnings text[] not null default '{}',
  status public.draft_status not null default 'pending_copy',
  generation_mode public.generation_mode not null default 'codex_skill',
  generation_provider public.generation_provider not null default 'codex',
  generation_status public.generation_status not null default 'pending',
  generation_rule_version text,
  generation_model text,
  generation_cost_estimate numeric(12,4),
  generation_error text,
  publish_mode public.publish_mode not null default 'active',
  publish_method public.publish_method not null default 'shopify_api',
  publish_status public.publish_status not null default 'pending',
  shopify_product_id text,
  shopify_admin_url text,
  error_message text,
  created_by uuid references public.profiles(id),
  reviewed_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_images (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  image_type text not null check (image_type in ('main', 'detail', 'spec', 'generated_detail', 'variant')),
  original_file_url text,
  processed_file_url text,
  generated_file_url text,
  alt_text text,
  sort_order integer not null default 0,
  ocr_text text,
  translated_text text,
  processing_status text not null default 'uploaded',
  processing_error text,
  created_at timestamptz not null default now()
);

create table public.product_variants (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  option1_name text default '款式',
  option1_value text default 'Default Title',
  option2_name text,
  option2_value text,
  option3_name text,
  option3_value text,
  sku text,
  cny_price numeric(12,2),
  twd_price integer,
  inventory_quantity integer not null default 0,
  inventory_policy text not null default 'deny' check (inventory_policy in ('deny', 'continue')),
  image_id uuid references public.product_images(id),
  created_at timestamptz not null default now()
);

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  mode public.generation_mode not null,
  provider public.generation_provider not null,
  rule_version text,
  model text,
  status public.generation_status not null default 'pending',
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  cost_estimate numeric(12,4),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.publish_jobs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  publish_mode public.publish_mode not null,
  publish_method public.publish_method not null,
  publish_status public.publish_status not null default 'pending',
  request_payload jsonb not null default '{}'::jsonb,
  response_payload jsonb not null default '{}'::jsonb,
  csv_file_url text,
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table public.automation_logs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.product_drafts(id) on delete cascade,
  action text not null,
  status text not null,
  message text,
  raw_payload jsonb,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.review_logs (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  action text not null,
  reviewer uuid references public.profiles(id),
  comment text,
  created_at timestamptz not null default now()
);

create index product_drafts_status_idx on public.product_drafts(status, generation_status, created_at);
create index product_images_draft_idx on public.product_images(draft_id, image_type, sort_order);
create index generation_runs_draft_idx on public.generation_runs(draft_id, created_at desc);
create index publish_jobs_draft_idx on public.publish_jobs(draft_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger product_drafts_set_updated_at
before update on public.product_drafts
for each row execute function public.set_updated_at();

create or replace function public.guard_sensitive_product_draft_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role public.user_role;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  select public.current_user_role() into role;

  if role in ('admin', 'reviewer') then
    return new;
  end if;

  if new.status is distinct from old.status
    and new.status not in ('pending_input', 'pending_copy', 'needs_revision', 'archived')
  then
    raise exception 'Only reviewers, admins, or server-side workers can move drafts into generation, review, or publish states.';
  end if;

  if new.generation_status is distinct from old.generation_status
    or new.generation_rule_version is distinct from old.generation_rule_version
    or new.generation_model is distinct from old.generation_model
    or new.generation_cost_estimate is distinct from old.generation_cost_estimate
    or new.generation_error is distinct from old.generation_error
    or new.publish_mode is distinct from old.publish_mode
    or new.publish_status is distinct from old.publish_status
    or new.publish_method is distinct from old.publish_method
    or new.shopify_product_id is distinct from old.shopify_product_id
    or new.shopify_admin_url is distinct from old.shopify_admin_url
    or new.error_message is distinct from old.error_message
    or new.reviewed_by is distinct from old.reviewed_by
  then
    raise exception 'Only reviewers, admins, or server-side workers can update generation/publish system fields.';
  end if;

  return new;
end;
$$;

create trigger product_drafts_guard_sensitive_fields
before update on public.product_drafts
for each row execute function public.guard_sensitive_product_draft_fields();

create or replace function public.claim_pending_generation(
  batch_limit integer default 5,
  rule_version text default 'chochonest-copywriter@manual-dev'
)
returns setof public.product_drafts
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select id
    from public.product_drafts
    where status = 'pending_copy'
      and generation_status = 'pending'
    order by created_at asc
    limit least(greatest(batch_limit, 1), 10)
    for update skip locked
  ),
  updated as (
    update public.product_drafts d
    set
      status = 'processing',
      generation_status = 'processing',
      generation_rule_version = rule_version
    from candidates
    where d.id = candidates.id
    returning d.*
  )
  select * from updated;
end;
$$;

revoke all on function public.claim_pending_generation(integer, text) from public;
revoke all on function public.claim_pending_generation(integer, text) from anon;
revoke all on function public.claim_pending_generation(integer, text) from authenticated;
grant execute on function public.claim_pending_generation(integer, text) to service_role;

create or replace function public.current_user_role()
returns public.user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() = 'admin', false)
$$;

create or replace function public.is_reviewer()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.current_user_role() in ('admin', 'reviewer'), false)
$$;

alter table public.profiles enable row level security;
alter table public.product_drafts enable row level security;
alter table public.product_images enable row level security;
alter table public.product_variants enable row level security;
alter table public.generation_runs enable row level security;
alter table public.publish_jobs enable row level security;
alter table public.automation_logs enable row level security;
alter table public.review_logs enable row level security;

create policy "profiles can read self and admins read all"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "admins manage profiles"
on public.profiles for all
using (public.is_admin())
with check (public.is_admin());

create policy "team can read product drafts"
on public.product_drafts for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or created_by = auth.uid()
);

create policy "operators can insert drafts"
on public.product_drafts for insert
with check (
  created_by = auth.uid()
  and public.current_user_role() in ('admin', 'operator', 'reviewer')
);

create policy "operators update own unpublished drafts"
on public.product_drafts for update
using (
  public.is_admin()
  or public.is_reviewer()
  or (
    created_by = auth.uid()
    and status in ('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review')
  )
)
with check (
  public.is_admin()
  or public.is_reviewer()
  or (
    created_by = auth.uid()
    and status in ('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review')
  )
);

create policy "team can read product images"
on public.product_images for select
using (
  exists (
    select 1 from public.product_drafts d
    where d.id = draft_id
    and (public.current_user_role() in ('admin', 'reviewer') or d.created_by = auth.uid())
  )
);

create policy "operators can insert product images for own drafts"
on public.product_images for insert
with check (
  exists (
    select 1 from public.product_drafts d
    where d.id = draft_id
    and (
      public.is_admin()
      or public.is_reviewer()
      or (
        d.created_by = auth.uid()
        and d.status in ('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review')
      )
    )
  )
);

create policy "reviewers can update product images"
on public.product_images for update
using (
  public.is_reviewer()
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id
    and d.created_by = auth.uid()
    and d.status in ('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review')
  )
)
with check (
  public.is_reviewer()
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id
    and d.created_by = auth.uid()
    and d.status in ('pending_input', 'pending_copy', 'needs_revision', 'ready_for_review')
  )
);

create policy "team can read variants"
on public.product_variants for select
using (
  exists (
    select 1 from public.product_drafts d
    where d.id = draft_id
    and (public.current_user_role() in ('admin', 'reviewer') or d.created_by = auth.uid())
  )
);

create policy "team can manage variants before publish"
on public.product_variants for all
using (
  public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
)
with check (
  public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

create policy "team can read generation runs"
on public.generation_runs for select
using (
  public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

create policy "team can read publish jobs"
on public.publish_jobs for select
using (
  public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

create policy "team can read automation logs"
on public.automation_logs for select
using (
  public.is_reviewer()
  or draft_id is null
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

create policy "team can read review logs"
on public.review_logs for select
using (
  public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'product-images',
  'product-images',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do nothing;

create policy "authenticated users can upload product images"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "authenticated users can read product images"
on storage.objects for select
to authenticated
using (bucket_id = 'product-images');

create policy "owners can update own product image objects"
on storage.objects for update
to authenticated
using (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'product-images'
  and (storage.foldername(name))[1] = auth.uid()::text
);
