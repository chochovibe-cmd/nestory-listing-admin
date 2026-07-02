# ChochoNest Listing Tool v5 Lightweight

This folder is the lightweight branch for the Claude v5 prototype. It intentionally stays separate from the main Next/Supabase app.

## What This Version Does

- Single-file frontend: `chochonest-listing-tool-v5.html`
- Cloudflare Worker backend proxy: `cloudflare-worker/src/worker.js`
- Cloudinary image upload through Worker-side signed upload
- Anthropic text generation and spec-image recognition through Worker secrets
- Matrixify CSV export as the first official output
- Local browser workspace restore for settings, queue text, completed results, and downloadable CSV state

Images are not stored across refresh in v5. If the page is refreshed before processing, text queue data remains, but images must be uploaded again before rerunning that item.

## Local Frontend Check

Open `chochonest-listing-tool-v5.html` directly in a browser and use Demo mode first.

Expected demo flow:

1. Enter Demo mode.
2. Add one product with title and CNY price.
3. Run the queue.
4. Download single CSV and merged CSV.
5. Refresh the page and confirm completed results are restored.

If the Worker is deployed on a separate workers.dev domain, click `API URL` in the header and paste the Worker base URL, for example:

```text
https://chochonest-v5-worker.your-account.workers.dev
```

If Cloudflare Pages routes `/api/*` to the Worker on the same domain, leave `API URL` blank.

## Worker Setup

Install and deploy from `cloudflare-worker`:

```powershell
cd .\分支\cloudflare-worker
copy wrangler.toml.example wrangler.toml
pnpm install
pnpm exec wrangler secret put ACCESS_TOKEN
pnpm exec wrangler secret put ANTHROPIC_API_KEY
pnpm exec wrangler secret put CLOUDINARY_CLOUD_NAME
pnpm exec wrangler secret put CLOUDINARY_API_KEY
pnpm exec wrangler secret put CLOUDINARY_API_SECRET
pnpm run deploy
```

`ACCESS_TOKEN` is the password entered in the frontend. Do not use a real API key as the access token.

## Pages Deployment

For the quickest static deployment, upload or deploy only the HTML file to Cloudflare Pages.

Recommended first deployment:

1. Deploy the Worker first.
2. Deploy the HTML to Pages.
3. Open the Pages URL.
4. Click `API URL` and paste the Worker URL.
5. Enter `ACCESS_TOKEN`.
6. Run one real product test.

Later, you can connect Pages and Worker with a same-domain `/api/*` route and leave `API URL` blank.

## First Real Acceptance Test

- Wrong token returns an error and does not enter the tool.
- Correct token passes `/api/ping`.
- One product without images generates copy and downloads CSV.
- One product with main/detail images uploads to Cloudinary and includes image URLs in CSV.
- One product with a spec image returns Traditional Chinese spec text and includes it in AI generation context.
- Matrixify imports the CSV as draft products without column shifts.

