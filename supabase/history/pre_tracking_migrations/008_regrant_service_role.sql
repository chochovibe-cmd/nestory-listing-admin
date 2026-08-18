-- Fix: service_role got "permission denied" reading tag_rules from the live
-- /api/generate route, even though 004/006/007 already contain grant statements
-- for these tables. `grant all privileges on all tables in schema public to
-- service_role` in 003 only covers tables that existed at the time it ran
-- (before 004 created tag_rules etc.), and does not retroactively apply to
-- tables added later. This migration just re-asserts the grants so they take
-- effect regardless of what happened when 004/006/007 were first run.
-- Safe to run multiple times.

grant all privileges on public.ip_catalog to service_role;
grant all privileges on public.ip_characters to service_role;
grant all privileges on public.tag_rules to service_role;
grant all privileges on public.collection_rules to service_role;
grant all privileges on public.team_settings to service_role;
grant all privileges on public.generation_history to service_role;

grant select on public.ip_catalog to authenticated;
grant select on public.ip_characters to authenticated;
grant select on public.tag_rules to authenticated;
grant select on public.collection_rules to authenticated;
