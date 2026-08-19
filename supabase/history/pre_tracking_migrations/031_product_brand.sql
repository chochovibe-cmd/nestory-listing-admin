-- 夜工包（回饋 27，2026-07-18）：聯名品牌欄位。
-- 「品牌 × IP」標題/SEO 骨架的資料前提（Razer × 寶可夢 這類聯名商品）。
-- 表單輸入欄位屬後續包；本欄位先就位，未填＝null＝走純 IP 骨架，行為不變。
-- 執行方式：貼到 Supabase SQL Editor 跑一次（可重跑）。

alter table public.product_drafts
  add column if not exists product_brand text;

comment on column public.product_drafts.product_brand is
  '聯名品牌（如 Razer）；有值時標題/SEO 用「品牌 × IP」骨架（回饋 27）。';
