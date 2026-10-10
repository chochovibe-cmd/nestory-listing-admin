> **2026-10-10 ROADMAP UPDATE — ACTIVE final smoke + SEO Panel V2**
>
> **Release first:** ACTIVE gate is ON. Run exactly one Owner-chosen real ACTIVE smoke through normal Nestory, verify Shopify readback, then close the Shopify release gate.
>
> **Later UIUX package: `UIUX-CARD-WORKBENCH → SEO Panel V2` (Owner-approved direction)**
> 1. Add a compact Google-style search preview using SEO title + product URL + meta description.
> 2. Show Shopify Handle in the SEO tab as `domain/products/[handle]`: domain/prefix read-only, handle editable. Default remains automatic; manual editing is optional, not required for every product.
> 3. Improve automatic Handle generation from the current deterministic IP/character/type + unique suffix toward a concise descriptive identity that may include a reliable core product term (for example `pingu-mini-camera-keychain-xxxxxx`) without stuffing the full SEO title. Keep lowercase ASCII/hyphen normalization, max length, uniqueness suffix, and deterministic fallback.
> - Provide a small “restore auto suggestion” action after manual override.
> - Warn only on actionable URL problems (invalid chars, excessive length, collision/duplicate), not generic SEO red-light scoring.
> - For products already public on Shopify, changing Handle must create/preserve an old→new URL redirect; never silently break existing links.
> - This is a UIUX/SEO follow-up, **not** a reason to delay the current ACTIVE release smoke.
>
> **2026-10-10 RELEASE GATE — DRAFT COMPLETE**
> - Production DRAFT cutover + one real DRAFT smoke are both PASS.
> - Do not spend another package on DRAFT validation unless new evidence appears.
> - Next release step is immediately `SHOPIFY-ACTIVE-GO-LIVE` → one controlled real ACTIVE smoke → free daily DRAFT/ACTIVE choice.
>
> **2026-10-10 RELEASE GATE ADVANCED**
> - Production DRAFT transition completed successfully on `dpl_Fcx2cdy683zyJwoBMyqmJ8ra7kXs` at authority `5fc18fb02741cca1b5c1c912e1ff668b7a410180`.
> - Current shortest release path is now: **1 fresh real DRAFT smoke → SHOPIFY-ACTIVE-GO-LIVE → 1 real ACTIVE smoke → free daily DRAFT/ACTIVE choice**.
> - The DRAFT smoke is a release gate, not a redesign package: one fresh Owner-approved product only, then verify Shopify DRAFT status, product identity, variants, SKU, price, images/media and local linkage.
> - ACTIVE remains explicitly OFF until the next package is separately authorized.
>
> **2026-10-09 RELEASE CHECKPOINT AFTER PR #34**
> - `UI-FLOW-STABILIZE` and `SHOPIFY-DAILY-DRAFT` are both completed/merged. Do not reopen them.
> - Current shortest release path is now: **Owner-approved Production DRAFT transition → 1 fresh DRAFT smoke → SHOPIFY-ACTIVE-GO-LIVE → 1 real ACTIVE smoke → free daily DRAFT/ACTIVE choice**.
> - Production DRAFT transition is operational/configuration work, not a new feature redesign: use merged authority `5fc18fb02741cca1b5c1c912e1ff668b7a410180`, remove/disable the old single-draft allowlist, keep ACTIVE flag false, verify live runtime, then smoke one fresh product.
> - ACTIVE package remains immediately next after DRAFT smoke and stays ahead of OBS-QUEUE / COPY / UIUX / PERF work.
>
> **2026-10-09 RELEASE ORDER DECISION — DRAFT THEN ACTIVE**
> - Owner confirmed the desired end state is not DRAFT-only forever; the target is normal daily freedom to choose Shopify DRAFT or ACTIVE.
> - Safety sequencing is now fixed as: **SHOPIFY-DAILY-DRAFT → fresh DRAFT smoke → SHOPIFY-ACTIVE-GO-LIVE → one real ACTIVE smoke → free daily DRAFT/ACTIVE choice**.
> - `SHOPIFY-ACTIVE-GO-LIVE` moves directly behind the DRAFT smoke and must not be left behind OBS-QUEUE / COPY / UIUX / PERF work.
> - PR #34 implements the prerequisite server safety gate: live publishing defaults to DRAFT-only when no one-draft test allowlist is present; ACTIVE requires explicit `SHOPIFY_ACTIVE_PUBLISH_ENABLED=true`.
> - The future ACTIVE package should prefer validation + explicit enablement over rewriting the existing lifecycle. It must verify customer-facing visibility / sales-channel publication, variants, price, inventory, images, and rollback/unpublish behavior with one Owner-approved product before broad ACTIVE freedom.
>
> **2026-10-09 ROADMAP CHECKPOINT AFTER PR #33**
> - `UI-FLOW-STABILIZE` 已 PASS 並 merge（PR #33 / authority `102565df789a035e6b8ae415ce7b694b919d927f`）；不要重做。
> - GO DAILY 前現在只剩：`SHOPIFY-DAILY-DRAFT → 1 fresh full-flow DRAFT smoke → GO DAILY（DRAFT）`。
> - Owner 新增流程優化想法，正式併入 post-GO `UIUX-FLOW-STATE`：**Smart Station Handoff**。
>   - 不採「每處理一張就強制跳下一站」，避免多件連續審核時來回跳站。
>   - 建議規則：目前站仍有其他可處理卡片 → 留在目前站；最後一張成功離站 → 自動切到合理下一站並 highlight 剛移動的商品。
>   - failure 不切站；batch / Sequential review 不中途切站，完成 queue 後才評估是否 handoff。
>   - 可重用既有 stage state / session preference / jump + highlight 能力；真正施工前重新 audit current source，另開窄包驗證，不阻擋 GO DAILY。
>
> **2026-10-09 FULL RECONCILIATION｜Fable 完整規劃重新對表**
>
> 這一節是把 Fable 對話、2026-09-30 Commander audit、UIUX audit 與 2026-10-09 current source/runtime 重新對表後的完整剩餘路線。前一版只突出 PB2 + UIUX，仍會讓部分後段 hardening 看不見；以下補齊，但**不代表全部都要在 GO DAILY 前完成**。
>
> ### A. GO DAILY 前 — 只剩 2 包 + 1 次 smoke
>
> 1. **UI-FLOW-STABILIZE**  
>    - Station3 Publish / Export Preflight modal portal：收合卡直接開 modal 不得被 transform / overflow 裁切。  
>    - 成功操作後 Toast 與卡片離場同時發生；API 未成功前不得假消失。  
>    - 這包只處理已重現的 flow bug；完整 focus trap / accessibility 不在此包擴 scope。
>
> 2. **SHOPIFY-DAILY-DRAFT**  
>    - 一般合格商品可真寫 Shopify DRAFT。  
>    - ACTIVE 在 server 端 hard-block。  
>    - 不再依賴單一 VICTOR allowlist 才能工作；保留 role / confirm / idempotency / recovery safety。
>
> 3. **Fresh full-flow smoke**  
>    - 淘寶擷取 → Queue 生成 → 文案審核 → 規格/圖片確認 → Shopify DRAFT → Shopify 回讀。  
>    - PASS = **GO DAILY（DRAFT）**；不用等下列優化。
>
> ### B. GO DAILY 後 — 主要產品優化主線
>
> 1. **OBS-QUEUE**：生成中 / 排隊中 / 失敗清單；只讀 existing `generation_runs`，不重做 Runner。
> 2. **COPY-SAFE**：單欄重生走 Product Brief；copyLength 真正生效；Miffy Quality Floor 先偵測；正文 / spec 使用同一 canonical evidence/spec basis，避免一邊有資料一邊漏；正常生成不預設增加一次 AI。
> 3. **PB2-COPY-STRATEGY**：Product Strategy Brief；收藏型 / 功能型分流；Owner 版 adaptive title；規格價值轉譯；品類知識包；真實商品 Golden Eval。Market Context 只視需要作 PB2 後段研究層，不先塞進每次生成 prompt。
> 4. **UIUX-SPEC-VARIANT**：規格維度 / 規格值 / Variant 編輯效率；desktop 重排；缺成本 / 缺圖摘要；批次處理；mobile / desktop 一致性。
> 5. **UIUX-CARD-WORKBENCH**：ResultCard / Workbench 層級與減法；照片 / 標題 / 下一步第一層，價格 / 待處理第二層，tag / 時間第三層；保留現有雙欄與 Sequential Review。
> 6. **UIUX-FLOW-STATE**：warning 跳欄位；裝置暫存 / Nestory 儲存 / Shopify sync 狀態分清；來源 vs 生成稿對照；批次部分失敗可處理；手機入口可發現；Dashboard 待辦優先。
> 7. **PERF P1A**：lazy load 未立即使用的大型 JS；縮圖/原圖與 matchMedia 一併檢查。
> 8. **PERF P1B**：工作台摘要先載、展開再拿 details；archived 延後；解決 40 active + 50 archived + images + variants 一次搬進瀏覽器。
> 9. **CAPTURE-FILTER**：只排除高信心推薦 / 活動 / 廣告 DOM 區塊；不確定圖片保留人工刪。
> 10. **PRICING-DB**：把匯率 / 係數從裝置 localStorage 收斂到 server-side canonical setting，避免桌機 / iPhone 算不同價格。
> 11. **SCHEDULE V1.2**：從舊 PR #15 取需求 / data model，基於 latest HEAD 重接 scheduling UI / DB / cron / execution。
>
> ### C. 後段 reliability / go-live / ops，不得再被短清單漏掉
>
> - **SHOPIFY-ACTIVE-GO-LIVE**：DRAFT 日常使用之後才做。驗證 ACTIVE 與 Shopify publication / sales channel 是兩件事；最後以顧客端可見、正確 variants / price / image 為準。
> - **DATA-RELIABILITY**：施工前重新 audit current source；包括 Variant 儲存原子性/並發衝突、重抓資料要顯示差異並保護人工修改、Shopify 人工修改 conflict、未知網路結果/429/timeout、遠端成功但本地 audit 回寫失敗的誠實狀態。V1 已做的 recovery 不重寫。
> - **TEST-OPS-HARDENING**：最小 browser E2E 關鍵旅程、斷線/重連提示、備份與 rollback 方法、error/operation ID 可追查、cost/health 告警。這些是可靠性投資，不是 GO DAILY blocker。
> - **ACCESSIBILITY/POLISH**：完整 focus trap、背景不可操作、鍵盤/長內容/手機抽屜等 modal consistency；與已重現的 portal bug 分開。
> - **VIDEO / ADVANCED IMAGE**：PR #12 影片與後續圖像工具，依額度分包。
> - **CSS P2**：逐元件收斂歷史 CSS，先做桌機/手機/三主題 baseline；禁止大掃除。
> - **SCOUTING / OFFLINE CLOUD QUEUE**：後排產品功能；目前不是日常上架 blocker。
> - 舊 `db172df` 小修（多色白名單、`適閤→適合`）先查 current HEAD 是否已包含，不盲目 cherry-pick。
>
> ### D. 舊計畫已完成 / 被新架構取代，不要重做
>
> - generation progress 改 draftId / runId：完成。
> - persistent generation queue + concurrency：完成。
> - capture 圖片背景補抓 / extension 防重按 + 商品名回饋：完成。
> - full / field regeneration 非阻塞 queue：完成。
> - V1 publish safety / migration gates / controlled DRAFT E2E：完成。
> - PR #14 / #15：只作 reference，不整包 merge。
>
> ### E. 建議順序
>
> **UI-FLOW-STABILIZE → SHOPIFY-DAILY-DRAFT → fresh smoke → GO DAILY → OBS-QUEUE → COPY-SAFE → PB2-COPY-STRATEGY → UIUX-SPEC-VARIANT → UIUX-CARD-WORKBENCH → UIUX-FLOW-STATE → PERF P1A → PERF P1B → CAPTURE-FILTER → PRICING-DB / SCHEDULE V1.2 → SHOPIFY-ACTIVE-GO-LIVE → DATA-RELIABILITY / TEST-OPS-HARDENING → VIDEO / advanced image → CSS / scouting later**
>
> 以上順序是 default，不是鐵律；真正施工前仍依 Owner 當時痛點與檔案衝突重排。原則是不讓後段完整清單拖住 GO DAILY。
>
> **2026-10-09 ROADMAP ADDENDUM｜補回 Fable 對話中被壓縮掉的文案 / UIUX 主線**
>
> 2026-10-09 Owner 指出前一版 active roadmap 把「文案品質策略」與「UIUX / 規格區」壓得太扁。重新對照 Fable 交接內容、既有 UIUX audits 與 current source 後，正式補回以下獨立 packages。這些是 **GO DAILY 後的優化主線**，不可被 COPY-SAFE 或 PERF 幾個名字吃掉。
>
> **GO DAILY 前只處理兩包：**
> 1. `UI-FLOW-STABILIZE`：修待發布卡收合時 Station3 Publish / Export Preflight modal 被卡片 transform / overflow 裁切；成功操作後 Toast 與卡片離場同步，避免「好像沒按到」。
> 2. `SHOPIFY-DAILY-DRAFT`：一般合格商品可真寫 Shopify DRAFT；ACTIVE 後端 hard-block；Production Owner approval 後跑 1 件 fresh full-flow smoke。PASS = **GO DAILY（DRAFT）**。
>
> **GO DAILY 後文案線不是只有 COPY-SAFE，分成兩層：**
> - `COPY-SAFE`：一致性 / 安全層。單欄重生走 Product Brief、copyLength 真正生效、Miffy Quality Floor 先偵測不自動重跑。
> - `PB2-COPY-STRATEGY`：品質 / 策略層。承接 Fable 對話原本已明確列出的 Product Strategy Brief：**收藏型 / 功能型分流、老闆版自適應標題、規格價值轉譯 → 品類知識包 → 真實商品 Golden Eval**。目前標題 v2 是 baseline，不直接推翻；PB2 用真商品比較後再調整。
>
> **GO DAILY 後 UIUX 也拆成獨立主線：**
> - `UIUX-SPEC-VARIANT`：規格區 / 維度 / 規格值 / Variant 編輯效率。保留已完成的 mobile D3.4B 行為，重點補 desktop Variant 重排、缺成本/缺圖摘要、批次處理、規格區層次與 mobile/desktop 一致性。
> - `UIUX-CARD-WORKBENCH`：ResultCard / 工作台資訊層次。照片、標題、下一步第一層；價格與待處理第二層；tags / 時間第三層；保留雙欄與 Sequential Review，不重做成簡化版。
> - `UIUX-FLOW-STATE`：流程狀態可理解性。警告可跳到欄位、此裝置暫存 / 工具已儲存 / Shopify 待同步分清楚、來源資料 vs 生成稿對照、批次部分失敗可處理、手機入口可發現、Dashboard 待辦優先。
>
> 以上三條 UIUX package 都要先 re-audit 最新畫面；PR #14 只當 reference，不整包搬回 current authority。
>
> **完整建議順序（2026-10-09）：**
> `UI-FLOW-STABILIZE → SHOPIFY-DAILY-DRAFT → fresh smoke → GO DAILY → OBS-QUEUE → COPY-SAFE → PB2-COPY-STRATEGY → UIUX-SPEC-VARIANT → UIUX-CARD-WORKBENCH → UIUX-FLOW-STATE → PERF P1A → PERF P1B → CAPTURE-FILTER → Schedule V1.2 / Pricing DB → Video / advanced image → CSS 收斂`
>
> 下方較早 roadmap 內容保留作歷史問題庫；若與本 addendum 衝突，以本區為準。

