-- 032: IP 目錄 V3（100 IP enrichment），移植自老闆工具 nestory-product-assistant (2026-07-16 zip)
-- 安全式：不改名、不刪；既有 IP 以 alias 補強。與我方 004 schema 相容（ip_catalog/ip_characters）。
-- 執行：貼 Supabase SQL Editor 跑一次（可重跑）。

-- IP Catalog V3: 100 common character IPs.
-- Safe migration: no rename, no delete. Existing IP names are preserved and enriched through aliases.
-- Schema note: current ip_catalog has no category / is_featured / is_popular / notes columns.
-- Creator / illustrator IPs such as Line Dog and Esther Bunny still require manual licensing / official-name confirmation before public claims.

create or replace function pg_temp.nestory_unique_text_array(input_values text[])
returns text[]
language sql
as $$
  select coalesce(array_agg(distinct item.value order by item.value), '{}'::text[])
  from unnest(input_values) as item(value)
  where item.value is not null and btrim(item.value) <> '';
$$;

create table if not exists pg_temp.nestory_ip_catalog_v3_targets (
  canonical_name text primary key,
  target_ip_name text not null
) on commit drop;

create or replace function pg_temp.nestory_merge_ip_catalog_v3(
  p_canonical_name text,
  p_legacy_names text[],
  p_next_aliases text[],
  p_next_sort_order integer
)
returns text
language plpgsql
as $$
declare
  target_name text := p_canonical_name;
  legacy_name text;
  merged_aliases text[];
begin
  -- If a legacy Traditional Chinese IP already exists, keep that ip_name to avoid
  -- breaking product_drafts.ip / tag_rules labels / any external references.
  if not exists (select 1 from public.ip_catalog where ip_name = p_canonical_name) then
    foreach legacy_name in array p_legacy_names loop
      if exists (select 1 from public.ip_catalog where ip_name = legacy_name) then
        target_name := legacy_name;
        exit;
      end if;
    end loop;
  end if;

  select pg_temp.nestory_unique_text_array(
    array[p_canonical_name] || p_legacy_names || p_next_aliases || coalesce(array_agg(existing_alias), '{}'::text[])
  )
  into merged_aliases
  from (
    select unnest(aliases) as existing_alias
    from public.ip_catalog
    where ip_name = target_name
       or ip_name = p_canonical_name
       or ip_name = any(p_legacy_names)
  ) existing;

  insert into public.ip_catalog (ip_name, aliases, sort_order, is_active)
  values (target_name, merged_aliases, p_next_sort_order, true)
  on conflict (ip_name) do update set
    aliases = pg_temp.nestory_unique_text_array(public.ip_catalog.aliases || excluded.aliases),
    sort_order = least(public.ip_catalog.sort_order, excluded.sort_order),
    is_active = true,
    updated_at = now();

  insert into pg_temp.nestory_ip_catalog_v3_targets (canonical_name, target_ip_name)
  values (p_canonical_name, target_name)
  on conflict (canonical_name) do update set
    target_ip_name = excluded.target_ip_name;

  return target_name;
end;
$$;

