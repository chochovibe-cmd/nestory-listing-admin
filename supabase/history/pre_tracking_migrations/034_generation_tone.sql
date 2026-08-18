-- P1-66（回饋 66，總指揮新方向計畫 §1.3）：記錄本次文案生成實際語氣。
-- 存 resolveCopyTone 後的具體語氣（例：小編聊天口吻），「依IP自動匹配」不落庫。
-- 卡片顯示歸 UX-C；本 migration 只加欄位。
-- 執行方式：貼到 Supabase SQL Editor 跑一次（可重跑）。

alter table public.product_drafts
  add column if not exists generation_tone text;

comment on column public.product_drafts.generation_tone is
  'P1-66: last copy generation tone after resolveCopyTone (concrete voice only; never 依IP自動匹配).';
