-- Nestory v0.2 generation history table.
-- Apply after 006 in Supabase SQL Editor.
-- Append-only snapshot of each copy field's generated content, used for the
-- per-field version back/forward UI (see docs supplement §4-16).

create table if not exists public.generation_history (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.product_drafts(id) on delete cascade,
  field_name text not null,
  content text not null,
  provider text,
  model text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists generation_history_draft_field_idx
  on public.generation_history (draft_id, field_name, created_at desc);

alter table public.generation_history enable row level security;

drop policy if exists "team can read generation history" on public.generation_history;
create policy "team can read generation history"
on public.generation_history for select
using (
  public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

drop policy if exists "operators can insert generation history for own drafts" on public.generation_history;
create policy "operators can insert generation history for own drafts"
on public.generation_history for insert
with check (
  public.is_admin()
  or public.is_reviewer()
  or exists (select 1 from public.product_drafts d where d.id = draft_id and d.created_by = auth.uid())
);

grant select, insert on public.generation_history to authenticated;
grant all privileges on public.generation_history to service_role;
