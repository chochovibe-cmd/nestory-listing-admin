-- Local/CI-only production-like baseline fixture.
--
-- WHY THIS EXISTS
-- Production had catalog data before repo migration 033 was written. A clean
-- database does not: migration 033 inserts Chiikawa characters under
-- ip_catalog.ip_name = '吉伊卡哇' and therefore needs that parent row first.
--
-- This file is NOT a production migration and must never be applied to the
-- hosted project. It only recreates the minimum legacy state that migration
-- 033 historically assumed already existed.

insert into public.ip_catalog (ip_name, aliases, sort_order, is_active)
values (
  '吉伊卡哇',
  array['Chiikawa', 'ちいかわ', '小可愛']::text[],
  10,
  true
)
on conflict (ip_name) do update set
  aliases = (
    select array_agg(distinct value order by value)
    from unnest(public.ip_catalog.aliases || excluded.aliases) as x(value)
  ),
  sort_order = least(public.ip_catalog.sort_order, excluded.sort_order),
  is_active = true,
  updated_at = now();
