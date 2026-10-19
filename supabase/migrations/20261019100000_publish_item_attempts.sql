alter table public.publish_batch_items
  add column if not exists attempt_count integer not null default 0,
  add column if not exists started_at timestamptz;
