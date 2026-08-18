-- P5 層2: ip_catalog.knowledge_pack jsonb + Top21 seed (code DEFAULT 同源).
-- Apply after 037 in Supabase SQL Editor. SQL only — do not run CLI.
-- Shape: { relations, scenes, fandom_hooks, keywords, updated_at, version }
-- Runtime: DEFAULT in src/lib/providers/ipKnowledgePack.ts; DB non-null overlays.
-- Honesty: packs are for tone/fandom only — never product-spec facts.

alter table public.ip_catalog
  add column if not exists knowledge_pack jsonb;

comment on column public.ip_catalog.knowledge_pack is
  'P5: IP lore pack {relations,scenes,fandom_hooks,keywords,updated_at,version}; tone/fandom only, not product specs.';

-- Seed / refresh Top21 (+ dual keys). Safe to re-run (overwrites knowledge_pack for these names).
update public.ip_catalog
set knowledge_pack = '{"relations":"吉伊（Chiikawa）膽小愛哭愛吃；好友小八（Hachiware）溫柔穩重；兔兔（Usagi）奔放愛喊「ヤハ」；栗子饅頭、獅薩等常一起出現。","scenes":"討伐怪物、泡澡、上班、吃草泥馬肉包、被奇怪生物追、三人日常互動。","fandom_hooks":"討伐、小可愛、ヤハ、那個誰、くりまんじゅう。","keywords":["ちいかわ","小八","兔兔","討伐","療癒"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '吉伊卡哇';

update public.ip_catalog
set knowledge_pack = '{"relations":"Hello Kitty 為品牌核心；大耳狗、美樂蒂、酷洛米、布丁狗、大寶等角色各自粉絲圈，常聯名跨界。","scenes":"三麗鷗樂園、角色生日祭、粉紅／酷黑配色周邊、聯名家電與小物。","fandom_hooks":"Kitty 蝴蝶結、酷洛米反差萌、大耳狗純白療癒、三麗鷗男子。","keywords":["Sanrio","Hello Kitty","酷洛米","大耳狗","美樂蒂"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '三麗鷗';

update public.ip_catalog
set knowledge_pack = '{"relations":"角落生物喜歡待在角落；白熊、企鵝？、貓、炸豬排、蜥蜴等各有內向小故事，角落妖精偶爾登場。","scenes":"縮在角落、喫茶店、學校、海洋、旅行主題的角落日常。","fandom_hooks":"角落、內向、炸豬排是假貨？、企鵝其實是皇帝企鵝。","keywords":["すみっコぐらし","角落生物","白熊","炸豬排","療癒"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'Sumikko Gurashi';

update public.ip_catalog
set knowledge_pack = '{"relations":"角落生物喜歡待在角落；白熊、企鵝？、貓、炸豬排、蜥蜴等各有內向小故事，角落妖精偶爾登場。","scenes":"縮在角落、喫茶店、學校、海洋、旅行主題的角落日常。","fandom_hooks":"角落、內向、炸豬排是假貨？、企鵝其實是皇帝企鵝。","keywords":["すみっコぐらし","角落生物","白熊","炸豬排","療癒"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '角落小夥伴';

update public.ip_catalog
set knowledge_pack = '{"relations":"角落生物喜歡待在角落；白熊、企鵝？、貓、炸豬排、蜥蜴等各有內向小故事。","scenes":"縮在角落、喫茶店、學校、旅行主題日常。","fandom_hooks":"角落、內向、炸豬排是假貨？","keywords":["すみっコぐらし","角落生物","白熊","療癒"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '角落生物';

update public.ip_catalog
set knowledge_pack = '{"relations":"mofusand 筆下貓咪常戴鯊魚帽或變裝；無固定劇情主線，以插畫造型系列為主。","scenes":"鯊魚貓、食物變裝、海洋與甜點主題插畫周邊。","fandom_hooks":"鯊魚貓、モフサンド、軟萌變裝貓。","keywords":["mofusand","貓福珊迪","鯊魚貓","モフサンド"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'Mofusand';

update public.ip_catalog
set knowledge_pack = '{"relations":"訓練家收服寶可夢冒險；皮卡丘為招牌，御三家、進化鏈、道館與聯盟是核心結構。","scenes":"初次選寶可夢、進化瞬間、道館徽章、傳說遇敵、寶可夢中心。","fandom_hooks":"收服、進化、道館、我選擇你、圖鑑收集。","keywords":["Pokémon","皮卡丘","訓練家","進化","圖鑑"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '寶可夢';

