# Nestory — Current Status

> 新 AI session 先讀本檔；詳細證據看 `docs/audits/`，release gate 看 `docs/RELEASE_READINESS.md`。
> Owner hard rule：**不要改 A 時順手改到無關 C；先確認 scope，再改；所有變更要留下可銜接紀錄。**

更新基準：2026-09-02（CI／Preview／production ledger read-only verification）
預設分支：`codex/nestory-v0.1-safety-skeleton`
Git source 目前 HEAD：`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`
已知 Vercel production baseline：`6ff020dd1d68152b6688c9695f8f96188b7862be`
PR #8：已於 2026-08-25 以 `21e9d1c90697797aaa6d982e9454ccd4a6955fd8` 合入預設分支。

> **2026-09-02 外部查證結果：**Vercel production alias 的 `READY` deployment 是 `6960a0c`；不是本輪 `f0a6bfa`。Supabase 正式專案狀態為 `ACTIVE_HEALTHY`，migration ledger 僅有 baseline/reconcile 兩筆；`20260822223100` 與 `20260902090000` 都還未套用。同理，source verifier／CI pass 仍不是 Shopify mock 或真實 E2E 的通過證明。
>
> 下方 D3.4–D3.7 中關於「PR #8 Draft／未 merge／尚未 production deploy」的敘述，是當時 package 的歷史條件；現況一律以上方 release truth 與 `docs/audits/RELEASE-TRUTH-RECONCILE-2026-09-01.md` 為準。

## Latest release-branch package — D3.7 mobile gesture guidance + bidirectional swipe

D3.7 只做 Commander 授權的兩項 mobile gesture corrective；start guard parent 為
`cea4babfb4a3aab7acddc1a3f22e055265ac744f`；「不 merge」是合併前 package guard，PR #8 的目前 merge 狀態以上方為準；本包沒有 Shopify write。

- Mobile `<=959px`：gesture teaching note 改為永久顯示的低強度 accent `△ + text`，final copy 由 JSX 單一來源提供；舊 dismiss state / localStorage / X 與 historical pseudo copy 移除。Desktop `>=960px` 不顯示此 mobile 教學。
- ResultCard mobile swipe 改為 signed bidirectional model：右滑露出左側 workflow panel（copy=`核准 / 重生`、image=既有 primary / `退回`、ready=`發布／匯出`）；左滑露出右側 `移出佇列`。workflow 寬 156px、ready single 108px、remove 96px，依各自半寬 snap；一次只顯示一側。
- `LONG_PRESS_MS=500`、`GESTURE_MOVE_PX=10`、axis/interactive/select/expanded/sequential/one-open-card guards 與所有 business handlers / API semantics 不變。新增 `scripts/verify-resultcard-uiux-d37.mjs` 並更新 historical verifier contract。

> 以下 D3.6 與更早章節保留作歷史脈絡；D3.7 只 supersede mobile gesture teaching note 與 swipe direction/reveal presentation。

## Latest release-branch package — D3.6 mobile selection controls corrective

D3.6 只做 owner 授權的兩項 mobile presentation corrective；start guard parent 為
`0c8df49bdfc5e08ed76f6cba040b22b5da22daea`；「不 merge」是合併前 package guard，PR #8 的目前 merge 狀態以上方為準；本包沒有 Shopify write。

- Mobile `<=959px`：`全選` 重用既有 semantic checkbox / `toggleAll` / checked / indeterminate DOM，final presentation 改為兩段 sliding control。OFF 與 partial 都讓 neutral segment 留在右側空白區；ON 才把 accent segment 滑到左側「全選」。partial 只用 accent border 提示，避免冒充全選。Desktop `>=960px` 完全保留 D3.5 native checkbox。
- Mobile copy-review long-press batch：`取消 / ✓ 批次核准 / 移出佇列` 改為 `repeat(3, minmax(0, 1fr))` 等寬；三顆統一 `40px` 高、`var(--radius-s)`、11px / 800 / line-height 1 / 相同 padding，只保留 semantic color 差異。既有 clear / approve / soft-archive handlers 不變。
- Verifier：D3.4B / D3.5 presentation assertions 已承認 D3.6 mobile-only supersession；新增 `scripts/verify-resultcard-uiux-d36.mjs` 並納入 `verify-all`。

> 以下 D3.5 與更早章節保留作歷史脈絡。D3.6 只 supersede mobile select-all presentation 與 copy-review batch geometry。

## Latest release-branch package — D3.5 final pre-Shopify UI freeze

