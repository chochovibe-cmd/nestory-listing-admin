-- 033: tag_rules 同步老闆工具（2026-07-16 zip）——大型娃娃/棉花娃娃(停用)/布丁狗補漏/二手SS tag/吉伊卡哇顯示名與標籤
-- 與我方 004 schema 相容（tag_rules 含 is_secondhand）。可重跑。
-- 注意：老闆工具的 add_ss_secondhand_grade.sql 依賴 product_status 欄位（我方無），刻意不移植；
--       我方 secondhand_grade 無 check 約束，SS級 值可直接使用（表單選項屬 UI 包）。

-- ===== add_large_doll_product_type_tag_rule =====
-- Add large doll product type to tag_rules.
-- Execute in Supabase SQL Editor.

update public.tag_rules
set
  rule_group = U&'\985E\578B',
  label = U&'\5927\578B\5A03\5A03',
  is_secondhand = false,
  is_active = true,
  sort_order = 92
where tag_value = U&'\985E\578B_\5927\578B\5A03\5A03';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\985E\578B', U&'\5927\578B\5A03\5A03', U&'\985E\578B_\5927\578B\5A03\5A03', false, true, 92
where not exists (
  select 1
  from public.tag_rules
  where tag_value = U&'\985E\578B_\5927\578B\5A03\5A03'
);

update public.tag_rules
set
  rule_group = U&'\985E\578B',
  label = U&'\5927\578B\5A03\5A03',
  is_secondhand = true,
  is_active = true,
  sort_order = 92
where tag_value = U&'\4E8C\624B_\985E\578B_\5927\578B\5A03\5A03';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\985E\578B', U&'\5927\578B\5A03\5A03', U&'\4E8C\624B_\985E\578B_\5927\578B\5A03\5A03', true, true, 92
where not exists (
  select 1
  from public.tag_rules
  where tag_value = U&'\4E8C\624B_\985E\578B_\5927\578B\5A03\5A03'
);


-- Keep the current Tags V2 charm collection label available while preserving the older badge alias.
update public.tag_rules
set
  rule_group = U&'\985E\578B',
  label = U&'\540A\98FE\639B\4EF6',
  is_secondhand = false,
  is_active = true,
  sort_order = 100
where tag_value = U&'\985E\578B_\540A\98FE\639B\4EF6';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\985E\578B', U&'\540A\98FE\639B\4EF6', U&'\985E\578B_\540A\98FE\639B\4EF6', false, true, 100
where not exists (
  select 1
  from public.tag_rules
  where tag_value = U&'\985E\578B_\540A\98FE\639B\4EF6'
);

update public.tag_rules
set
  rule_group = U&'\985E\578B',
  label = U&'\540A\98FE\639B\4EF6',
  is_secondhand = true,
  is_active = true,
  sort_order = 100
where tag_value = U&'\4E8C\624B_\985E\578B_\540A\98FE\639B\4EF6';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\985E\578B', U&'\540A\98FE\639B\4EF6', U&'\4E8C\624B_\985E\578B_\540A\98FE\639B\4EF6', true, true, 100
where not exists (
  select 1
  from public.tag_rules
  where tag_value = U&'\4E8C\624B_\985E\578B_\540A\98FE\639B\4EF6'
);

-- ===== add_cotton_doll_product_type_tag_rule =====
-- Add cotton doll product type to tag_rules.
-- Execute in Supabase SQL Editor.

update public.tag_rules
set
  rule_group = U&'\985E\578B',
  label = U&'\68C9\82B1\5A03\5A03',
  is_secondhand = false,
  is_active = true,
  sort_order = 86
where tag_value = U&'\985E\578B_\68C9\82B1\5A03\5A03';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\985E\578B', U&'\68C9\82B1\5A03\5A03', U&'\985E\578B_\68C9\82B1\5A03\5A03', false, true, 86
where not exists (
  select 1
  from public.tag_rules
  where tag_value = U&'\985E\578B_\68C9\82B1\5A03\5A03'
);

update public.tag_rules
set
  rule_group = U&'\985E\578B',
  label = U&'\68C9\82B1\5A03\5A03',
  is_secondhand = true,
  is_active = true,
  sort_order = 86
