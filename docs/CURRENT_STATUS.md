# Nestory — Current Status

> 新 AI session 先讀本檔；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。
> Owner hard rule：**不要改 A 時順手改到無關 C；先確認 scope，再改；所有變更要留下可銜接紀錄。**

更新基準：2026-08-20
正式 app 基準分支：`codex/nestory-v0.1-safety-skeleton`
正式 app 基準 HEAD：`6ff020dd1d68152b6688c9695f8f96188b7862be`
目前 release 分支：`agent/release-thumbnail-regression-fix`

## 0. ResultCard mobile R3 — source complete, awaiting iPhone QA

Latest owner contract is now implemented directly in formal source: natural
`title → station → date` flow, balanced image/right summary, one-line
sale/strike/profit, card X on the border, 38px scope/sort, compact
generation/sequential-review header, and direct copy-review
`取消 / 批次核准 / 移出佇列` actions.

The implementation is limited to ResultCard title rendering,
DraftResultsPanel copy-review action exposure, the dedicated mobile release
stylesheet, and matching source-contract verifiers/docs. No uploader, Variant,
Supabase, Shopify, API, auth/role, archive-semantic, long-press timing, or
swipe-math behavior changed.

Temporary R3 patch-runner workflows have been removed. See
`docs/audits/RESULTCARD-MOBILE-OWNER-CORRECTION-R3-2026-08-20.md`.

## 1. Production 現況

### App production baseline

Vercel 已有 production deployment：

- branch：`codex/nestory-v0.1-safety-skeleton`
- commit：`6ff020dd1d68152b6688c9695f8f96188b7862be`
- message：`release: merge Nestory stabilization and tracked Supabase baseline (#6)`

目前 2026-08-20 的 ImageUploader / ResultCard 手機修復仍在 release branch，**尚未 merge / 尚未 production deploy**。

### Production Supabase reconciliation — COMPLETE

正式專案：`nestory-listing-tool-test` / `tbgtqwvuohmdxnxisrgr`。

2026-08-18 經 owner 明確授權後完成：

- `PRECHECK_OK` ✅
- tracked migration `20260818142712 baseline_existing_schema_20260818` ✅
- tracked migration `20260818142919 production_reconcile_20260818` ✅
- `POSTCHECK_OK` ✅

受保護資料列前後一致：

- product_drafts 32
- product_images 147
- product_variants 143
- profiles 1

舊 migration `001–039` 未刪除，完整保留在 `supabase/history/pre_tracking_migrations/`；不可 production replay。

## 2. Current mobile release work

### ImageUploader — owner runtime 已接受主要方向

歷史回歸已確認並修正：

- P10/P09 的 nowrap + 96/120 大縮圖不再使用；
- desktop 維持 recovered anchor：secondary 64×64 / main 96×96 / wrap；
- mobile (`<=959px`) 改為 **3 欄等寬正方形**；
- mobile delete `×`：右上、32×32；
- spec badge 保留並避開 `×`。

必須保留的後期有效 UX：

- upload spinner；
- failed retry；
- paste；
- drag/reorder；
- soft-remove；
- dual-size upload；
- spec marking。

這一輪 ResultCard 工作 **不要再動 ImageUploader**。

### Results / ResultCard — containment 已通過

2026-08-20 iPhone runtime 已確認：

- results pane / ResultCard **不再水平凸出手機畫面**。

因此 width containment 不再重做。

### ResultCard — latest owner-refined contract

Owner 2026-08-20 最新 iPhone review 再次修正資訊階層。現在 mobile contract：

**Top/title row**

1. 商品標題是主要內容；
2. station label（例：`文案待審核`）與日期必須視覺上跟在**標題最後一行**後面，不再浮在標題第一行右側；
3. 右上 `×` 放在卡片 top border 上，而不是縮在卡片內容內。

`×` 必須重用既有 `archiveOne()`：

- 意義是「移出工作佇列 / soft archive」；
- 有既有 busy guard；
- 有 undo / unarchive；
- **不是 hard delete，不新增刪資料 API**。

**Summary**

- 圖片在左；
- 右側依序放 `海外現貨`、IP/角色/類型/語氣 tags、warnings；
- wider mobile thumb 約 92px，窄手機約 84px，讓圖片與右側 tags 視覺更平衡；
- 不允許重新產生水平 overflow。

**Price**

- 售價、compare-at、利潤、比例維持一個 compact horizontal information row；
- 無厚重大外框；
- collapsed card 不顯示獨立 `重生`，重生保留在 swipe action。

**Expand / gestures**