D3.5 是 ResultCard / Variant UI 的最後 corrective polish。Start guard 以
`3ef8ab0e942aaffba5b9ca0af39ac38897d42b25` 為唯一允許 parent；本包完成後停止
ResultCard / Variant UI 施工，下一步只能由 Commander 另開 controlled Shopify go-live package。

Final owner UI contract：

- Shared：desktop + mobile `全選` 改為真正可見的 native checkbox +「全選」文字；既有 `toggleAll`、checked 與 indeterminate semantics 保留，歷史 `rc-toggle-track` 僅保留相容 markup、final presentation 隱藏，不再呈現 switch / knob。
- Desktop results：StageFilterPills、scope、sort 在正常 desktop viewport 同列；desktop `全選` 從 filter hierarchy 視覺移到 panel header，與 `▶ 逐件審核 / ▶ 逐件標圖` 形成同一 review-control group。沒有改 ResultCard desktop information architecture。
- Desktop login：`>=960px` 將 `.login-panel` 放寬到舒適的 640px 上限；mobile 維持原 compact form。Supabase sign-in / redirect / session / role 全部未改。
- Mobile Variant：`依角色建立` 改走既有 `createPortal + variant-editor-modal-backdrop + variant-editor-modal` bottom-sheet/modal 系統；搜尋 `ip_characters`、multi-select、loading、`appendCharacterRows` 行為不變。Desktop 仍保留既有 inline role builder。
- Mobile Variant actions：固定同組 `[＋新增維度] [依角色建立] [批次手動覆蓋價格]`；390/393/375px 以三欄呈現，極窄 `<360px` 才 graceful wrap。原 mobile-only `＋ 新增 Variant` entry 移除，但 `addRow` 與既有 add-variant capability 沒有刪除。
- Mobile Variant rows：drag glyph / row badge / copy chrome 更 compact；readonly 規格最多兩行；readonly spec / price 與 copy action 去掉 input-like heavy frame；成本 input 保持明確 editable affordance；mobile-only grid 固定規格→價格→成本→庫存節奏並限制 width，desktop Variant grid 不改。
- Touch reorder / long-press guard 保持 `ROW_LONG_PRESS_MS=500`、`TOUCH_DRAG_PX=8`；pricing helper、manual lock、inherited cost、batch cost semantics 均未改。

Verifier：

- `scripts/verify-resultcard-uiux-d34b.mjs` 已移除被 D3.5 supersede 的 switch / mobile `＋新增 Variant` assertion。
- 新增 `scripts/verify-resultcard-uiux-d35.mjs`，驗證 final checkbox、desktop controls/login、mobile character modal/action group/row polish 與 desktop Variant freeze。
- `scripts/verify-all.mjs` 已納入 D3.5 verifier；舊 D3 verifier 已改為承認 D3.5 checkbox supersession。

Dedicated audit：

- `docs/audits/PRE-SHOPIFY-UI-FINAL-2026-08-21.md`

Git / release gate：

- D3.5 start commit：`3ef8ab0e942aaffba5b9ca0af39ac38897d42b25`
- final commit：本 `ONE FINAL COMMIT` 所在 commit；commit 無法在自身內容中預先嵌入自身 SHA，immutable SHA 以 PR #8 final head 與 Commander final report 為準。
- 「PR #8 必須維持 Draft / Open / 未 merge」為合併前的 historical guard；現已由 2026-09-01 release truth 取代。
- Work runtime 若無法執行本地 dependency/build，GitHub CI 是 final remote authority；Vercel Preview 與 CI 結果以同一 final HEAD 驗證。
- 本包明確 **沒有 Shopify production write**；不要建商品、上架、下架、更換 token 或修改 store configuration。

> 以下 D3.4B 與更早章節保留作歷史脈絡。若與 D3.5 final contract 衝突，以 D3.5 為準。

## Previous release-branch package — D3.4B owner corrective pass 2

D3.4A / D3.4A.1 曾被 owner 否決，並由 `3b270b368ac5362e5cfc0048791942fd2f08798a`
以正常 revert 完整退回 D3.3 source state。本次最新包是重新設計的 **D3.4B**，
不要把被 revert 的 D3.4A 實作當成目前基準。

D3.4B 最新真實狀態：

