export const SHARED_PRODUCT_TITLE_PROMPT = `【商品標題契約｜所有語氣共用】
商品標題與官網 title_zh 使用同一最終文字，最多 80 字；seo_title 另寫自然搜尋標題，不要複製這三段。
固定順序：品牌 × IP中文＋英文 | 角色＋商品種類 | 造型或款式差異。
[[title_brand]] 聯名或製造商品牌。名創優品、萬代、樂高分別寫 MINISO、Bandai、LEGO。其他品牌要在本次來源或既有搜尋摘錄看到可靠英文才用英文，沒看到就留中文。賣場與平台不是品牌。
[[title_ip]] 已建檔 IP 的標準中文＋可靠英文別名，如七龍珠 DRAGON BALL Z、三麗鷗 Sanrio。只有中文資料時用中文。
[[title_item]] 只放角色＋商品種類，例如「孫悟空 盲盒擺件」。不要把 Q版、萌粒、鍵帽等造型詞放在這段。
[[title_diff]] 把這款和其他同種類分開的造型或款式，例如「Q版萌粒鍵帽」。沒有這種差異就留空，不要填標準款。
單一角色可中英並列，多角色按款式順序以「・」串接中文。與 IP 相同的角色名只出現一次。
各段用完整詞組，分隔符是 ASCII「 | 」。尺寸、材質、授權寫進商品資訊，不進標題。活動與叫賣詞留在來源。
格式示意（只取格式，事實依本次商品）：
MINISO × 七龍珠 DRAGON BALL Z | 孫悟空 盲盒擺件 | Q版萌粒鍵帽
Bandai × 三麗鷗 Sanrio | 家族米粒公仔吊飾盲盒 | 隨機單盒
史努比 Snoopy | 多功能三明治機／華夫餅機 | 附3種烤盤`;

export const SHARED_PRODUCT_TITLE_REGEN_RULE = `${SHARED_PRODUCT_TITLE_PROMPT}
本次依來源與既有搜尋校正品牌英文、商品種類與造型分段。輸出 [[enriched_title]]、[[title_ip]]、[[title_brand]]、[[title_item]]、[[title_diff]]，內容從各標記下一行開始，缺資料的組件留空。`;