- 手機不顯示大型 expand arrow；
- 正常 tap card 仍走既有 `handleHeaderClick → tryToggleExpand`；
- long press 仍是 `LONG_PRESS_MS=500`，gesture math 不改；
- 按住時有視覺壓感；`is-checked` selected accent 保留；
- left swipe handler / threshold 不改。

**Results header**

- `生成結果（三站工作佇列）` 與 compact `逐件審核/逐件標圖` 在手機同一 header row；
- `全選` 保留但縮小，不移除功能。

**Batch toolbar**

- 選取後：count 在上；`取消 / 批次主動作 / 第三動作` 一排；
- copy-review 的 `更多` 只有 `移出佇列`，因此直接顯示既有 soft-archive action，不再多按一層；
- image-review 的 `更多` 仍有 generate-detail on/off + archive，**保留 More**，避免 UI 簡化誤刪功能。

**Filters / hint**

- `只看我的` 與 `最新在上` mobile outer box 同寬；
- 高度從 44px 回到 owner 比較喜歡的 compact 38px；
- gesture hint 保留「長按卡片可多選；左滑可快捷」，theme accent 更明顯但仍是輕量提示；
- swipe actions 只美化外觀，原 handler / API 不改。

### Isolation implementation

最新 owner-refined UI 使用獨立後載 stylesheet：

- `src/app/resultcard-mobile-release.css`
- `layout.tsx` 在 `globals.css → stabilization.css → resultcard-mobile-release.css` 順序載入。

目的：不要繼續把已驗證的 `stabilization.css` 疊成無法追蹤的大補丁，也避免 ResultCard UI 改動波及 upload / Variant / desktop。

詳細 audits：

- `docs/audits/RESULTCARD-MOBILE-OWNER-CORRECTION-2026-08-20.md`
- `docs/audits/RESULTCARD-MOBILE-REFINE-2026-08-20.md`（latest）

## 3. Explicit C guard for current UI pass

這一輪禁止順手修改：

- ImageUploader / upload pipeline；
- VariantEditor / variant persistence；
- Supabase schema/data/RLS；
- Shopify publish implementation/config；
- review/approve/revision/publish API；
- archive endpoint semantics；
- roles/auth；
- long-press timer / swipe threshold / swipe math；
- desktop ResultCard quick actions。

UI pass 只允許：

- `ResultCard.tsx` 的 mobile title/station/date 最小 DOM；
- `DraftResultsPanel.tsx` 的 copy-review direct archive action 與 station class；
- dedicated ResultCard mobile CSS；
- mobile presentation verifier；
- CURRENT_STATUS / audit docs。

## 4. CI gate

Canonical final automated gate：

1. `pnpm install --frozen-lockfile`
2. `pnpm run verify:all`
3. `pnpm run typecheck`
4. `pnpm run build`

`agent/ci-gate` / `b935290` 曾建立 green CI baseline。

目前 release branch 每次 runtime UI 調整後仍需 final CI；Vercel Preview READY ≠ GitHub full CI complete。

Vercel Hobby build-rate-limit/quota error 不要誤判成 code compile failure。

## 5. Runtime / tool health audit — 2026-08-20

Dedicated audit：

- `docs/audits/RELEASE-HEALTH-AUDIT-2026-08-20.md`

目前 Vercel production 最近 7 天 runtime-error query：**沒有 error clusters**。

這代表沒有已知 production crash loop，但不取代 authenticated/manual workflow QA。

### Shopify — good guards already present

Single publish route目前：

- 要 signed-in user；
- `canPublish` role guard；
- ACTIVE 要 `confirmActive=true`；
- invalid mode拒絕；
- duplicate variant combinations publish 前擋掉。

Shopify credential/token：

- CLIENT_ID / CLIENT_SECRET server-only；
- client_credentials token有cache + expiry safety margin；
- 401 invalidate後只 retry一次；
- live mode缺 credentials誠實 fail。

### Shopify P0 before broad real publishing

#### P0-A：Production env 必須確認

真實 Shopify write只有 `SHOPIFY_PUBLISH_MOCK` **精確等於 `false`** 才啟用。

