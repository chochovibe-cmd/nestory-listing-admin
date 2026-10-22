# AI_START_HERE — Nestory 新 session 入口

> 更新：2026-10-21。本檔只放「怎麼開始」和長期不變的規則；**現況一律看 `docs/CURRENT_STATUS.md`，不要在本檔寫進度。**
> 10-21 之前的完整舊版原文（含 08-18 正式 DB reconcile 細節、PR #8／#10 歷史、舊 CI 分支）：`docs/archive/AI_START_HERE-2026-10-21.md`。

## 1. 開場讀什麼（照順序，讀完就停）
1. 本檔
2. `docs/CURRENT_STATUS.md`：做到哪、進行中、風險、等老闆的事
3. `AGENTS.md`：施工規則、UI／安全鐵則
4. 要排下一包或發包時：`docs/發包總表-2026-10-14.md`

需要時才讀：
- UI 工作：`docs/mockups/nestory-v7-mockup.html`、`docs/Mockup差異備忘.md`、`docs/REGRESSION_AUDIT.md`
- 合作規則細節（scope、Race Guard、Vercel 部署節流 §23）：`docs/AI_WORKING_RULES.md`
- 上線／部署判斷：`docs/RELEASE_READINESS.md`
- 碰正式 Supabase／migration／RLS（**必讀**）：`docs/audits/` 底下四份 2026-08-18 的 PRODUCTION-SUPABASE-RECONCILE、SUPABASE-LOCAL-RECONCILE-CI、SUPABASE-PRODUCTION-PACKAGE、SUPABASE-MIGRATION-BASELINE，以及 `supabase/migrations/`
- 某一包的規格：總表那一列寫的分支和檔名

不要通讀 `docs/`；有日期的施工規格、HANDOFF、audit 都是歷史。

## 2. 專案一句話
Nestory 是潮巢玩居內部的 Shopify 商品上架 PWA：抓取淘寶商品（Chrome 外掛）、圖片／規格、AI 文案、審核、Shopify 發布；Supabase 資料層、Vercel 部署。

## 3. 基本資料
- GitHub：`chochovibe-cmd/nestory-listing-admin`。主線＝`handoff/20261008-golive-spec`；GitHub 預設分支 `codex/nestory-v0.1-safety-skeleton` 是舊的，不是主線。
- 正式站：https://nestory-listing-admin.vercel.app（Vercel Hobby 免費方案，部署次數有限）。
- 正式 Supabase：`nestory-listing-tool-test`（`tbgtqwvuohmdxnxisrgr`）。名字有 test，但它**就是正式資料庫**（免費方案）。
- Shopify 環境變數名稱：`SHOPIFY_STORE_DOMAIN`、`SHOPIFY_CLIENT_ID`、`SHOPIFY_CLIENT_SECRET`（client credentials）、`SHOPIFY_LOCATION_ID`、`SHOPIFY_PUBLISH_MOCK`（正好是 `"false"` 才會真的寫 Shopify）。
- 驗證（與 CI 同順序）：`pnpm install --frozen-lockfile` → `pnpm run verify:all` → `pnpm run typecheck` → `pnpm run build`。

## 4. Migration 規則
- `supabase/migrations/` 是正式 tracked history（從 2026-08-18 起算）；新增一律用 timestamp 檔名，並附測試。
- `supabase/history/pre_tracking_migrations/001–039` 只是歷史：不搬回、不 replay 到正式站。不偽造 ledger（ledger 版本號和檔名對不上是已知的技術債）。
- `supabase/reconcile/` 是證據，不是佇列；`local-production-baseline.sql` 只限 local／CI 使用。
- 已上線的 migration 要 rollback：新增一支 revert migration，不可手動跑舊的 rollback SQL。
- AI 只產生 SQL 檔，不自己跑 Supabase CLI，由老闆貼上執行。只用免費方案，不建付費 branch。CI 裡的免費 DB gate＝GitHub runner＋Docker＋Supabase CLI＋Postgres 17。

## 5. 角色模型
- `operator`：建立、操作自己的商品；不審核、不發布。
- `reviewer`：讀取全隊資料、審核、發布。
- `admin`：reviewer 的權限，加上 profiles、成員角色、敏感設定。
- `viewer`：沒有 TS／DB role；目前不要新增。
- 不要只把 operator 加進 `canPublish()`；改權限時 UI／API／helper／RLS／tests 要一起改。

## 6. 修改鐵則
- 改 A 時不要順手動到無關的 C；先確認範圍。每次修改都記錄 what／why／檔案／狀態／剩餘風險。
- 不刪舊文件；歷史只歸檔到 `docs/archive/`。
- 不 merge、不做 Vercel production 部署，除非老闆明確同意。Preview 不要每個 commit 都部署（一包一次；見 AI_WORKING_RULES §23）。
- Git commit、Preview、CI、Vercel Production、Shopify 是不同的證據，不能拿其中一個的成功去推論另一個也通過。
- 真正寫入 Shopify 的動作要老闆逐步同意；source verifier 不等於 mock 或 E2E 的證據。
- service-role API 不可相信前端傳來的 ID。
- 沒有證據不要改 hosted-only 的 `rls_auto_enable()`；不要為了讓 Security Advisor 變綠燈，就一刀切 SECURITY DEFINER／RLS helper 的 EXECUTE 權限。

## 7. 新 session 開場指令
> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。`git fetch` 後以 `origin/handoff/20261008-golive-spec` 為準。不要用 Git source 猜 Vercel／Supabase 現況，要查就唯讀查。碰 DB 先讀四份 Supabase audits。
