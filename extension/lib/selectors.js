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
    /**
     * CAP-2.6 / 86: price = 促銷／現售展示價（不得優先當成本）；
     * originalPrice / listPrice = 优惠前／劃線原價（優先 → price_cny）；
     * promoPrice = 券后／店優惠后（→ capture_meta.promo_price_cny）。
     */
    price: [
      "[class*='Price--priceText']",
      "[class*='priceText--']",
      "[class*='highlightPrice'] [class*='text']",
      ".tb-rmb-num",
      "#J_StrPrice .tb-rmb-num",
      "[class*='Price--extraPriceText']",
      "span[class*='price']"
    ],
    /** 原價優先（CAP-2.6） */
    originalPrice: [
      "[class*='originPrice']",
      "[class*='OriginPrice']",
      "[data-label*='优惠前']",
      "[data-label*='優惠前']",
      "[class*='Price--subPriceText']",
      "[class*='subPrice']",
      "del.tb-price-original",
      ".tb-price-original",
      "del",
      "[class*='lineThrough']"
    ],
    listPrice: [
      "[class*='Price--subPriceText']",
      "[class*='originPrice']",
      "[class*='subPrice']",
      "del",
      ".tb-price-original",
      "[class*='lineThrough']"
    ],
    /** 促銷後價標籤／節點（不得當 price_cny） */
    promoPrice: [
      "[class*='highlightPrice'] [class*='text']",
      "[class*='PromoPrice']",
      "[class*='promoPrice']",
      "[data-label*='优惠后']",
      "[data-label*='優惠後']",
      "[data-label*='券后']",
      "[data-label*='券後']",
      "[class*='couponPrice']"
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
    /** CAP-2.6 / 88: SKU 選項縮圖（相對於 skuValue 節點） */
    skuValueThumb: ["img", "[class*='thumb'] img", "[style*='background']"],
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
    originalPrice: [
      "[class*='originPrice']",
      "[class*='Price--subPriceText']",
      ".tm-price-panel del",
      ".tm-yen + del",
      "del"
    ],
    listPrice: [
      "[class*='Price--subPriceText']",
      ".tm-price-panel del",
      ".tm-yen + del"
    ],
    promoPrice: [
      ".tm-promo-price .tm-price",
      "[class*='highlightPrice'] [class*='text']",
      "[class*='PromoPrice']"
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
