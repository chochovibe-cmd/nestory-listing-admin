-- Optional v0.1 test seed.
-- Use only in a test Supabase project after applying the initial migration.
-- This seed contains no real product data or credentials.

insert into public.product_drafts (
  id,
  source_type,
  taobao_title,
  original_title,
  cny_price,
  twd_cost,
  twd_price,
  pricing_formula,
  category,
  vendor,
  product_type,
  note,
  status,
  generation_mode,
  generation_provider,
  generation_status,
  publish_mode,
  publish_method,
  publish_status
)
values (
  '00000000-0000-4000-8000-000000000001',
  'manual',
  '日系木質收納小托盤',
  '日系木質收納小托盤',
  88.00,
  515,
  750,
  '{"rate":4.5,"costMultiplier":1.3,"marginMultiplier":1.4,"minPrice":199}'::jsonb,
  'storage',
  'CHOCHONEST',
  '居家收納 / 桌面小物',
  'v0.1 mock flow seed',
  'pending_copy',
  'codex_skill',
  'codex',
  'pending',
  'active',
  'shopify_api',
  'pending'
)
on conflict (id) do update
set
  taobao_title = excluded.taobao_title,
  original_title = excluded.original_title,
  status = excluded.status,
  generation_status = excluded.generation_status,
  publish_status = excluded.publish_status,
  updated_at = now();

insert into public.product_images (
  id,
  draft_id,
  image_type,
  original_file_url,
  processed_file_url,
  alt_text,
  sort_order,
  processing_status
)
values (
  '00000000-0000-4000-8000-000000000101',
  '00000000-0000-4000-8000-000000000001',
  'main',
  'https://example.com/nestory-mock-main.jpg',
  'https://example.com/nestory-mock-main.jpg',
  '潮巢 Nestory 日系木質收納小托盤商品主圖',
  0,
  'uploaded'
)
on conflict (id) do update
set
  original_file_url = excluded.original_file_url,
  processed_file_url = excluded.processed_file_url,
  alt_text = excluded.alt_text,
  processing_status = excluded.processing_status;
