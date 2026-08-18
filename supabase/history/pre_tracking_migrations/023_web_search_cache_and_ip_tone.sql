-- B8／B19: Web Search cache on drafts + team_settings seed for IP→tone overrides.
-- Apply after 022 in Supabase SQL Editor. SQL only — do not run CLI.

-- Per-draft search cache (D2-A): same query fingerprint → no re-search on regenerate.
-- Shape (jsonb):
-- {
--   "query": "...",
--   "queryFingerprint": "...",
--   "summary": "...",
--   "sources": [{ "title": "...", "url": "..." }],
--   "provider": "tavily",
--   "fetchedAt": "ISO8601"
-- }
alter table public.product_drafts
  add column if not exists web_search_cache jsonb;

comment on column public.product_drafts.web_search_cache is
  'B8/B19: cached Tavily/Serper search payload for this draft; reuse when queryFingerprint matches.';

-- A16-style override map: DEFAULT lives in src/lib/providers/ipToneMap.ts;
-- edit this row to change IP→tone without a deploy. Empty {} = use code defaults only.
-- Example value:
-- { "鬼滅之刃": "中二熱血宣言", "吉伊卡哇": "可愛周邊輕鬆感" }
insert into public.team_settings (key, value)
values (
  'ip_tone_map_overrides',
  '{}'::jsonb
)
on conflict (key) do nothing;
