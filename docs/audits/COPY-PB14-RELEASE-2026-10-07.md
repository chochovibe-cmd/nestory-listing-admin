# COPY-PB1.4 Release — 2026-10-07

## Authority
- Default: `codex/nestory-v0.1-safety-skeleton@eac309b5fffc7f3f5a7effdfffedd22792ad74a0`
- Accepted PB1.4 runtime/test source: `a30aa29ba713189b989c11418dd4fb2733dad16a`
- Historical PR #13 remains Draft and is **not** the release PR because its base is not the current default.

## Owner decision
- PB1.4 core quality accepted for release.
- Do not keep polishing Why/tone as a launch blocker.
- Keep natural benefit extension; block unrelated hard specs, false precise numbers, unsupported licensing/safety/medical/guarantee claims.

## Release scope
This branch was created fresh from the real default and ports only the accepted copy runtime/test state needed to reproduce PB1.4 behavior:
- generate route and copy providers;
- Product Brief;
- strict same-product web evidence gate;
- title / SEO / formatting finalizers used by the accepted output;
- copy/web-search/title verifiers and fixtures.

Explicitly excluded: UI packages, schedule, video, image work, DB migration, Shopify write, Production deploy, and historical feature-branch documentation not needed for release.

## Validation
- Clean Release runtime/test HEAD: `db3e6f1b2be6aab5eab2130a073927c4d18a366c`
- GitHub CI #755: verifier ✅ / typecheck ✅ / build ✅
- First CI run exposed one omitted required JSON test fixture; only that fixture was added, then the clean branch passed.
- Vercel did not build the latest HEAD because the account returned: `Deployment rate limited — retry in 24 hours.` This is a platform quota gate, not a source build failure.
- Production / Shopify / Supabase schema remained untouched.

## Current gate
**SOURCE PASS / MERGE HOLD.** PR #17 stays Draft. Merge requires explicit Owner approval. A fresh Vercel Preview can be retried after quota reset if desired; Production deployment remains a separate package.
