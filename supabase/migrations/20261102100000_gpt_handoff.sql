alter table public.product_drafts
  add column if not exists gpt_handoff_at timestamptz,
  add column if not exists gpt_exported_at timestamptz;