> **2026-10-09 ACTIVE ROADMAP — supersedes 2026-09-30 pending list**
>
> 目前不是「V1.1 還沒做」，而是 **V1.1 core 已 PASS，正在進入日常 Shopify DRAFT 開放與後續優化**。舊表格保留作歷史問題庫；任何舊項目施工前都要先對最新 source / runtime 重查，不可照 9/30 狀態直接重做。

## 0. 什麼時候可以正式完整開始跑上架流程？

只剩一個必要 Gate：

**SHOPIFY-DAILY-DRAFT → Owner Production 批准 → 1 件 fresh 全流程 smoke → GO DAILY（DRAFT）**

過關條件：
1. Production 可讓一般合格商品建立真 Shopify **DRAFT**。
2. 後端 hard-block `ACTIVE`，不是只靠前端按鈕提醒。
3. 不靠單一 `SHOPIFY_LIVE_TEST_DRAFT_ID` 才能使用。
4. CI / Preview PASS 後才動 Production。
5. Production 切換後，以 1 件一般新商品跑：擷取 → 生成 → 文案審核 → 圖片確認 → Shopify DRAFT。
6. Shopify 回讀標題、Variants、價格、SKU、庫存策略、圖片正確且不重複建品。

**以上 PASS 後，Owner 可以開始把 Nestory 當日常完整上架工具使用。**  
這裡的「完整上架」是安全地送到 Shopify DRAFT。直接 ACTIVE／顧客端公開另開 package，不阻擋日常 DRAFT 工作。

