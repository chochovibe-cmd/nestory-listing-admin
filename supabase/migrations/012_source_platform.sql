-- Nestory UI-parity correction round -- restore the "快速狀態" quick-status
-- summary line from 分支's result card.
-- Apply after 001-011 in Supabase SQL Editor.
--
-- The form already lets an operator pick a source marketplace (淘寶/閑魚/蝦皮)
-- but never persisted it. This is an internal record-keeping field only --
-- it must never be sent to Shopify or the Matrixify CSV export.

alter table public.product_drafts
  add column if not exists source_platform text;