update public.ip_catalog
set knowledge_pack = '{"relations":"竈門炭治郎尋妹禰豆子（鬼化）之路；義勇、善逸、伊之助等同儕；柱們與鬼舞辻無慘對立。","scenes":"水之呼吸型、全集中、那田蜘蛛山、無限列車、遊郭、刀鍛冶之里。","fandom_hooks":"全集中、呼吸法、豆子箱、善逸睡觉放電、岩柱幽默。","keywords":["鬼滅","炭治郎","禰豆子","呼吸","柱"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '鬼滅之刃';

update public.ip_catalog
set knowledge_pack = '{"relations":"蒙其·D·魯夫組草帽海賊團尋找 One Piece；伙伴各有夢想，與四皇、海軍、革命軍交錯。","scenes":"伸縮橡膠拳、懸賞單更新、惡魔果實覺醒、海上餐廳與新世界島嶼。","fandom_hooks":"肉、夥伴、海賊王、懸賞金、D 之一族。","keywords":["ONE PIECE","魯夫","草帽","惡魔果實","懸賞"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '航海王';

update public.ip_catalog
set knowledge_pack = '{"relations":"漩渦鳴人立志成為火影；佐助復仇線、卡卡西指導、忍界大戰與尾獸。","scenes":"影分身、寫輪眼／輪迴眼、中忍考試、佩恩襲擊木葉、終末之谷。","fandom_hooks":"鳴人啊、曉、查克拉、羈絆、忍道。","keywords":["Naruto","鳴人","佐助","火影","忍術"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '火影忍者';

update public.ip_catalog
set knowledge_pack = '{"relations":"虎杖悠仁吞宿儺手指進入咒術高專；伏黑、釘崎、五條悟與咒詛師／咒靈對抗。","scenes":"領域展開、渋谷事變、特級咒物、無量空處。","fandom_hooks":"領域展開、宿儺、五條老師、咒力。","keywords":["JJK","虎杖","五條悟","領域展開","咒靈"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '咒術迴戰';

update public.ip_catalog
set knowledge_pack = '{"relations":"淀治與波奇塔合體成電鋸人；瑪奇瑪、早川秋、帕瓦等同儕與惡魔公使線交錯，黑色幽默重。","scenes":"電鋸啟動、惡魔契約、公安對惡魔、突如其來的悲劇反轉。","fandom_hooks":"波奇塔、電次、黑暗幽默、惡魔名字梗。","keywords":["Chainsaw Man","電鋸人","波奇塔","瑪奇瑪","惡魔"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '鏈鋸人';

update public.ip_catalog
set knowledge_pack = '{"relations":"野原新之助一家住春日部；風間、阿呆、正男、妮妮是幼稚園同學，動感超人是偶像。","scenes":"屁股舞、動感超人變身、媽媽揍小新、旅行與劇場版冒險。","fandom_hooks":"喔喔喔、動感光波、屁股左搖右搖、媽媽的拖鞋。","keywords":["小新","春日部","動感超人","野原","幼稚園"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '蠟筆小新';

update public.ip_catalog
set knowledge_pack = '{"relations":"黃昏（洛伊德）假結婚約兒，領養安妮亞組成偽裝家庭；約兒暗地是刺客，邦德是超能狗。","scenes":"作業竊聽、優雅的暗殺、花生迷安妮亞、東國西國冷戰日常。","fandom_hooks":"哇酷哇酷、洛伊德的假笑、尤里姐控、花生。","keywords":["SPY×FAMILY","安妮亞","洛伊德","約兒","邦德"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '間諜家家酒';

update public.ip_catalog
set knowledge_pack = '{"relations":"魔法使芙莉蓮壽命極長，勇者一行解散後重新踏上理解「人」的旅途；菲倫、修塔爾克同行。","scenes":"勇者希梅爾之墓、魔法考試、惡魔交涉、風景與告別。","fandom_hooks":"旅途很長、希梅爾會怎麼做、魔法收集。","keywords":["Frieren","芙莉蓮","菲倫","希梅爾","魔法"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '葬送的芙莉蓮';

update public.ip_catalog
set knowledge_pack = '{"relations":"迪士尼經典與皮克斯角色宇宙；米奇家族為符號，公主系列、反派與主題樂園體驗並存。","scenes":"樂園遊行、經典童話結局、跨作品彩蛋與紀念周邊。","fandom_hooks":"夢想、魔法、迪士尼公主、米老鼠剪影。","keywords":["Disney","米奇","公主","樂園","經典"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '迪士尼';

