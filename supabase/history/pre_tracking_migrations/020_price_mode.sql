-- B6: 定價模式（特價 sale ＝售價＋定價劃線／單一售價 single ＝不填 compare_at）
-- 預設 sale。既有列視為特價；單一售價送出時 compare_at_price 應為 null。

alter table public.product_drafts
  add column if not exists price_mode text not null default 'sale';

do $$
begin
  alter table public.product_drafts
    add constraint product_drafts_price_mode_check
    check (price_mode in ('sale', 'single'));
exception
  when duplicate_object then null;
end $$;

comment on column public.product_drafts.price_mode is
  'B6 pricing UI: sale = sell + compare_at (划线), single = sell only (compare_at null on submit)';
