# RLS Smoke Tests

These tests should be run after applying `supabase/migrations/001_initial_schema.sql`
to a test Supabase project. They are written as scenarios because user-scoped
RLS is easiest to verify with real authenticated sessions.

## Setup

Create three users:

```text
admin@example.com      role = admin
operator@example.com   role = operator
reviewer@example.com   role = reviewer
```

Bootstrap the first admin using `docs/admin-bootstrap.md`, then promote the
reviewer account.

## Operator Can Create Pending Draft

As `operator@example.com`, create a draft through `/drafts/new`.

Expected:

```text
status = pending_copy
generation_mode = codex_skill
generation_status = pending
publish_mode = active
publish_status = pending
created_by = operator user id
```

## Operator Cannot Escalate Workflow

As `operator@example.com`, try to update the draft directly:

```sql
update public.product_drafts
set status = 'ready_for_review'
where id = '<draft_id>';
```

Expected:

```text
ERROR: Only reviewers, admins, or server-side workers can move drafts into generation, review, or publish states.
```

## Operator Cannot Write Shopify Fields

As `operator@example.com`, try:

```sql
update public.product_drafts
set shopify_product_id = 'gid://shopify/Product/1'
where id = '<draft_id>';
```

Expected:

```text
ERROR: Only reviewers, admins, or server-side workers can update generation/publish system fields.
```

## Worker Can Claim And Complete Through API

Call `POST /api/worker/claim` with `WORKER_API_TOKEN`.

Expected:

```text
status = processing
generation_status = processing
generation_rule_version = supplied ruleVersion
```

Call `POST /api/worker/complete`.

Expected:

```text
status = ready_for_review
generation_status = completed
generation_runs row created
automation_logs row created
```

## Reviewer Can Approve

As `reviewer@example.com`, call:

```text
POST /api/drafts/{id}/approve
```

Expected:

```text
status = approved
reviewed_by = reviewer user id
review_logs row created
```

## Reviewer Can Request Revision

As `reviewer@example.com`, call:

```text
POST /api/drafts/{id}/request-revision
```

Expected:

```text
status = needs_revision
reviewed_by = reviewer user id
review_logs row created
```

## Active Publish Requires Confirmation

As `reviewer@example.com`, call publish without `confirmActive`:

```json
{ "publishMode": "active" }
```

Expected:

```text
400 ACTIVE publish requires explicit confirmActive=true
```

Then call with:

```json
{ "publishMode": "active", "confirmActive": true }
```

Expected with `SHOPIFY_PUBLISH_MOCK=true`:

```text
status = active_published
publish_status = active_published
shopify_product_id = mock-product-id
publish_jobs row created
```

## CSV Fallback Is Reviewer Only

As `operator@example.com`, call:

```text
POST /api/exports/matrixify
```

Expected:

```text
403 Reviewer role is required to export fallback CSV
```

As `reviewer@example.com`, call the same endpoint for an eligible draft.

Expected:

```text
CSV downloads
status = csv_ready
publish_method = matrixify_csv
publish_jobs row created
```