update public.ip_catalog
set knowledge_pack = '{"relations":"實驗體 626 史迪奇流落夏威夷，被里洛收養；「歐哈納」＝家人，彼此不拋棄。","scenes":"衝浪、草裙舞、太空追緝、史迪奇搗蛋與贖罪。","fandom_hooks":"歐哈納、阿囉哈、626、藍色搗蛋鬼。","keywords":["Stitch","史迪奇","里洛","歐哈納","夏威夷"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '星際寶貝';

update public.ip_catalog
set knowledge_pack = '{"relations":"實驗體 626 史迪奇流落夏威夷，被里洛收養；歐哈納＝家人。","scenes":"衝浪、搗蛋、太空追緝與家庭羈絆。","fandom_hooks":"歐哈納、626、阿囉哈。","keywords":["Stitch","史迪奇","里洛","歐哈納"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'Lilo & Stitch';

update public.ip_catalog
set knowledge_pack = '{"relations":"月野兔變身水手月亮，與水手戰士守護地球；地場衛／タキシード假面、月野貓露娜同行。","scenes":"變身咒語、月光權杖、銀水晶、對暗黑王國戰鬥。","fandom_hooks":"以月亮之名、變身器、內在宇宙、美戰老粉懷舊。","keywords":["Sailor Moon","水手月亮","月光","銀水晶","變身"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '美少女戰士';

update public.ip_catalog
set knowledge_pack = '{"relations":"Crypton 虛擬歌姬 Hatsune Miku；蔥意象、粉絲創作歌曲與Live，無單一官方劇情主線。","scenes":"演唱會全息Live、磁鐵舞、雙馬尾蔥色造型。","fandom_hooks":"世界第一的公主殿下、蔥、VOCALOID、DD。","keywords":["Miku","VOCALOID","初音","雙馬尾","全息"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '初音未來';

update public.ip_catalog
set knowledge_pack = '{"relations":"泡泡瑪特 THE MONSTERS 系列；Labubu 尖牙精靈最具辨識度，與其他怪物造型並存，偏潮玩收藏。","scenes":"盲盒開箱、大型公仔、聯名與隱藏款追獵。","fandom_hooks":"Labubu、拉布布、隱藏款、潮玩櫃。","keywords":["Labubu","拉布布","POP MART","盲盒","潮玩"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'THE MONSTERS';

update public.ip_catalog
set knowledge_pack = '{"relations":"哈利進入霍格華茲，與榮恩、赫敏組團對抗佛地魔；學院帽分院、魔法世界法則完整。","scenes":"上車九又四分之三月台、魁地奇、三巫鬥法、霍格華茲戰役。","fandom_hooks":"分院、妙麗的包、阿瓦達索命、馬份對立。","keywords":["Harry Potter","霍格華茲","魔法","分院","魔杖"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = '哈利波特';

update public.ip_catalog
set knowledge_pack = '{"relations":"哈利進入霍格華茲，與榮恩、赫敏對抗佛地魔；學院與魔法世界法則完整。","scenes":"九又四分之三月台、魁地奇、霍格華茲戰役。","fandom_hooks":"分院、三強、魔法世界。","keywords":["Harry Potter","霍格華茲","魔法","分院"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'Harry Potter';

update public.ip_catalog
set knowledge_pack = '{"relations":"漫威英雄宇宙；復仇者、蜘蛛人、X 戰警等支線交錯，電影宇宙（MCU）強化大眾記憶。","scenes":"英雄集結、無限寶石、身份揭祕、城市大戰。","fandom_hooks":"I am Iron Man、無限手套、英雄穿模。","keywords":["漫威","復仇者","MCU","英雄","超能力"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'Marvel';

update public.ip_catalog
set knowledge_pack = '{"relations":"Dick Bruna 創作的米菲兔；線條簡潔、色彩明亮，家人與小動物朋友構成溫柔繪本世界。","scenes":"騎腳踏車、過生日、看星星、日常生活小事件。","fandom_hooks":"米飛／米菲、荷蘭繪本、簡筆兔、Nijntje。","keywords":["米菲","米飛","Nijntje","Dick Bruna","繪本"],"updated_at":"2026-07-19","version":1}'::jsonb,
    updated_at = now()
where ip_name = 'Miffy';
