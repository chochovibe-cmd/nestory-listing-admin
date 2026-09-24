export const SHARED_PRODUCT_TITLE_PROMPT = `【商品標題契約｜所有語氣共用】
商品標題與官網 title_zh 使用同一最終文字，最多 80 字；seo_title 另寫自然搜尋標題。
固定順序：品牌 × IP中文＋英文 | 角色＋系列／精準商品名稱 | 款式選擇或重要差異。
同時輸出完整 enriched_title 與以下內部組件，由程式組裝：
[[title_ip]] 已建檔 IP 標準中文＋可靠英文別名，如三麗鷗 Sanrio；僅有中文資料時用中文。
[[title_brand]] 資料支持的聯名／製造商品牌，有英文用英文，如 Bandai、Razer、BRUNO；僅有中文時用中文；缺資料留空。賣場與平台屬來源資訊。
[[title_item]] 角色＋系列／精準商品名稱。單一角色可中英並列，多角色按款式順序以「・」串接中文。與 IP 相同的角色名稱只出現一次。角色多時挑主要角色，其餘完整清單交給正文。
[[title_diff]] 有購買辨識價值的指定／隨機、款數、功能或配件差異；資料只夠兩段時留空。
各段使用完整詞組及 ASCII「 | 」分隔。標題用文字呈現商品身分與持續有效的商品特色；尺寸、材質、授權等資訊對應本款資料。活動與叫賣文字留在來源中。
格式示意（只取格式，事實依本次商品）：
Bandai × 三麗鷗 Sanrio | 家族米粒公仔吊飾盲盒 | 隨機單盒
BRUNO × 寶可夢 Pokémon | 聯名多功能料理鍋／電熱鍋
史努比 Snoopy | 多功能三明治機／華夫餅機 | 附3種烤盤`;

export const SHARED_PRODUCT_TITLE_REGEN_RULE = `${SHARED_PRODUCT_TITLE_PROMPT}
本次依來源校正商品身分、改善選材與措辭。輸出 [[enriched_title]]、[[title_ip]]、[[title_brand]]、[[title_item]]、[[title_diff]]，內容從各標記下一行開始，缺資料的組件留空。`;
