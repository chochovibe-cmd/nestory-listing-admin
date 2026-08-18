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
Draft PR：#1

Canonical pipeline：
1. frozen pnpm install
2. `verify:all`
3. `typecheck`
4. `build`

首次完整 green run：`32132498629` / job `95696500082`。

### CI verifier modernization

CI 第一輪把多個舊 verifier drift 暴露出來，已做結構性修正，不是關掉檢查：
- browser storage：允許非敏感 UI state，阻擋 credential-like writes。
- client secret env：只阻擋 client-reachable module 真正的 `process.env.<secret>` access；環境變數名稱作為 UI 說明文字不誤報。
- client/server 邊界：由 `"use client"` import graph 推導，不靠脆弱路徑 allowlist。
- requirements/contracts/mock-flow：改驗 current source + fixtures + canonical `docs/RELEASE_READINESS.md`，不綁死已淘汰 v0.1 文件名稱。

Green run client graph：135 client-reachable modules。

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

## Production Supabase reconcile — read-only audit complete

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
production：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
狀態：**live DB 尚未修改。**

Confirmed state：
- migration ledger 空白。
- live schema 已有 late-stage fields；不能 replay `001–039`。
- core RLS enabled，draft owner/reviewer policy 大致符合 canonical role model。
- production 目前只有 1 個 admin profile。

Confirmed drift/security work：
- `ip_catalog / ip_characters / tag_rules / collection_rules`：RLS enabled、live policy 缺失。
- public SECURITY DEFINER RPC surface 有 Security Advisor warnings。
- `set_updated_at / touch_image_batches_updated_at / touch_publish_batches_updated_at` 有 mutable search_path warnings。
- leaked-password protection disabled。

## 下一個施工 gate

### 1. 先收尾 CI branch / Draft PR

- final diff 核對。
- squash connector 產生的碎 commits，保留少量可理解歷史。
- Draft PR #1 暫不 merge 到 production/default branch。
- merge 前重新確認 final head CI green。

### 2. Production Supabase reconciliation

不要直接 replay 歷史 migration，也不要手造 migration ledger。

需要乾淨的新 reconciliation migration workflow，scope 只放已確認 drift：
- restore/驗證 4 張 catalog/rule RLS policies
- revoke 不必要 trigger/event-trigger direct client EXECUTE
- harden trigger search_path
- 保留真正需要的 RLS helper execution capability
- 不改 canonical role model
- 不改商品資料

### 3. Supabase 驗證矩陣

- authenticated 可讀 active IP/tag catalog
- operator 不可 admin-write catalog
- operator own-draft read/update 正常
- reviewer/admin cross-team read 正常
- batch archive owner/reviewer scope 正常
- auth/sensitive-field triggers 正常
- rerun Supabase Security Advisor

### 4. Production config / E2E

CI/source compile green 後才做：
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
- 不信任前端 IDs 後直接用 service role 改資料。
- 不為了 CI green 關掉 verifier；先修 verifier/source drift。
- 不整包 revert B4/P07。
- 不大量重寫 `globals.css`。
- 不先開 E6/F/G。
