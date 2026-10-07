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

## Current gate
**HOLD** until this clean Release branch passes its own GitHub CI. Even after CI PASS, merge requires explicit Owner approval. Production deployment is a separate package.
