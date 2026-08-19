-- R1: pipeline_stage for three-station queue (copy_review / image_review / ready).
-- Apply after 028 in Supabase SQL Editor. SQL only — do not run CLI.
--
-- Dual-write era: keep existing draft_status; R2+ may retire status gradually.
-- Backfill is idempotent (safe to re-run). Mapping follows 流程重構規格書 §2.2
-- + Fable R1 rulings (Q2/Q4): publishing→ready; api_failed→published;
-- approved + non-empty shopify_product_id → published (§11 historical Shopify drafts).

-- ---------------------------------------------------------------------------
-- 1) Column
-- ---------------------------------------------------------------------------
alter table public.product_drafts
  add column if not exists pipeline_stage text;

comment on column public.product_drafts.pipeline_stage is
  'R1: three-station pipeline stage (input|copy_review|image_review|ready|published|archived). Dual-written with status until R2+ retires status.';

-- ---------------------------------------------------------------------------
-- 2) Idempotent backfill (CASE UPDATE) — re-runnable
-- ---------------------------------------------------------------------------
update public.product_drafts
set pipeline_stage = case status::text
  when 'pending_input' then 'input'
  when 'pending_copy' then 'input'
  when 'processing' then 'input'
  when 'ready_for_review' then 'copy_review'
  when 'needs_revision' then 'copy_review'
  when 'failed' then 'copy_review'
  when 'approved' then
    case
      when shopify_product_id is not null
        and btrim(shopify_product_id) <> ''
      then 'published'
      else 'image_review'
    end
  when 'publishing' then 'ready'
  when 'csv_ready' then 'published'
  when 'draft_created' then 'published'
  when 'active_published' then 'published'
  when 'api_failed' then 'published'
  when 'archived' then 'archived'
  else coalesce(nullif(pipeline_stage, ''), 'input')
end
where pipeline_stage is distinct from (
  case status::text
    when 'pending_input' then 'input'
    when 'pending_copy' then 'input'
    when 'processing' then 'input'
    when 'ready_for_review' then 'copy_review'
    when 'needs_revision' then 'copy_review'
    when 'failed' then 'copy_review'
    when 'approved' then
      case
        when shopify_product_id is not null
          and btrim(shopify_product_id) <> ''
        then 'published'
        else 'image_review'
      end
    when 'publishing' then 'ready'
    when 'csv_ready' then 'published'
    when 'draft_created' then 'published'
    when 'active_published' then 'published'
    when 'api_failed' then 'published'
    when 'archived' then 'archived'
    else coalesce(nullif(pipeline_stage, ''), 'input')
  end
);

-- Any remaining null (edge / concurrent insert) → input
update public.product_drafts
set pipeline_stage = 'input'
where pipeline_stage is null;

-- ---------------------------------------------------------------------------
-- 3) Default + NOT NULL + check (after backfill)
-- ---------------------------------------------------------------------------
alter table public.product_drafts
  alter column pipeline_stage set default 'input';

alter table public.product_drafts
  alter column pipeline_stage set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'product_drafts_pipeline_stage_check'
      and conrelid = 'public.product_drafts'::regclass
  ) then
    alter table public.product_drafts
      add constraint product_drafts_pipeline_stage_check
      check (
        pipeline_stage in (
          'input',
          'copy_review',
          'image_review',
          'ready',
          'published',
          'archived'
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Partial index for work-queue station queries (Q1-A)
-- ---------------------------------------------------------------------------
create index if not exists product_drafts_pipeline_stage_work_idx
  on public.product_drafts (pipeline_stage)
  where pipeline_stage not in ('published', 'archived');