## 1. 已完成，不要重做

| 原計畫 | 現況 |
|---|---|
| V1 Shopify safety / resumable publish | ✅ PASS |
| 真 Shopify DRAFT recovery + fresh E2E | ✅ PASS |
| Capture 1.2 | ✅ PR #18 已 merge |
| V1.1 draftId progress | ✅ PR #24 |
| V1.1 persistent generation queue | ✅ PR #26 |
| V1.1 background image fetch / input release | ✅ PR #27 |
| V1.1 nonblocking regeneration | ✅ PR #28 |
| Regen Modal 收合卡錯位 | ✅ PR #29 + Owner PASS |
| VICTOR 2026-10-09 DRAFT E2E | ✅ Shopify DRAFT、2 variants、SKU / price 回讀 PASS |

## 2. GO DAILY 之後的優化包

### P1 — OBS-QUEUE｜生成佇列狀態中心
只補 UI，不重做 Queue Runner。顯示「生成中 / 排隊中 / 失敗」總數與商品清單，刷新後仍從 DB `generation_runs` 還原。

### P2 — COPY-SAFE｜文案穩定性
第一階段保持正常生成速度與費用不變：單欄重生補齊 Product Brief evidence chain、`copyLength` 真正生效、Miffy Golden Eval、Quality Floor 先偵測/標記「資料很多但文案異常薄」。**不預設每篇多跑一次 AI、不堆大量負面 prompt。**

