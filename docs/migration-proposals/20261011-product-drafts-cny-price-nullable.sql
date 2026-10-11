-- PROPOSAL ONLY — DO NOT APPLY FROM THIS PACKAGE.
-- Purpose: after application code no longer relies on 0.01 as a NOT NULL sentinel,
-- allow a genuinely unknown captured CNY cost to be stored as NULL.
--
-- Deliberately stored under docs/migration-proposals/, not supabase/migrations/,
-- so normal migration tooling cannot apply it accidentally.
--
-- Preflight before any future Production package:
--   select count(*) as placeholder_rows
--   from public.product_drafts
--   where cny_price = 0.01;
--
-- This proposal does NOT rewrite existing 0.01 rows. Any cleanup must be a
-- separately approved, narrow data-repair package using capture provenance.

begin;

alter table public.product_drafts
  alter column cny_price drop not null;

commit;

-- Rollback shape (only if every row is non-null again):
-- alter table public.product_drafts alter column cny_price set not null;
