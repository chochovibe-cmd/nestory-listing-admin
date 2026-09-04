# Nestory — Shopify 並行上線準備包（2026-09-03）

## 1. 指揮決策

Shopify 技術準備可與文案修改並行，但必須拆成兩條界線：

- **現在可做**：本機來源驗證、mock 安全性盤點、正式環境設定的唯讀預檢規格。
- **現在不可做**：merge／production deploy、production migration、`SHOPIFY_PUBLISH_MOCK=false`、真實 Shopify 商品寫入。

文案未定稿不阻擋 Shopify 技術準備；它會阻擋最終 `ACTIVE` 公開與批量上架。

## 2. 本包邊界

本包只建立 go-live 證據，不改商品內容、不改角色語意、不改 UI、不改資料庫 schema。

允許：

1. 核對 Shopify 發布相關程式入口與 fail-safe；
2. 執行現有本機驗證器；
3. 記錄 pass／fail／skip，不把 source verifier 冒充 runtime E2E；
4. 準備不洩漏值的 Vercel production env 存在性檢查；
5. 定義後續 mock runtime 與單筆真實 `DRAFT` 驗收步驟。

禁止：

1. 顯示、複製或寫入任何 secret；
2. 更改 `.env.local` 或 Vercel env；
3. merge、push、deploy；
4. 套用 Supabase migration；
5. 建立、更新、刪除或啟用 Shopify 真實商品。

## 3. Gate 與驗收標準

### G0 — Source guard

- 記錄 branch、HEAD、working tree；
- 保留使用者既有未追蹤／未提交檔案，不修改、不納入本包；
- 確認本包使用的 source 與 PR #10 Preview source 相符，否則標示差異。

### G1 — 本機機械驗證

執行並逐項記錄：

1. `pnpm run verify:mock-flow`
2. `node scripts/verify-shopify-lifecycle-safety.mjs`
3. `pnpm run verify:variant-duplicates`
4. `pnpm run verify:no-secrets`
5. `pnpm run verify:client-secret-refs`
6. `pnpm run typecheck`

通過條件：六項皆 exit 0。任何一項失敗即停在 G1，不修改程式碼；由 Commander 判讀是否另開修復包。

### G2 — Vercel production env 唯讀預檢（後續獨立執行）

只回報「存在／缺少／格式可疑」，不得輸出值：

- `SHOPIFY_STORE_DOMAIN`
- `SHOPIFY_CLIENT_ID`
- `SHOPIFY_CLIENT_SECRET`
- `SHOPIFY_LOCATION_ID`（有限庫存建議必備）
- `SHOPIFY_PUBLISH_MOCK`

通過條件：前三項存在；location 已設定或已明確接受自動查詢 location 的風險；在真實測試獲准前仍保持 mock-safe。設定缺漏只能列為 owner 手動事項，不由子代理修改。

### G3 — Shopify mock runtime（需可登入的測試草稿）

- 使用 reviewer/admin 與專用測試草稿；
- 僅 mock，不呼叫 Shopify 真店；
- 驗證單筆草稿發布、ACTIVE 額外確認、失敗／重試紀錄；
- 記錄資料庫會產生的測試紀錄與清理方式。

通過條件：runtime 行為符合 release contract，且 Shopify 後台沒有新增商品。這一關不能用 G1 source verifier 代替。

### G4 — 單筆 controlled real-product E2E（需要 owner 明確批准）

- 先完成 PR #10 審核、必要 migration 規劃、production deploy 與 G2/G3；
- 只建一筆可辨識的 Shopify `DRAFT`，不公開；
- 核對標題、描述、圖片、價格、規格、庫存 location、metafields、後台連結；
- 測一次 partial-create/retry 的受控情境或等價可證明流程；
- 未得到 owner 第二次批准，不轉 `ACTIVE`。

### G5 — 公開上線

前提：文案定稿、商品資料抽查通過、G0–G4 全綠。先以極小批次公開，再觀察紀錄與 Shopify 後台結果；不得直接全量。

## 4. 分工規則

- **Commander**：拆包、風險判讀、是否過 Gate、修復設計、最終驗收。
- **LUNA**：只執行 G0/G1 的機械盤點與既有命令；不得自行改碼或擴張 scope。
- **Owner**：登入／後台操作、production env 變更、merge/deploy/migration 批准、真實商品與 `ACTIVE` 批准。

## 5. 目前已知基線

- 工作分支預期為 `codex/security-hardening-20260902`；
- production 仍是 `6960a0c`，PR #10 hardening 尚未 production deploy；
- `20260822223100` 與 `20260902090000` 尚未套用 production；
- Shopify authenticated mock E2E 已於本文件 §12 完成；mock partial-create/retry 注入情境與 controlled real-product E2E 仍未完成；
- 只有 exact `SHOPIFY_PUBLISH_MOCK=false` 才允許真實 Shopify 寫入；`ACTIVE` 仍需 `confirmActive=true`。

