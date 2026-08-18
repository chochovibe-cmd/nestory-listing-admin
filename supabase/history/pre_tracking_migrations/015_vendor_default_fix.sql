-- A24 (2026-07-10, A14 real-product test finding).
-- Apply after 014 in the Supabase SQL Editor (do NOT run the CLI).
--
-- product_drafts.vendor defaulted to 'CHOCHONEST' since 001_initial_schema,
-- which is why the payload.ts/matrixify.ts fallback ("CHOCHONEST") almost
-- never actually fired -- nearly every draft already carried this DB default
-- as its vendor. "CHOCHONEST" is not a real vendor value in this store;
-- "潮巢 Nestory" already exists in Shopify's vendor list and is the intended
-- value everywhere else in the app.

alter table public.product_drafts
  alter column vendor set default '潮巢 Nestory';

-- Backfill rows that still carry the untouched old default. Only rows with
-- the exact literal 'CHOCHONEST' value are touched -- anything an operator
-- deliberately typed differently is left alone.
update public.product_drafts
  set vendor = '潮巢 Nestory'
  where vendor = 'CHOCHONEST';
