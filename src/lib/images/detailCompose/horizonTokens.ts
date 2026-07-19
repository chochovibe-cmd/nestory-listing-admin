/**
 * SYN-1 R4: Horizon store scheme-1 tokens
 * (docs/合成詳情圖打樣/品牌風格-來自Horizon主題.md).
 * Cream + black/white/gray only — no promo color chips.
 */

export const HORIZON = {
  bg: "#faf8f3",
  surface: "#faf8f3",
  surface2: "#f5f3f0",
  title: "#2a2a2a",
  body: "#4a4a4a",
  ink: "#2a2a2a",
  inkSolid: "#000000",
  lineSoft: "rgba(0,0,0,0.06)",
  lineInput: "#dfdfdf",
  onInk: "#ffffff"
} as const;

export const DETAIL_COMPOSE_WIDTH = 1080;

/** Title stack: Noto Serif TC first (Cormorant-like). */
export const FONT_TITLE_STACK =
  '"Noto Serif TC", "Noto Serif CJK TC", "Source Han Serif TC", "Microsoft JhengHei", serif';

/** Body stack: Noto Sans TC → MSJH. */
export const FONT_BODY_STACK =
  '"Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", "Microsoft JhengHei UI", sans-serif';

/** Fixed purchase notice when draft has no ◈ 購買提醒 block. */
export const DEFAULT_BUY_NOTICE =
  "本商品為正版授權選品，實際規格以包裝標示為準。潮巢代購商品到貨後經檢視再寄出；如有瑕疵請於收貨後三天內聯繫客服。";
