# RLS and Role Policy Guide

This guide summarizes the v0.1 security model in human-reviewable form. The
authoritative implementation is `supabase/migrations/001_initial_schema.sql`.

## Roles

| Role | Intended user | Allowed in v0.1 |
| --- | --- | --- |
| `admin` | Owner / system manager | Read and manage all product drafts, profiles, review, publish, and export. |
| `operator` | Listing staff | Create product drafts, upload images, edit own input-stage drafts. |
| `reviewer` | Final reviewer / publisher | Review, edit, approve, publish, export CSV fallback. |
| `service_role` | Server-side API only | Worker completion, publish updates, CSV fallback status writes, logs. |

## Product Draft Access

| Action | Admin | Reviewer | Operator | Server API |
| --- | --- | --- | --- | --- |
| Read all drafts | Yes | Yes | No, own drafts only | Yes |
| Create draft | Yes | Yes | Yes | Yes |
| Edit product input fields | Yes | Yes | Own drafts before publish | Yes |
| Move to `processing` | Yes | Yes | No | Yes |
| Move to `ready_for_review` | Yes | Yes | No | Yes |
| Approve | Yes | Yes | No | Yes |
| Change publish mode | Yes | Yes | No | Yes |
| Publish status updates | Yes | Yes | No | Yes |
| Shopify ID / Admin URL writes | Yes | Yes | No | Yes |
| Archive own input draft | Yes | Yes | Yes | Yes |

Operators may only move drafts among input-safe states:

```text
pending_input
pending_copy
needs_revision
archived
```

The database trigger `guard_sensitive_product_draft_fields()` blocks
non-reviewer users from moving records into generation, review, or publish
states and from editing generation/publish system fields.

Operators may upload or edit images only for their own drafts while the draft is
still in an input/review-prep state:

```text
pending_input
pending_copy
needs_revision
ready_for_review
```

## Worker Boundary

Codex Skill workers must not receive the Supabase service role key. They call
server endpoints with:

```http
Authorization: Bearer ${WORKER_API_TOKEN}
```

Server endpoints validate the scoped worker token and then use the service role
internally.

Worker routes:

```text
POST /api/worker/claim
POST /api/worker/complete
POST /api/worker/fail
```

`claim` uses the SQL RPC `claim_pending_generation()` with
`FOR UPDATE SKIP LOCKED`, and the RPC can only be executed by `service_role`.

## Publish Boundary

Publishing is reviewer-only:

```text
POST /api/drafts/{id}/approve
POST /api/drafts/{id}/publish
```

The PWA shows ACTIVE publishing with two browser confirmations. The server also
requires:

```json
{ "confirmActive": true }
```

`SHOPIFY_PUBLISH_MOCK=true` is the v0.1 default, so publish payloads can be
validated without sending real Shopify requests.

## CSV Fallback Boundary

CSV fallback is reviewer/admin only:

```text
POST /api/exports/matrixify
```

The route reads eligible drafts, builds Matrixify CSV, updates drafts to
`csv_ready`, and records `publish_jobs` using server-side service access after
the user's reviewer/admin role is verified.

Eligible statuses:

```text
approved
api_failed
csv_ready
```

## Storage Boundary

Bucket: `product-images`

Path convention:

```text
{user_id}/{draft_id}/{image_type}/{filename}
```

Authenticated users can upload only under their own top-level `user_id` folder.
The bucket is public-read in v0.1 because Shopify and Matrixify need image URLs.

## Known Next Verification

After dependencies and a test Supabase project are available:

1. Apply the migration.
2. Confirm an operator cannot update `shopify_product_id`.
3. Confirm an operator cannot set `status = ready_for_review`.
4. Confirm reviewer can approve and publish mock.
5. Confirm worker API can claim and complete via scoped token.
