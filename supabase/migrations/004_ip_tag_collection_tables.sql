-- Nestory v0.2 IP, tag, and collection rule tables.
-- Apply this after 001-003 in Supabase SQL Editor.
-- This file only adds reusable rule/catalog tables and does not alter draft,
-- worker, AI, Shopify, or image pipeline behavior.

create extension if not exists pgcrypto;

create table if not exists public.ip_catalog (
  id uuid primary key default gen_random_uuid(),
  ip_name text not null,
  aliases text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ip_catalog_ip_name_unique unique (ip_name)
);

create table if not exists public.ip_characters (
  id uuid primary key default gen_random_uuid(),
  ip_name text not null
    references public.ip_catalog (ip_name)
    on update cascade on delete restrict,
  character_name text not null,
  aliases text[] not null default '{}'::text[],
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ip_characters_ip_name_character_name_unique
    unique (ip_name, character_name)
);

create table if not exists public.tag_rules (
  id uuid primary key default gen_random_uuid(),
  rule_group text not null,
  label text not null,
  tag_value text not null,
  is_secondhand boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tag_rules_rule_group_check
    check (rule_group in ('IP','角色','類型','情境','狀態','推薦','商品屬性','等級')),
  constraint tag_rules_unique_tag_value unique (tag_value)
);

create table if not exists public.collection_rules (
  id uuid primary key default gen_random_uuid(),
  tag_value text not null,
  collection_name text not null,
  collection_handle text not null,
  collection_url text,
  is_secondhand boolean not null default false,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint collection_rules_unique_tag_collection
    unique (tag_value, collection_handle)
);

create index if not exists ip_catalog_active_sort_index
  on public.ip_catalog (is_active, sort_order, ip_name);

create index if not exists ip_characters_ip_active_sort_index
  on public.ip_characters (ip_name, is_active, sort_order, character_name);

create index if not exists tag_rules_active_group_sort_index
  on public.tag_rules (is_active, rule_group, sort_order, label);

create index if not exists collection_rules_active_tag_sort_index
  on public.collection_rules (is_active, tag_value, sort_order, collection_name);

drop trigger if exists ip_catalog_set_updated_at on public.ip_catalog;
create trigger ip_catalog_set_updated_at
before update on public.ip_catalog
for each row execute function public.set_updated_at();

drop trigger if exists ip_characters_set_updated_at on public.ip_characters;
create trigger ip_characters_set_updated_at
before update on public.ip_characters
for each row execute function public.set_updated_at();

drop trigger if exists tag_rules_set_updated_at on public.tag_rules;
create trigger tag_rules_set_updated_at
before update on public.tag_rules
for each row execute function public.set_updated_at();

drop trigger if exists collection_rules_set_updated_at on public.collection_rules;
create trigger collection_rules_set_updated_at
before update on public.collection_rules
for each row execute function public.set_updated_at();

alter table public.ip_catalog enable row level security;
alter table public.ip_characters enable row level security;
alter table public.tag_rules enable row level security;
alter table public.collection_rules enable row level security;

drop policy if exists ip_catalog_select_authenticated on public.ip_catalog;
create policy ip_catalog_select_authenticated
on public.ip_catalog
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists ip_catalog_write_admin on public.ip_catalog;
create policy ip_catalog_write_admin
on public.ip_catalog
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists ip_characters_select_authenticated on public.ip_characters;
create policy ip_characters_select_authenticated
on public.ip_characters
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists ip_characters_write_admin on public.ip_characters;
create policy ip_characters_write_admin
on public.ip_characters
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists tag_rules_select_authenticated on public.tag_rules;
create policy tag_rules_select_authenticated
on public.tag_rules
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists tag_rules_write_admin on public.tag_rules;
create policy tag_rules_write_admin
on public.tag_rules
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists collection_rules_select_authenticated on public.collection_rules;
create policy collection_rules_select_authenticated
on public.collection_rules
for select
to authenticated
using (is_active = true or public.is_admin());

drop policy if exists collection_rules_write_admin on public.collection_rules;
create policy collection_rules_write_admin
on public.collection_rules
for all
to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select on public.ip_catalog to authenticated;
grant select on public.ip_characters to authenticated;
grant select on public.tag_rules to authenticated;
grant select on public.collection_rules to authenticated;

grant insert, update, delete on public.ip_catalog to authenticated;
grant insert, update, delete on public.ip_characters to authenticated;
grant insert, update, delete on public.tag_rules to authenticated;
grant insert, update, delete on public.collection_rules to authenticated;

grant all privileges on public.ip_catalog to service_role;
grant all privileges on public.ip_characters to service_role;
grant all privileges on public.tag_rules to service_role;
grant all privileges on public.collection_rules to service_role;
