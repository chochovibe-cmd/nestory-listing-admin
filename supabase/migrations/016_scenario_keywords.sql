-- A16: Taiwan long-tail scenario keyword dictionary (type -> scenario terms),
-- used by the rule engine to pick 1-2 fixed candidates into seo_title/meta
-- and the D段 "適用情境" bullet (A17) -- never left to the LLM to invent.
-- Apply after 001-015 in Supabase SQL Editor.
--
-- Initial content is an AI draft (待老闆審 -- see docs/施工清單.md 待確認清單),
-- seeded so the feature works end-to-end before review; edit the `value`
-- jsonb directly in this table to correct/extend it without a code change.
-- Keys are the canonical product-type labels normalizeProductTypeForDisplay()
-- / titleGenerator.ts's PRODUCT_TYPE_ALIASES already produce.

insert into public.team_settings (key, value)
values (
  'scenario_keywords_by_type',
  '{
    "吊飾掛件": ["包包掛飾", "交換禮物", "書包裝飾", "送禮首選"],
    "絨毛娃娃": ["療癒小物", "送禮首選", "桌面擺飾", "交換禮物"],
    "盲盒": ["開箱驚喜", "收藏系列", "交換禮物"],
    "扭蛋": ["收藏系列", "桌面小物"],
    "娃娃抱枕": ["療癒小物", "沙發擺飾", "送禮首選"],
    "壓克力立牌": ["桌面擺飾", "收藏展示"],
    "手機支架": ["桌面小物", "辦公室擺飾"],
    "公仔模型": ["收藏展示", "送禮首選"]
  }'::jsonb
)
on conflict (key) do nothing;
