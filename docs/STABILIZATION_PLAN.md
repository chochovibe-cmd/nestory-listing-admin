# Nestory — Stabilization Plan

> 目的：把 regression / authorization / production audits 轉成可執行修復順序。
> 詳細證據看 `docs/audits/`；歷史實際修改看 `docs/CHANGELOG.md`。

更新：2026-08-18

## 已實作，待完整 runtime 驗證/merge

1. **P0-1 Variant axis atomic confirm** — `agent/p0-variant-atomic-confirm` / `verify:variant-axis-atomic`
2. **P0-2 Variant duplicate option protection** — `agent/p0-variant-duplicate-protection` / `verify:variant-duplicates`
3. **P0-3 Mobile ResultCard expand affordance** — `agent/p0-mobile-resultcard-expand` / `verify:mobile-resultcard-expand`
4. **P1-1 Mobile interactive-target gesture guard** — `agent/p1-mobile-gesture-guard` / `verify:mobile-resultcard-gesture`
5. **P1-2 P07 Variant hover containment** — `agent/p1-variant-picker-clipping` / `verify:variant-picker-containment`
6. **P1-3 Browser-storage secret policy** — `agent/p1-localstorage-secret-policy` / `verify:browser-storage-secrets`
7. **P0 Batch archive owner authorization** — `agent/p0-archive-owner-authorization` / `fdc5527` / `verify:batch-archive-auth`

上述修復細節與手動驗證矩陣留在 `docs/CHANGELOG.md` 與對應 audits；本檔只保留施工順序。

## Role / RLS canonical model — audit complete

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- **viewer**：目前沒有 TS/DB role；不要先新增。

不要只把 operator 加進 `canPublish()`。

## Production Supabase reconcile — read-only audit complete

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
分支：`agent/production-supabase-reconcile-audit`
production：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
狀態：**live DB 尚未修改。**

### Confirmed state

- Supabase migration ledger 空白。
- Production schema 已包含 late-stage Nestory fields，所以不能 replay `001–039`。
- Core RLS enabled，product owner/reviewer policies 大致符合 canonical role model。
- Production 目前只有 1 個 admin profile，尚無 operator/reviewer。

### Confirmed drift / security work

#### A. Catalog/rule RLS policies missing

RLS enabled but no policy：
- `ip_catalog`
- `ip_characters`
- `tag_rules`
- `collection_rules`

Repo migration 004 原本有 authenticated SELECT + admin write policies。
Production authenticated 仍有 SELECT grants，但 RLS 無 policy，direct Data API reads 會被拒。

#### B. SECURITY DEFINER RPC surface

Security Advisor flags public-schema functions including：
- `current_user_role`
- `is_admin`
- `is_reviewer`
- `guard_sensitive_product_draft_fields`
- `handle_new_user`
- `rls_auto_enable`
- ownership helper functions

不要盲目全部 revoke：
- trigger/event-trigger functions 的 direct client EXECUTE 應移除。
- RLS helper functions 必須確認 policy evaluation 仍能正常執行；長期應避免把 privileged helper 暴露成 public RPC。

#### C. Trigger function search_path

Security Advisor warnings：
- `set_updated_at`
- `touch_image_batches_updated_at`
- `touch_publish_batches_updated_at`

未來 migration 加 explicit safe search_path。

#### D. Auth leaked-password protection

目前 disabled；在新增團隊成員前建議啟用。

## 下一個施工 gate

### 1. 不動 production DB

先保留目前 live state，避免在 migration history 空白時直接修 DDL。

### 2. 建立 audited migration baseline

需要正式 local Supabase CLI repo 環境後：
- inspect/pull live schema
- 不回填假 migration rows
- 不 replay 001–039
- 建立一個乾淨的新 reconciliation migration

### 3. Reconciliation migration scope

只做確認過的 security/schema drift：
- restore/驗證 catalog/rule RLS policies
- revoke trigger/event-trigger 不必要 direct EXECUTE
- harden search_path
- 保留真正需要的 RLS helper execution capability
- 不改 role model
- 不改商品資料

### 4. 驗證矩陣

- authenticated 可讀 active IP/tag catalog
- operator 不可直接 admin-write catalog
- operator own-draft read/update 正常
- reviewer/admin cross-team read 正常
- batch archive owner/reviewer scope 正常
- auth trigger / sensitive-field trigger 仍正常
- rerun Supabase Security Advisor
- typecheck / app smoke

### 5. 更新 schema verifier

`verify-sql-schema.mjs` 目前不能代表 production current schema。reconcile 後要補：
- current columns
- RLS policy contracts
- critical function privileges/search_path
- migration discipline guard

## 後續

1. CI gate：verify → typecheck → build
2. Vercel production env audit
3. Shopify production config audit
4. real-product E2E
5. 再處理 E6/F/G

## 不要做

- 不 replay `001–039`。
- 不手動偽造 Supabase migration history。
- 不為了 catalog 可讀而 disable RLS。
- 不直接把 operator 加進 publish。
- 不把所有 SECURITY DEFINER authenticated EXECUTE 一刀切掉。
- 不信任前端傳入 IDs 後直接用 service role 改資料。
- 不整包 revert B4/P07。
- 不大量重寫 `globals.css`。
- 不先開 E6/F/G。
