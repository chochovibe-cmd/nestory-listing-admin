-- SYNC-KEEP-MEDIA, 2026-10-24.
-- Per-product switch for how full sync treats Shopify media (images + external videos):
--   'tool'    (default) — current behaviour: tool images/videos are uploaded, Shopify-only media needs
--             confirmRemovals, replaced sources are re-uploaded.
--   'shopify' — images follow Shopify (boss rule 10-24): sync never adds, removes, replaces or re-alts
--             any Shopify media, and never rewrites product_images identity. Text, variants, prices,
--             SKU, cost, metafields still sync as usual.
-- Not in mark_linked_product_draft_dirty's column list → flipping it does not mark the draft dirty.
-- Revert: alter table public.product_drafts drop column shopify_media_mode;

alter table public.product_drafts
  add column if not exists shopify_media_mode text not null default 'tool';

alter table public.product_drafts
  drop constraint if exists product_drafts_shopify_media_mode_check;

alter table public.product_drafts
  add constraint product_drafts_shopify_media_mode_check
  check (shopify_media_mode in ('tool', 'shopify'));

comment on column public.product_drafts.shopify_media_mode is
  'SYNC-KEEP-MEDIA: tool = sync uploads/removes media to match the tool; shopify = sync leaves all Shopify media untouched';

-- SYNC-ROLLOUT batch 6: Shopify gallery holds images the tool does not send (old publishes put 詳情圖
-- in the gallery), or the tool has an image Shopify does not. Boss rule: images follow Shopify.
update public.product_drafts
set shopify_media_mode = 'shopify'
where id in (
  '3c67c42b-b7a1-4550-814e-c6e1f5d41a7b',
  '329f516c-af09-44fe-bafb-743107da6009',
  '8b3a323e-366d-4cde-a83e-ea4ab79dda35',
  'b9400278-3811-4c5a-94ec-a1ff9b372d6f',
  '8b3a35b9-2a9b-4b14-84d3-5c7e84f9b8f8',
  '6ede08ef-ac72-4741-92db-794f253a6ff6'
);
