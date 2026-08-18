# Nestory — Current Status

> 這是給新 AI session 的「唯一短版現況」。
> 只放現在還成立的資訊；歷史細節看 `docs/CHANGELOG.md` / audits。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前穩定化 stack：cleanup → P0-1 → P0-2 → P0-3 → P1-1 → P1-2 → **P1-3**
目前工作分支：`agent/p1-localstorage-secret-policy`

## 1. 專案狀態

Nestory 核心商品上架、AI 文案、圖片/規格、審核、Shopify publish 架構已相當完整。現在主要工作是**穩定化與正式環境一致性**，不是擴新功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 70–75%

## 2. 已實作的穩定化修復（皆尚未完整 runtime 驗證/merge）

### P0-1 Variant axis atomic confirm
分支：`agent/p0-variant-atomic-confirm`
固定 commit：`171bbaa`

Destructive axis change 未確認前不再先改 dimensions；確認後 dimensions + rows 一起套用。

### P0-2 Variant duplicate option protection
分支：`agent/p0-variant-duplicate-protection`
canonical：branch HEAD / `fix(variants): protect duplicate option combinations`

四層 guard：expand/merge、Workspace pre-submit、shared persistence、Shopify publish 409。

### P0-3 Mobile ResultCard expand affordance
分支：`agent/p0-mobile-resultcard-expand`
canonical：branch HEAD / `fix(mobile): restore ResultCard expand affordance`

只在 mobile 恢復既有 `.rc-toggle`（44×44），不恢復 desktop quick actions；使用 isolated `stabilization.css` hotfix。

### P1-1 Mobile interactive-target gesture guard
分支：`agent/p1-mobile-gesture-guard`
canonical：branch HEAD / `fix(mobile): isolate ResultCard controls from card gestures`

- centralized `cardGestureTarget.ts`
- ResultCard touch start/move/end 在 interactive target 退出
- blank card surface long-press/swipe 保留
- verifier 已接入 package / verify-all
- 額外鎖住 `activeTab === tab.id`

### P1-2 P07 Variant desktop hover preview containment
分支：`agent/p1-variant-picker-clipping`
canonical：branch HEAD / `fix(ui): keep Variant hover preview inside picker`

保留 P07 `overflow-x:clip`；只在 desktop fine pointer 將 picker 第一/第三欄 160px hover preview 向 260px picker 內側對齊。不改 VariantEditor / globals.css；新增 `verify:variant-picker-containment`。

### P1-3 Browser-storage secret policy
分支：`agent/p1-localstorage-secret-policy`
canonical：branch HEAD / `fix(verify): enforce sensitive browser-storage writes`

Root cause：`verify-no-secrets.mjs` 的註解已承認 localStorage 不等於洩密，但實作仍以檔名 allowlist blanket-ban `/localStorage/i`，因此合法 UI state（automation prefs、tone memory、ResultCard gesture hint、autosave/prefs）會造成 verifier drift。

已改：
- 新增 `scripts/browser-storage-secret-policy.mjs`。
- `findSensitiveBrowserStorageWrites()` 只檢查 browser storage 的 write arguments / assignment key+value，敏感命名包含：
  - `apiKey`
  - `accessToken / refreshToken / authToken / bearerToken`
  - `clientSecret / privateKey / serviceRole`
  - `secret / password / credential / authorization`
  - `webhook`
  - provider-specific `shopify/github/openai/anthropic` key/token
- `verify-no-secrets.mjs` 移除 localStorage allowlist 與 blanket-ban；保留既有：
  - client-side Anthropic call guard
  - client-side OpenAI/Anthropic secret env name guard
  - hard-coded key/token prefix scans
  - `.env` / `.gitignore` checks
- 新增 `verify-browser-storage-secret-policy.mjs`：
  - 合法 theme/prefs/session/tone storage 必須通過
  - `openaiApiKey/accessToken/webhook/clientSecret/service_role` storage writes 必須被抓
  - 直接讀現有 `automationPrefsStore.ts`、`toneMemory.ts`、`DraftResultsPanel.tsx` 確認不誤殺
- 新增 `verify:browser-storage-secrets` 並納入 `verify:all`。

目前 code/verifier diff 相對 P1-2 已確認只含 5 檔：
- `scripts/browser-storage-secret-policy.mjs`
- `scripts/verify-no-secrets.mjs`
- `scripts/verify-browser-storage-secret-policy.mjs`
- `package.json`
- `scripts/verify-all.mjs`

**下一個主線：role / permission / RLS consistency audit。**

## 3. 仍待處理的高優先事項

### P0 role / permission model
實際角色 `admin | operator | reviewer`；部分文件曾寫 viewer。operator 預設不能 publish，牽涉前端 + RLS/DB guard，不能只改 `canPublish()`。

下一步應先做 audit/decision：
- 新使用者預設 operator 是否合理
- operator 是否應 publish
- reviewer 是否只審核或也可發布
- admin 專屬能力有哪些
- 對應 TS type / frontend guard / API auth / RLS / SQL trigger/policy 一次對齊

### P0 migration verification drift
migrations 已到 039，但 SQL verifier 主要驗早期 schema；需對 production Supabase 做 reconcile。

### CI
目前沒有正式 GitHub Actions CI gate。未來建議：install → verify → typecheck → build。

## 4. 重要穩定化結論

- P0-1 / P0-2：Variant state consistency / duplicate option guard 已做。
- P0-3 / P1-1：Mobile ResultCard expand + gesture isolation 已做。
- P1-2：P07 containment 保留，Variant hover preview 用局部 collision fix。
- P1-3：`verify:no-secrets` 不再把所有 localStorage 當風險，而是檢查敏感 browser-storage writes。
- 過去 commit scope 混雜；現在一題一 commit。

## 5. 功能階段摘要

- Phase A/B：核心後端與 listing UI 大致完成。
- Phase C：shell/settings/library/FX 完成；member management 未完成；records 部分。
- Phase D：Shopify/image chain/Sharp/image review 大致完成；Showmore/preview/YouTube 有殘留驗證。
- Phase E：E1–E5 大致完成；E6 未完成。
- Phase F/G：大多未開始，**現在不優先**。

## 6. 正式環境尚未確認

仍需：
- Vercel production env
- Supabase migration / RLS 實際狀態
- Shopify production mode / credentials
- real-product E2E

## 7. 下一步順序

1. 收尾/squash P1-3；專用 verifier / typecheck 留待可執行環境驗證
2. role / permission / RLS consistency audit + decision
3. production Supabase migration reconcile
4. CI
5. real-product E2E
6. 再往 E6/F/G

## 8. 文件讀取順序

1. `AI_START_HERE.md`
2. 本檔
3. `AGENTS.md`
4. `docs/STABILIZATION_PLAN.md`
5. 對應 audit
6. `docs/CHANGELOG.md`
7. 歷史施工文件（按需）

不要要求新 session 一開始全文讀 `施工清單.md` 或全部 dated docs。