## 6. 收包條件

本準備包只在 G0/G1 證據完整並由 Commander 核帳後收包。G2–G5 各自是需要新批准或人工配合的後續包，不得被本包誤標為完成。

## 7. G0/G1 執行證據（2026-09-03）

Commander 核帳基線：

- branch：`codex/security-hardening-20260902`
- HEAD：`d02ea9b5bb1e9afd8e4227b513f0be13e444868e`
- HEAD 是 `f0a6bfa` 的後代，且與 `origin/codex/security-hardening-20260902` 同步；新增差異是後續狀態文件。
- 執行前既有未追蹤檔：`.claude/settings.local.json`；保持原狀，未讀取、未修改、未納入。

LUNA 只執行機械驗證，六項皆 exit 0：

1. `pnpm run verify:mock-flow` — pass
2. `node scripts/verify-shopify-lifecycle-safety.mjs` — 7 tests pass；明確禁止 network
3. `pnpm run verify:variant-duplicates` — pass
4. `pnpm run verify:no-secrets` — pass；140 modules
5. `pnpm run verify:client-secret-refs` — pass；140 modules
6. `pnpm run typecheck` — pass

核帳結論：**G0/G1 完成**。這只證明目前 branch 的來源契約與本機 injected model；不代表 G2 Vercel env、G3 mock runtime、G4 真實 Shopify `DRAFT` 或 G5 公開上線已完成。

## 8. G2 第一次唯讀嘗試（2026-09-03）

- `.vercel/project.json` 不存在：本工作區尚未連結 Vercel project；
- `vercel env ls production` 無法執行：本機沒有可用的 `vercel` CLI；
- 依本包規則沒有安裝 CLI、沒有啟動登入、沒有改 project link、沒有讀 `.env*`；
- 因此五個 production Shopify env 的存在性目前仍是 **unverified**，不可標示為缺少或通過；
- G2 狀態：**等待 owner 提供／開啟正確 Vercel project 的人工入口後再做唯讀核對**。

## 9. G2 Vercel UI 唯讀核對（2026-09-03）

Owner 已在 Chrome 開啟 Vercel Team Environment Variables；Commander 只讀取變數名稱、project 與 environment scope，沒有點進變數、沒有展開或複製值、沒有修改設定。

`nestory-listing-admin` project 顯示：

| 變數名稱 | Production／Preview 名稱存在性 | 判定 |
|---|---|---|
| `SHOPIFY_STORE_DOMAIN` | 存在 | 通過名稱檢查 |
| `SHOPIFY_CLIENT_ID` | 存在 | 通過名稱檢查 |
| `SHOPIFY_CLIENT_SECRET` | 存在 | 通過名稱檢查 |
| `SHOPIFY_PUBLISH_MOCK` | 存在 | 值未查看；mock-safe 狀態仍未驗證 |
| `SHOPIFY_LOCATION_ID` | 未顯示 | 缺口；有限庫存目前只能依賴 API 自動找 location |

補充：

- `SHOPIFY_API_VERSION` 名稱存在；
- 沒有顯示任何 `NEXT_PUBLIC_SHOPIFY_*` 名稱；
- 所有上述已存在的 Shopify 名稱均標示套用於 `Production and Preview`；
- 這次只證明名稱與 scope，不證明值正確、憑證有效或 runtime 可連線。

G2 核帳：**盤點完成，但不放行**。進 G3 前需由 owner 決定是否補主要出貨地點的 `SHOPIFY_LOCATION_ID`；進任何真實測試前，還要以不洩密方式確認 `SHOPIFY_PUBLISH_MOCK` 的實際安全狀態。

## 10. G3 Preview 定位（2026-09-03）

- Vercel Deployments 已確認 `d02ea9b`／`codex/security-hardening-20260902` 的 Preview 為 `Ready`；
- Preview URL：`https://nestory-listing-admin-ju8loo1cr-chocho-nestory.vercel.app/`；
- Preview 目前導向 `/login`，尚未建立 authenticated session；
- 沒有輸入帳密、沒有登入、沒有建立或修改草稿；
- G3 下一步需要 owner 在這個 Preview 分頁完成團隊登入，再由 Commander 只讀選定專用測試草稿與確認 mock 邊界。

這只完成 G3 的正確環境定位，不是 runtime pass。

## 11. G3 登入與 mock-safe precheck（2026-09-03）

- Owner 已在 `d02ea9b` Preview 完成團隊登入；
- 設定頁「連線狀態」明確顯示：`Shopify Admin API 模擬中（不會建真實商品）`；
- `完成待發布` 目前為 0 件；
- 兩筆 `失敗` 是現有 Razer／可可貓實際商品資料，且各有價格／IP 必修問題，不適合作為 mock 測試犧牲品；
- 未核准、重生、移出、發布或修改任何草稿。

