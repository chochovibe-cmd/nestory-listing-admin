-- Nestory Phase 2 correction round -- result card field restoration.
-- Apply after 001-010 in Supabase SQL Editor.
--
-- Adds columns needed to bring ResultCard back to parity with the 分支
-- prototype's result card: generated FAQ (generated but never persisted),
-- a compare-at ("定價") reference price alongside the existing sell price,
-- and AI-detected classification fields (populated starting in Phase 4 of
-- this correction round; left null/unused by Phase 1-3).

alter table public.product_drafts
  add column if not exists generated_faq_html text,
  add column if not exists compare_at_price numeric,
  add column if not exists detected_category text,
  add column if not exists sku text;

insert into public.team_settings (key, value)
values ('pricing_defaults', '{"compareAtMultiplier": 1.8}'::jsonb)
on conflict (key) do nothing;
