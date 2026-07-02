-- Nestory v0.2 tag rules seed.
-- Apply after supabase/migrations/004_ip_tag_collection_tables.sql.
-- SQL Editor safe format: every row is a complete idempotent insert.

-- tag_rules
-- IP
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '吉伊卡哇', 'IP_吉伊卡哇', false, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '三麗鷗', 'IP_三麗鷗', false, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '寶可夢', 'IP_寶可夢', false, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '蠟筆小新', 'IP_蠟筆小新', false, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '貓福珊迪', 'IP_貓福珊迪', false, true, 50) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '迪士尼', 'IP_迪士尼', false, true, 60) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '漫威', 'IP_漫威', false, true, 70) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '航海王', 'IP_航海王', false, true, 80) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '咒術迴戰', 'IP_咒術迴戰', false, true, 90) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '火影忍者', 'IP_火影忍者', false, true, 100) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '膽大黨', 'IP_膽大黨', false, true, 110) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '排球少年', 'IP_排球少年', false, true, 120) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', '新世紀福音戰士', 'IP_新世紀福音戰士', false, true, 130) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', 'JOJO', 'IP_JOJO', false, true, 140) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', 'Labubu', 'IP_Labubu', false, true, 150) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', 'CRYBABY', 'IP_CRYBABY', false, true, 160) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('IP', 'SKULLPANDA', 'IP_SKULLPANDA', false, true, 170) on conflict (tag_value) do nothing;
-- 角色
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '小八貓', '角色_小八貓', false, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '吉伊卡哇', '角色_吉伊卡哇', false, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '兔兔', '角色_兔兔', false, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '栗子饅頭', '角色_栗子饅頭', false, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '凱蒂貓', '角色_凱蒂貓', false, true, 50) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '美樂蒂', '角色_美樂蒂', false, true, 60) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '酷洛米', '角色_酷洛米', false, true, 70) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '大耳狗', '角色_大耳狗', false, true, 80) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '布丁狗', '角色_布丁狗', false, true, 85) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '皮卡丘', '角色_皮卡丘', false, true, 90) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '魯夫', '角色_魯夫', false, true, 100) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '索隆', '角色_索隆', false, true, 110) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '喬巴', '角色_喬巴', false, true, 120) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '五條悟', '角色_五條悟', false, true, 130) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '虎杖悠仁', '角色_虎杖悠仁', false, true, 140) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '鳴人', '角色_鳴人', false, true, 150) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '佐助', '角色_佐助', false, true, 160) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '明日香', '角色_明日香', false, true, 170) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '綾波零', '角色_綾波零', false, true, 180) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '蜘蛛人', '角色_蜘蛛人', false, true, 190) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '鋼鐵人', '角色_鋼鐵人', false, true, 200) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('角色', '美國隊長', '角色_美國隊長', false, true, 210) on conflict (tag_value) do nothing;
-- 類型
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '公仔模型', '類型_公仔模型', false, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '景品', '類型_景品', false, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', 'PVC', '類型_PVC', false, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '一番賞大賞', '類型_一番賞大賞', false, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '一番賞小賞', '類型_一番賞小賞', false, true, 50) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '盲盒', '類型_盲盒', false, true, 60) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '扭蛋', '類型_扭蛋', false, true, 70) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '黏土人', '類型_黏土人', false, true, 80) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '娃娃抱枕', '類型_娃娃抱枕', false, true, 90) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '吊飾徽章', '類型_吊飾徽章', false, true, 100) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '壓克力立牌', '類型_壓克力立牌', false, true, 110) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '文具小物', '類型_文具小物', false, true, 120) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '生活雜貨', '類型_生活雜貨', false, true, 130) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '服飾配件', '類型_服飾配件', false, true, 140) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '手機配件', '類型_手機配件', false, true, 150) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '電腦周邊', '類型_電腦周邊', false, true, 160) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('類型', '展示收納', '類型_展示收納', false, true, 170) on conflict (tag_value) do nothing;
-- 情境
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '可愛療癒', '情境_可愛療癒', false, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '桌面佈置', '情境_桌面佈置', false, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '房間佈置', '情境_房間佈置', false, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '手機電腦', '情境_手機電腦', false, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '展示收納', '情境_展示收納', false, true, 50) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '服飾配件', '情境_服飾配件', false, true, 60) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '送禮推薦', '情境_送禮推薦', false, true, 70) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '順手加購', '情境_順手加購', false, true, 80) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '文具小物', '情境_文具小物', false, true, 90) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '收藏展示', '情境_收藏展示', false, true, 100) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '小空間佈置', '情境_小空間佈置', false, true, 110) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '日常實用', '情境_日常實用', false, true, 120) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('情境', '外出小物', '主題_外出小物', false, true, 130) on conflict (tag_value) do nothing;
-- 狀態
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('狀態', '現貨約14天', '狀態_現貨約14天', false, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('狀態', '訂購後叫貨', '狀態_訂購後叫貨', false, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('狀態', '預購商品', '狀態_預購商品', false, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('狀態', '海外訂購', '狀態_海外訂購', false, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('狀態', '售完補貨中', '狀態_售完補貨中', false, true, 50) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('狀態', '限量商品', '狀態_限量商品', false, true, 60) on conflict (tag_value) do nothing;
-- 推薦
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', '新品上架', '推薦_新品上架', false, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', '人氣熱銷', '推薦_人氣熱銷', false, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', '限量收藏', '推薦_限量收藏', false, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', 'CP爆擊', '推薦_CP爆擊', false, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', '順手加購', '推薦_順手加購', false, true, 50) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', '送禮首選', '推薦_送禮首選', false, true, 60) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('推薦', '編輯精選', '推薦_編輯精選', false, true, 70) on conflict (tag_value) do nothing;
-- 商品屬性
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('商品屬性', '二手商品', '商品屬性_二手', true, true, 10) on conflict (tag_value) do nothing;
-- 等級
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('等級', 'SS級', '二手_等級_SS級', true, true, 0) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('等級', 'S級', '二手_等級_S級', true, true, 10) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('等級', 'A級', '二手_等級_A級', true, true, 20) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('等級', 'B級', '二手_等級_B級', true, true, 30) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('等級', 'C級', '二手_等級_C級', true, true, 40) on conflict (tag_value) do nothing;
insert into public.tag_rules (rule_group, label, tag_value, is_secondhand, is_active, sort_order) values ('等級', 'D級', '二手_等級_D級', true, true, 50) on conflict (tag_value) do nothing;
