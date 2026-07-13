-- C2 A-lite: System Prompt version table skeleton (optional, do NOT require for C2 acceptance).
-- UI shows「待 SQL／待接線」and does not read this table yet.
-- generate() continues to use in-code / env prompts until a later package wires this up.
--
-- Safe to run later in Supabase SQL Editor; C2 never depends on it being applied.

create table if not exists public.system_prompt_versions (
  id uuid primary key default gen_random_uuid(),
  version_number integer not null,
  body text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  note text
);

create unique index if not exists system_prompt_versions_version_number_uidx
  on public.system_prompt_versions (version_number);

comment on table public.system_prompt_versions is
  'C2 skeleton: Admin-edited copy system prompt history. Not wired to /api/generate yet.';

-- team_settings pointer to active version (optional)
insert into public.team_settings (key, value)
values (
  'system_prompt_active_version',
  '{"version_number": null, "note": "C2 placeholder — generate still uses code defaults"}'::jsonb
)
on conflict (key) do nothing;

-- RLS: admin write, authenticated read (align with team_settings spirit)
alter table public.system_prompt_versions enable row level security;

drop policy if exists system_prompt_versions_select_authenticated on public.system_prompt_versions;
create policy system_prompt_versions_select_authenticated
  on public.system_prompt_versions
  for select
  to authenticated
  using (true);

drop policy if exists system_prompt_versions_admin_write on public.system_prompt_versions;
create policy system_prompt_versions_admin_write
  on public.system_prompt_versions
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.system_prompt_versions to authenticated;
grant insert, update, delete on public.system_prompt_versions to authenticated;
