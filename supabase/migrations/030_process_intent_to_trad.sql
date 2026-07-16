-- R2: add process_intent = to_trad（簡轉繁）for image pipeline marks.
-- Apply after 029 in Supabase SQL Editor. SQL only — do not run CLI.
--
-- Iron rule: until this migration runs, UI/API must not write to_trad
-- (check constraint would reject). D4 image edit may still skip to_trad
-- with an honest warning until backend support lands.

-- Drop old check (name from 019) and re-add with to_trad.
alter table public.product_images
  drop constraint if exists product_images_process_intent_check;

alter table public.product_images
  add constraint product_images_process_intent_check
  check (
    process_intent is null
    or process_intent in ('keep', 'de_text', 'regenerate', 'to_trad')
  );

comment on column public.product_images.process_intent is
  'B5/R2 image pipeline mark: null=unmarked (legacy), keep=保留原圖, to_trad=簡轉繁, de_text=去字, regenerate=重生. Default keep applied at station① approve (R2 Q2-A).';