select pg_temp.nestory_merge_ip_catalog_v3('Miffy', '{}'::text[], array['米菲', '米飛', '米菲兔', 'Nijntje', 'miffy', 'Dick Bruna', '米菲兔子']::text[], 2010);
select pg_temp.nestory_merge_ip_catalog_v3('Peanuts', array['史努比']::text[], array['史努比', '花生漫畫', '花生漫画', 'Snoopy', 'Charlie Brown', 'Peanuts Comic', 'Charles Schulz']::text[], 2020);
select pg_temp.nestory_merge_ip_catalog_v3('Moomin', array['嚕嚕米']::text[], array['嚕嚕米', '噜噜米', '姆明', 'Moomins', 'ムーミン']::text[], 2030);
select pg_temp.nestory_merge_ip_catalog_v3('Peter Rabbit', '{}'::text[], array['彼得兔', '比得兔', '小兔彼得', 'Peter Rabbit', 'Beatrix Potter', '彼得兔子']::text[], 2040);
select pg_temp.nestory_merge_ip_catalog_v3('Paddington', '{}'::text[], array['柏靈頓熊', '柏林頓熊', '帕丁頓熊', '帕丁顿熊', 'Paddington Bear']::text[], 2050);
select pg_temp.nestory_merge_ip_catalog_v3('The Little Prince', '{}'::text[], array['小王子', '小王子周邊', 'Le Petit Prince', 'Little Prince']::text[], 2060);
select pg_temp.nestory_merge_ip_catalog_v3('Care Bears', '{}'::text[], array['愛心熊', '爱心熊', '彩虹熊', 'CareBear', 'Care Bears']::text[], 2070);
select pg_temp.nestory_merge_ip_catalog_v3('Monchhichi', '{}'::text[], array['夢奇奇', '梦奇奇', '蒙奇奇', 'Monchichi', 'Sekiguchi']::text[], 2080);
select pg_temp.nestory_merge_ip_catalog_v3('Barbapapa', '{}'::text[], array['巴巴爸爸', '巴巴家族', 'Barbapapa']::text[], 2090);
select pg_temp.nestory_merge_ip_catalog_v3('Pusheen', '{}'::text[], array['胖吉貓', '胖吉猫', 'Pusheen Cat', '胖胖貓']::text[], 2100);
select pg_temp.nestory_merge_ip_catalog_v3('Molang', '{}'::text[], array['萌浪兔', '茉浪兔', 'Molang Rabbit', 'Molang Bunny']::text[], 2110);
select pg_temp.nestory_merge_ip_catalog_v3('Esther Bunny', '{}'::text[], array['愛絲特兔', '爱丝特兔', 'Esther Loves You', 'Esther Bunny', '에스더버니']::text[], 2120);
select pg_temp.nestory_merge_ip_catalog_v3('Line Dog', '{}'::text[], array['線條小狗', '线条小狗', '小狗線條', '小狗线条', 'linedog', 'Line Dog']::text[], 2130);
select pg_temp.nestory_merge_ip_catalog_v3('Kanahei''s Small Animals', '{}'::text[], array['卡娜赫拉的小動物', '卡娜赫拉的小动物', '卡娜赫拉', 'Kanahei', 'P助', '粉紅兔兔', '粉红兔兔']::text[], 2140);
select pg_temp.nestory_merge_ip_catalog_v3('Mofusand', array['貓福珊迪']::text[], array['貓福珊迪', '猫福珊迪', 'mofusand', 'モフサンド', '鯊魚貓', '鲨鱼猫']::text[], 2150);
select pg_temp.nestory_merge_ip_catalog_v3('Sumikko Gurashi', array['角落小夥伴', '角落生物']::text[], array['角落小夥伴', '角落小伙伴', '角落生物', 'すみっコぐらし', 'Sumikko', 'Sumikkogurashi']::text[], 2160);
select pg_temp.nestory_merge_ip_catalog_v3('Rilakkuma', '{}'::text[], array['拉拉熊', '懶懶熊', '懒懒熊', '鬆弛熊', '松弛熊', 'リラックマ']::text[], 2170);
select pg_temp.nestory_merge_ip_catalog_v3('Tarepanda', '{}'::text[], array['趴趴熊', '懶懶熊貓', '懒懒熊猫', 'たれぱんだ']::text[], 2180);
select pg_temp.nestory_merge_ip_catalog_v3('Sentimental Circus', '{}'::text[], array['憂傷馬戲團', '忧伤马戏团', 'センチメンタルサーカス']::text[], 2190);
select pg_temp.nestory_merge_ip_catalog_v3('Kapibarasan', '{}'::text[], array['水豚君', '水豚仔', 'カピバラさん', 'Kapibara-san']::text[], 2200);
select pg_temp.nestory_merge_ip_catalog_v3('Koupen Chan', '{}'::text[], array['肯定企鵝', '肯定企鹅', 'コウペンちゃん', 'Koupenchan']::text[], 2210);
select pg_temp.nestory_merge_ip_catalog_v3('Nyan Nyan Nyanko', '{}'::text[], array['喵喵貓', '喵喵猫', 'にゃんにゃんにゃんこ', 'Nyan Nyanko']::text[], 2220);
select pg_temp.nestory_merge_ip_catalog_v3('Neko Atsume', '{}'::text[], array['貓咪收集', '猫咪收集', '貓咪後院', '猫咪后院', 'ねこあつめ']::text[], 2230);
select pg_temp.nestory_merge_ip_catalog_v3('Pingu', '{}'::text[], array['企鵝家族', '企鹅家族', 'Pingu', 'ピングー']::text[], 2240);
select pg_temp.nestory_merge_ip_catalog_v3('Bread Barbershop', '{}'::text[], array['麵包理髮店', '面包理发店', 'Bread Barber Shop', '브레드 이발소']::text[], 2250);
select pg_temp.nestory_merge_ip_catalog_v3('The Powerpuff Girls', array['飛天小女警']::text[], array['飛天小女警', '飞天小女警', 'Powerpuff Girls', 'PPG', 'The Powerpuff Girls']::text[], 2260);
select pg_temp.nestory_merge_ip_catalog_v3('Adventure Time', array['探險活寶']::text[], array['探險活寶', '探险活宝', 'Adventure Time', '老皮阿寶', '老皮阿宝']::text[], 2270);
select pg_temp.nestory_merge_ip_catalog_v3('We Bare Bears', '{}'::text[], array['熊熊遇見你', '熊熊遇见你', '咱們裸熊', '咱们裸熊', 'We Bare Bears']::text[], 2280);
select pg_temp.nestory_merge_ip_catalog_v3('The Amazing World of Gumball', '{}'::text[], array['阿甘妙世界', '甘寶的奇妙世界', 'Gumball', 'Amazing World of Gumball']::text[], 2290);
select pg_temp.nestory_merge_ip_catalog_v3('Steven Universe', '{}'::text[], array['神臍小捲毛', '神脐小卷毛', 'Steven Universe', '史蒂芬宇宙']::text[], 2300);
select pg_temp.nestory_merge_ip_catalog_v3('SpongeBob SquarePants', array['海綿寶寶']::text[], array['海綿寶寶', '海绵宝宝', 'SpongeBob', 'SpongeBob SquarePants', '派大星']::text[], 2310);
select pg_temp.nestory_merge_ip_catalog_v3('Tom and Jerry', array['湯姆貓與傑利鼠']::text[], array['湯姆貓與傑利鼠', '猫和老鼠', '湯姆與傑利', 'Tom & Jerry', 'Tom and Jerry']::text[], 2320);
select pg_temp.nestory_merge_ip_catalog_v3('Looney Tunes', '{}'::text[], array['樂一通', '乐一通', '兔八哥', 'Bugs Bunny', 'Looney Tunes']::text[], 2330);
select pg_temp.nestory_merge_ip_catalog_v3('Scooby-Doo', '{}'::text[], array['史酷比', 'Scooby Doo', 'Scooby-Doo']::text[], 2340);
select pg_temp.nestory_merge_ip_catalog_v3('Sesame Street', '{}'::text[], array['芝麻街', 'Sesame Street', '艾摩', 'Elmo']::text[], 2350);
select pg_temp.nestory_merge_ip_catalog_v3('Garfield', '{}'::text[], array['加菲貓', '加菲猫', 'Garfield']::text[], 2360);
select pg_temp.nestory_merge_ip_catalog_v3('The Simpsons', array['辛普森家庭']::text[], array['辛普森家庭', '辛普森一家', 'Simpsons', 'The Simpsons']::text[], 2370);
select pg_temp.nestory_merge_ip_catalog_v3('South Park', array['南方四賤客']::text[], array['南方四賤客', '南方公園', '南方公园', 'South Park']::text[], 2380);
select pg_temp.nestory_merge_ip_catalog_v3('Rick and Morty', array['瑞克和莫蒂']::text[], array['瑞克和莫蒂', '瑞克與莫蒂', 'Rick & Morty', 'Rick and Morty']::text[], 2390);
select pg_temp.nestory_merge_ip_catalog_v3('Gravity Falls', '{}'::text[], array['怪誕小鎮', '怪诞小镇', '神秘小鎮大冒險', 'Gravity Falls']::text[], 2400);
select pg_temp.nestory_merge_ip_catalog_v3('My Little Pony', '{}'::text[], array['彩虹小馬', '小馬寶莉', '小马宝莉', 'MLP', 'My Little Pony']::text[], 2410);
select pg_temp.nestory_merge_ip_catalog_v3('The Smurfs', '{}'::text[], array['藍色小精靈', '蓝精灵', 'Smurfs', 'The Smurfs']::text[], 2420);
select pg_temp.nestory_merge_ip_catalog_v3('Minions', array['小小兵']::text[], array['小小兵', '小黄人', '神偷奶爸', 'Despicable Me', 'Minions']::text[], 2430);
select pg_temp.nestory_merge_ip_catalog_v3('Shaun the Sheep', '{}'::text[], array['笑笑羊', '小羊肖恩', 'Shaun the Sheep']::text[], 2440);
select pg_temp.nestory_merge_ip_catalog_v3('Wallace & Gromit', '{}'::text[], array['酷狗寶貝', '超级无敌掌门狗', 'Wallace and Gromit', 'Wallace & Gromit']::text[], 2450);
select pg_temp.nestory_merge_ip_catalog_v3('The Addams Family', '{}'::text[], array['阿達一族', '亚当斯一家', 'Addams Family', 'Wednesday']::text[], 2460);
select pg_temp.nestory_merge_ip_catalog_v3('The Boss Baby', '{}'::text[], array['寶貝老闆', '宝贝老板', 'Boss Baby', 'The Boss Baby']::text[], 2470);
select pg_temp.nestory_merge_ip_catalog_v3('ThunderCats', '{}'::text[], array['霹靂貓', '霹雳猫', 'ThunderCats']::text[], 2480);
select pg_temp.nestory_merge_ip_catalog_v3('Teenage Mutant Ninja Turtles', array['忍者龜']::text[], array['忍者龜', '忍者神龟', 'TMNT', 'Teenage Mutant Ninja Turtles']::text[], 2490);
select pg_temp.nestory_merge_ip_catalog_v3('Ben 10', '{}'::text[], array['Ben10', '少年駭客', '少年骇客', 'Ben 10']::text[], 2500);
select pg_temp.nestory_merge_ip_catalog_v3('Doraemon', array['哆啦A夢']::text[], array['哆啦A夢', '哆啦A梦', '小叮噹', 'Doraemon', 'ドラえもん']::text[], 2510);
select pg_temp.nestory_merge_ip_catalog_v3('蠟筆小新', '{}'::text[], array['Crayon Shin-chan', '蜡笔小新', '小新', 'クレヨンしんちゃん']::text[], 2520);
select pg_temp.nestory_merge_ip_catalog_v3('寶可夢', '{}'::text[], array['Pokémon', 'Pokemon', '精靈寶可夢', '精灵宝可梦', '口袋妖怪', 'Pokémon Center']::text[], 2530);
select pg_temp.nestory_merge_ip_catalog_v3('Kirby', array['星之卡比']::text[], array['星之卡比', '卡比', 'Kirby', 'カービィ']::text[], 2540);
select pg_temp.nestory_merge_ip_catalog_v3('Super Mario', '{}'::text[], array['超級瑪利歐', '超级马里奥', '瑪利歐', '马里奥', 'Mario', 'Super Mario']::text[], 2550);
select pg_temp.nestory_merge_ip_catalog_v3('Animal Crossing', '{}'::text[], array['動物森友會', '动物森友会', '動森', '动森', 'Animal Crossing']::text[], 2560);
select pg_temp.nestory_merge_ip_catalog_v3('The Legend of Zelda', '{}'::text[], array['薩爾達傳說', '塞尔达传说', 'Zelda', 'Legend of Zelda']::text[], 2570);
select pg_temp.nestory_merge_ip_catalog_v3('Splatoon', '{}'::text[], array['斯普拉遁', '喷射战士', 'Splatoon']::text[], 2580);
select pg_temp.nestory_merge_ip_catalog_v3('Minecraft', '{}'::text[], array['當個創世神', '我的世界', '麥塊', 'Minecraft']::text[], 2590);
select pg_temp.nestory_merge_ip_catalog_v3('航海王', '{}'::text[], array['ONE PIECE', '海賊王', '海贼王', 'Onepiece']::text[], 2600);
select pg_temp.nestory_merge_ip_catalog_v3('火影忍者', '{}'::text[], array['Naruto', 'NARUTO', '火影', '疾風傳']::text[], 2610);
select pg_temp.nestory_merge_ip_catalog_v3('Dragon Ball', array['七龍珠']::text[], array['七龍珠', '七龙珠', '龍珠', '龙珠', 'Dragon Ball', 'DBZ']::text[], 2620);
select pg_temp.nestory_merge_ip_catalog_v3('鬼滅之刃', '{}'::text[], array['Demon Slayer', '鬼滅', '鬼灭', 'Kimetsu no Yaiba']::text[], 2630);
select pg_temp.nestory_merge_ip_catalog_v3('咒術迴戰', '{}'::text[], array['Jujutsu Kaisen', 'JJK', '咒術回戰', '咒术回战', '呪術廻戦']::text[], 2640);
select pg_temp.nestory_merge_ip_catalog_v3('間諜家家酒', '{}'::text[], array['SPY x FAMILY', 'Spy Family', '間諜過家家', '间谍过家家']::text[], 2650);
select pg_temp.nestory_merge_ip_catalog_v3('Chainsaw Man', array['鏈鋸人']::text[], array['鏈鋸人', '链锯人', '電鋸人', '电锯人', 'Chainsaw Man']::text[], 2660);
select pg_temp.nestory_merge_ip_catalog_v3('排球少年', '{}'::text[], array['Haikyu!!', 'Haikyuu!!', '排球', 'ハイキュー']::text[], 2670);
select pg_temp.nestory_merge_ip_catalog_v3('名偵探柯南', '{}'::text[], array['Detective Conan', 'Case Closed', '柯南', '名侦探柯南']::text[], 2680);
select pg_temp.nestory_merge_ip_catalog_v3('我推的孩子', '{}'::text[], array['Oshi no Ko', '推しの子', '我推', '我推的孩子']::text[], 2690);
select pg_temp.nestory_merge_ip_catalog_v3('葬送的芙莉蓮', '{}'::text[], array['Frieren', '葬送のフリーレン', '芙莉蓮', '芙莉莲']::text[], 2700);
select pg_temp.nestory_merge_ip_catalog_v3('藍色監獄', '{}'::text[], array['Blue Lock', '藍鎖', '蓝色监狱', 'ブルーロック']::text[], 2710);
select pg_temp.nestory_merge_ip_catalog_v3('新世紀福音戰士', '{}'::text[], array['Evangelion', 'EVA', '福音戰士', 'エヴァンゲリオン']::text[], 2720);
select pg_temp.nestory_merge_ip_catalog_v3('JOJO的奇妙冒險', '{}'::text[], array['JOJO', 'JoJo''s Bizarre Adventure', 'ジョジョ', 'JOJO 的奇妙冒險']::text[], 2730);
select pg_temp.nestory_merge_ip_catalog_v3('我的英雄學院', '{}'::text[], array['My Hero Academia', 'MHA', 'ヒロアカ', '我的英雄学院']::text[], 2740);
select pg_temp.nestory_merge_ip_catalog_v3('Attack on Titan', array['進擊的巨人']::text[], array['進擊的巨人', '进击的巨人', '巨人', 'Attack on Titan', 'AOT']::text[], 2750);
select pg_temp.nestory_merge_ip_catalog_v3('Disney', array['迪士尼']::text[], array['迪士尼', 'Disney', 'Mickey & Friends', '米奇家族', '迪士尼米奇家族']::text[], 2760);
select pg_temp.nestory_merge_ip_catalog_v3('Winnie the Pooh', array['小熊維尼']::text[], array['小熊維尼', '小熊维尼', '維尼', '维尼', 'Pooh', 'Winnie the Pooh']::text[], 2770);
select pg_temp.nestory_merge_ip_catalog_v3('Lilo & Stitch', array['星際寶貝']::text[], array['星際寶貝', '星际宝贝', '史迪奇', 'Stitch', 'Lilo & Stitch']::text[], 2780);
select pg_temp.nestory_merge_ip_catalog_v3('Toy Story', array['玩具總動員']::text[], array['玩具總動員', '玩具总动员', 'Toy Story', 'Pixar Toy Story']::text[], 2790);
select pg_temp.nestory_merge_ip_catalog_v3('Marvel', '{}'::text[], array['漫威', 'Marvel Comics', 'MCU', 'Marvel']::text[], 2800);
select pg_temp.nestory_merge_ip_catalog_v3('Spider-Man', '{}'::text[], array['蜘蛛人', '蜘蛛侠', 'Spiderman', 'Spider-Man']::text[], 2810);
select pg_temp.nestory_merge_ip_catalog_v3('Star Wars', array['星際大戰']::text[], array['星際大戰', '星际大战', '星戰', '星战', 'Star Wars']::text[], 2820);
select pg_temp.nestory_merge_ip_catalog_v3('DC Comics', '{}'::text[], array['DC', 'DC漫畫', 'DC漫画', 'DCEU', 'DC Comics']::text[], 2830);
select pg_temp.nestory_merge_ip_catalog_v3('Batman', '{}'::text[], array['蝙蝠俠', '蝙蝠侠', '黑暗騎士', 'Batman', 'The Dark Knight']::text[], 2840);
select pg_temp.nestory_merge_ip_catalog_v3('Harry Potter', array['哈利波特']::text[], array['哈利波特', '哈利·波特', 'Wizarding World', '魔法世界', 'Harry Potter']::text[], 2850);
select pg_temp.nestory_merge_ip_catalog_v3('Jurassic World', array['侏羅紀世界']::text[], array['侏羅紀世界', '侏罗纪世界', '侏羅紀公園', 'Jurassic Park', 'Jurassic World']::text[], 2860);
select pg_temp.nestory_merge_ip_catalog_v3('Godzilla', array['哥吉拉']::text[], array['哥吉拉', '哥斯拉', 'Godzilla', 'Gojira', 'ゴジラ']::text[], 2870);
select pg_temp.nestory_merge_ip_catalog_v3('The Lord of the Rings', array['魔戒']::text[], array['魔戒', '指環王', '指环王', 'LOTR', 'The Lord of the Rings']::text[], 2880);
select pg_temp.nestory_merge_ip_catalog_v3('Ghostbusters', array['魔鬼剋星', '捉鬼敢死隊']::text[], array['魔鬼剋星', '捉鬼敢死隊', '捉鬼敢死队', 'Ghostbusters']::text[], 2890);
select pg_temp.nestory_merge_ip_catalog_v3('Back to the Future', array['回到未來']::text[], array['回到未來', '回到未来', 'Back to the Future', 'BTTF']::text[], 2900);
select pg_temp.nestory_merge_ip_catalog_v3('POP MART', '{}'::text[], array['泡泡瑪特', '泡泡玛特', 'POPMART', 'POP MART']::text[], 2910);
select pg_temp.nestory_merge_ip_catalog_v3('THE MONSTERS', '{}'::text[], array['The Monsters', 'Labubu', '拉布布', 'POP MART Labubu', 'THE MONSTERS']::text[], 2920);
select pg_temp.nestory_merge_ip_catalog_v3('CRYBABY', '{}'::text[], array['哭娃', '哭哭寶貝', '哭哭宝贝', 'POP MART CRYBABY']::text[], 2930);
select pg_temp.nestory_merge_ip_catalog_v3('MOLLY', '{}'::text[], array['POP MART MOLLY', 'Molly']::text[], 2940);
select pg_temp.nestory_merge_ip_catalog_v3('DIMOO', '{}'::text[], array['POP MART DIMOO', 'Dimoo']::text[], 2950);
select pg_temp.nestory_merge_ip_catalog_v3('SKULLPANDA', '{}'::text[], array['骷髏熊貓', '骷髅熊猫', 'POP MART SKULLPANDA', 'Skullpanda']::text[], 2960);
select pg_temp.nestory_merge_ip_catalog_v3('HIRONO', '{}'::text[], array['小野', 'POP MART HIRONO', 'Hirono']::text[], 2970);
select pg_temp.nestory_merge_ip_catalog_v3('HACIPUPU', '{}'::text[], array['哈奇普普', '哈奇噗噗', 'POP MART HACIPUPU', 'Hacipupu']::text[], 2980);
select pg_temp.nestory_merge_ip_catalog_v3('Baby Three', '{}'::text[], array['BabyThree', 'Baby Three', '寶寶三', '宝宝三']::text[], 2990);
select pg_temp.nestory_merge_ip_catalog_v3('Nanci', '{}'::text[], array['南茜', 'Nanci 囡茜', '囡茜']::text[], 3000);

