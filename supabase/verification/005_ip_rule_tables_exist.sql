-- Nestory v0.2 verification: required IP/tag/collection tables exist.
-- Run in Supabase SQL Editor after 004 and both seed files.
-- This returns booleans only and does not print row data or secrets.

select
  to_regclass('public.ip_catalog') is not null as ip_catalog_exists,
  to_regclass('public.ip_characters') is not null as ip_characters_exists,
  to_regclass('public.tag_rules') is not null as tag_rules_exists,
  to_regclass('public.collection_rules') is not null as collection_rules_exists;
