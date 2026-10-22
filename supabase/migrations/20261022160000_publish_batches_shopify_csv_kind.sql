-- RECORDS-CSV（2026-10-22 老闆插隊）：發布紀錄可重新下載 Shopify CSV，下載也記進 publish_batches。
-- kind 擴充 shopify_csv（shopify_api / showmore / matrixify 維持）。
-- 執行方式：貼到 Supabase SQL Editor 跑一次（可重跑）。沒跑之前下載照常可用，只是不留紀錄。

alter table public.publish_batches
  drop constraint if exists publish_batches_kind_check;

alter table public.publish_batches
  add constraint publish_batches_kind_check
  check (kind in ('shopify_api', 'showmore', 'matrixify', 'shopify_csv'));

comment on column public.publish_batches.kind is
  'RECORDS-CSV: shopify_api | showmore | matrixify | shopify_csv. CSV exports / re-downloads create completed batches (best-effort).';