### P3 — PERF P1A｜首載 JS 減肥
ResultCard / Workspace 的大型 Modal、CSV、Sync、生圖等改 lazy load；檢查縮圖是否誤載原圖與重複 matchMedia。零產品行為改變。

### P4 — PERF P1B｜工作台資料按需載入
這項 **仍未做**：目前 `/drafts/new` 還會抓最近 40 active + 50 archived，並把這批商品圖片／variants 一次載入。改成摘要先載、展開再抓 details、封存延後載；小操作減少整頁 `router.refresh()`。

### P5 — CAPTURE-FILTER｜淘寶廣告圖高信心過濾
依 DOM / 來源區塊排除明顯推薦、活動、廣告圖；不確定圖片保留給 Owner 人工刪，避免過濾過頭。

## 3. 原 Fable / 舊 roadmap 後段仍未完成

- **PR #14 UIUX 2.0**：舊 branch 已與 current authority 大幅 diverge。不要整包 merge；改成 reference-only，逐項看仍有價值的 UI 設計，再從最新 HEAD 重做小包。
- **PR #15 排程上架**：同樣是舊架構疊在 #14 上。保留需求與資料模型想法，未來做 V1.2 Schedule 時從最新 HEAD 重新接線。
- **Pricing DB**：匯率／係數目前仍有 localStorage 路徑；跨裝置一致性尚未正式收斂到 server setting。
- **PR #12 影片**：Taobao → YouTube → Shopify 仍是 Draft/reference，後排。
- **Browser E2E smoke**：repo 仍以 source verifier + typecheck + build + Owner runtime 為主，最小 Playwright/Cypress 關鍵旅程尚未補。
- **Shopify ACTIVE / sales channel publication**：尚未正式開放；未來需獨立驗證「ACTIVE ≠ 一定已上指定通路」與顧客端可見性。
- **UI/UX 細修**：Variant 批次操作、Dashboard 待辦優先、ResultCard 減法/層級、mobile/desktop 一致性。先 re-audit 最新畫面，不照舊 PR 直接搬。
- **PERF P2 / CSS 收斂**：最後逐區做，禁止一次大掃除。
- **進階圖片 / 影片 / scouting**：後排，不阻擋 Shopify DRAFT 日常使用。
- 舊 `db172df` 兩組小修（多色白名單、`適閤→適合`）施工前先重查 current HEAD 是否已自然包含，不盲目 cherry-pick。

