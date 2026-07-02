-- Nestory v0.2 team settings table.
-- Apply after 005 in Supabase SQL Editor.
-- Holds adjustable operator-facing config (e.g. the "銅板價" tag threshold,
-- future workflow provider selection). Not wired to Make/n8n yet -- UI + storage only.

create table if not exists public.team_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

drop trigger if exists team_settings_set_updated_at on public.team_settings;
create trigger team_settings_set_updated_at
before update on public.team_settings
for each row execute function public.set_updated_at();

alter table public.team_settings enable row level security;

drop policy if exists team_settings_read on public.team_settings;
create policy team_settings_read
on public.team_settings for select
to authenticated
using (true);

drop policy if exists team_settings_write_admin on public.team_settings;
create policy team_settings_write_admin
on public.team_settings for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.team_settings to authenticated;
grant insert, update, delete on public.team_settings to authenticated;
grant all privileges on public.team_settings to service_role;

insert into public.team_settings (key, value)
values ('low_price_tag_threshold', '{"amount_twd": 300}'::jsonb)
on conflict (key) do nothing;
