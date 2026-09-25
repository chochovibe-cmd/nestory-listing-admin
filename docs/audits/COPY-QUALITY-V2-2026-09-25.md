# Nestory Copy Quality V2 — 2026-09-25 handoff

## Authority and release state

- Owner request: fix the causes of drifting/generic Chaochao copy and leave a durable, model-independent handoff. Preserve the owner-approved five-section Chaochao layout and latest 2026-09-24 Preview behavior.
- Work branch: `codex/copy-quality-v2`, based on `agent/chaochao-tone-on-live` `5203e4a` (latest 9/24 Preview), **not** production default `a3b3c57`.
- At the start of this package, Vercel Production deployment was `dpl_F5pf9DZPDRVMLpfxepC5G4wv7h2k` at `a3b3c57`; latest Preview deployment was `dpl_6pc3PeLBG1L6Z2n7usZoWhQwYk2p` at `5203e4a`.
- No production deployment, Supabase migration, Shopify write, or existing-draft repair in this package. Production's six known capture drafts with 25–200 flat variants and zero DB variants were still unchanged at read-only check on 2026-09-25.
- New runtime version: `chaochao-evidence-v2-20260925@<VERCEL_GIT_COMMIT_SHA>`. Read it from generate API response `runtimeVersion`, draft `generation_rule_version`, or `generation_runs.rule_version`.

## Changes and evidence

| Problem | Change | Where |
|---|---|---|
| Capture 64→0 | Collapse only identical SKU choice + price + SKU + image rows before persistence; retain full original 64 rows in raw_capture. Conflicting commercial rows still fail validation. Same-URL recapture now has a safe path to refill old zero-variant drafts. | `mapCaptureFields.ts`, `createCaptureDraft.ts` existing refill path |
| Seller facts lost | Add bounded, labelled original capture title/spec/params/unique variants to both full and field regenerate prompts. When DB variants are missing, derive variant summary from original capture. | `captureEvidence.ts`, `systemPromptBase.ts`, `generate/route.ts` |
| Self-grounding search | Search uses original capture spec, raw title and operator note. Do not pass AI-edited `draft.spec_text`, detected IP/character/type or Vision prose to product search. Keep bracketed brand/IP words in original title. Tavily composite answer disabled; result snippets labelled candidates. | `generate/route.ts`, `webSearch/index.ts`, `webSearch/tavily.ts` |
| Stale cache | New search fingerprint and 7-day TTL for product and IP searches; Vision fingerprint hashes model plus full prompt with image URLs. Single-field regenerate validates search fingerprint/age and refreshes when needed. | `webSearch/index.ts`, `visionProvider.ts`, `generate/route.ts` |
| Generic filler | Chaochao-only writing rules permit shorter sections and FAQ when evidence is sparse; copyLength now changes instructions. Avoid invented handling, feeling and delivery promises. Other tones retain their contracts. A narrow final review flags generic phrases and unsupported explicit unit measurements. | `chaochaoPrompt.ts`, `copyQuality.ts`, `generate/route.ts` |
| Missing provenance | Full and field generations append version, model, evidence, original/final output and cache provenance to `generation_runs`. Approval appends a human-approved final snapshot linked to previous AI run when available. Original capture-related warnings survive regeneration. | `copyVersion.ts`, `generate/route.ts`, `approve/route.ts` |

## Verification done

- `pnpm install --frozen-lockfile` succeeded; no dependency manifest changes.
- `pnpm typecheck`, `pnpm verify:all`, and `pnpm build` succeeded locally.
- New executable regression `scripts/verify-copy-evidence-v2.cjs` covers synthetic 64→8 choices, conflicting price retained, original evidence retained, bracketed brand query, AI Vision terms excluded, stale cache invalidation and critic warnings. This tests the actual TS functions, not just matching source strings.
- Read-only live sample of Dragon Ball draft `8b3a323e-366d-4cde-a83e-ea4ab79dda35`: 64 captured rows, 0 stored; exactly eight unique option combinations, repeated eight times, with no distinct SKU/image/price across duplicates. The code fix targets this shape; **no live backfill has occurred**.

## Remaining gates — do not claim quality improvement yet

1. **Real-model A/B:** no API credentials in this checkout. On a Preview with credentials, generate five varied drafts with same immutable input in old `5203e4a` and new branch; avoid editing customer products during comparison. Suggested: Dragon Ball `8b3a323e...` (8 choices), Bandai Sanrio `8d2b744c...` (blind box), Pingu camera `5feb9b44...` (electronics), Miffy watch `07781d69...` (existing variants), Razer mouse `29b827a7...` (3C). Evaluate factual claims, variant coverage, unique product detail, repetition, voice, field overlap, and SEO. Record raw/final outputs and reviewer judgment, not hand-written fixtures. No 'better' claim without these results.
2. **Existing drafts:** currently zero-variant production drafts stay zero until recaptured or safely backfilled. Before any batch repair, dry-run all six using `mapCaptureToDraftFields` and inspect unique choice count, conflicting SKU/price/image and stored thumbnails; do not blindly insert 64/196 rows or overwrite edits. Original capture already reaches Writer for generation even while DB rows remain missing.
3. **Exact product Web verification:** disabling Tavily's synthesized answer and marking candidates limits confirmation bias, but snippets do not yet provide machine-enforced exact-model proof. A later stage should build per-claim source + exact-match score and exclude unsupported specs before writing.
4. **Architecture:** Evidence Pack is separated deterministically, but editorial angle, writing and critique are still one main model call plus local review warnings. There is no separate LLM Editorial Brief / Critic or automatic failed-field rewrite yet. Add only after latency/cost and real-model A/B show this is needed; account for Vercel timeout.
5. **Feedback:** future approvals now save labelled final text; earlier approvals are not retroactively gold examples. No owner-curated category examples or UI rejection-reason choices yet. Never treat all past `generation_history` as approved.
6. **Deploy:** verify branch Preview `READY`, generate response `runtimeVersion` and saved run provenance, compare output, then decide separately on production promotion. Never infer deployed SHA from branch HEAD.

## Next model start here

1. Read `AI_START_HERE.md`, `docs/CURRENT_STATUS.md`, `AGENTS.md`, then this file. Check `git status`, Vercel production/preview SHA and Supabase migration ledger independently.
2. Confirm `pnpm typecheck && pnpm verify:all && pnpm build`; use `scripts/verify-copy-evidence-v2.cjs` for the 64→8 regression.
3. Run five actual model A/B samples before considering production. If worse, use the recorded run input/output/version to isolate data loss vs prompt vs deterministic postprocessing; don't add another prompt override blindly.
4. Make any existing draft repair a separate dry-run reviewed operation; raw_capture is the immutable source, generated spec_text is display copy.
