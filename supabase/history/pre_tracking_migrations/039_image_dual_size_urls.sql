-- A19: dual-size client uploads
-- list_thumb_url = ~320px long edge (lists / cards)
-- vision_mid_url = ~1280px long edge (Vision / analyze-images)
-- original_file_url remains the full-resolution source

alter table public.product_images
  add column if not exists list_thumb_url text;

alter table public.product_images
  add column if not exists vision_mid_url text;

comment on column public.product_images.list_thumb_url is
  'A19: browser-generated ~320px thumbnail for list/card UI; optional until migration used.';

comment on column public.product_images.vision_mid_url is
  'A19: browser-generated ~1280px mid-size for Vision; prefer over original_file_url when set.';
