-- CAP-1（擷取接收端，2026-07-18）：個人擷取 token + raw_capture 全量留底。
-- 執行方式：貼到 Supabase SQL Editor 跑一次（可重跑）。
-- 未跑前：/api/import/product-page 與 /api/settings/capture-token 應回明確錯誤，不靜默假成功。

-- ── profiles：一人一枚擷取 token（只存 hash；明文僅產生當下回一次）──
alter table public.profiles
  add column if not exists capture_token_hash text;

alter table public.profiles
  add column if not exists capture_token_prefix text;

alter table public.profiles
  add column if not exists capture_token_created_at timestamptz;

comment on column public.profiles.capture_token_hash is
  'CAP-1：擷取 API 個人 token 的 sha256 hex；明文不存庫。';

comment on column public.profiles.capture_token_prefix is
  'CAP-1：設定頁顯示用遮罩（如 ncap_a1b2…f9e0），非密文。';

comment on column public.profiles.capture_token_created_at is
  'CAP-1：token 產生／重設時間。';

-- 唯一：同一 hash 不可掛兩人（防碰撞／誤寫）
create unique index if not exists profiles_capture_token_hash_uidx
  on public.profiles (capture_token_hash)
  where capture_token_hash is not null;

-- ── product_drafts：擷取當下全量 JSON 留底（回放／多維升級用）──
alter table public.product_drafts
  add column if not exists raw_capture jsonb;

comment on column public.product_drafts.raw_capture is
  'CAP-1：Chrome 擷取 raw payload 留底（sku_table／params／server 代抓結果等）。生成流程不覆寫此欄。';
