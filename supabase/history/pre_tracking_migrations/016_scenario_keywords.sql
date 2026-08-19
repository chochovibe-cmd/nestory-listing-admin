-- A16: Taiwan long-tail scenario keyword dictionary (type -> scenario terms),
-- used by the rule engine to pick 1-2 fixed candidates into seo_title/meta
-- and the D段 "適用情境" bullet (A17) -- never left to the LLM to invent.
-- Apply after 001-015 in Supabase SQL Editor.
--
-- Content reviewed 2026-07-10 (marketing pass): dropped 送禮首選 (ad-speak,
-- no search volume), added 生日禮物, reordered so the strongest terms sit
-- first (the picker always takes the first 1-2). Edit the `value` jsonb
-- directly in this table to correct/extend it without a code change.
-- Keys are the canonical product-type labels normalizeProductTypeForDisplay()
-- / titleGenerator.ts's PRODUCT_TYPE_ALIASES already produce.
-- `do update` on purpose: if the pre-review seed was already applied, this
-- replaces it with the reviewed version.

insert into public.team_settings (key, value)
values (
  'scenario_keywords_by_type',
  '{
    "吊飾掛件": ["包包掛飾", "交換禮物", "生日禮物", "書包裝飾"],
    "絨毛娃娃": ["療癒小物", "生日禮物", "交換禮物", "房間佈置"],
    "盲盒": ["交換禮物", "開箱驚喜", "收藏系列"],
    "扭蛋": ["桌面小物", "交換禮物", "收藏系列"],
    "娃娃抱枕": ["療癒小物", "午睡神器", "生日禮物"],
    "壓克力立牌": ["桌面擺飾", "追星應援", "收藏展示"],
    "手機支架": ["追劇神器", "辦公桌小物", "實用禮物"],
    "公仔模型": ["收藏展示", "桌面擺飾", "生日禮物"]
  }'::jsonb
)
on conflict (key) do update set value = excluded.value;
