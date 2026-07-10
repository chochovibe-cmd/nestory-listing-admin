-- A21-3: team_settings-editable IP -> Shopify collection URL map, used by
-- internalLinks.ts to append a rule-based "更多{IP} → 專區連結" line at the
-- end of the description when publishing (payload.ts). Apply after 001-016
-- in Supabase SQL Editor.
--
-- Seeded EMPTY on purpose: we don't know your Shopify collection handles
-- (and AGENTS.md says never guess a URL) -- an IP with no entry here simply
-- gets no internal link appended, never a guessed/possibly-404 one. To turn
-- it on for an IP, edit the `value` jsonb directly in this table, e.g.:
--   {
--     "三麗鷗": "https://your-store.myshopify.com/collections/sanrio",
--     "Chiikawa": "https://your-store.myshopify.com/collections/chiikawa"
--   }
-- Keys are ip_catalog.ip_name values (the same canonical IP name stored in
-- product_drafts.ip_name). No code change or redeploy needed after editing.

insert into public.team_settings (key, value)
values ('internal_link_urls_by_ip', '{}'::jsonb)
on conflict (key) do nothing;
