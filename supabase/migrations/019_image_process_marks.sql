-- B5: Per-image process marks for the Phase D image pipeline.
-- Default is blank (unmarked) -- send-to-process is blocked until every
-- pipeline image has a process_intent.
-- is_spec_process = "規格圖" mark: image-processing only (去簡體字), NOT OCR.
-- image_type stays main/detail so a 規格圖 can still be the main product photo.

alter table public.product_images
  add column if not exists process_intent text,
  add column if not exists is_spec_process boolean not null default false;

do $$
begin
  alter table public.product_images
    add constraint product_images_process_intent_check
    check (process_intent is null or process_intent in ('keep', 'de_text', 'regenerate'));
exception
  when duplicate_object then null;
end $$;

comment on column public.product_images.process_intent is
  'B5 image pipeline mark: null=unmarked, keep=保留原圖, de_text=去簡體字, regenerate=重生主圖';

comment on column public.product_images.is_spec_process is
  'B5 規格圖 mark: process as 去簡體字 only; not an OCR source (see Mockup差異備忘 差異2)';