- A：mobile `全選` 文字整合進 toggle 本體，移除 D3.3 外層框；仍與 `只看我的 / 排序` 維持 38px 同高三欄幾何。
- B：mobile 操作提示列恢復可關閉 `X`；關閉只隱藏提示列，既有資料／ResultCard 行為不受影響。
- C：維度 / 規格值定義區改用 ResultCard Tags 的 chip 設計語言；`新增維度`、`新增值` 都改成按下後才出現的 modal / bottom-sheet 流程；**mobile + desktop 同步**。
- D：variant 結果列 **只改 mobile**；使用六點 Pointer Events drag、圖示複製、小 badge、縮圖、readonly 完整規格名 + 鉛筆、readonly 售價／定價 + 鉛筆、窄成本、無限庫存 toggle、最右垃圾桶。D3.3 的 mobile `×` 已明確改回垃圾桶。
- E：mobile 固定同排 `批次手動覆蓋價格 / ＋ 新增 Variant`，兩者都走 modal / bottom sheet，不會因「建立規格」收合而消失；長按 variant row 進入多選。批次成本只作用於被選取列，且不論該列原成本是空白、商品成本繼承值或既有手填值，都會覆寫成這次輸入的新成本；未選取列完全不動。覆寫後呼叫既有 `recalculateUnlockedVariantPrices`：未手動鎖定價格的列依既有公式重算售價與定價，`priceLocked`（✎ 手動鎖定）列則由既有 helper 直接保留原售價／定價，不修改任何 pricing formula。
- F：ResultCard 價格列改成底部對齊，較大價格文字向上延伸；**mobile + desktop 同步**。
- Desktop variant 結果卡片 D/E 本包不改，保留原本 desktop render path；下一輪若做視覺優化應獨立成 D3.5 類 package。

H 段已確認：

- 新增 variant 已會繼承正的商品層級成本；
- 舊 `套用成本` 只填空白 / 非正成本列，不覆蓋已填正數；
- per-variant 實際成本本來就存在，`costIsInherited` 只是 UI-only marker，沒有獨立 DB override flag；
- 因此 D3.4B 可安全完成批次手動成本覆蓋，不需 schema migration，也沒有修改 `rate / costMultiplier / marginMultiplier / compareAtMultiplier / minPrice` 等價格公式。
- Final-commit guard：mobile 成本欄視覺寬度固定約五位數字空間（88px）；mobile 複製使用雙重疊方框 icon、仍精確複製並插入下一列；操作提示實際文案為「長按卡片進入多選；向左滑可核准／重送，向右滑可移除。」；`＋ 新增 Variant` 與批次覆蓋按鈕固定同排且都只開 modal，不做 inline 展開。
- 傳輸環境備註：D3.4B 候選中的 `VariantEditor.tsx` 因本次 ChatGPT→GitHub connector 對單一工具參數約 32K 字元開始出現截斷，而 GitHub Git Blob API 官方上限遠高於此，因此採**純機械式 render 抽出**：runtime state / handlers / pricing / duplicate / inventory / touch-drag 邏輯全部仍留在 `VariantEditor.tsx`，只把原 JSX 搬到 `VariantEditorRender.tsx` 的普通 render functions。這是傳輸 workaround，不是設計或架構重構；拆分前後 moved JSX 與非 render runtime logic 已做 byte-for-byte 等價驗證。

Dedicated audit：

- `docs/audits/RESULTCARD-VARIANT-UIUX-D3-4B-2026-08-21.md`

Git / release gate：

- D3.4B start commit：`3b270b368ac5362e5cfc0048791942fd2f08798a`
- end commit：本 `ONE FINAL COMMIT` 所在 commit；實際 SHA 以 PR #8 push 後 HEAD 為準（commit 無法在自身內容預先嵌入自身 SHA）。
- 「PR #8 必須維持 Draft / Open / 未 merge」為合併前的 historical guard；現已由 2026-09-01 release truth 取代。
- final automated gate 仍是 `verify:all → typecheck → build`；Supabase Local Reconcile / Vercel Preview 狀態需跟 final HEAD 一起驗。
- Pointer Events touch reorder 是 real pointer-capture implementation，但 Work runtime 沒有實體 iPhone；final Preview 仍需 owner mobile runtime QA。

## UIUX Batch D3 follow-up

Results controls, image-review hierarchy, collapsible spec creation, login shell
presentation and the mobile remove affordance were refined on PR #8. The mobile
interaction remains a single left-swipe reveal, now with a real “移出佇列”
button wired to the existing soft-archive/undo path. Login route presentation
hides navigation chrome without changing auth.

See `docs/audits/RESULTCARD-UIUX-BATCH-D3-2026-08-20.md`.

## 0. ResultCard mobile R3 — source complete, awaiting iPhone QA

