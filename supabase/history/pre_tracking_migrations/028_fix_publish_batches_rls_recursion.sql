-- 028: Fix infinite recursion in RLS — publish_batches(027) AND image_batches(025)
-- ---------------------------------------------------------------------------
-- 症狀：
--   /records 讀 publish_batches → PostgREST 回
--   {"code":"42P17","message":"infinite recursion detected in policy for relation \"publish_batches\""}
--   前台被 isMissingPublishBatchesError 誤判成「請執行 027」。
--   /dashboard E3 讀 image_batches＋publish_batches → 同理誤報「請執行 025／027」。
-- 根因：025 與 027 各自的兩條 SELECT policy 互相引用——
--   batches 的 policy 內 exists 查 batch_items；
--   batch_items 的 policy 內 exists 查 batches → RLS 循環（42P17）。
--   （025/027 由 service_role 寫入時繞過 RLS，所以送圖功能正常，只有前台匿名讀爆掉。）
-- 修法：把跨表檢查抽成 SECURITY DEFINER 函式（評估時繞過對方表的 RLS），
--   政策本體只呼叫函式，打斷循環。語意與原政策相同；不動表結構、不刪資料。
-- 執行方式：貼到 Supabase SQL Editor 執行一次，之後重新整理 /records 與 /dashboard。
-- ---------------------------------------------------------------------------

-- 1) helper：目前使用者是否擁有此批次內任何一筆草稿（給 publish_batches policy 用）
create or replace function public.user_owns_items_in_publish_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.publish_batch_items i
    join public.product_drafts d on d.id = i.draft_id
    where i.batch_id = p_batch_id
      and d.created_by = auth.uid()
  );
$$;

-- 2) helper：目前使用者是否為此批次的建立者（給 publish_batch_items policy 用）
create or replace function public.user_owns_publish_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.publish_batches b
    where b.id = p_batch_id
      and b.created_by = auth.uid()
  );
$$;

revoke all on function public.user_owns_items_in_publish_batch(uuid) from public;
revoke all on function public.user_owns_publish_batch(uuid) from public;
grant execute on function public.user_owns_items_in_publish_batch(uuid) to authenticated, service_role;
grant execute on function public.user_owns_publish_batch(uuid) to authenticated, service_role;

-- 3) 重建 publish_batches SELECT policy（語意與 027 相同，僅改用函式）
drop policy if exists "team can read publish batches" on public.publish_batches;
create policy "team can read publish batches"
on public.publish_batches for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or created_by = auth.uid()
  or public.user_owns_items_in_publish_batch(id)
);

-- 4) 重建 publish_batch_items SELECT policy（語意與 027 相同，僅改用函式）
drop policy if exists "team can read publish batch items" on public.publish_batch_items;
create policy "team can read publish batch items"
on public.publish_batch_items for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or public.user_owns_publish_batch(batch_id)
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id and d.created_by = auth.uid()
  )
);

-- 5) image_batches（025）同病同修 --------------------------------------------

create or replace function public.user_owns_items_in_image_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.image_batch_items i
    join public.product_drafts d on d.id = i.draft_id
    where i.batch_id = p_batch_id
      and d.created_by = auth.uid()
  );
$$;

create or replace function public.user_owns_image_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.image_batches b
    where b.id = p_batch_id
      and b.created_by = auth.uid()
  );
$$;

revoke all on function public.user_owns_items_in_image_batch(uuid) from public;
revoke all on function public.user_owns_image_batch(uuid) from public;
grant execute on function public.user_owns_items_in_image_batch(uuid) to authenticated, service_role;
grant execute on function public.user_owns_image_batch(uuid) to authenticated, service_role;

drop policy if exists "team can read image batches" on public.image_batches;
create policy "team can read image batches"
on public.image_batches for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or created_by = auth.uid()
  or public.user_owns_items_in_image_batch(id)
);

drop policy if exists "team can read image batch items" on public.image_batch_items;
create policy "team can read image batch items"
on public.image_batch_items for select
using (
  public.current_user_role() in ('admin', 'reviewer')
  or public.user_owns_image_batch(batch_id)
  or exists (
    select 1 from public.product_drafts d
    where d.id = draft_id and d.created_by = auth.uid()
  )
);

-- 6) 驗證（執行後應回 0 列或資料列，不應再報 42P17）：
--   select id from public.publish_batches limit 1;
--   select id from public.image_batches limit 1;
--   （/records 應顯示「尚無批次」或批次卡；/dashboard E3 額度卡應有數字，
--    兩處都不應再出現「請執行 025／027」）