## 4. 目前建議順序

**DOC-CHECKPOINT（本包） → SHOPIFY-DAILY-DRAFT → fresh smoke → GO DAILY → OBS-QUEUE → COPY-SAFE → PERF P1A → PERF P1B → CAPTURE-FILTER → PR #14/#15 拆解回收 → Pricing DB → Video / CSS / advanced image。**

# Nestory 指揮官總計畫

更新：2026-09-30。店主流程與分工已定案；下列個別改善是待執行／待確認提案，不代表已修復或已通過驗收。

## 1. 店主目標與分工

文案修好 → 必要功能補齊 → UIUX 美化與流程優化 → Shopify 正式上線 → 有額度再做圖片＋影片優化工具。

主代理負責設計、取捨、派工及驗收；低成本模型負責範圍明確的查檔、整理、窄修補與測試。本環境優先 gpt-6-luna／low。小任務直接工具處理更省時就不開代理。實作分不重疊檔案，主代理只複核關鍵 diff、風險及驗收證據，不把工人的全部工作重做一遍。

每包 3–5 項；任務卡須含目標、指定檔案、禁止範圍、輸出、驗收、停手條件。工人遇到架構／產品裁決即回報；同類失敗兩次先交回指揮官。高風險資料／權限／發布設計由主代理決定；機械實作仍可委派。

不對外部生成模型、發布或資料修改提供概括批准。已有明確授權不重問。真正需要店主的是文字品質／新視覺方向判斷、登入、必要的外部操作批准。產品裡的 AI 型號不因「工人用便宜模型」而擅自更換。

## 2. 本次證據邊界

