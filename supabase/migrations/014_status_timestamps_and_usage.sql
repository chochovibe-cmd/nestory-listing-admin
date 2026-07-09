-- Nestory Phase A -- A13: status-change timestamps + per-draft AI usage.
-- Apply after 013 in the Supabase SQL Editor (do NOT run the CLI).
--
-- The dashboard funnel (E2) needs to know WHEN each draft crossed a stage, and
-- the budget panel (E4) needs per-draft AI spend. generation_cost_estimate
-- already exists (001); this adds the stage timestamps and the raw token
-- counts behind the cost estimate (so the estimate can be recomputed if the
-- approximate price table in copy.ts is later corrected).
--
-- All columns are nullable and only written server-side (service_role), so the
-- operator field guard (005) does not need to change.

alter table public.product_drafts
  add column if not exists copy_generated_at timestamptz,
  add column if not exists reviewed_at timestamptz,
  add column if not exists published_at timestamptz,
  add column if not exists generation_input_tokens integer,
  add column if not exists generation_output_tokens integer;

-- Funnel queries filter/sort drafts by when they entered a stage.
create index if not exists product_drafts_copy_generated_at_idx
  on public.product_drafts (copy_generated_at);
create index if not exists product_drafts_published_at_idx
  on public.product_drafts (published_at);
