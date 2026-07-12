-- B7: multi-dimension variants, manual price lock, draft-level dimension defs.
--
-- ──────────────────────────────────────────────────────────────────────────
-- product_variants.cny_price 語意重新定義（B7，2026-07-12）
-- ──────────────────────────────────────────────────────────────────────────
-- 舊語意（001_initial_schema 欄名暗示）：cny_price ≈ 人民幣售價／未嚴格定義。
-- 新語意（B7 定案）：cny_price =「成本（來源幣）」——表單列上的成本欄，
--   幣別跟 product_drafts 同一層（¥ CNY 或 NT$ TWD 皆可能寫入此 numeric 欄；
--   顯示與換算由前端／發布端依草稿成本幣別處理）。twd_price 仍是 NT$ 售價。
--
-- 舊表單寫入調查（WorkspaceInputPanel.tsx 於 B7 前）：
--   - 有名稱的款式列只 insert：
--       option1_name='款式', option1_value=name,
--       sku, twd_price=Number(row.price)|null,
--       inventory_quantity / inventory_policy
--   - **從未寫入 product_variants.cny_price**（舊列該欄幾乎皆 null）
--   - 表單 placeholder 為「售價」，但 B3 規格截圖填入時把 costCny 塞進
--     row.price，再落到 twd_price——語意混雜（成本數字寫進售價欄）
--
-- 舊資料處理：不搬資料、不 UPDATE。讀舊列時：
--   - cny_price 為 null 屬正常（舊路徑沒寫）
--   - twd_price 若有值，B7 前可能是「手填售價」或「誤當成本的 CNY 數字」；
--     發布端以 twd_price 當售價、cny_price 當成本（null 則用 draft 層成本）
-- ──────────────────────────────────────────────────────────────────────────

-- Draft-level dimension definitions (max 3 names). Empty = single-SKU product.
-- Example: [{"name":"角色"},{"name":"尺寸"}]
alter table public.product_drafts
  add column if not exists variant_dimensions jsonb not null default '[]'::jsonb;

comment on column public.product_drafts.variant_dimensions is
  'B7: up to 3 option axis defs, e.g. [{"name":"角色"},{"name":"尺寸"}]. Empty = no multi-variant UI state.';

-- Per-variant compare-at (sale mode); null in single price mode.
alter table public.product_variants
  add column if not exists compare_at_price integer;

-- ✎ manual lock: formula recalculation must not overwrite sell/compare when true.
alter table public.product_variants
  add column if not exists price_locked boolean not null default false;

-- Stable row order for form + publish (first row drives Shopify productCreate initial variant).
alter table public.product_variants
  add column if not exists sort_order integer not null default 0;

comment on column public.product_variants.cny_price is
  'B7: cost in source currency (same currency as draft cost entry). NOT sell price. Pre-B7 form never wrote this column (usually null).';

comment on column public.product_variants.twd_price is
  'B7: NT$ sell price after formula or manual edit. Pre-B7 form wrote the free-text price field here (mixed sell vs CNY-cost from B3).';

comment on column public.product_variants.compare_at_price is
  'B7: NT$ compare-at (划線定價); null when price_mode=single or unset.';

comment on column public.product_variants.price_locked is
  'B7: when true, operator manually edited price; formula recalculation skips this row (✎).';

comment on column public.product_variants.sort_order is
  'B7: display/publish order; first valid row is aligned with productCreate initial option values to avoid ghost variants.';