- 本機分支 codex/copy-quality-v2、HEAD 18ba0cd，上有既有未提交修改，已保留。
- 讀取現況、發布條件、元件與關鍵儲存／發布程式；不是完整安全稽核，也未跑新一輪測試。
- 上輪正式站瀏覽器停在登入頁；本輪未新增登入後視覺／手機驗收。
- 最新文案證據是 docs/audits/COPY-QUALITY-V2-ACCEPTANCE-2026-09-30.md：兩次授權生成完成，格式過關但品質仍未通過；品質提醒空白不等於內容正確。
- RELEASE_READINESS.md 更新停在 9/4，和較新 CURRENT_STATUS 的 source／deployment 敘述不同。舊 SHA、migration 與權限只能作歷史；正式上線前必須重新核對，不照抄成目前事實。
- 三位 Luna 只讀盤點已派發；文案工人在額度限制前交回有效 findings，UI／流程工人未完成。主代理補做有限度核對；不得把三份都標為完成。
- 本輪只有專案規則、總計畫及進度文件變更；沒有產品程式／CSS／真商品／資料庫變更，沒有 push／部署或付費生成。

## 3. 深入盤點：已有什麼、還要補什麼

標記：**S**＝本機 source 可確認；**O**＝已有結果紀錄；**R**＝風險／缺證據，需實測；**P**＝產品改善提案。S 不代表正式站正在發生故障。

### A 文案與商品資料

| ID／狀態 | 白話問題與證據 | 處理／過關條件 |
|---|---|---|
| C01 O | 700W 被寫成快速、省時、幾分鐘；來源只有功率。ACCEPTANCE-2026-09-30.md:15、正文／SEO樣本。 | 先用失敗稿離線診斷欄位責任，保留短正面寫法；性能與交期需可追溯資料。固定案例加陌生商品驗收，不反覆抽稿。 |
| C02 S/O | 正文商品資訊與 spec 是分開生成／整理，已出現一邊少資料。chaochaoPrompt.ts:86–87、117–120；generate/route.ts:1319–1345。 | 設計一份標準規格清單供兩处呈現；保留來源、款式差異、人工修訂，避免錯誤共用覆蓋。驗收已知欄位完整且相互一致。 |
| C03 S/O | 標題契約要求 IP 中文＋英文，但新驗收記錄期待英文優先。titlePrompt.ts:6–20；ACCEPTANCE:17。 | 是規則衝突，不能只怪後處理。指揮官提出品牌／IP／角色三欄的最小對照例，依最新店主定案一次統一生成、重生與組裝契約。 |
| C04 O | why 泛用、購買提醒像宣傳、SEO沒有挑具體差異。ACCEPTANCE:13–15。 | 每欄指定一個買家問題與已知商品細節；保留完整資訊和自然幽默，不堆禁詞。以人工可讀性評估，不用程式通過冒充文案通過。 |
| C05 S/O | copyQuality.ts:362–409 是數字對照，不能理解「已知數字推成無根據效果」；樣本提醒空白。 | 既有提醒維持輔助，不升級成真偽裁判或自動付費重寫；若增加提示只針對驗證過的高風險模式。 |
| C06 S/P | 擷取已保留原始證據，但擷取、人工規格、AI整理不是同一回事。mapCaptureFields.ts:128–151、453–480；generate/route.ts。 | 核對原始擷取→映射草稿→模型輸入→模型輸出→發布五段；重抓須顯示差異並保護手改。先查現有防護，不宣稱擷取本身已證實漏資料。 |

### B 功能、資料可靠性與速度

| ID／狀態 | 白話問題與證據 | 處理／過關條件 |
|---|---|---|
| F01 S/R | WorkspaceInputPanel.tsx:111–165 先插新款式再刪舊列；有保留舊資料防護，但清除失敗可能暫時重複。 | 評估原子化儲存與版本衝突檢查；保留失敗可恢復。注入寫入／清除失敗及兩人同時修改，確保不重複、不靜默蓋資料。新 migration僅產檔。 |
| F02 S/R | generationProgress.ts 進度留 module 記憶體、以標題比對結果。 | 使用 draftId／runId 關聯；刷新後查真实状态，核對逾時結果才開放重試。維持同步文案架構，不為此大改 worker。 |
| F03 S/R | drafts/new/page.tsx:110–144 僅載入最近40件非封存、50件封存；子元件無法篩選尚未載入資料。 | 服務端按站別查詢＋分頁／搜尋，總數與本頁筆數分開。用超過40件含舊待辦案例驗證可找到；不能只是把limit無限加大。 |
| F04 S/R | 相同頁面讀取整批草稿、圖片、款式；資料量增加可能拖慢初載，尚無量測。 | 先量初載、展開與搜尋，再按需讀取詳細資料／縮圖；不憑感覺大改快取或框架。 |
| F05 S/P | warningTiers.ts以文字正則及欄位缺口分級。 | 加入穩定code、severity、field、source，再相容舊警告。點警告可定位欄位；改顯示文字不能改變阻擋語意。 |
| F06 S/R | 暫存已有localStorage；結果卡手動儲存、Shopify同步另有狀態。兩種儲存不能混稱。 | 按真實狀態顯示裝置暫存／工具儲存／待同步；離開、重新整理、切商品、登入過期測不丟未保存內容。跨裝置恢復是另一需求，不把本機暫存當雲端保存。 |
| F07 S/R | adminGraphQL.ts:18–42處理401重取token，但無明確fetch逾時／統一節流處理；publishDraftSafe已有CAS防重複。 | 補失敗類型與可恢復狀態；429退避只對安全操作採用，建立商品遇網路未知結果要先查遠端。驗收重點是無重複商品。 |
| F08 S/R | publishDraftSafe.ts:302阻擋publishing重入；每日stuck-batches掃image_batches（scanStuckBatches.ts），不能當發布恢復機制。 | 用操作ID、開始時間與遠端核對設計發布中斷恢復；不按逾時直接重建商品。測服務中斷與完成回寫失敗。 |
| F09 S/R | publishDraftSafe.ts:72–112的失敗狀態／發布紀錄寫入未檢查回傳error。 | 回報「遠端操作結果」與「本地紀錄保存結果」兩件事，提供核對入口。注入DB紀錄失敗，避免成功／失敗訊息失真。 |
| F10 S/P | scouting/page.tsx是骨架，追蹤按鈕disabled，卻有「新增商家連結，系統會自動追蹤新品」空狀態。 | 清楚標示尚未開放、回主要工作入口。選品追蹤完整實作暫緩，不列Shopify上線必備。 |

