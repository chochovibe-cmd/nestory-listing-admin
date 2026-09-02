-- P1-AUTH: current_image_batch_id is a server-managed pipeline pointer.
--
-- This is a forward tracked migration. It intentionally does not replay or
-- modify the pre-tracking history. The application writes the pointer only
-- after the authenticated request has passed draft RLS and created a matching
-- image_batch_items membership row.

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
    or new.current_image_batch_id is distinct from old.current_image_batch_id
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
