-- B4: one-click character add marks rows as pending for Phase C admin review.
-- Pending characters stay is_active=true so Tags V2 / regenerate can use them
-- immediately; review_status is governance only (not a hard gate on tags).
-- Apply in Supabase SQL Editor after 020. Do not run via CLI.

alter table public.ip_characters
  add column if not exists review_status text not null default 'approved';

alter table public.ip_characters
  drop constraint if exists ip_characters_review_status_check;

alter table public.ip_characters
  add constraint ip_characters_review_status_check
  check (review_status in ('pending', 'approved'));

alter table public.ip_characters
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

create index if not exists ip_characters_pending_index
  on public.ip_characters (review_status)
  where review_status = 'pending';

comment on column public.ip_characters.review_status is
  'B4: pending = one-click add awaiting Phase C review; still usable for Tags V2 when is_active=true.';

comment on column public.ip_characters.created_by is
  'B4: operator who one-click added this character (nullable for seed/admin rows).';
