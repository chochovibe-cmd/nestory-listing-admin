-- Nestory Listing Admin v0.1 runtime permissions patch
-- Apply in Supabase SQL Editor if REST calls return 42501 after schema/RLS exists.
-- This grants table/function access to Supabase API roles; RLS policies still
-- decide which rows authenticated users may actually read or write.

grant usage on schema public to anon, authenticated, service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

grant select on public.profiles to authenticated;
grant update (name) on public.profiles to authenticated;

grant select, insert, update on public.product_drafts to authenticated;
grant select, insert, update on public.product_images to authenticated;
grant select, insert, update, delete on public.product_variants to authenticated;

grant select on public.generation_runs to authenticated;
grant select on public.publish_jobs to authenticated;
grant select on public.automation_logs to authenticated;
grant select on public.review_logs to authenticated;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_reviewer() to authenticated;
grant execute on function public.requeue_revision_for_generation(uuid, text) to authenticated;

grant execute on function public.claim_pending_generation(integer, text, text) to service_role;
