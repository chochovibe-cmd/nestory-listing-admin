# Nestory — Current Status

> 給新 AI session 的短版現況；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 → role audit → P0 archive auth → production Supabase audit → CI gate → **Supabase 001–039 reconcile plan**
目前工作分支：`agent/supabase-reconcile-plan`
目前 Draft PR：#1 `ci: add verified quality gate and modernize repo checks`（base 是 production Supabase audit；仍未 merge）

## 1. 專案狀態

Nestory 核心商品上架、AI 文案、圖片/規格、審核、Shopify publish 架構已相當完整；目前主線是**穩定化與正式環境一致性**，不是擴新功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 75–80%（CI gate 已全綠；production DB security reconcile、實機 E2E 仍未完成）

## 2. 已實作的 stabilization stack

- **P0-1** `agent/p0-variant-atomic-confirm` / `171bbaa`：Variant destructive axis confirm atomic。
- **P0-2** `agent/p0-variant-duplicate-protection`：duplicate option protection，涵蓋 expand / Workspace / persistence / Shopify 409。
- **P0-3** `agent/p0-mobile-resultcard-expand`：mobile selectMode 恢復既有 compact expand toggle。
- **P1-1** `agent/p1-mobile-gesture-guard`：interactive child touch 不再被 ResultCard long-press/swipe 接管。
- **P1-2** `agent/p1-variant-picker-clipping`：保留 P07 containment，局部修 desktop Variant hover preview clipping。
- **P1-3** `agent/p1-localstorage-secret-policy`：no-secrets 改成檢查 credential-like browser-storage writes，不 blanket-ban localStorage。
- **P0 archive auth** `agent/p0-archive-owner-authorization` / `fdc5527`：batch archive authorization read 先走 authenticated RLS，再 service-role mutation。

以上功能修復仍需要對應手機/Variant/角色實機 cases；不要只因 CI compile green 就宣稱所有 UX runtime 已驗證。

## 3. CI gate — complete / final squashed head green

專項：`docs/audits/CI-GATE-2026-08-18.md`
分支：`agent/ci-gate`
final head：`b935290`
Draft PR：#1

Workflow：
1. `pnpm install --frozen-lockfile`
2. `pnpm run verify:all`
3. `pnpm run typecheck`
4. `pnpm run build`

Final squashed-head green run：`32132941280` / job `95697924316`
- install ✅
- verify:all ✅
- typecheck ✅
- build ✅

### CI 建立時清掉的 verifier drift

- `verify-static` 舊 localStorage blanket-ban 與 P1-3 新 policy 衝突。
- raw `OPENAI_API_KEY` 說明文字被誤判成 client secret access。
- 舊 client/server path heuristic 會把真正 server helper 誤判成 client。
- `verify-requirements` 綁死已淘汰 v0.1 文件名稱。
- `verify-contracts` / `verify-mock-flow` 直接讀已不存在的 legacy docs。

現在：
- client scope 由 `"use client"` import graph 推導。
- release/deployment/API/manual QA/handoff contract 集中到 `docs/RELEASE_READINESS.md`。
- verifier 優先驗 current source + fixture + canonical docs，不再把歷史檔名本身當產品 contract。

### Vercel 狀態解讀

Recent Vercel preview failure 的 GitHub target 是 `build-rate-limit / upgradeToPro`。
GitHub CI 已在乾淨 Ubuntu runner 完成 `next build`，所以目前該 Vercel failure 應視為 preview quota/rate-limit，不是已證實的 code compile failure。

## 4. Role / RLS canonical model

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`

Canonical role：
- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。
- `viewer` 沒有進 TS/DB enum；目前不要新增。

不要只把 operator 加進 `canPublish()`；未來若要改，必須 helper + API + UI + DB/RLS + tests 一次對齊。

## 5. Production Supabase reconcile — 001–039 live-state matrix complete

專項：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
實際 Supabase：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`
工作分支：`agent/supabase-reconcile-plan`
production DB：**尚未修改**。

