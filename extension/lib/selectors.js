/**
 * CAP-2: selector catalog — 淘寶改版只改這一檔。
 * 每個欄位是選擇器陣列，依序試第一個有值的。
 */
(function (root) {
  var NestoryCap = root.NestoryCap || (root.NestoryCap = {});

  var taobao = {
    title: [
      "h1[class*='MainTitle']",
      "h1[class*='mainTitle']",
      "h1[data-title]",
      "[class*='ItemHeader--mainTitle']",
      "[class*='mainTitle--']",
      ".tb-main-title",
      "#J_Title h3",
      "h1"
    ],
    price: [
      "[class*='Price--priceText']",
      "[class*='priceText--']",
      "[class*='highlightPrice'] [class*='text']",
      ".tb-rmb-num",
      "#J_StrPrice .tb-rmb-num",
      "[class*='Price--extraPriceText']",
      "span[class*='price']"
    ],
    listPrice: [
      "[class*='Price--subPriceText']",
      "[class*='originPrice']",
      "[class*='subPrice']",
      "del",
      ".tb-price-original",
      "[class*='lineThrough']"
    ],
    skuRoot: [
      "[class*='skuWrapper']",
      "[class*='SkuContent']",
      "[class*='skuContent']",
      "#J_isku",
      ".tb-sku",
      "[class*='Sku--']"
    ],
    skuAxis: [
      "[class*='skuItem']",
      "[class*='SkuItem']",
      "dl.tb-prop",
      "[class*='valueItem']"
    ],
    skuAxisLabel: [
      "[class*='ItemLabel']",
      "[class*='labelName']",
      "dt",
      "[class*='skuLabel']",
      ".tb-property-type"
    ],
    skuValue: [
      "[class*='valueItem']",
      "[class*='ValueItem']",
      "li a",
      "li",
      "[class*='skuValue']",
      ".tb-img a",
      "span[class*='value']"
    ],
    mainGallery: [
      "[class*='thumbnail--'] img",
      "[class*='Thumbnail--'] img",
      "ul[class*='thumb'] img",
      "#J_UlThumb img",
      ".tb-thumb img",
      "[class*='PicGallery'] img",
      "[class*='mainPic'] img",
      "#J_ImgBooth"
    ],
    detailImages: [
      "#description img",
      "#J_DivItemDesc img",
      "[class*='descV8'] img",
      "[class*='DescV8'] img",
      "[id*='desc'] img",
      ".detail-desc img",
      "[class*='content--'] img"
    ],
    video: [
      "video source[src]",
      "video[src]",
      "[class*='video'] source[src]",
      "[class*='Video'] video",
      "source[type*='video']"
    ],
    paramsTable: [
      "[class*='ItemParams'] tr",
      "[class*='params'] tr",
      "#J_AttrUL li",
      ".attributes-list li",
      "[class*='InfoItem']",
      "table[class*='attr'] tr",
      "#J_AttrList li"
    ]
  };

  /** 天貓差集；缺 key 時 adapter fallback 到 taobao */
  var tmall = {
    title: [
      "h1[data-title]",
      "[class*='ItemHeader--mainTitle']",
      ".tb-detail-hd h1",
      "h1"
    ],
    price: [
      "[class*='Price--priceText']",
      ".tm-price",
      "#J_StrPriceModBox .tm-price",
      ".tm-promo-price .tm-price"
    ],
    listPrice: [
      "[class*='Price--subPriceText']",
      ".tm-price-panel del",
      ".tm-yen + del"
    ],
    skuRoot: [
      ".tb-sku",
      "#J_isku",
      "[class*='skuWrapper']"
    ],
    mainGallery: [
      "#J_UlThumb img",
      ".tb-thumb img",
      "[class*='thumbnail'] img"
    ],
    detailImages: [
      "#description img",
      "#J_DivItemDesc img",
      "[class*='descV8'] img"
    ]
  };

  var shopee = {
    title: [
      "h1",
      "[class*='product-briefing'] h1",
      "[data-testid='product-title']",
      "meta[property='og:title']"
    ],
    price: [
      "[class*='product-price']",
      "[class*='pqTWkA']",
      "div[class*='product-briefing'] [class*='price']",
      "meta[property='product:price:amount']",
      "meta[itemprop='price']"
    ],
    listPrice: [
      "[class*='product-price'] del",
      "del",
      "[class*='line-through']"
    ],
    skuRoot: [
      "[class*='product-variation']",
      "section[class*='flex'] [class*='variation']",
      "[data-testid='product-variation']"
    ],
    skuAxisLabel: [
      "[class*='product-variation'] > label",
      "label",
      "h3",
      "div[class*='flex'] > div:first-child"
    ],
    skuValue: [
      "button",
      "[role='button']",
      "button[class*='product-variation']"
    ],
    mainGallery: [
      "[class*='image-carousel'] img",
      "[class*='product-image'] img",
      "meta[property='og:image']",
      "picture img"
    ],
    detailImages: [
      "[class*='product-detail'] img",
      "[class*='fV3TIn'] img",
      "div[data-sqe='desc'] img"
    ],
    video: ["video source[src]", "video[src]"],
    paramsTable: [
      "[class*='product-detail'] tr",
      "table tr",
      "[class*='specification'] div"
    ]
  };

  var generic = {
    ogTitle: 'meta[property="og:title"]',
    ogImage: 'meta[property="og:image"]',
    ogPriceAmount: 'meta[property="product:price:amount"]',
    ogPriceCurrency: 'meta[property="product:price:currency"]',
    itempropPrice: 'meta[itemprop="price"], [itemprop="price"]',
    itempropName: 'meta[itemprop="name"], [itemprop="name"]',
    itempropImage: 'meta[itemprop="image"], [itemprop="image"]',
    title: ["h1", "title"],
    price: [
      '[itemprop="price"]',
      'meta[property="product:price:amount"]',
      "[class*='price']",
      "[class*='Price']",
      ".product-price",
      "#price"
    ],
    listPrice: ["del", "s", "[class*='compare']", "[class*='original']"],
    mainGallery: [
      'meta[property="og:image"]',
      'meta[itemprop="image"]',
      "main img",
      "article img",
      ".product img",
      "#product img"
    ],
    detailImages: ["main img", "article img", ".description img", "#description img"],
    video: ["video source[src]", "video[src]", "iframe[src*='youtube']", "iframe[src*='youtu.be']"],
    paramsTable: ["table tr", "dl dt", "[class*='spec'] tr", "[class*='param'] tr"]
  };

  NestoryCap.SELECTORS = {
    taobao: taobao,
    tmall: tmall,
    shopee: shopee,
    generic: generic
  };

  NestoryCap.mergeSelectors = function (primary, fallback) {
    var out = {};
    var keys = {};
    var k;
    if (fallback) {
      for (k in fallback) {
        if (Object.prototype.hasOwnProperty.call(fallback, k)) keys[k] = true;
      }
    }
    if (primary) {
      for (k in primary) {
        if (Object.prototype.hasOwnProperty.call(primary, k)) keys[k] = true;
      }
    }
    for (k in keys) {
      if (primary && primary[k] != null) out[k] = primary[k];
      else if (fallback) out[k] = fallback[k];
    }
    return out;
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      SELECTORS: NestoryCap.SELECTORS,
      mergeSelectors: NestoryCap.mergeSelectors
    };
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