真實 E2E 前必查：

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_PUBLISH_MOCK=false`
- 建議明確 `SHOPIFY_LOCATION_ID`

目前可用 Vercel connector不提供 env secret/value read，所以不可從 source猜正式環境已正確。

建議後續 UI 加一個不洩密的 `模擬發布 / 正式 Shopify` indicator。

#### P0-B：partial Shopify create retry idempotency

目前 `publishDraft` 是先 `productCreate`，再同步 variant/price/inventory。

若 Shopify product已建立，但後續 variant sync失敗：

- app會記 `api_failed`；
- 也會存已建立的 `shopify_product_id` 供診斷；
- 但目前 source沒有明顯看到下一次 retry 在 `productCreate` 前對既有 `shopify_product_id` 做 resume/idempotency guard。

因此廣泛 live publish 前應做獨立修復/防呆，避免 partial failure retry 可能建立重複 Shopify product。

這是 **P0 release risk**，但不要混進 ResultCard UI commit。

### Shopify P1

有限庫存建議明確設定 `SHOPIFY_LOCATION_ID`；現在缺值時會嘗試第一個可讀 location，多倉情境可能不是 owner預期的庫存位置。

### Test / QA gap

Repo有大量 `verify:*` source-contract tests、typecheck、build，但 `package.json` 目前沒有 Playwright/Cypress browser E2E runner。

這也是為什麼有些 CSS regression source verifier過了，iPhone runtime才看到。

不建議為了眼前 release臨時大導入新 framework；本輪先用：

- owner iPhone runtime；
- final CI；
- controlled Shopify mock；
- controlled real-product E2E。

release後再補最小 Playwright mobile smoke最合理。

## 6. Role / RLS canonical model

- operator：建立/操作自己的商品；不審核、不發布。
- reviewer：全隊讀取、審核、發布。
- admin：reviewer + profiles / 成員角色 / 敏感設定。
- viewer：不存在。

任何角色改動必須 helper + UI + API + DB/RLS + tests一起對齊。

Batch archive authorization已修：operator own-only；reviewer/admin依RLS team scope。

## 7. Migration tracking canonical

Production migration list：

1. `20260818142712 baseline_existing_schema_20260818`
2. `20260818142919 production_reconcile_20260818`

Active queue：`supabase/migrations/` 只放正式 tracked migrations + future migrations。

Historical `001–039`：`supabase/history/pre_tracking_migrations/`，不可 production replay。

未來 production DDL 使用 tracked migration；不要 fake ledger / manual rollback後留下不一致 history。

## 8. Release runtime gate

Owner iPhone 驗最新 Preview：

1. containment不能回歸；
2. title 正常換行，station + date 視覺跟在 title 最後一行；
3. card `×` 位在右上 border 上，可以移出佇列且 undo正常；
4. thumbnail left / sale+tags+warnings right，比例平衡；
5. price / compare / profit 一排且不 overflow；
6. long-press有按住 feedback，成功後selected state明顯；
7. results header 與逐件審核 compact 且不 overflow；
8. copy-review batch直接看到移出佇列，不需一個只有一項的 More；
9. image-review More的 generate-detail options仍在；
10. scope/sort等寬且 compact 38px；
11. gesture hint使用theme accent；
12. left swipe actions可正常執行；
13. uploader仍3欄；
14. Variant picker/zoom快速 sanity check。

## 9. Shortest path to formal production use

1. 本輪 owner-refined ResultCard Preview通過 iPhone runtime。
2. **停止 mobile UI施工**。
3. final GitHub CI：`verify:all → typecheck → build`。
4. Production Shopify env/config preflight（不曝露secret）。
5. 解決或明確 gate `partial productCreate retry idempotency` P0。
6. Shopify mock publish。
7. owner明確批准後才做一筆 controlled real-product E2E。
8. E2E正確後，owner明確批准才 merge/deploy本輪 release到 production。

不要因為 Preview可開就跳過 CI / Shopify preflight / owner production approval。

## 10. Source of truth / audits

先讀：

- `AI_START_HERE.md`
- 本檔
- `AGENTS.md`
- `docs/RELEASE_READINESS.md`

UI / regression：

- `docs/audits/UIUX-COLLATERAL-REGRESSION-AUDIT-2026-08-19.md`
- `docs/audits/MOBILE-REGRESSION-RESTORE-2026-08-19.md`
- `docs/audits/MOBILE-RUNTIME-VALIDATION-2026-08-19.md`
- `docs/audits/MOBILE-RELEASE-LAYOUT-2026-08-20.md`
- `docs/audits/RESULTCARD-MOBILE-POLISH-2026-08-20.md`（前一版 owner後續已修正）
- `docs/audits/RESULTCARD-MOBILE-OWNER-CORRECTION-2026-08-20.md`
- `docs/audits/RESULTCARD-MOBILE-REFINE-2026-08-20.md`（latest）
- `docs/audits/RELEASE-HEALTH-AUDIT-2026-08-20.md`

DB / security：

- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`

`docs/CHANGELOG.md` 是 append-only；connector沒有安全 append primitive時不要整檔覆寫/截斷。最新變更透過 CURRENT_STATUS + dedicated audits保留完整紀錄。
