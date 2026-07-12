-- B12: soft-archive restore metadata for product_drafts.
-- Apply after 023 in Supabase SQL Editor. SQL only — do not run CLI.
--
-- Authority for "is archived" remains draft_status = 'archived' (enum since 001).
-- These columns remember prior status / when, so 解除封存 can restore workflow state.

alter table public.product_drafts
  add column if not exists status_before_archive public.draft_status,
  add column if not exists archived_at timestamptz;

comment on column public.product_drafts.status_before_archive is
  'B12: status snapshot taken when moving to archived; restored on unarchive.';

comment on column public.product_drafts.archived_at is
  'B12: when the draft was soft-archived; null when not archived.';

create index if not exists product_drafts_archived_at_idx
  on public.product_drafts (archived_at desc nulls last)
  where status = 'archived';