### 已完成

Repo migration `001–039` 已逐份讀取並和 live schema / constraints / indexes / policies / functions / grants / representative seed data 對照。

結論：
- migration ledger 空白，但 production live end-state 幾乎完整反映 `001–039`。
- **不要 replay `001–039`。**「ledger 沒紀錄」不等於「schema 沒套」。
- `009` 的中間 sale-status state 已由 `010` 正確取代。
- `019` 的 process-intent constraint 已由 `030` 正確擴充。
- `025/027` 的 recursive batch RLS 已由 `028` helper-based policies 正確取代。
- `032/033/037/038` 的大量 catalog/tag/knowledge seed 也有強證據已存在。
- `039` dual image URLs 已存在。

### 唯一明確 migration-level drift

`004_ip_tag_collection_tables.sql`：
- 4 張表存在
- RLS enabled
- grants / constraints / triggers 存在
- **但 8 條預期 policies 全部不存在**

受影響表：
- `ip_catalog`
- `ip_characters`
- `tag_rules`
- `collection_rules`

### 其他 security hardening debt

- SECURITY DEFINER direct EXECUTE / RPC surface 有 Security Advisor warnings。
- `set_updated_at / touch_image_batches_updated_at / touch_publish_batches_updated_at` 沒有 explicit function search_path。
- Auth leaked-password protection disabled。

### 已建立安全 reconcile SQL review draft

`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

刻意放在 `supabase/reconcile/`，**不是** `supabase/migrations/`：
- migration ledger 空白時，現在不能讓 future `db push` 把歷史 `001–039` 當未套用 migration 重播。

Draft 的 active SQL 目前只包含：
1. restore 8 missing catalog/rule policies
2. 3 個 timestamp trigger helper 固定 `search_path = pg_catalog`

SECURITY DEFINER trigger/event-trigger direct EXECUTE revoke 目前只留**註解候選**，不會執行；要在隔離 DB 測過 trigger behavior 才能啟用。

## 6. 下一步順序

1. **Production 不動。**
2. Review `supabase/reconcile/2026-08-18_production_reconcile_draft.sql` 的最小 SQL scope。
3. 決定隔離 Supabase 測試環境：目前 project 沒有 development branch；建立 branch 會產生成本，必須先取得成本並由使用者明確確認。
4. 隔離測試：
   - authenticated 可讀 active catalog rows
   - operator 不可直接 admin-write catalog
   - admin 可管理 catalog / 讀 inactive
   - core draft owner/reviewer RLS 不受影響
   - batch RLS 不回歸 42P17 recursion
   - auth new-user / sensitive-field / updated_at triggers 正常
   - SECURITY DEFINER revoke 候選逐一驗證
5. 測過後才決定真正 tracked migration/baseline 策略。
6. rerun Supabase Security Advisor。
7. Vercel production env + Shopify production config audit。
8. 執行 release-readiness manual/runtime matrix + real-product E2E。
9. 再往 E6/F/G。

## 7. Release / validation source of truth

- Release gate：`docs/RELEASE_READINESS.md`
- Current state：本檔
- Stabilization ordering：`docs/STABILIZATION_PLAN.md`
- CI history：`docs/audits/CI-GATE-2026-08-18.md`
- Production DB truth + 001–039 matrix：`docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- Reconcile SQL review draft：`supabase/reconcile/2026-08-18_production_reconcile_draft.sql`

CI green = source/verifier/typecheck/build green；**不等於手機/角色/真 Shopify E2E 已全部手動驗證**。

## 8. 新 agent 文件順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. 對應 audit
6. `docs/RELEASE_READINESS.md`（release/deploy 時）
7. `docs/CHANGELOG.md` / 歷史施工文件（按需）

不要要求新 session 一開始全文讀 `施工清單.md` 或全部 dated docs。