### UIUX Batch D1 follow-up

ResultCard / results-panel now uses the same selection hierarchy on mobile and
desktop: select-all is on the guide row and selected batch actions appear on
the next row. Image-review batch actions are directly visible (no More menu).
Mobile status labels precede the date, the archive X is fully visible, and the
price row uses an aligned grid. Desktop cards use a title-only first row with
the thumbnail and vertically centred supporting content beneath it. The visible
expand triangle is removed while the existing card-tap expand handler remains.

See `docs/audits/RESULTCARD-UIUX-BATCH-D1-2026-08-20.md`.

### UIUX Batch D2 follow-up

Results controls now use the requested mobile hierarchy (filters, select-all,
then batch actions), while desktop select-all sits beside sort. Mobile cards no
longer show the corner X and instead rely on the existing swipe affordance;
image mark statistics have a dedicated summary row, with filled variant count
and the existing equal-price/range display. Variant editing auto-expands during
normal changes and only asks for confirmation when hand-entered data would be
discarded. Login is reduced to the global bar and login form.

See `docs/audits/RESULTCARD-UIUX-BATCH-D2-2026-08-20.md`.

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

### App production baseline / source head / runtime verification

- 舊 production baseline：`6ff020dd1d68152b6688c9695f8f96188b7862be`（`release: merge Nestory stabilization and tracked Supabase baseline (#6)`）。
- PR #8 已合入 default branch：`21e9d1c90697797aaa6d982e9454ccd4a6955fd8`。
- 正式 Vercel deployment 已於 2026-09-02 只讀核對：`READY`、target=`production`、commit=`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`。可明確說「目前 default source head 已 production」；不能把此事推論成 Shopify E2E 或未套用 migration 已完成。
- 本輪 security hardening commit `f0a6bfa` 位於 `codex/security-hardening-20260902`／Draft PR #10，CI 與 Preview 都已通過，但**尚未 merge／production deploy**。

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

#### P0-B：partial Shopify create retry idempotency — source 已修，runtime 未驗

`7de14a564e1e96501918c78fd3f6c4401cd137de` 已把 publish lifecycle 改為 `publishDraftSafe.ts`：

- `productCreate` 一律先建成 Shopify `DRAFT`；
- 先保存 `shopify_product_id`，再做 variant／price／inventory follow-up；
- `api_failed + real shopify_product_id` 的 retry 會先查遠端：`ACTIVE` 一律停住人工處理；`DRAFT` 先刪除再清掉本機 linkage，之後才允許新的 `productCreate`；
- linkage 保存失敗會嘗試 compensating delete，避免靜默孤兒商品；重複 publish 與直接對既有 real ID `productCreate` 均會被擋住。

`scripts/verify-shopify-lifecycle-safety.mjs` 有 source/injected-model contract，但它禁止網路，**不是 Shopify mock 或真實 E2E**。廣泛 live publish 前仍必須實際執行並記錄 mock partial-failure/retry；一筆受 owner 批准的 controlled real-product E2E 仍是 release gate。

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

已證實 production 套用的 migration：

1. `20260818142712 baseline_existing_schema_20260818`
2. `20260818142919 production_reconcile_20260818`

Source active queue 另有：

3. `20260822223100_variant_split_override_semantics`（2026-09-02 已從正式 migration ledger 核對：**尚未套用**）
4. `20260902090000_guard_current_image_batch_pointer`（PR #10 security hardening 新增；**尚未套用**）

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
3. Draft PR #10 的 Preview 登入／iPhone runtime QA。
4. Production Shopify env/config preflight（不曝露secret）。
5. 規劃 active migrations `20260822223100` + `20260902090000` 的套用與驗證；不可重跑歷史 migration。
6. Shopify mock publish（含 partial-create retry 行為）並留下 runtime 結果。
7. owner明確批准後才做一筆 controlled real-product E2E。
8. E2E正確後，owner明確批准才 merge PR #10；正式 Vercel 目前是 `6960a0c`，merge 後才會產生下一個 production deployment。

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
- `docs/audits/PRE-SHOPIFY-UI-FINAL-2026-08-21.md`（D3.5 latest UI freeze）
- `docs/audits/RELEASE-TRUTH-RECONCILE-2026-09-01.md`（本輪 canonical release truth）

DB / security：

- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`

`docs/CHANGELOG.md` 是 append-only；connector沒有安全 append primitive時不要整檔覆寫/截斷。最新變更透過 CURRENT_STATUS + dedicated audits保留完整紀錄。