-- Main character rows
with nestory_ip_character_seed (ip_name, character_name, aliases, sort_order, is_active) as (
  values
  ('Miffy', 'Miffy', array['米菲', '米菲兔', 'Nijntje']::text[], 10, true),
  ('Peanuts', 'Snoopy', array['史努比']::text[], 10, true),
  ('Peanuts', 'Charlie Brown', array['查理布朗']::text[], 20, true),
  ('Peanuts', 'Woodstock', array['糊塗塌客', '伍德斯托克']::text[], 30, true),
  ('Peanuts', 'Lucy', array['露西']::text[], 40, true),
  ('Peanuts', 'Linus', array['萊納斯']::text[], 50, true),
  ('Moomin', 'Moomin', array['嚕嚕米', '姆明']::text[], 10, true),
  ('Moomin', 'Little My', array['小不點', '小美']::text[], 20, true),
  ('Moomin', 'Snufkin', array['阿金', '史力奇']::text[], 30, true),
  ('Peter Rabbit', 'Peter Rabbit', array['彼得兔', '比得兔']::text[], 10, true),
  ('Paddington', 'Paddington', array['柏靈頓熊', '帕丁頓熊']::text[], 10, true),
  ('The Little Prince', 'The Little Prince', array['小王子']::text[], 10, true),
  ('Care Bears', 'Cheer Bear', array['歡樂熊', '彩虹熊']::text[], 10, true),
  ('Monchhichi', 'Monchhichi', array['夢奇奇', '蒙奇奇']::text[], 10, true),
  ('Barbapapa', 'Barbapapa', array['巴巴爸爸']::text[], 10, true),
  ('Pusheen', 'Pusheen', array['胖吉貓']::text[], 10, true),
  ('Molang', 'Molang', array['萌浪兔']::text[], 10, true),
  ('Esther Bunny', 'Esther Bunny', array['愛絲特兔']::text[], 10, true),
  ('Line Dog', 'Line Dog', array['線條小狗', '线条小狗']::text[], 10, true),
  ('Kanahei''s Small Animals', 'Piske', array['P助', '小雞P助']::text[], 10, true),
  ('Kanahei''s Small Animals', 'Usagi', array['粉紅兔兔', '兔兔']::text[], 20, true),
  ('Mofusand', 'Mofusand Cat', array['貓福珊迪', '鯊魚貓']::text[], 10, true),
  ('Sumikko Gurashi', 'Shirokuma', array['白熊']::text[], 10, true),
  ('Sumikko Gurashi', 'Penguin?', array['企鵝?', '企鵝']::text[], 20, true),
  ('Sumikko Gurashi', 'Tonkatsu', array['炸豬排']::text[], 30, true),
  ('Sumikko Gurashi', 'Neko', array['貓']::text[], 40, true),
  ('Sumikko Gurashi', 'Tokage', array['蜥蜴']::text[], 50, true),
  ('Rilakkuma', 'Rilakkuma', array['拉拉熊']::text[], 10, true),
  ('Tarepanda', 'Tarepanda', array['趴趴熊']::text[], 10, true),
  ('Sentimental Circus', 'Shappo', array['團長']::text[], 10, true),
  ('Kapibarasan', 'Kapibarasan', array['水豚君']::text[], 10, true),
  ('Koupen Chan', 'Koupen Chan', array['肯定企鵝']::text[], 10, true),
  ('Nyan Nyan Nyanko', 'Nyan Nyan Nyanko', array['喵喵貓']::text[], 10, true),
  ('Neko Atsume', 'Tubbs', array['白胖貓']::text[], 10, true),
  ('Pingu', 'Pingu', array['企鵝家族']::text[], 10, true),
  ('Bread Barbershop', 'Bread', array['麵包師傅']::text[], 10, true),
  ('The Powerpuff Girls', 'Blossom', array['花花']::text[], 10, true),
  ('The Powerpuff Girls', 'Bubbles', array['泡泡']::text[], 20, true),
  ('The Powerpuff Girls', 'Buttercup', array['毛毛']::text[], 30, true),
  ('The Powerpuff Girls', 'Mojo Jojo', array['魔人啾啾']::text[], 40, true),
  ('Adventure Time', 'Finn', array['阿寶', '芬恩']::text[], 10, true),
  ('Adventure Time', 'Jake', array['老皮', '傑克']::text[], 20, true),
  ('We Bare Bears', 'Grizz', array['大大', '灰熊']::text[], 10, true),
  ('We Bare Bears', 'Panda', array['胖達', '熊貓']::text[], 20, true),
  ('We Bare Bears', 'Ice Bear', array['阿極', '白熊']::text[], 30, true),
  ('The Amazing World of Gumball', 'Gumball', array['阿甘']::text[], 10, true),
  ('Steven Universe', 'Steven', array['史蒂芬']::text[], 10, true),
  ('SpongeBob SquarePants', 'SpongeBob', array['海綿寶寶']::text[], 10, true),
  ('SpongeBob SquarePants', 'Patrick Star', array['派大星']::text[], 20, true),
  ('Tom and Jerry', 'Tom', array['湯姆貓', '湯姆']::text[], 10, true),
  ('Tom and Jerry', 'Jerry', array['傑利鼠', '傑利']::text[], 20, true),
  ('Looney Tunes', 'Bugs Bunny', array['兔八哥']::text[], 10, true),
  ('Scooby-Doo', 'Scooby-Doo', array['史酷比']::text[], 10, true),
  ('Sesame Street', 'Elmo', array['艾摩']::text[], 10, true),
  ('Garfield', 'Garfield', array['加菲貓']::text[], 10, true),
  ('The Simpsons', 'Homer Simpson', array['荷馬']::text[], 10, true),
  ('South Park', 'Cartman', array['卡特曼']::text[], 10, true),
  ('Rick and Morty', 'Rick Sanchez', array['瑞克']::text[], 10, true),
  ('Gravity Falls', 'Dipper Pines', array['弟寶']::text[], 10, true),
  ('My Little Pony', 'Twilight Sparkle', array['紫悅']::text[], 10, true),
  ('The Smurfs', 'Smurfette', array['藍妹妹']::text[], 10, true),
  ('Minions', 'Kevin', array['凱文']::text[], 10, true),
  ('Shaun the Sheep', 'Shaun', array['笑笑羊']::text[], 10, true),
  ('Wallace & Gromit', 'Gromit', array['阿高']::text[], 10, true),
  ('The Addams Family', 'Wednesday Addams', array['星期三']::text[], 10, true),
  ('The Boss Baby', 'Boss Baby', array['寶貝老闆']::text[], 10, true),
  ('ThunderCats', 'Lion-O', array['獅貓']::text[], 10, true),
  ('Teenage Mutant Ninja Turtles', 'Leonardo', array['李奧納多']::text[], 10, true),
  ('Ben 10', 'Ben Tennyson', array['田小班', 'Ben']::text[], 10, true),
  ('Doraemon', 'Doraemon', array['哆啦A夢', '小叮噹']::text[], 10, true),
  ('Doraemon', 'Nobita', array['大雄']::text[], 20, true),
  ('蠟筆小新', '野原新之助', array['小新', '新之助']::text[], 10, true),
  ('寶可夢', '皮卡丘', array['Pikachu']::text[], 10, true),
  ('寶可夢', '伊布', array['Eevee']::text[], 20, true),
  ('Kirby', 'Kirby', array['卡比', '星之卡比']::text[], 10, true),
  ('Super Mario', 'Mario', array['瑪利歐', '馬力歐']::text[], 10, true),
  ('Animal Crossing', 'Isabelle', array['西施惠']::text[], 10, true),
  ('The Legend of Zelda', 'Link', array['林克']::text[], 10, true),
  ('Splatoon', 'Inkling', array['魷魚']::text[], 10, true),
  ('Minecraft', 'Creeper', array['苦力怕']::text[], 10, true),
  ('航海王', '魯夫', array['路飛', 'Luffy']::text[], 10, true),
  ('航海王', '索隆', array['Zoro']::text[], 20, true),
  ('火影忍者', '鳴人', array['Naruto']::text[], 10, true),
  ('火影忍者', '佐助', array['Sasuke']::text[], 20, true),
  ('Dragon Ball', '孫悟空', array['悟空', 'Goku']::text[], 10, true),
  ('鬼滅之刃', '炭治郎', array['竈門炭治郎', 'Tanjiro']::text[], 10, true),
  ('咒術迴戰', '虎杖悠仁', array['虎杖', 'Yuji']::text[], 10, true),
  ('咒術迴戰', '五條悟', array['五条悟', 'Gojo']::text[], 20, true),
  ('間諜家家酒', '安妮亞', array['Anya']::text[], 10, true),
  ('Chainsaw Man', '淀治', array['電次', 'Denji']::text[], 10, true),
  ('排球少年', '日向翔陽', array['日向', 'Hinata']::text[], 10, true),
  ('名偵探柯南', '江戶川柯南', array['柯南', 'Conan']::text[], 10, true),
  ('我推的孩子', '星野愛', array['小愛', 'Ai']::text[], 10, true),
  ('葬送的芙莉蓮', '芙莉蓮', array['Frieren']::text[], 10, true),
  ('藍色監獄', '潔世一', array['潔', 'Isagi']::text[], 10, true),
  ('新世紀福音戰士', '綾波零', array['Rei']::text[], 10, true),
  ('JOJO的奇妙冒險', '空條承太郎', array['承太郎']::text[], 10, true),
  ('我的英雄學院', '綠谷出久', array['Deku', '出久']::text[], 10, true),
  ('Attack on Titan', 'Eren Yeager', array['艾連', '艾伦']::text[], 10, true),
  ('Disney', 'Mickey Mouse', array['米奇']::text[], 10, true),
  ('Disney', 'Minnie Mouse', array['米妮']::text[], 20, true),
  ('Winnie the Pooh', 'Winnie the Pooh', array['小熊維尼', '維尼']::text[], 10, true),
  ('Lilo & Stitch', 'Stitch', array['史迪奇']::text[], 10, true),
  ('Toy Story', 'Woody', array['胡迪']::text[], 10, true),
  ('Toy Story', 'Buzz Lightyear', array['巴斯光年']::text[], 20, true),
  ('Marvel', 'Iron Man', array['鋼鐵人', 'Tony Stark']::text[], 10, true),
  ('Marvel', 'Captain America', array['美國隊長']::text[], 20, true),
  ('Spider-Man', 'Spider-Man', array['蜘蛛人', '彼得帕克']::text[], 10, true),
  ('Star Wars', 'Darth Vader', array['黑武士', '達斯維達']::text[], 10, true),
  ('DC Comics', 'Superman', array['超人']::text[], 10, true),
  ('Batman', 'Batman', array['蝙蝠俠']::text[], 10, true),
  ('Batman', 'Joker', array['小丑']::text[], 20, true),
  ('Harry Potter', 'Harry Potter', array['哈利波特']::text[], 10, true),
  ('Jurassic World', 'T. rex', array['暴龍', '霸王龍']::text[], 10, true),
  ('Godzilla', 'Godzilla', array['哥吉拉', '哥斯拉']::text[], 10, true),
  ('The Lord of the Rings', 'Frodo', array['佛羅多']::text[], 10, true),
  ('Ghostbusters', 'Slimer', array['綠鬼', '史萊姆']::text[], 10, true),
  ('Back to the Future', 'Marty McFly', array['馬帝']::text[], 10, true),
  ('POP MART', 'POP MART', array['泡泡瑪特']::text[], 10, true),
  ('THE MONSTERS', 'Labubu', array['拉布布']::text[], 10, true),
  ('THE MONSTERS', 'Zimomo', array['Zimomo']::text[], 20, true),
  ('THE MONSTERS', 'Tycoco', array['Tycoco']::text[], 30, true),
  ('CRYBABY', 'CRYBABY', array['哭娃']::text[], 10, true),
  ('MOLLY', 'MOLLY', array['Molly']::text[], 10, true),
  ('DIMOO', 'DIMOO', array['Dimoo']::text[], 10, true),
  ('SKULLPANDA', 'SKULLPANDA', array['骷髏熊貓']::text[], 10, true),
  ('HIRONO', 'HIRONO', array['小野']::text[], 10, true),
  ('HACIPUPU', 'HACIPUPU', array['哈奇普普']::text[], 10, true),
  ('Baby Three', 'Baby Three', array['寶寶三']::text[], 10, true),
  ('Nanci', 'Nanci', array['南茜', '囡茜']::text[], 10, true)
)
insert into public.ip_characters (ip_name, character_name, aliases, sort_order, is_active)
select coalesce(targets.target_ip_name, seed.ip_name),
       seed.character_name,
       seed.aliases,
       seed.sort_order,
       seed.is_active
