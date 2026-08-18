# Nestory — Current Status

> 給新 AI session 的短版現況；歷史細節看 `docs/CHANGELOG.md` / audits。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 → role audit → P0 archive auth → **production Supabase audit**
目前工作分支：`agent/production-supabase-reconcile-audit`

## 1. 專案狀態

Nestory 核心商品上架、AI 文案、圖片/規格、審核、Shopify publish 架構已相當完整；目前主線是**穩定化與正式環境一致性**，不是擴新功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 70–75%

## 2. 已實作的穩定化修復（尚待完整 runtime 驗證/merge）

- **P0-1** `agent/p0-variant-atomic-confirm`：Variant destructive axis confirm atomic；固定 commit `171bbaa`。
- **P0-2** `agent/p0-variant-duplicate-protection`：duplicate option protection，涵蓋 expand / Workspace / persistence / Shopify 409。
- **P0-3** `agent/p0-mobile-resultcard-expand`：mobile selectMode 恢復既有 compact expand toggle，不恢復整條 quick row。
- **P1-1** `agent/p1-mobile-gesture-guard`：interactive child touch 不再被 ResultCard long-press/swipe 接管。
- **P1-2** `agent/p1-variant-picker-clipping`：保留 P07 containment，只讓 desktop Variant hover preview 向 picker 內側展開。
- **P1-3** `agent/p1-localstorage-secret-policy`：no-secrets 改成檢查 credential-like browser-storage writes，不再 blanket-ban localStorage。
- **P0 archive auth** `agent/p0-archive-owner-authorization` / `fdc5527`：batch archive authorization read 改走 authenticated RLS；service role 只做已授權 rows 的後續 mutation。

P1-3 與 P0 archive preview 的 Vercel status 曾回 failure，但 target 明確是 `build-rate-limit / upgradeToPro`，不是程式 build error；因此只記為「preview 額度阻擋、未驗證」。

## 3. Role / RLS canonical model

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

目前真正 canonical role：
- `admin`
- `operator`
- `reviewer`

`viewer` 沒有進 TypeScript 或 DB enum，只是部分舊/後期文件語意；目前不建議新增。

建議 capability：
- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。

不要只把 operator 塞進 `canPublish()`。若未來真要改，必須一次對齊 helper + API + UI + DB/RLS + tests。

## 4. Production Supabase reconcile — 已完成唯讀第一輪

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
分支：`agent/production-supabase-reconcile-audit`
production DB：**尚未修改**。

實際 Supabase：
- project：`nestory-listing-tool-test`
- ref：`tbgtqwvuohmdxnxisrgr`
- Postgres 17

### 已確認

1. **Supabase migration ledger 是空的。**
   - `list_migrations` 沒有 entries。
   - 但 production schema 已有後期欄位，例如 `raw_capture`、`generation_tone`、`list_thumb_url`、`vision_mid_url`。
   - 結論：historical SQL 很可能用 SQL Editor/manual flow 套過，不能用 migration ledger 判斷 schema 版本。

2. **不要 replay repo `001–039`。**
   - migration row 缺失 ≠ DDL 缺失。
   - 直接重播會有 schema/policy/data 風險。

3. **4 張 catalog/rule table 有 RLS 但沒有 policy：**
   - `ip_catalog`
   - `ip_characters`
   - `tag_rules`
   - `collection_rules`
   - repo migration 004 本來有 authenticated read + admin write policies；production 現在沒有。
   - authenticated 仍有 SELECT grant，但 RLS 無 policy，Data API direct read 會被擋。

4. **SECURITY DEFINER exposure / trigger hardening：**
   - Security Advisor flags `current_user_role / is_admin / is_reviewer / guard_sensitive_product_draft_fields / handle_new_user / rls_auto_enable` 等 public-schema functions。
   - trigger/event-trigger functions 不應維持不必要 direct client EXECUTE。
   - RLS helper functions不能盲目 revoke authenticated EXECUTE，否則可能破壞 policy evaluation；需用更安全的 schema/RPC surface 設計。

5. **search_path warnings：**
   - `set_updated_at`
   - `touch_image_batches_updated_at`
   - `touch_publish_batches_updated_at`

6. **Auth leaked-password protection disabled。**
   - production 擴大成員前建議啟用。

7. **目前 production profiles 只有 1 個 admin。**
   - 尚無 operator/reviewer。
   - 所以 P0 archive owner bug 目前沒有其他 team member 可實際被越權，但仍必須在新增成員前修好。

## 5. Production schema 目前可視為「晚期 schema + 權限 drift」

核心 tables/columns 大致完整，RLS 也普遍 enabled；主要未知/風險是：
- migration history 不可用
- catalog policies 漂移
- SECURITY DEFINER function RPC surface
- current schema verifier 太舊

因此下一步不是補所有 missing migration，而是建立**乾淨 reconciliation baseline**。

## 6. 下一步順序

1. 保持 production DB 不動。
2. 在有正式 local Supabase CLI repo 環境後，先從 live schema 產生/確認 baseline，再建立新的 reconciliation migration。
3. migration scope：
   - restore/驗證 4 張 catalog/rule RLS policies
   - revoke 不必要 trigger/event-trigger direct EXECUTE
   - harden flagged trigger search_path
   - 保留 RLS helpers 真正需要的 policy execution capability
4. 對 migration 做 operator/reviewer/admin RLS 測試。
5. rerun Supabase Security Advisor。
6. 更新 `verify-sql-schema.mjs` 讓它驗 current schema，而不是主要停留在早期 001/003。
7. 建 CI：verify → typecheck → build。
8. real-product E2E。
9. 再往 E6/F/G。

## 7. 正式環境仍待確認

- Vercel production env
- Shopify production mode / credentials
- real-product E2E

Supabase live schema/RLS 第一輪已確認，後續是 reconciliation，不再標成「完全未知」。

## 8. 文件讀取順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`（碰 DB 必讀）
6. 對應其他 audit
7. `docs/CHANGELOG.md`
8. 歷史施工文件（按需）

不要要求新 session 一開始全文讀 `施工清單.md` 或全部 dated docs。
