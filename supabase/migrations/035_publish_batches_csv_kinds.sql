-- P1-69（回饋 69，總指揮新方向計畫 §1.3）：Showmore／Matrixify 匯出入 publish_batches。
-- 覆寫 D7 A-lite「CSV 不進批次帳」：kind 擴充 showmore / matrixify（shopify_api 維持）。
-- 紀錄頁篩選 UI 歸 UX；本檔只放寬 check constraint。
-- 執行方式：貼到 Supabase SQL Editor 跑一次（可重跑）。

-- Drop & re-add kind check so CSV export kinds are allowed.
alter table public.publish_batches
  drop constraint if exists publish_batches_kind_check;

alter table public.publish_batches
  add constraint publish_batches_kind_check
  check (kind in ('shopify_api', 'showmore', 'matrixify'));

comment on column public.publish_batches.kind is
  'P1-69: shopify_api | showmore | matrixify. CSV exports create completed batches (best-effort).';