from nestory_ip_character_seed seed
left join pg_temp.nestory_ip_catalog_v3_targets targets
  on targets.canonical_name = seed.ip_name
on conflict (ip_name, character_name) do update set
  aliases = pg_temp.nestory_unique_text_array(public.ip_characters.aliases || excluded.aliases),
  sort_order = least(public.ip_characters.sort_order, excluded.sort_order),
  is_active = true,
  updated_at = now();

-- Safe validation queries: read-only checks after running the migration.
select ip_name, aliases, sort_order, is_active
from public.ip_catalog
where ip_name in ('Miffy', 'Peanuts', 'Moomin', 'The Powerpuff Girls', 'Line Dog', 'THE MONSTERS')
   or aliases && array['Miffy', 'Peanuts', 'Moomin', 'Powerpuff Girls', 'Line Dog', 'THE MONSTERS', 'Snoopy', 'Labubu', 'Nijntje']::text[]
order by sort_order, ip_name;

select ip_name, character_name, aliases, sort_order, is_active
from public.ip_characters
where character_name in ('Miffy', 'Snoopy', 'Blossom', 'Bubbles', 'Buttercup', 'Line Dog', 'Labubu')
   or aliases && array['Miffy', 'Snoopy', 'Blossom', 'Bubbles', 'Buttercup', 'Line Dog', 'Labubu', 'Nijntje']::text[]
order by ip_name, sort_order, character_name;
