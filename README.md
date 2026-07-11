# Nestory Listing Admin v0.1

Team PWA skeleton for the Chocho Nestory Shopify listing workflow.

The v0.1 goal is a secure data-flow foundation:

1. PWA creates product drafts in Supabase.
2. Drafts enter a `pending_copy` queue.
3. A scoped worker API lets Codex Skill jobs claim and complete copywriting work.
4. Reviewers approve and publish through a server-side Shopify payload interface.
5. Matrixify CSV remains available as a fallback path.

## Safety Notes

- Do not commit `.env` or any real token.
- The frontend only uses the Supabase anon key.
- `SUPABASE_SERVICE_ROLE_KEY`, `WORKER_API_TOKEN`, and Shopify credentials are server-only.
- `SHOPIFY_PUBLISH_MOCK=true` is the safe default for v0.1.

## First Setup

```powershell
copy .env.example .env.local
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Port 3000 -Build
```

Apply `supabase/migrations/001_initial_schema.sql` in Supabase SQL Editor before using the PWA.

Start with `AGENTS.md` (standing rules for all AI models, including the active-document map) and `docs/施工清單.md` (the single source of progress truth). Historical v0.1-era docs (mock flow, team handoff, QA checklists) are quarantined in `docs/archive/` — see its README before citing anything from there.

## Local Preview

If dependencies are already installed and a production build exists, start the local preview with:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local.ps1 -Port 3000
```

Then open:

```text
http://127.0.0.1:3000/login
```

The script runs in the foreground. Keep that terminal open while previewing the PWA, and press `Ctrl+C` to stop it.

If the browser shows `ERR_CONNECTION_REFUSED`, the local Next server is not running on that port. Run the command above in a PowerShell window and keep it open while using the app. Background servers started from automation may exit when their parent process ends.

## Local Preflight

Run this before handing off or before wiring a Supabase test project:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/preflight-local.ps1 -CheckUrl
```

For a heavier verification pass that also runs TypeScript and production build:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/preflight-local.ps1 -Full
```

The preflight never prints `.env.local` values. It only reports whether the local env file exists.
