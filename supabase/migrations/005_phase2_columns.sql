-- Nestory v0.2 Phase 2 columns patch.
-- Apply after 001-004 in Supabase SQL Editor.
--
-- This intentionally does NOT recreate copy_status / review_status / publish_status:
-- 001 already has `status` (draft_status enum), `generation_status`, and `publish_status`
-- (enum) covering those dimensions. This migration only adds columns for concepts that
-- do not exist yet: sale source tiering, image pipeline description/flags/status,
-- secondhand fields, IP/character auto-detect fields, and a future video_urls slot.

alter table public.product_drafts
  add column if not exists sale_status text not null default '海外代購'
    constraint product_drafts_sale_status_check
      check (sale_status in ('海外代購', '預購', '現貨')),

  add column if not exists image_description text,
  add column if not exists image_flags jsonb not null default '{}'::jsonb,

  add column if not exists image_status text not null default 'pending'
    constraint product_drafts_image_status_check
      check (image_status in ('pending', 'processing', 'done', 'failed', 'skipped')),

  add column if not exists is_secondhand boolean not null default false,
  add column if not exists secondhand_grade text,
  add column if not exists secondhand_condition text,
  add column if not exists secondhand_notes text,

  add column if not exists ip_name text,
  add column if not exists character_name text,

  add column if not exists why_we_chose_it text,
  add column if not exists product_highlights text[] not null default '{}',

  add column if not exists video_urls jsonb not null default '[]'::jsonb;

create index if not exists product_drafts_image_status_idx
  on public.product_drafts (image_status);

create index if not exists product_drafts_sale_status_idx
  on public.product_drafts (sale_status);

create index if not exists product_drafts_duplicate_check_idx
  on public.product_drafts (ip_name, character_name, product_type);

-- image_status is a pipeline/system field (parallel to generation_status), so it joins
-- the same guard that already protects generation_status/worker fields from being
-- edited directly by a plain operator once a draft has moved past manual-entry states.
create or replace function public.guard_sensitive_product_draft_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  role public.user_role;
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'service_role' then
    return new;
  end if;

  select public.current_user_role() into role;

  if role in ('admin', 'reviewer') then
    return new;
  end if;

  if new.status is distinct from old.status
    and new.status not in ('pending_input', 'pending_copy', 'needs_revision', 'archived')
  then
    raise exception 'Only reviewers, admins, or server-side workers can move drafts into generation, review, or publish states.';
  end if;

  if new.generation_status is distinct from old.generation_status
    or new.generation_rule_version is distinct from old.generation_rule_version
    or new.generation_model is distinct from old.generation_model
    or new.generation_cost_estimate is distinct from old.generation_cost_estimate
    or new.generation_error is distinct from old.generation_error
    or new.image_status is distinct from old.image_status
    or new.shopify_handle is distinct from old.shopify_handle
    or new.shopify_tags is distinct from old.shopify_tags
    or new.shopify_collections is distinct from old.shopify_collections
    or new.metafields_json is distinct from old.metafields_json
    or new.generated_payload_json is distinct from old.generated_payload_json
    or new.shopify_payload_preview is distinct from old.shopify_payload_preview
    or new.worker_id is distinct from old.worker_id
    or new.worker_locked_at is distinct from old.worker_locked_at
    or new.worker_lock_expires_at is distinct from old.worker_lock_expires_at
    or new.worker_attempts is distinct from old.worker_attempts
    or new.max_worker_attempts is distinct from old.max_worker_attempts
    or new.next_retry_at is distinct from old.next_retry_at
    or new.publish_mode is distinct from old.publish_mode
    or new.publish_status is distinct from old.publish_status
    or new.publish_method is distinct from old.publish_method
    or new.shopify_product_id is distinct from old.shopify_product_id
    or new.shopify_admin_url is distinct from old.shopify_admin_url
    or new.error_message is distinct from old.error_message
    or new.reviewed_by is distinct from old.reviewed_by
  then
    raise exception 'Only reviewers, admins, or server-side workers can update generation/publish system fields.';
  end if;

  return new;
end;
$$;
