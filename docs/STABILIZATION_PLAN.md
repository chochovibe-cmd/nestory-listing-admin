# Nestory — Stabilization Plan

> 目的：把 regression / authorization / production / CI audits 轉成可執行施工順序。
> 詳細證據看 `docs/audits/`；release gate 看 `docs/RELEASE_READINESS.md`。

更新：2026-08-18

## 已實作，待最終整合/實機驗證

1. **P0-1 Variant axis atomic confirm** — `agent/p0-variant-atomic-confirm` / `verify:variant-axis-atomic`
2. **P0-2 Variant duplicate option protection** — `agent/p0-variant-duplicate-protection` / `verify:variant-duplicates`
3. **P0-3 Mobile ResultCard expand affordance** — `agent/p0-mobile-resultcard-expand` / `verify:mobile-resultcard-expand`
4. **P1-1 Mobile interactive-target gesture guard** — `agent/p1-mobile-gesture-guard` / `verify:mobile-resultcard-gesture`
5. **P1-2 P07 Variant hover containment** — `agent/p1-variant-picker-clipping` / `verify:variant-picker-containment`
6. **P1-3 Browser-storage secret policy** — `agent/p1-localstorage-secret-policy` / `verify:browser-storage-secrets`
7. **P0 Batch archive owner authorization** — `agent/p0-archive-owner-authorization` / `fdc5527` / `verify:batch-archive-auth`

功能修復已有 source-contract verifier；mobile/Variant/role runtime cases 仍要按 `docs/RELEASE_READINESS.md` 實測。

## CI gate — complete / green

專項：`docs/audits/CI-GATE-2026-08-18.md`
分支：`agent/ci-gate`
final squashed commit：`b935290`
Draft PR：#1

Canonical pipeline：
1. frozen pnpm install
2. `verify:all`
3. `typecheck`
4. `build`

Final squashed-head run `32132941280` / job `95697924316`：全部成功。

### CI verifier modernization

CI 第一輪把多個舊 verifier drift 暴露出來，已做結構性修正，不是關掉檢查：
- browser storage：允許非敏感 UI state，阻擋 credential-like writes。
- client secret env：只阻擋 client-reachable module 真正的 `process.env.<secret>` access；環境變數名稱作為 UI 說明文字不誤報。
- client/server 邊界：由 `"use client"` import graph 推導，不靠脆弱路徑 allowlist。
- requirements/contracts/mock-flow：改驗 current source + fixtures + canonical `docs/RELEASE_READINESS.md`，不綁死已淘汰 v0.1 文件名稱。

### Vercel 與 CI 的關係

Recent Vercel preview check target = `build-rate-limit / upgradeToPro`。
GitHub CI 已成功跑 `next build`，因此目前 Vercel preview failure 不應被解讀成 code build failure。

## Role / RLS canonical model — audit complete

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- **viewer**：目前沒有 TS/DB role；不要新增。

不要只把 operator 加進 `canPublish()`。

## Production Supabase reconcile — 001–039 live-state matrix complete

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
分支：`agent/supabase-reconcile-plan`
production：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
狀態：**live DB 尚未修改。**

### Matrix conclusion

Repo `001–039` 已逐份和 production live state 比對。

- migration ledger 空白，但 schema/data final state 幾乎完整。
- 不可 replay `001–039`。
- `009 → 010`、`019 → 030`、`025/027 policies → 028` 是正常 supersede chain。
- late catalog/tag/knowledge seeds `032/033/037/038` 有代表性與數量證據已套用。
- `039` dual-size image URL fields 存在。

### Confirmed drift

唯一明確 migration-level drift：migration `004` 的 4 張 table：
- `ip_catalog`
- `ip_characters`
- `tag_rules`
- `collection_rules`

目前狀態：
- tables ✅
- RLS enabled ✅
- grants ✅
- triggers/constraints ✅
- **policies 0/8 ❌**

### Other security hardening debt

- SECURITY DEFINER direct RPC surface 有 Security Advisor warnings。
- `set_updated_at / touch_image_batches_updated_at / touch_publish_batches_updated_at` mutable search_path warnings。
- leaked-password protection disabled。

## Safe reconciliation draft — prepared, NOT applied

Path：`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

它刻意不在 `supabase/migrations/`：production ledger 空白時，不能讓 CLI 把歷史 migration 當成待執行 queue。

Active SQL scope：
1. idempotently restore 8 migration-004 catalog/rule policies
2. pin 3 simple timestamp trigger helpers to `search_path = pg_catalog`

NOT active yet：
- trigger/event-trigger SECURITY DEFINER EXECUTE revokes
- moving RLS helpers to private schema
- any migration-history repair

Supabase 官方目前建議：SECURITY DEFINER 必須固定 search_path；RLS policy 使用的 definer helper 不需要暴露在 Data API schema。Direct EXECUTE hardening仍需隔離 runtime proof，不能靠 advisor 警告直接全 revoke。

## 下一個施工 gate

### 1. Production 保持不動

不要在 live DB 直接貼 reconcile draft。

### 2. 建立隔離測試策略

目前 Supabase project 沒有 development branch。

Supabase branch 會產生成本：
- 若要建立，必須先查 cost
- 顯示成本給使用者
- 使用者明確確認後才能建立

在未取得隔離環境前，不執行 production DDL。

### 3. 隔離環境驗證 reconcile draft

最低測試矩陣：
- authenticated 可讀 active IP/tag/collection catalog
- operator 不可 admin-write catalog
- admin 可讀 inactive 並管理 catalog
- operator own-draft read/update 正常
- reviewer/admin cross-team read 正常
- batch archive owner/reviewer scope 正常
- image/publish batch SELECT 不回歸 42P17 recursion
- `handle_new_user` 仍能建立 operator profile
- sensitive-field trigger 正常阻擋 operator escalation
- timestamp triggers 正常更新 updated_at
- SECURITY DEFINER direct EXECUTE revoke 候選逐一測，不批次猜
- rerun Supabase Security Advisor

### 4. Baseline / tracked migration strategy

只有隔離測試完成後，才決定如何建立「從現在開始」的 tracked migration baseline。

鐵則：
- 不把 `001–039` 重新套進 production
- 不手動插假 migration rows
- 不直接把 review draft 搬進 `supabase/migrations/` 就 `db push`

### 5. Production config / E2E

DB reconcile 路徑確認後：
- Vercel production env audit
- Shopify production config audit
- manual mobile/Variant/role cases
- controlled real-product E2E

## Schema verifier 後續

`verify-sql-schema.mjs` 現在可以在 CI 跑通，但它仍主要代表 repo historical schema contract，不代表 production live schema 已 reconcile。

Supabase reconciliation 完成後再補：
- current columns
- current RLS policy contracts
- critical function privileges/search_path
- migration discipline guard

## 不要做

- 不 replay `001–039`。
- 不手動偽造 Supabase migration history。
- 不為了 catalog 可讀而 disable RLS。
- 不直接把 operator 加進 publish。
- 不把所有 SECURITY DEFINER authenticated EXECUTE 一刀切掉。
- 不把 reconcile review draft 當正式 migration 直接 push。
- 不信任前端 IDs 後直接用 service role 改資料。
- 不為了 CI green 關掉 verifier；先修 verifier/source drift。
- 不整包 revert B4/P07。
- 不大量重寫 `globals.css`。
- 不先開 E6/F/G。
