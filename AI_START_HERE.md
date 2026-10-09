> **2026-10-10 fresh Shopify DRAFT smoke — PASS**
> - Owner used existing Pingu mini camera draft as the real Production smoke; no second test product is required.
> - Nestory draft: `5feb9b44-e8c1-46f7-9d06-2c354bfcd0d9`; publish batch completed 1/1 with 0 failures in DRAFT mode.
> - Shopify readback: `gid://shopify/Product/15422660214969` status **DRAFT**; title matched; SKU `CHO-DS-PIN-PIN-001`; price TWD 799; 1 default variant; 4 main product images present.
> - Detail images remain excluded from Shopify product media by the already-approved media contract; this is expected, not a missing-image defect.
> - Local Shopify product linkage is present. No release-blocking issue found.
> - **Release gate result: DRAFT SMOKE PASS. Next package: SHOPIFY-ACTIVE-GO-LIVE.** ACTIVE still requires explicit Owner Production approval before enabling the server flag or creating a real ACTIVE product.
>
> **2026-10-10 Production DRAFT transition — PASS**
> - Owner explicitly approved the Production DRAFT switch.
> - Production env transition completed: `SHOPIFY_LIVE_TEST_DRAFT_ID` is empty/disabled; `SHOPIFY_ACTIVE_PUBLISH_ENABLED=false` is explicitly set for Production.
> - Production deployed exact authority `5fc18fb02741cca1b5c1c912e1ff668b7a410180` as `dpl_Fcx2cdy683zyJwoBMyqmJ8ra7kXs`; deployment is READY and owns `nestory-listing-admin.vercel.app`.
> - Live `/api/status` returned HTTP 200 with `shopify=true` and `shopifyMock=false`; Shopify is in real mode, not simulation.
> - ACTIVE remains blocked by the server gate because the explicit ACTIVE flag is false. This package did not publish any product and did not change DB / SKU / price / images / variants.
> - **Current blocker / next action:** run exactly 1 fresh full-flow real Shopify DRAFT smoke using an Owner-approved test product. After PASS, immediately open `SHOPIFY-ACTIVE-GO-LIVE` and run one controlled real ACTIVE smoke before broad ACTIVE freedom.
>
> **2026-10-09 Commander handoff after PR #34 — CURRENT**
> - Git authority live-checked after merge: `handoff/20261008-golive-spec@5fc18fb02741cca1b5c1c912e1ff668b7a410180`.
> - `UI-FLOW-STABILIZE` = PASS / merged / Owner runtime accepted (PR #33).
> - `SHOPIFY-DAILY-DRAFT` = PASS / merged (PR #34). Source now guarantees live Shopify publish defaults to DRAFT-only when the old single-draft allowlist is absent; ACTIVE stays server-blocked unless `SHOPIFY_ACTIVE_PUBLISH_ENABLED=true`.
> - Production has **not** been switched to this authority yet. Current production remains `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / Git `cb4b4d122398e765aa8c2375568756978c649334`, READY. A new authority Preview may exist, but it is not Production.
> - Current next action is a separate **Production DRAFT transition package**: Owner must explicitly approve before changing Production env / deployment. Transition should remove/disable the single-draft allowlist, keep `SHOPIFY_ACTIVE_PUBLISH_ENABLED=false`, deploy exact merged authority, then run exactly 1 fresh full-flow DRAFT smoke.
> - If that smoke PASS: immediately do `SHOPIFY-ACTIVE-GO-LIVE` → one Owner-approved real ACTIVE smoke → only then free daily DRAFT / ACTIVE choice.
> - Owner workflow cadence: two packages are now complete; this is the recommended checkpoint to switch to a new Commander chat. New chat first reads AI_START_HERE → AI_WORKING_RULES → CURRENT_STATUS → ACTIVE_TASKS, then live-checks GitHub / Vercel before action.
>
> **2026-10-09 SHOPIFY-DAILY-DRAFT checkpoint — SOURCE PASS / PRODUCTION HOLD**
> - Product authority remains `handoff/20261008-golive-spec@102565df789a035e6b8ae415ce7b694b919d927f` until PR #34 is explicitly approved and merged.
> - Draft PR #34 head: `gpt/shopify-daily-draft-20261009@5cfcc2b0dc492cdde52c5a798369e243cd193919`.
> - PR #34 changes only 3 files: `src/lib/shopify/liveTestGuard.ts`, `scripts/verify-shopify-live-test-guard.mjs`, `.env.example`.
> - New contract: when live Shopify is enabled and no single-draft allowlist is configured, normal publishing is **DRAFT-only by default**. ACTIVE stays server-blocked unless `SHOPIFY_ACTIVE_PUBLISH_ENABLED=true`.
> - Existing `SHOPIFY_LIVE_TEST_DRAFT_ID` remains stricter: one draft only + DRAFT-only, even if the future ACTIVE flag is true.
> - CI verify / typecheck / build = PASS；Vercel Preview `dpl_7ozjq7iJHnr74GwWqfYfWBzvATfD` = READY；Preview `/api/status` confirms `shopifyMock=true`, so this validation did not write real Shopify.
> - Production is unchanged: `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / `cb4b4d122398e765aa8c2375568756978c649334`；live daily DRAFT is **not yet enabled**.
> - Agreed release order is now explicit: `SHOPIFY-DAILY-DRAFT → fresh DRAFT smoke → SHOPIFY-ACTIVE-GO-LIVE → one real ACTIVE smoke → free daily DRAFT/ACTIVE choice`. ACTIVE no longer sits in a distant backlog.
> - No merge / Production deploy / env switch without explicit Owner approval.
>
> **2026-10-09 Commander checkpoint after PR #33 — CURRENT**
> - Git authority live-checked after merge: `handoff/20261008-golive-spec@102565df789a035e6b8ae415ce7b694b919d927f`.
> - `UI-FLOW-STABILIZE` = **PASS / MERGED**（PR #33）。Owner 已在 Preview 實測：收合卡發布／匯出 modal、Export Preflight modal、單卡成功離場皆通過；失敗不應假消失的 source guard 保留。
> - Production 仍未被本包改動：deployment `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / Git `cb4b4d122398e765aa8c2375568756978c649334`，READY；`/api/status` 200、Supabase=true、Shopify=true、`shopifyMock=false`，但日常真寫入仍受現有 live-test gate 限制。
> - **下一個真正施工包：`SHOPIFY-DAILY-DRAFT`**。完成 source / CI / Preview 後仍需 Owner 明確批准 Production；之後只跑 1 件 fresh full-flow DRAFT smoke，PASS 才標記 **GO DAILY（DRAFT）**。
> - Owner 2026-10-09 新 UX 想法已排入 `UIUX-FLOW-STATE`：**Smart Station Handoff（聰明接棒）**。暫定規則是「目前站還有其他工作就留在原站；最後一張成功處理完才自動切下一站並 highlight 剛移動的卡；失敗不跳；批次 / Sequential 不在中途亂切」。這是 post-GO 優化，不插隊目前 release gate。
> - 文件是 handoff，不是 runtime 真相；新 Commander 仍必須先 live-check GitHub / Vercel。
>
> **2026-10-09 Commander handoff after PR #31 — CURRENT**
> - Git authority: `handoff/20261008-golive-spec@9eff0659f4a2c936b550ea5bc72ba69aa1a0567a`（PR #31 已 merge）。
> - Production 仍是 deployment `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / Git SHA `cb4b4d122398e765aa8c2375568756978c649334`，READY；`/api/status` = Supabase true / Shopify true / `shopifyMock=false`。PR #30/#31 都是 docs-only，沒有改 Production runtime。
> - Owner 新節奏：每完成 1–2 個 package 就換新 Commander 對話；換前做 repo handoff。
> - 下一個真正施工包：`UI-FLOW-STABILIZE`。完成後做 `SHOPIFY-DAILY-DRAFT` + 1 件 fresh full-flow smoke；PASS = **GO DAILY（DRAFT）**。
> - 完整後續 roadmap 不只 COPY-SAFE / PERF：另含 PB2 文案策略、規格/Variant UIUX、ResultCard/Workbench UIUX、流程狀態 UIUX、Pricing DB、Schedule V1.2、Shopify ACTIVE/publication、reliability/data hardening、browser E2E/ops hardening、Capture filter、Video/advanced image、CSS/scouting later。詳見 `docs/COMMANDER-ROADMAP.md` 最上方 2026-10-09 FULL RECONCILIATION。
> - 新對話不得用本段 SHA 當永久真相；第一步仍要 live-check GitHub / Vercel。
>
> **2026-10-09 接續節奏與 roadmap 補正**
> - Owner 改採「每完成 1–2 個 package 就換新 Commander 對話」；每次換對話前必須做 repo handoff，不依賴聊天摘要。
> - GO DAILY 前現在有兩個窄包：先 `UI-FLOW-STABILIZE`（發布/匯出 modal portal + 成功後卡片離場回饋同步），再 `SHOPIFY-DAILY-DRAFT`（一般商品 DRAFT-only 真寫入、ACTIVE 後端 hard-block）。最後跑 1 件 fresh full-flow smoke；PASS = 可正式每天用 Nestory 上架到 Shopify DRAFT。
> - GO DAILY 後文案拆成 `COPY-SAFE`（一致性/安全）與獨立 `PB2-COPY-STRATEGY`（收藏型/功能型分流、老闆版自適應標題、規格價值轉譯、品類知識包、Golden Eval）。
> - UIUX 不是只剩舊 PR #14：正式拆成 `UIUX-SPEC-VARIANT`、`UIUX-CARD-WORKBENCH`、`UIUX-FLOW-STATE`，均從最新 HEAD 重做小包，舊 PR 只供 reference。
>
> **2026-10-09 V1.1 + Shopify DRAFT 日常上架前 checkpoint（CURRENT AUTHORITY）**
> - Git authority：`handoff/20261008-golive-spec@cb4b4d122398e765aa8c2375568756978c649334`。PR #29 已合併；Production 現在是 Vercel deployment `dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178`，Git SHA 同為 `cb4b4d1…`，狀態 READY。
> - Production `/api/status` 重新核對：HTTP 200、Supabase=true、Shopify=true、`shopifyMock=false`。**這不等於已全面開放 Shopify 真寫入。** 現在仍是 Owner 核准的單一 DRAFT live-test gate；`checkLiveTestGuard` 在 allowlist 存在時只准一件 draft、且 publish mode 只能是 `draft`。不可直接清空 allowlist 當作「正式開放」，因為沒有 allowlist 反而會失去這層限制。
> - V1 基礎 Shopify 發布安全已 PASS：recovery / 防重複、SKU、media filter、真 DRAFT 都已有 runtime 證據。
> - V1.1 核心流水線已 PASS，**不要重做**：PR #24 draftId 進度、#26 持久生成 Queue、#27 圖片背景補抓、#28 非阻塞重生均已合併。Recent Production DB 也已有 Pingu / VICTOR / Miffy 的 completed queue runs。
> - Capture 1.2 PR #18 已實際合併（merge commit `62e1a412…`）；舊文件寫「Draft/HOLD、未 merge」已過期。
> - Regen Modal PR #29 已合併，Owner 實機驗收 PASS。
> - 2026-10-09 VICTOR controlled Shopify DRAFT E2E PASS：Nestory publish batch completed 1/1、0 failed；Shopify product `gid://shopify/Product/15422035853497` 仍為 DRAFT，2 variants，SKU `6131444709110` / `6131444709111`，售價 NT$449 / NT$499。
> - VICTOR 圖片：原始擷取曾有 22 張；目前 Nestory DB 16 張（5 main + 9 detail + 2 variant）。Owner 已確認少的 6 張 detail 是人工刪除淘寶廣告／錯誤詳情圖，不視為資料遺失 blocker。之後另做 CAPTURE-FILTER，只自動排除高信心廣告區圖片；不確定的仍交人工刪。
> - TAG authority：舊 Product Assistant DB 實際歷史資料反覆存在 `sale_status=海外代購（約14天）` + `銷售_海外現貨` 的組合，因此目前 VICTOR 的 `銷售_海外現貨` 不是 Shopify API 自行改錯；沿用既有 catalog / Shopify collection 命名 authority，不把 TAG 強改成另一套字。
> - **下一個唯一阻擋「正式日常完整跑上架流程」的 package：SHOPIFY-DAILY-DRAFT。** 目標是所有合格商品可真建立 Shopify DRAFT，但 ACTIVE 在後端一律禁止。Source/CI/Preview 過後，需 Owner 明確批准 Production 切換；再用 1 件一般新商品跑「擷取 → 生成 → 審核 → 圖片 → Shopify DRAFT」smoke。這件 PASS 後即可宣布 **GO DAILY（DRAFT）**。
> - Shopify ACTIVE／顧客端公開仍是另一個後續 Gate，**不是開始日常 DRAFT 上架的 blocker**。
> - 後續優化與原 Fable 計畫剩餘項目，以 `docs/COMMANDER-ROADMAP.md` 頂部 2026-10-09 ACTIVE ROADMAP 為準；當前施工／reserved files 看 `docs/ACTIVE_TASKS.md`。
>
> **以下舊 checkpoint 保留作歷史；若與本區衝突，以本區 + GitHub / Vercel / Supabase / Shopify live 查詢為準。**

> **2026-10-08 V1 Shopify 上線收尾（CURRENT AUTHORITY）**
> - `handoff/20261008-golive-spec` 已合併 PR #20–#23；程式 release commit 為 `8cdc25817a7febfd25c2e555b58a6cf0092031ed`。
> - 正式網址 `nestory-listing-admin.vercel.app` 與 `nestory-listing-admin-chocho-nestory.vercel.app` 現在都指向 deployment `dpl_9G2KNRABYpSq2MoXvSCN848sJcUE`（Git SHA `8cdc258…`）。`/api/status` = 200、Supabase/Shopify = true、`shopifyMock=true`；該 deployment 最近 30 分鐘 0 error。
> - 注意：2026-10-08 Vercel API deployment 免費額度已達每日上限，無法再建立新的 Production deployment；本次經 Owner 明確批准後，先驗證 exact Preview READY、確認 Preview/Production 需要的 Supabase/Shopify env 共用且沒有 handoff branch 的 live-test override，再把兩個正式 alias 安全切到該 exact deployment。**判斷 Production 真相要查 alias mapping，不可只看 target=production 清單。**
> - Production Supabase Gate 已完成：`variant_split_override_semantics` 與 `guard_current_image_batch_pointer` 已正式套用並驗證；舊文件「仍有 3 個 migration 未套」已過期。不要重播歷史 migration。
> - 真 Shopify DRAFT E2E 已完成：先驗證 timeout recovery / 同 Product ID 續接；再用「Pingu × 您萌｜吹風機」跑全新 DRAFT。商品 `gid://shopify/Product/15420026945721` 保持 DRAFT，5 variants、售價 NT$1,680、compare-at NT$2,280、SKU 正確。
> - 全新 DRAFT 曾暴露 media bug：detail 圖也進 Shopify 圖庫。PR #23 已修為 Shopify product media 只收 `main` + `variant`；現有 Pingu DRAFT 已精準移除 20 張 detail media，最後 9 張商品圖全 READY，description 的 detail embed 仍保留。
> - PR #18（Capture 1.2）仍為 Draft/HOLD：程式與 CI 已完成，但 Owner 手動 Chrome extension 驗收暫緩，**未 merge**。
> - Production 仍維持 `SHOPIFY_PUBLISH_MOCK=true`。這代表正式站目前不會直接寫真 Shopify；若要開啟日常真發布，必須另開明確 Production live-write package，不可從這份文件自行推論已放行。
> - 下一階段照原計劃：V1.1 擷取＋生成統一流水線 → COPY-SAFE 文案細修；PERF P1A 要等 PR #14 合併/放棄決策後施工，P1B 併入 V1.1；PR #15 排程、PR #12 影片等依 roadmap 後續處理。
>
> **以下 2026-10-07 舊狀態區塊保留作歷史；若與本區衝突，以本區＋GitHub/Vercel/Supabase live 查詢為準。**

# Nestory — AI Start Here

> **2026-10-07 狀態注記（主線 release truth）**
> - PB1.4 文案已由 PR #17 合進主線（merge commit `585c99b`），主線 CI 綠；店主已驗收文案品質。
> - 舊文案線 PR #13、#11 已關閉（被取代）；本機舊分支 `codex/copy-quality-v2` 末尾有 wip 封存 commit（`db172df`），僅供歷史查詢；其中 `mapCaptureFields` 多色白名單與 `zhTwLocalizer` 適閤修正為待 cherry-pick 的通用小修。
> - 正式站目前仍是 `eac309b`（10/6）；`585c99b` 的自動部署已從 Vercel Dashboard 取消，PB1.4 尚未上正式站，部署需店主明確批准。
> - 正式 Supabase 仍有 3 個 migration 未套：`20260822223100`、`20260902090000`、`20260903100000`。
> - 下一步順序：發布安全二修（混合 retry 整批 ACTIVE、轉正式無強確認）→ 店主批准後套 migration → 正式站部署 → 單一真商品 Shopify DRAFT E2E → 全新商品全流程驗收。

> 給任何新 Codex / Claude Code / ChatGPT / 其他 AI coding session 的最短入口。
> 目標：不用掃完整 repo，也能在 1–3 分鐘內知道專案在哪、什麼已上 production、什麼仍只在 branch、下一步是什麼。

## 1. 新 session 先讀

1. `AI_START_HERE.md`（本檔）
2. `docs/AI_WORKING_RULES.md`（永久合作規則；包含 scope、Race Guard、Owner 驗收、Vercel deployment 節流）
3. `docs/CURRENT_STATUS.md`
4. `AGENTS.md`
5. 做穩定化再讀 `docs/STABILIZATION_PLAN.md` + 對應 `docs/audits/*.md`
6. 要判斷 release / deploy：讀 `docs/RELEASE_READINESS.md`

碰 production Supabase / migration / RLS，**必讀**：
- `docs/audits/PRODUCTION-SUPABASE-RECONCILE-2026-08-18.md`
- `docs/audits/SUPABASE-LOCAL-RECONCILE-CI-2026-08-18.md`
- `docs/audits/SUPABASE-PRODUCTION-PACKAGE-2026-08-18.md`
- `docs/audits/SUPABASE-MIGRATION-BASELINE-2026-08-18.md`
- active `supabase/migrations/`

`supabase/reconcile/2026-08-18_*` 現在是**執行證據 / reference material**；production canonical history 已轉到 tracked `supabase/migrations/`。

## 2. 專案一句話

Nestory 是潮巢玩居內部 Shopify 商品上架 PWA：商品輸入、圖片/規格、AI 文案、審核、圖片處理、Shopify 發布；Supabase 資料層、Vercel 部署。

## 3. 重要：現在已經有一部分真正上 production

### Production Supabase reconcile — 已完成

正式專案：`nestory-listing-tool-test` (`tbgtqwvuohmdxnxisrgr`)。

2026-08-18 使用者已明確授權 production DB repair，且已成功執行：

- live precheck：`PRECHECK_OK` ✅
- tracked baseline migration：`20260818142712 baseline_existing_schema_20260818` ✅
- tracked reconcile migration：`20260818142919 production_reconcile_20260818` ✅
- live postcheck：`POSTCHECK_OK` ✅

受保護 row counts 前後完全一致：
- product drafts 32
- product images 147
- product variants 143
- profiles 1

正式 reconcile 已：
- 補回 migration 004 遺失的 8 條 catalog/rule RLS policies；
- 3 個 timestamp trigger helpers 固定 `search_path=pg_catalog`；
- `handle_new_user()` / `guard_sensitive_product_draft_fields()` 移除 anon/authenticated direct EXECUTE，保留 service_role；
- 保留 authenticated RLS helper execution；
- 不改 `rls_auto_enable()`；
- 不改商品資料、角色語意、Shopify/Vercel config。

Security Advisor after apply：原本 4-table no-policy 與 3 個本 package 目標 search_path findings 已消失。仍有 SECURITY DEFINER/RLS helper/Auth 類警告，屬**下一個獨立 hardening scope**，不可一刀切 revoke。

### Migration tracking 已正式開始

Production 在這次之前沒有 migration ledger；live DB 卻已包含歷史 `001–039` 的大部分最終狀態。

因此正式策略是：**tracking 從 2026-08-18 現有 audited state 開始**，不是假裝 001–039 曾被 Supabase CLI 管理。

Active queue：`supabase/migrations/`
- `20260818142712_baseline_existing_schema_20260818.sql`
- `20260818142919_production_reconcile_20260818.sql`
- `20260822223100_variant_split_override_semantics.sql`（2026-09-02 已由正式 migration ledger 核對為**尚未套用**）
- `20260902090000_guard_current_image_batch_pointer.sql`（PR #10 source hardening 新增；尚未套用 production，須依 ledger 規劃）
- 未來 tracked migrations 往後 append。

Pre-tracking history：
- `supabase/history/pre_tracking_migrations/001…039`
- 內容完整保存；是歷史 / local reconstruction input，**不是 production migration queue**。

鐵則：
- 不把 `001–039` 搬回 active queue；
- 不 replay 到 production；
- 不偽造舊 ledger；
- tracked migration 上線後若需 rollback，要新增 tracked revert migration，不可只手動跑舊 rollback SQL造成 schema/ledger 不一致。

## 4. Git source、Vercel runtime 與 PR #8 的真相（2026-09-01 校正）

以下三件事必須分開看，不能互相推論：

- `6ff020dd1d68152b6688c9695f8f96188b7862be` 是先前文件中的 production baseline。
- PR #8 已在 2026-08-25 以 merge commit `21e9d1c90697797aaa6d982e9454ccd4a6955fd8` 合入預設分支 `codex/nestory-v0.1-safety-skeleton`；舊文件中「PR #8 Draft／未 merge」都是合併前的歷史敘述，不可當現況。
- 2026-09-02 已從 Vercel production alias 只讀核對：當時正式站 `READY`，commit 是 `6960a0cd257590abb6c1ccb7c97a2c3e772714d3`。
- 2026-09-23 稍後 Owner 要求把潮巢語氣與加深搜尋這輪也上主線，給 GPT 精修。預設分支含 `2fb59c08ac2e295373c5897accd2598c25526fc7`。上面「不含潮巢語氣」只適用到 `2bdf011` 那一次部署。細節見 `docs/CURRENT_STATUS.md` 最上方 2026-09-23 一節。

同樣地，Git commit、Preview、GitHub CI、Vercel Production 和 Shopify 都是不同的證據來源。不得把任一項的成功推成另一項已通過。

### 2026-09-02 security hardening（Draft PR #10，尚未部署 production）

- P0：所有 server-side 外部圖片下載已統一經過 SSRF-safe fetch（每個 redirect 重新驗證、封鎖 private／metadata 網段、大小／逾時／圖片內容驗證）。
- P1：8 個會以 service-role 寫入的草稿／圖片路由，已先以 session RLS 確認 draft ownership／team scope；worker 走明確 token 例外，不接受無效 Bearer token 降級為 session。
- GitHub CI #372（frozen install、`verify:all`、typecheck、build）與 Supabase Local Reconcile #83 已通過；對應 Vercel Preview 為 `READY`。
- source 在 `codex/security-hardening-20260902`，Draft PR #10；尚未 merge、未部署 production，也未套用新的 Supabase migration。詳細證據及 remaining gates 見 `docs/audits/SECURITY-HARDENING-2026-09-02.md`。

## 5. CI / free DB gate

Source CI canonical：`agent/ci-gate` / `b935290` / Draft PR #1。

Free Supabase runtime branch：`agent/supabase-local-ci` / `f017765` / Draft PR #3。

Production package branch：`agent/supabase-production-package` / `2d96fce` / Draft PR #4。

Current migration housekeeping branch：`agent/supabase-migration-baseline`。

免費 DB gate 使用 GitHub runner + Docker + Supabase CLI + Postgres 17；**不要建立付費 Supabase Development Branch**。

已 runtime 驗證：
- production-like historical reconstruction（含 032 transaction modeling / 033 legacy parent fixture）；
- 8-policy drift + restore；
- operator/admin catalog RLS；
- operator owner boundary、reviewer/admin cross-team；
- new-user / sensitive-field triggers；
- batch ownership helpers無 `42P17`；
- archive authorization scope；
- timestamp search_path hardening；
- trigger-only function EXECUTE hardening；
- production precheck/apply/postcheck/rollback/re-apply cycle。

Migration baseline verifier：`scripts/verify-supabase-migration-baseline.mjs`，已接入 `verify:all`，鎖 active queue / archive / local bootstrap 路徑。

## 6. Canonical role model

- `operator`：建立/操作自己的商品；不審核、不發布。
- `reviewer`：全隊讀取、審核、發布。
- `admin`：reviewer + profiles / 成員角色 / 敏感設定。
- `viewer`：沒有 TS/DB role；目前不要新增。

不要單獨把 operator 加進 `canPublish()`；權限變更必須 UI/API/helper/RLS/tests 一起對齊。

## 7. 下一步順序

1. 審閱 Draft PR #10，並以 Preview 做必要的登入／手機 runtime QA；未經 owner 同意不得 merge。
2. 規劃 active migrations：ledger 已確認第三筆未套用；新的 `20260902090000_guard_current_image_batch_pointer` 也未套用。不可重跑 `001–039`。
3. 做不洩密的 Vercel Shopify env/config preflight，保持 Preview mock-safe。
4. 先做 Shopify mock publish；再由 owner 明確批准一筆 controlled real-product E2E。partial-create retry 的**source guard 已修**，但兩種 runtime 證據仍不能省略。
5. 下一個 DB hardening scope才處理 14 個 remaining Security Advisor warnings；先設計/測試，不直接 revoke RLS helpers或 hosted-only functions。

## 8. 修改鐵則

- 每次修改要記錄 what / why / affected files / state / remaining risks。
- 不刪舊文件；歷史只 archive / index。
- `supabase/migrations/` 現在是正式 tracked history；任何新增都要 timestamped + test + production discipline。
- `supabase/history/pre_tracking_migrations/` 不可 production replay。
- `supabase/reconcile/` 是 review/evidence，不是一般 deploy queue。
- `local-production-baseline.sql` 只允許 local/CI。
- 不改 hosted-only `rls_auto_enable()` without proof。
- 不為了 Security Advisor 綠燈而一刀切 SECURITY DEFINER / RLS helper EXECUTE。
- service-role API 不可信任前端傳來的 IDs。
- 不 merge / 不 Vercel production deploy，除非使用者明確同意。
- Vercel Preview 不要每個 commit 都部署；預設是一個 package 完成、CI / diff 通過後才做 1 次 Owner Preview。完整規則見 `docs/AI_WORKING_RULES.md` §23。
- 使用者要求 Supabase 免費方案；不要建立付費 branch。

## 9. 新 session 開場指令

> 先讀 `AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`。確認 PR #10 的 CI／Preview、Vercel production SHA 與 production migration ledger；不要用 Git source 猜 Vercel／Supabase 現況。碰 DB 必讀四份 Supabase audits與 active `supabase/migrations/`。2026-08-18 reconcile 已正式成功套用；第三及第四個 tracked migration 尚未套用。