### C 前台風格、互動與手機

| ID／狀態 | 白話問題與證據 | 處理／過關條件 |
|---|---|---|
| U01 S/P | WorkbenchMobileShell有輸入／快速預覽／審核，MobileTabbar新增長按選單；桌機導航分法不同。 | 建立同一商品的「所在步驟＋下一步」；保留既有入口及手勢，補可見捷徑。首次使用者不用記手勢也能做完一件商品。 |
| U02 P | 商品卡片、警告、標籤、價格與操作有不同任務，視覺優先度需實機比較。 | 照片／標題／下一步第一層，價格／待處理第二層，標籤／時間第三層。沿用tokens、sel、schip、Button；先一張卡片與主操作區樣本。 |
| U03 S/R | Station3PublishModal与ExportPreflightModal有dialog／aria-modal、取消焦點和Esc，但自身無portal／Tab焦點限制。 | 統一彈窗掛載、焦點圈限／返回、背景不可操作；測鍵盤、手機抽屜、長內容與鍵盤彈出，不能只靠aria-modal。 |
| U04 P | 多款式是大量重複工作，純外觀調整效益有限。 | 摘要顯示缺成本／缺圖款數；評估只改選取款、批次帶入價格並預览變更。保留既有覆寫／鎖价／重複组合防護。 |
| U05 P | 多選後、批次部分失敗、回列表的位置是完整工作情境。 | 操作列顯示選取範圍，結果逐筆可處理；返回維持位置／篩選，換站避免殘留選取誤操作。 |
| U06 S/P | Dashboard已有待辦／漏斗／費用／健康資料；todoBuckets.ts有200筆上限提示。 | 待處理優先，統計放後；改善準確計數與資料範圍說明。不要再建重複儀表板。 |
| U07 S/R | layout.tsx載入14份CSS，有歷史覆蓋修補。 | 先保存三主題桌機／手機基準，再逐元件收斂。保留已定案框線風格；不把CSS整理與手勢／業務邏輯同包。 |
| U08 S/R | public有manifest；本輪在src/public未找到serviceWorker註冊或完整離線流程。 | 不能把可安裝等同離線可用。先補斷網／重連／草稿保存的誠實提示與實測；離線雲端操作排隊不是首發必做。 |

### D Shopify正式上線、營運與維護

