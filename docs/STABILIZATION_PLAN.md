# Nestory — Stabilization Plan

> 目的：把 regression / authorization audits 轉成可執行修復順序。
> 詳細證據看 `docs/audits/`；實際修改看 `docs/CHANGELOG.md`。

更新：2026-08-18

## 已實作，待完整 runtime 驗證/merge

1. **P0-1 Variant axis atomic confirm** — `agent/p0-variant-atomic-confirm` / `verify:variant-axis-atomic`
2. **P0-2 Variant duplicate option protection** — `agent/p0-variant-duplicate-protection` / `verify:variant-duplicates`
3. **P0-3 Mobile ResultCard expand affordance** — `agent/p0-mobile-resultcard-expand` / `verify:mobile-resultcard-expand`
4. **P1-1 Mobile interactive-target gesture guard** — `agent/p1-mobile-gesture-guard` / `verify:mobile-resultcard-gesture`
5. **P1-2 P07 Variant hover containment** — `agent/p1-variant-picker-clipping` / `verify:variant-picker-containment`
6. **P1-3 Browser-storage secret policy** — `agent/p1-localstorage-secret-policy` / `verify:browser-storage-secrets`

上述修復細節與手動驗證矩陣留在 `docs/CHANGELOG.md` 與對應 audits；本檔不再重複全部內容。

## Role / RLS audit — 第一輪完成

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`
分支：`agent/role-rls-consistency-audit`

### 建議 canonical role model

- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- **viewer**：目前沒有 TS/DB role；不要先新增。

理由：這最符合目前 `UserRole`、Postgres enum、新使用者 default、`canReview/canPublish`、publish/approve API、RLS 與 sensitive-field guard。

### 文字 drift（後續低風險整理）
- `canAccessSettings()` 實際三角色都可進，但註解寫 admin + operator。
- capture-token API 實際 `canOperate()` 三角色都可用，但註解/403 文案寫 operator + admin。

不要拿 stale 文案反推實際安全模型；可獨立修文案。

## P0 — Batch archive owner authorization

分支：`agent/p0-archive-owner-authorization`
狀態：**已實作，待 squash / verifier / runtime 驗證。**

### Root cause
`/api/drafts/batch/archive` 原本：
- 只做 `canOperate()`。
- 接著直接用 service-role client select request 傳入的 `draftIds`。
- service role bypass RLS。
- 沒有 owner check。

因此 operator 可能跨 owner 封存／解封其他成員商品。

### 已實作
- authorization read 改走 `authSupabase`；由既有 RLS 決定 row visibility。
- migration-024 fallback read 也維持 `authSupabase`，不能藉 fallback bypass owner scope。
- service role 僅保留已授權 rows 的 archive/unarchive mutation。
- reviewer/admin 仍可依 RLS 讀全隊 rows；operator 只會取得自己的 rows。
- 新增 `verify-batch-archive-authorization.mjs`。
- 新增 `verify:batch-archive-auth` 並納入 `verify:all`。

### Scope control
相對 role audit 的 code/verifier diff 只有：
- `src/app/api/drafts/batch/archive/route.ts`
- `scripts/verify-batch-archive-authorization.mjs`
- `package.json`
- `scripts/verify-all.mjs`

沒有改 `roles.ts`、沒有 migration、沒有擴大任何角色權限。

### 待驗證
- operator：自己的 draft archive/unarchive 正常。
- operator：他人 draft id 不被 service write 處理。
- reviewer/admin：跨成員 archive/unarchive 仍正常。
- migration 024 missing fallback 同樣遵守 RLS。
- `npm run verify:batch-archive-auth`
- `npm run typecheck`

## 下一個主線

1. squash P0 archive authorization。
2. production Supabase migration / RLS reconcile。
3. CI gate：verify → typecheck → build。
4. real-product E2E。
5. 再處理 E6/F/G。

## 不要做

- 不把 operator 直接加進 `canPublish()`。
- 不新增 viewer，除非先有明確 read-only 成員需求。
- 不信任前端傳入的 IDs 後直接用 service role 改資料。
- 不整包 revert B4/P07。
- 不大量重寫 `globals.css`。
- 不先開 E6/F/G。
