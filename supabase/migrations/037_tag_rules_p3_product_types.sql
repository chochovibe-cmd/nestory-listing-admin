-- 037: P3 類型目錄擴充 — tag_rules 種子（2026-07-18）
-- 新類型：滑鼠、鍵盤、手把控制器、保溫杯瓶
-- 比照 033：每類型寫 類型_X ＋ 二手_類型_X；可重跑（update + insert where not exists）。
-- 大型娃娃已在 033，本檔不重複。
-- 純 alias 擴充（耳機→藍牙耳機、喇叭→藍牙音響、充電／滑鼠墊／鍵帽／收納）只在 nestoryTagsV2.ts，無 SQL。

-- ===== 滑鼠 =====
update public.tag_rules
set
  rule_group = '類型',
  label = '滑鼠',
  is_secondhand = false,
  is_active = true,
  sort_order = 180
where tag_value = '類型_滑鼠';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '滑鼠', '類型_滑鼠', false, true, 180
where not exists (
  select 1 from public.tag_rules where tag_value = '類型_滑鼠'
);

update public.tag_rules
set
  rule_group = '類型',
  label = '滑鼠',
  is_secondhand = true,
  is_active = true,
  sort_order = 180
where tag_value = '二手_類型_滑鼠';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '滑鼠', '二手_類型_滑鼠', true, true, 180
where not exists (
  select 1 from public.tag_rules where tag_value = '二手_類型_滑鼠'
);

-- ===== 鍵盤 =====
update public.tag_rules
set
  rule_group = '類型',
  label = '鍵盤',
  is_secondhand = false,
  is_active = true,
  sort_order = 190
where tag_value = '類型_鍵盤';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '鍵盤', '類型_鍵盤', false, true, 190
where not exists (
  select 1 from public.tag_rules where tag_value = '類型_鍵盤'
);

update public.tag_rules
set
  rule_group = '類型',
  label = '鍵盤',
  is_secondhand = true,
  is_active = true,
  sort_order = 190
where tag_value = '二手_類型_鍵盤';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '鍵盤', '二手_類型_鍵盤', true, true, 190
where not exists (
  select 1 from public.tag_rules where tag_value = '二手_類型_鍵盤'
);

-- ===== 手把控制器 =====
update public.tag_rules
set
  rule_group = '類型',
  label = '手把控制器',
  is_secondhand = false,
  is_active = true,
  sort_order = 200
where tag_value = '類型_手把控制器';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '手把控制器', '類型_手把控制器', false, true, 200
where not exists (
  select 1 from public.tag_rules where tag_value = '類型_手把控制器'
);

update public.tag_rules
set
  rule_group = '類型',
  label = '手把控制器',
  is_secondhand = true,
  is_active = true,
  sort_order = 200
where tag_value = '二手_類型_手把控制器';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '手把控制器', '二手_類型_手把控制器', true, true, 200
where not exists (
  select 1 from public.tag_rules where tag_value = '二手_類型_手把控制器'
);

-- ===== 保溫杯瓶 =====
update public.tag_rules
set
  rule_group = '類型',
  label = '保溫杯瓶',
  is_secondhand = false,
  is_active = true,
  sort_order = 210
where tag_value = '類型_保溫杯瓶';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '保溫杯瓶', '類型_保溫杯瓶', false, true, 210
where not exists (
  select 1 from public.tag_rules where tag_value = '類型_保溫杯瓶'
);

update public.tag_rules
set
  rule_group = '類型',
  label = '保溫杯瓶',
  is_secondhand = true,
  is_active = true,
  sort_order = 210
where tag_value = '二手_類型_保溫杯瓶';

insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order)
select '類型', '保溫杯瓶', '二手_類型_保溫杯瓶', true, true, 210
where not exists (
  select 1 from public.tag_rules where tag_value = '二手_類型_保溫杯瓶'
);