| ID／狀態 | 白話問題與證據 | 處理／過關條件 |
|---|---|---|
| S01 R | 發布條件文件和較新現況文件的版本日期不同。 | 上線前重新核對預定分支／SHA、Preview、Production、migration ledger和授權；先整理一張現況表，舊紀錄留存但明確標歷史。 |
| S02 S/R | 有mock防護、publisher權限、ACTIVE確認、先DRAFT再補欄位、CAS與部分失敗恢復。沒有本輪真店端到端證據。 | 保留既有保護；用一件批准的DRAFT核對圖片、款式、售價、庫存地點與回填，再按批准範圍驗公開上架。 |
| S03 S/R | 本輪在src/lib/shopify及發布API未找到publication相關操作；ACTIVE是商品狀態，不能單憑它證明指定銷售通路可見。 | 核對實際商店通路設定與回讀證據，必要時另設通路發布步驟；不能直接斷言商店一定不可見。以顧客頁可見、可選正確款式作最終驗收。 |
| S04 S/R | 缺SHOPIFY_LOCATION_ID時publishDraftSafe.ts:49–68取第一個location。 | 確認店主使用的庫存地點；上線核對實際權限、庫存政策、價格與圖片，不只看env名稱存在。 |
| S05 S/R | syncShopifyProduct.ts已有remote updatedAt衝突、hash與回讀。 | 實測Shopify人工修改後工具不靜默覆蓋；部分同步要知道哪些欄位成功，不把已有能力重寫。 |
| S06 R | 原有RLS／service-role／圖片下載防護與migration證據分屬不同版本。 | 確認發布版本包含保護，測operator自己／他人資料、reviewer、admin範圍；不把local／舊CI當Production證據。 |
| S07 S/R | package.json和CI有大量source驗證、typecheck、build，但沒有browser E2E runner。 | 在穩定環境加最小關鍵旅程：輸入、補款式、生成結果、審核、mock發布；付費API以固定回應測介面，真模型另驗。 |
| S08 R/P | 本輪未驗證備份還原、錯誤追蹤與費用上限；已有cost／health儀表板不代表限制生效。 | 正式上線需回復方法、可追查操作ID、記錄保留策略與費用提醒；先確認既有配置再補。資料庫恢復與部署回退分開演練，不自行啟用付費方案。 |

Shopify官方依據（2026-09-30查閱）：https://shopify.dev/docs/api/admin-graphql/latest/mutations/publishablePublish 說明publication是通路發布，商品可見也要求active。實作時依專案固定API版本重查契約。本次沒有生成／修改GraphQL。

## 4. 五階段過關條件

| 階段 | 本階段交付 | 過關條件 |
|---|---|---|
| 1 文案 | 欄位目的、規格共用、標題契約、固定驗收集 | 來源可靠、已知資訊完整、無無據性能／交期、選品理由具體；店主認可且陌生商品也能用。不能只用示範商品考自己。 |
| 2 功能 | 儲存一致性、資料找得到、失敗恢復、警告定位、基本圖／款式流程 | 正常、斷線、刷新、部分失敗、同時修改能有可理解結果；必要功能沒有靠手動修資料才可使用。 |
| 3 UIUX | 三主題一致、商品卡片與工作台、手機、彈窗、逐件處理 | 一件商品從輸入到待發布的桌機／手機實測；不遮按鈕、不爆版、不丟位置；外觀樣本先認方向。 |
| 4 Shopify | 發布版本整合、設定核對、mock、批准DRAFT、公開通路驗收、回復紀錄 | 工具結果與Shopify一致，客人看得到且款式／價格／圖片正確；中斷不重複建商品；有明確批准才上正式。 |
| 5 圖片影片 | 視額度分次做清理／背景／詳情圖／影片工具 | 每次先估費用、保留原檔、預覽選用、可撤回、記實際成本；先評估便宜的裁切壓縮／排序，AI生成逐件受控。 |

第一到三階段只做上線必要與高效益範圍，避免為了「全面」無限加功能。新選品追蹤、完整離線同步、整站大重構、大型影音生成都後排。基本圖片功能仍在第二／四階段驗收。

## 5. 下一包：先修文案的離線設計與最小補丁

1. **C-A 指揮官**：凍結9/30失敗稿、確認標題規則衝突，建立每欄目的與驗收案例；需要店主裁決只交具體對照。
2. **C-B Luna**：依明確設計實作規格共用或資料一致性窄修補，限定檔案，不改其他語氣／發布／UI；若涉及資料覆蓋先交回設計。
3. **C-C Luna**：固定案例／陌生商品離線檢查，核對組裝prompt、原始資料與輸出欄位、完整生成與單欄重生一致性；不呼叫付費模型。
4. **C-D 指揮官**：審diff、確認適當測試與人工目標稿；接著提出小額、固定次數的真模型驗收。這些包是計畫，尚未實作或批准付費。

## 6. 派工模板

目標：一個可驗收結果。指定檔案：最小範圍。禁止：無關模組、密鑰／真資料、push／deploy、付費或外部寫入。輸出：檔案、變更摘要、測試證據、剩餘風險。停止：需求衝突、跨模組設計、同類失敗兩次。主代理驗收：看證據和關鍵diff，必要時針對風險獨立測試。

## 7. 本包完成狀態

- [x] CMD-A 常駐省算力分工與店主流程寫入AGENTS.md。
- [x] CMD-B 深入盤點與證據分級；工人未完成範圍已明示，主代理補必要核對。
- [x] CMD-C 五階段路線、驗收與下一包任務卡。
- [x] CMD-D 入口／現況／施工清單同步。
- [ ] 產品修復、登入實機驗收、最新部署與資料庫核對、真店發布：本包未執行。