where tag_value = U&'\4E8C\624B_\985E\578B_\68C9\82B1\5A03\5A03';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\985E\578B', U&'\68C9\82B1\5A03\5A03', U&'\4E8C\624B_\985E\578B_\68C9\82B1\5A03\5A03', true, true, 86
where not exists (
  select 1
  from public.tag_rules
  where tag_value = U&'\4E8C\624B_\985E\578B_\68C9\82B1\5A03\5A03'
);
-- ===== disable_cotton_doll_product_type_tag_rule =====
-- Disable cotton doll as a selectable product type.
-- Keep existing data and historical tag_rules rows; new products should use 絨毛娃娃.

update public.tag_rules
set is_active = false
where rule_group = '類型'
  and (label = '棉花娃娃' or tag_value = '類型_棉花娃娃');

-- ===== add_missing_tag_rules_for_pompompurin =====
insert into public.tag_rules
  (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
values
  ('角色', '布丁狗', '角色_布丁狗', false, true, 85),
  ('情境', '外出小物', '主題_外出小物', false, true, 130)
on conflict (tag_value) do update
set
  rule_group = excluded.rule_group,
  label = excluded.label,
  is_secondhand = excluded.is_secondhand,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();
-- ===== add_ss_secondhand_tag_rule =====
insert into public.tag_rules
  (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
values
  ('等級', 'SS級', '二手_等級_SS級', true, true, 0)
on conflict (tag_value) do update
set
  rule_group = excluded.rule_group,
  label = excluded.label,
  is_secondhand = excluded.is_secondhand,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  updated_at = now();

-- ===== update_chiikawa_character_display_names =====
begin;

delete from public.ip_characters
where ip_name = '吉伊卡哇';

insert into public.ip_characters (ip_name, character_name, aliases, sort_order, is_active)
values
  ('吉伊卡哇', '吉伊卡哇', array['吉伊','ちいかわ','Chiikawa','小可愛']::text[], 10, true),
  ('吉伊卡哇', '小八', array['小八貓','哈奇','ハチワレ','Hachiware']::text[], 20, true),
  ('吉伊卡哇', '烏薩奇', array['兔兔','兔子','兔哥','うさぎ','Usagi']::text[], 30, true),
  ('吉伊卡哇', '小桃', array['飛鼠','桃鼠','莫莫加','モモンガ','Momonga']::text[], 40, true),
  ('吉伊卡哇', '栗子饅頭', array['栗饅頭','栗子','くりまんじゅう','Kurimanju']::text[], 50, true),
  ('吉伊卡哇', '海獺勇者', array['海獺','勇者','ラッコ','Rakko']::text[], 60, true),
  ('吉伊卡哇', '獅薩', array['風獅爺','シーサー','Shisa']::text[], 70, true),
  ('吉伊卡哇', '古本屋', array['古本','螃蟹','カニ','Kan']::text[], 80, true),
  ('吉伊卡哇', '盔甲先生', array['鎧甲先生','盔甲','鎧さん','Armor']::text[], 90, true),
  ('吉伊卡哇', '勞動盔甲', array['勞動鎧甲','工作盔甲','労働の鎧さん']::text[], 100, true),
  ('吉伊卡哇', '包包盔甲', array['包包鎧甲','ポシェットの鎧さん']::text[], 110, true),
  ('吉伊卡哇', '拉麵盔甲', array['拉麵鎧甲','ラーメンの鎧さん']::text[], 120, true),
  ('吉伊卡哇', '大強', array['大隻強','でかつよ','Dekatsuyo']::text[], 130, true),
  ('吉伊卡哇', '阿之子', array['那孩子','那個孩子','あのこ','Anoko']::text[], 140, true),
  ('吉伊卡哇', '奇美拉', array['合成獸','キメラ','Chimera']::text[], 150, true)
on conflict (ip_name, character_name) do update set
  aliases = excluded.aliases,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

commit;

-- ===== update_chiikawa_tag_rules_labels =====
-- Localize Chiikawa character display names and tag_rules labels.
-- Execute after ip_catalog/ip_characters and tag_rules exist.
-- Uses update + insert where not exists; no ON CONFLICT required.

with chiikawa_characters(ip_name, character_name, aliases, sort_order, is_active) as (
  values
    (U&'\5409\4F0A\5361\54C7', U&'\5C0F\516B', array[U&'\5C0F\516B\8C93', U&'\54C8\5947', U&'\30CF\30C1\30EF\30EC', 'Hachiware']::text[], 20, true),
    (U&'\5409\4F0A\5361\54C7', U&'\70CF\85A9\5947', array[U&'\5154\5154', U&'\5154\5B50', U&'\5154\54E5', U&'\3046\3055\304E', 'Usagi']::text[], 30, true),
    (U&'\5409\4F0A\5361\54C7', U&'\5C0F\6843', array[U&'\98DB\9F20', U&'\6843\9F20', U&'\83AB\83AB\52A0', U&'\30E2\30E2\30F3\30AC', 'Momonga']::text[], 40, true)
)
update public.ip_characters target
set
  character_name = source.character_name,
  aliases = source.aliases,
  sort_order = source.sort_order,
  is_active = source.is_active
from chiikawa_characters source
where target.ip_name = source.ip_name
  and (
    target.character_name = source.character_name
    or target.character_name = any(source.aliases)
  );

with chiikawa_characters(ip_name, character_name, aliases, sort_order, is_active) as (
  values
    (U&'\5409\4F0A\5361\54C7', U&'\5C0F\516B', array[U&'\5C0F\516B\8C93', U&'\54C8\5947', U&'\30CF\30C1\30EF\30EC', 'Hachiware']::text[], 20, true),
    (U&'\5409\4F0A\5361\54C7', U&'\70CF\85A9\5947', array[U&'\5154\5154', U&'\5154\5B50', U&'\5154\54E5', U&'\3046\3055\304E', 'Usagi']::text[], 30, true),
    (U&'\5409\4F0A\5361\54C7', U&'\5C0F\6843', array[U&'\98DB\9F20', U&'\6843\9F20', U&'\83AB\83AB\52A0', U&'\30E2\30E2\30F3\30AC', 'Momonga']::text[], 40, true)
)
insert into public.ip_characters (ip_name, character_name, aliases, sort_order, is_active)
select source.ip_name, source.character_name, source.aliases, source.sort_order, source.is_active
from chiikawa_characters source
where not exists (
  select 1
  from public.ip_characters existing
  where existing.ip_name = source.ip_name
    and existing.character_name = source.character_name
);

with character_rules(label, aliases, sort_order) as (
  values
    (U&'\5409\4F0A\5361\54C7', array[U&'\5409\4F0A', U&'\3061\3044\304B\308F', 'Chiikawa', U&'\5C0F\53EF\611B']::text[], 10),
    (U&'\5C0F\516B', array[U&'\5C0F\516B\8C93', U&'\54C8\5947', U&'\30CF\30C1\30EF\30EC', 'Hachiware']::text[], 20),
    (U&'\70CF\85A9\5947', array[U&'\5154\5154', U&'\5154\5B50', U&'\5154\54E5', U&'\3046\3055\304E', 'Usagi']::text[], 30),
    (U&'\5C0F\6843', array[U&'\98DB\9F20', U&'\6843\9F20', U&'\83AB\83AB\52A0', U&'\30E2\30E2\30F3\30AC', 'Momonga']::text[], 40),
    (U&'\6817\5B50\9945\982D', array[U&'\6817\9945\982D', U&'\6817\5B50', U&'\304F\308A\307E\3093\3058\3085\3046', 'Kurimanju']::text[], 50),
    (U&'\6D77\737A\52C7\8005', array[U&'\6D77\737A', U&'\52C7\8005', U&'\30E9\30C3\30B3', 'Rakko']::text[], 60),
    (U&'\7345\85A9', array[U&'\98A8\7345\723A', U&'\30B7\30FC\30B5\30FC', 'Shisa']::text[], 70),
    (U&'\53E4\672C\5C4B', array[U&'\53E4\672C', U&'\8783\87F9', U&'\30AB\30CB', 'Kan']::text[], 80),
    (U&'\76D4\7532\5148\751F', array[U&'\93A7\7532\5148\751F', U&'\76D4\7532', U&'\93A7\3055\3093', 'Armor']::text[], 90),
    (U&'\52DE\52D5\76D4\7532', array[U&'\52DE\52D5\93A7\7532', U&'\5DE5\4F5C\76D4\7532', U&'\52B4\50CD\306E\93A7\3055\3093']::text[], 100),
    (U&'\5305\5305\76D4\7532', array[U&'\5305\5305\93A7\7532', U&'\30DD\30B7\30A7\30C3\30C8\306E\93A7\3055\3093']::text[], 110),
    (U&'\62C9\9EB5\76D4\7532', array[U&'\62C9\9EB5\93A7\7532', U&'\30E9\30FC\30E1\30F3\306E\93A7\3055\3093']::text[], 120),
    (U&'\5927\5F37', array[U&'\5927\96BB\5F37', U&'\3067\304B\3064\3088', 'Dekatsuyo']::text[], 130),
    (U&'\963F\4E4B\5B50', array[U&'\90A3\5B69\5B50', U&'\90A3\500B\5B69\5B50', U&'\3042\306E\3053', 'Anoko']::text[], 140),
    (U&'\5947\7F8E\62C9', array[U&'\5408\6210\7378', U&'\30AD\30E1\30E9', 'Chimera']::text[], 150)
), normal_rules as (
  select label, aliases, U&'\89D2\8272_' || label as tag_value, sort_order
  from character_rules
), secondhand_rules as (
  select label, aliases, U&'\4E8C\624B_\89D2\8272_' || label as tag_value, sort_order
  from character_rules
)
update public.tag_rules target
set
  label = source.label,
  tag_value = source.tag_value,
  sort_order = source.sort_order,
  is_active = true
from normal_rules source
where target.rule_group = U&'\89D2\8272'
  and coalesce(target.is_secondhand, false) = false
  and (
    target.label = source.label
    or target.label = any(source.aliases)
    or replace(target.tag_value, U&'\89D2\8272_', '') = source.label
    or replace(target.tag_value, U&'\89D2\8272_', '') = any(source.aliases)
  )
  and not exists (
    select 1
    from public.tag_rules existing
    where existing.tag_value = source.tag_value
      and existing.id <> target.id
  );

with character_rules(label, aliases, sort_order) as (
  values
    (U&'\5C0F\516B', array[U&'\5C0F\516B\8C93', U&'\54C8\5947', U&'\30CF\30C1\30EF\30EC', 'Hachiware']::text[], 20),
    (U&'\70CF\85A9\5947', array[U&'\5154\5154', U&'\5154\5B50', U&'\5154\54E5', U&'\3046\3055\304E', 'Usagi']::text[], 30),
    (U&'\5C0F\6843', array[U&'\98DB\9F20', U&'\6843\9F20', U&'\83AB\83AB\52A0', U&'\30E2\30E2\30F3\30AC', 'Momonga']::text[], 40)
), normal_rules as (
  select label, aliases, U&'\89D2\8272_' || label as tag_value
  from character_rules
), secondhand_rules as (
  select label, aliases, U&'\4E8C\624B_\89D2\8272_' || label as tag_value
  from character_rules
)
update public.tag_rules target
set is_active = false
from normal_rules source
where target.rule_group = U&'\89D2\8272'
  and coalesce(target.is_secondhand, false) = false
  and target.label = any(source.aliases)
  and exists (
    select 1 from public.tag_rules existing where existing.tag_value = source.tag_value
  );

with character_rules(label, aliases, sort_order) as (
  values
    (U&'\5409\4F0A\5361\54C7', array[U&'\5409\4F0A', U&'\3061\3044\304B\308F', 'Chiikawa', U&'\5C0F\53EF\611B']::text[], 10),
    (U&'\5C0F\516B', array[U&'\5C0F\516B\8C93', U&'\54C8\5947', U&'\30CF\30C1\30EF\30EC', 'Hachiware']::text[], 20),
    (U&'\70CF\85A9\5947', array[U&'\5154\5154', U&'\5154\5B50', U&'\5154\54E5', U&'\3046\3055\304E', 'Usagi']::text[], 30),
    (U&'\5C0F\6843', array[U&'\98DB\9F20', U&'\6843\9F20', U&'\83AB\83AB\52A0', U&'\30E2\30E2\30F3\30AC', 'Momonga']::text[], 40),
    (U&'\6817\5B50\9945\982D', array[U&'\6817\9945\982D', U&'\6817\5B50', U&'\304F\308A\307E\3093\3058\3085\3046', 'Kurimanju']::text[], 50),
    (U&'\6D77\737A\52C7\8005', array[U&'\6D77\737A', U&'\52C7\8005', U&'\30E9\30C3\30B3', 'Rakko']::text[], 60),
    (U&'\7345\85A9', array[U&'\98A8\7345\723A', U&'\30B7\30FC\30B5\30FC', 'Shisa']::text[], 70),
    (U&'\53E4\672C\5C4B', array[U&'\53E4\672C', U&'\8783\87F9', U&'\30AB\30CB', 'Kan']::text[], 80),
    (U&'\76D4\7532\5148\751F', array[U&'\93A7\7532\5148\751F', U&'\76D4\7532', U&'\93A7\3055\3093', 'Armor']::text[], 90),
    (U&'\52DE\52D5\76D4\7532', array[U&'\52DE\52D5\93A7\7532', U&'\5DE5\4F5C\76D4\7532', U&'\52B4\50CD\306E\93A7\3055\3093']::text[], 100),
    (U&'\5305\5305\76D4\7532', array[U&'\5305\5305\93A7\7532', U&'\30DD\30B7\30A7\30C3\30C8\306E\93A7\3055\3093']::text[], 110),
    (U&'\62C9\9EB5\76D4\7532', array[U&'\62C9\9EB5\93A7\7532', U&'\30E9\30FC\30E1\30F3\306E\93A7\3055\3093']::text[], 120),
    (U&'\5927\5F37', array[U&'\5927\96BB\5F37', U&'\3067\304B\3064\3088', 'Dekatsuyo']::text[], 130),
    (U&'\963F\4E4B\5B50', array[U&'\90A3\5B69\5B50', U&'\90A3\500B\5B69\5B50', U&'\3042\306E\3053', 'Anoko']::text[], 140),
    (U&'\5947\7F8E\62C9', array[U&'\5408\6210\7378', U&'\30AD\30E1\30E9', 'Chimera']::text[], 150)
), normal_rules as (
  select label, U&'\89D2\8272_' || label as tag_value, sort_order
  from character_rules
), secondhand_rules as (
  select label, U&'\4E8C\624B_\89D2\8272_' || label as tag_value, sort_order
  from character_rules
)
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\89D2\8272', label, tag_value, false, true, sort_order
from normal_rules source
where not exists (
  select 1 from public.tag_rules existing where existing.tag_value = source.tag_value
);

with character_rules(label, sort_order) as (
  values
    (U&'\5409\4F0A\5361\54C7', 10),
    (U&'\5C0F\516B', 20),
    (U&'\70CF\85A9\5947', 30),
    (U&'\5C0F\6843', 40),
    (U&'\6817\5B50\9945\982D', 50),
    (U&'\6D77\737A\52C7\8005', 60),
    (U&'\7345\85A9', 70),
    (U&'\53E4\672C\5C4B', 80),
    (U&'\76D4\7532\5148\751F', 90),
    (U&'\52DE\52D5\76D4\7532', 100),
    (U&'\5305\5305\76D4\7532', 110),
    (U&'\62C9\9EB5\76D4\7532', 120),
    (U&'\5927\5F37', 130),
    (U&'\963F\4E4B\5B50', 140),
    (U&'\5947\7F8E\62C9', 150)
), secondhand_rules as (
  select label, U&'\4E8C\624B_\89D2\8272_' || label as tag_value, sort_order
  from character_rules
)
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select U&'\89D2\8272', label, tag_value, true, true, sort_order
from secondhand_rules source
where not exists (
  select 1 from public.tag_rules existing where existing.tag_value = source.tag_value
);
