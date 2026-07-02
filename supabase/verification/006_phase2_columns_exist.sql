-- Nestory v0.2 verification: Phase 2 columns/tables exist.
-- Run in Supabase SQL Editor after 005, 006, and 007 migrations.
-- This returns booleans only and does not print row data or secrets.

select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_drafts' and column_name = 'sale_status'
  ) as sale_status_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_drafts' and column_name = 'image_status'
  ) as image_status_exists,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_drafts' and column_name = 'is_secondhand'
  ) as is_secondhand_exists,
  to_regclass('public.team_settings') is not null as team_settings_exists,
  to_regclass('public.generation_history') is not null as generation_history_exists;