G3 目前狀態：**安全環境已確認，但缺專用測試草稿**。需 owner 指定使用既有 2026-07-17「測試」未完成草稿，或批准建立一筆新的專用 mock 草稿；未取得選擇前停止資料寫入。

## 12. G3 authenticated mock E2E（2026-09-03）

Owner 批准建立新的專用 mock 草稿；Commander 在 `d02ea9b` Preview 執行完整瀏覽器流程，沒有變更 Vercel env、沒有觸發真實 Shopify write。

測試資料與證據：

- 草稿 ID：`51f7d7fe-fd02-4954-8a54-299f6e586855`；原始標題保留識別 `【SHOPIFY-MOCK-E2E-20260903】米菲臺燈測試品`；
- 上傳 1 張 repo 內測試主圖，成本 CNY 100；
- 先以 test mode 生成：如預期不呼叫 AI，但因 test mode 不自動辨識 IP／商品類型而進入 `失敗`，核准按鈕被必修門檻停用；
- Owner 明確批准一次預估 NT$1–3 的 LLM 重生；補充 Miffy／臺燈辨識方向後，草稿成功恢復為 `文案待審核`，顯示 `IP=Miffy`、`角色=Miffy`、`型態=臺燈`、售價 NT$899；
- 文案核准後進入圖片站；1 張圖判定「保留」，經第二次確認進入 `完成待發布`；
- 發布 modal 選擇 `API 正式上架`，完成 ACTIVE 額外確認；因 Preview 設定頁已明確顯示 `Shopify Admin API 模擬中（不會建真實商品）`，此步只驗證 mock ACTIVE contract；
- 發布後 `完成待發布` 由 1 變 0；`/records` 最新批次 `#1F0209` 顯示「匯入 Shopify（API 上架）」、1 件、全部成功；
- 草稿詳情最終顯示 `generation: api_llm / completed`、`publish: active / active_published`，原始標題仍保留 E2E 測試識別。
- 內容風險：測試文案產生「不含 BPA 的食物級矽膠」、尺寸與產地等規格主張；目前 UI 只以「發布前請核實來源」警告，不會阻擋核准。這筆資料只能留作 mock E2E，不能轉為真實商品；G5 前必須由 owner 以來源證據抽查商品規格。

G3 核帳：**authenticated mock E2E 通過**。已覆蓋輸入、圖片上傳、test-mode fail-safe、失敗後 LLM 重試、必修門檻、文案核准、圖片分流、ACTIVE 確認、批次紀錄與最終狀態。這不等於真實 Shopify 商品驗證，也不等於 `publishDraftSafe` 的 partial-create/retry runtime 注入情境；後者仍是 G4 前獨立 release gate。

操作注意：test mode 對「全新、尚無 IP／類型的草稿」無法零成本走完核准，因它刻意不做 AI 偵測。未來若要純零成本 E2E，應使用已具有 `ip_name`／`product_type` 的專用 fixture，或另開程式修復包設計安全的測試資料注入；不要把這個限制誤判為 Shopify 發布失敗。

## 13. Owner G4 準備批准後的 source package（2026-09-03）

本文件 §1–§6 是批准前的準備包邊界。Owner 後續明確批准進入 G4 準備，並限定真實 Shopify 最多建立一筆 `DRAFT`、不得 `ACTIVE`；因此另開本機分支 `codex/shopify-full-sync-g4-20260903` 施工，沒有改寫先前 G0–G3 證據。

已完成 source 第一版：

- `SHOPIFY_LIVE_TEST_DRAFT_ID` 單草稿 allowlist；設定時 publish 只可單筆 `DRAFT`，sync/lifecycle 也只能作用同一 draft；
- additive migration `20260903100000_shopify_full_sync_state.sql`：sync status、remote timestamps/hash/error、variant/media identity/source hash、audit ledger；
- same-product `productUpdate`、variant create/update/delete、庫存 compare-and-adjust、media add/update/unlink、metafields、read-before-write conflict 與 post-write readback；
- atomic `syncing` claim、`partial` 狀態、removal/ACTIVE 額外確認、archive/restore/permanent-delete API；
- status/media 改用 Shopify 2026-04 非 deprecated mutation；官方 schema validator revision 3 通過；
- `npm run verify:all`、`npm run typecheck`、`npm run build` 通過。Build 的 webpack cache snapshot 只出現 warning，production compile／35 pages／route generation 都成功。

本包仍**沒有**：apply migration、改 Vercel env、push/PR/merge/deploy、Shopify 真實寫入、永久刪除、ACTIVE、前端 UI 實作。UI 必須等 Owner 確認 `SHOPIFY-FULL-CONNECTION-DESIGN-2026-09-03.md` §7 三段方案。

下一個 runtime gate：先在隔離 Preview 套正確 branch 與 schema，設定唯一 allowlist draft、確認 token scopes/location，跑 mock partial-sync；全綠後才使用 owner 已批准的唯一真實 Shopify `DRAFT` 做 create→update→readback→archive→restore。永久刪除仍要執行當下再次批准。
