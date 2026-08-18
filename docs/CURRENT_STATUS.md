# Nestory — Current Status

> 給新 AI session 的短版現況；歷史細節看 `docs/CHANGELOG.md` / audits。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → P1-3 → role audit → **P0 archive auth**
目前工作分支：`agent/p0-archive-owner-authorization`

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

P1-3 最終 preview 的 Vercel status 曾回 failure，但 target 明確是 `build-rate-limit / upgradeToPro`，不是程式 build error；因此只記為「preview 額度阻擋、未驗證」。

## 3. Role / RLS audit 結論

專項：`docs/audits/ROLE-RLS-CONSISTENCY-AUDIT-2026-08-18.md`
分支：`agent/role-rls-consistency-audit`

目前真正 canonical role 是：
- `admin`
- `operator`
- `reviewer`

`viewer` 沒有進 TypeScript 或 DB enum，只是部分舊/後期文件語意；目前不建議新增。

### 建議 canonical capability model
- **operator**：建立/操作自己的商品；不審核、不發布。
- **reviewer**：可讀全隊、審核、發布。
- **admin**：reviewer 能力 + profiles / 成員角色 / 敏感 team settings 管理。

這個模型最接近現有 source + DB：
- 新使用者預設 `operator`。
- `canReview` / `canPublish` = admin + reviewer。
- DB sensitive-field guard 也只讓 admin/reviewer 進 generation/review/publish system state。
- reviewer/admin 可讀全隊 draft；operator 主要只讀自己的 draft。

因此：**不要只把 operator 塞進 `canPublish()`。** 若未來真要讓一般 operator 直接發布，要另做完整 role-model change（helper + API + DB/RLS + UI + tests）。

### 已確認文字 drift
- `canAccessSettings()` 實際用 `canOperate()`，所以三角色都可進設定頁，但註解仍寫 admin + operator。
- capture-token API 也用 `canOperate()`，實際 reviewer 可產生個人 token，但註解/403 文案寫 operator + admin。

這些屬文字/語意 drift，後續可獨立修文案，不應拿 stale 註解反推安全權限。

## 4. 新找到並已修的 P0 authorization bug

分支：`agent/p0-archive-owner-authorization`

### 原問題
`/api/drafts/batch/archive`：
1. 只檢查 `canOperate()`。
2. 接著用 service-role client 讀 request 傳入的任意 `draftIds`。
3. service role bypass RLS。
4. route 沒有 owner check。

因此 operator 原本可能跨 owner 封存／解封其他人的商品。

### 已實作
- requested draft IDs 的 initial read + migration-024 fallback read 全改成 `authSupabase`。
- 先由 authenticated RLS 篩出使用者可見 rows：operator 只拿自己的 rows；reviewer/admin 可拿全隊 rows。
- service role 仍只用於後續 archive/unarchive mutation，不再負責 request ID authorization read。
- 新增 `verify-batch-archive-authorization.mjs`：
  - 鎖定 initial/fallback read 必須用 authSupabase。
  - 禁止 authorization phase 用 service role select requested draft IDs。
  - 鎖定 001 migration 的 team/owner read RLS contract。
- 新增 `verify:batch-archive-auth` 並納入 `verify:all`。

目前 code/verifier diff 相對 role audit 只含：
- `src/app/api/drafts/batch/archive/route.ts`
- `scripts/verify-batch-archive-authorization.mjs`
- `package.json`
- `scripts/verify-all.mjs`

沒有擴張任何角色能力、沒有改 migration、沒有改 `roles.ts`。

## 5. 接下來高優先事項

1. 收尾/squash P0 archive owner authorization。
2. production Supabase migration / RLS reconcile（repo migrations 已到 039，但實際 production 尚未驗證）。
3. CI gate：verify → typecheck → build。
4. real-product E2E。
5. 再往 E6/F/G。

## 6. 正式環境尚未確認

仍需：
- Vercel production env
- Supabase migration / RLS live state
- Shopify production mode / credentials
- real-product E2E

## 7. 文件讀取順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. 對應 audit
6. `docs/CHANGELOG.md`
7. 歷史施工文件（按需）

不要要求新 session 一開始全文讀 `施工清單.md` 或全部 dated docs。
