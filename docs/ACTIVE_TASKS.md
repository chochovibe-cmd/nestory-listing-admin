> **2026-10-10 HANDOFF — no active Shopify release blocker**
> - Shopify release package is closed PASS.
> - Do not reopen DRAFT/ACTIVE release work unless new live evidence shows a regression.
> - New Commander should first live-check authority / PRs / Production, then choose the next approved post-release package from the roadmap.
> - SEO Panel V2 / Handle work is approved as a queued UIUX-CARD-WORKBENCH direction, not yet an implementation package unless Commander defines the six package fields.
>
> **2026-10-10 RELEASE CHECKPOINT — Shopify ACTIVE blocker cleared**
> - DRAFT release: PASS.
> - ACTIVE publication fix PR #35: merged.
> - Production deployment: PASS.
> - Real Online Store publication recovery/readback: PASS.
> - **No further Shopify release smoke is required as a blocker.** Daily DRAFT / ACTIVE is now normal operation; observe future ACTIVE publishes routinely and open a narrow bug package only if new evidence appears.
> - Return Commander priority to the existing post-release roadmap instead of reopening Shopify release work.
>
> **2026-10-10 ACTIVE TASK — PR #35 merge decision**
> - `SHOPIFY-ACTIVE-PUBLICATION-FIX` implementation is complete and validated.
> - PR #35 head: `508757ecea55517b19f6798951066e2cb480c0b9`; CI #1021 PASS; Preview `dpl_DadBdv5xJAqrmAgKfcmFXwNX2izg` READY; changed files = 3.
> - **Do not merge without Owner explicitly saying it may merge.**
> - After merge only: deploy merged authority to Production, keep release controlled, re-enable ACTIVE, then use the already-selected Crayon Shin-chan product for recovery/smoke if safe; verify `status=ACTIVE` + Online Store `publishedOnPublication=true` + non-null `publishedAt` before release PASS.
>
> **2026-10-10 ACTIVE TASK — SHOPIFY-ACTIVE-PUBLICATION-FIX (HOLD until Owner authorizes repair)**
> **Authority:** current live release authority + Shopify Admin API publication state observed on the real smoke product.
> **Allowed scope (max 3 adjustments):**
> 1. Add a small Shopify publication helper that discovers the Online Store publication (no hard-coded store ID) and calls idempotent `publishablePublish` for one product.
> 2. In ACTIVE flow, after staged DRAFT sync + status ACTIVE, publish to Online Store and independently read back `publishedOnPublication=true` (and expected publication timestamp/state) before Nestory writes `active_published`.
> 3. Add focused tests for success/idempotency/publication failure; DRAFT path must remain unchanged.
> **Forbidden:** payload/title/copy/images/SKU/pricing/variant/recovery/DB schema/UI/Showmore/Matrixify changes; no broad channel publishing; no hard-coded Online Store publication ID.
> **Owner acceptance:** one controlled real smoke product is both Shopify ACTIVE and Online Store published, with existing data intact. Failure must not be recorded locally as `active_published`.
> **Diff gate:** only Shopify lifecycle/publication helper + focused tests/docs if needed.
> **Publication:** feature branch/PR first; Preview/CI; no merge without Owner approval; Production ACTIVE gate stays OFF until repaired build is accepted.
>
> **2026-10-10 ACTIVE TASK — one controlled real Shopify ACTIVE smoke**
> - ACTIVE server gate is already ON in Production.
> - Reserved release scope: exactly one Owner-chosen product, normal Nestory ACTIVE publish, then independent Shopify readback.
> - Do not use an arbitrary old product and do not bulk-publish.
> - Acceptance: Shopify status ACTIVE; intended title, SKU, price, variants and main images are correct; Nestory linkage/publish status is correct; no unrelated product is made ACTIVE.
> - PASS → Shopify release gate closes and daily DRAFT/ACTIVE choice is authorized. Failure → HOLD and open a narrowly scoped repair package.
>
> **2026-10-10 ACTIVE TASK — SHOPIFY-ACTIVE-GO-LIVE**
> - Production DRAFT transition: PASS.
> - Real DRAFT smoke: PASS (Pingu mini camera, `gid://shopify/Product/15422660214969`).
> - No further DRAFT smoke is required.
> - Next package must explicitly define and verify ACTIVE vs Online Store publication semantics, then enable ACTIVE only under Owner Production approval and run exactly one controlled real ACTIVE smoke.
> - Until that approval, `SHOPIFY_ACTIVE_PUBLISH_ENABLED=false` remains authoritative.
>
> **2026-10-10 ACTIVE GATE — FRESH DRAFT SMOKE**
> - Production DRAFT transition = **PASS**.
> - Authority / Production: `5fc18fb02741cca1b5c1c912e1ff668b7a410180` / `dpl_Fcx2cdy683zyJwoBMyqmJ8ra7kXs`.
> - Live mode: `shopifyMock=false`; single-draft allowlist disabled; ACTIVE flag explicitly false.
> - **Next task:** exactly one Owner-approved fresh product through the full real flow → Shopify DRAFT → read back product/variants/SKU/price/images/status.
> - Do not use an old partially-published recovery draft as the release smoke. The smoke should be a new product with no existing Shopify linkage.
> - Forbidden until smoke PASS + new package: ACTIVE enablement, real ACTIVE publish, broad batch live publishing validation, unrelated UI/DB work.
> - After smoke PASS: start `SHOPIFY-ACTIVE-GO-LIVE` immediately.
>
> **2026-10-09 NEXT-CHAT ACTIVE HANDOFF**
> - Final product authority: `5fc18fb02741cca1b5c1c912e1ff668b7a410180`.
> - Completed: `UI-FLOW-STABILIZE` ✅；`SHOPIFY-DAILY-DRAFT` ✅ merged PR #34.
> - **Current next task: Production DRAFT transition — OWNER APPROVAL REQUIRED BEFORE WRITE.**
> - Allowed after approval: adjust Production Shopify live-test env so normal products are no longer single-draft allowlisted; keep `SHOPIFY_ACTIVE_PUBLISH_ENABLED=false`; deploy the exact merged authority; verify Production status; run exactly 1 fresh DRAFT smoke.
> - Forbidden without new approval: ACTIVE enablement, real ACTIVE publish, sales-channel publication changes, unrelated Product/UI/DB changes.
> - If fresh DRAFT smoke PASS, next package is immediately `SHOPIFY-ACTIVE-GO-LIVE` with one controlled real ACTIVE smoke.
> - Active agents: none. Reserved files: none until next Commander defines the Production transition package.
> - Owner cadence: two packages complete → recommend new Commander chat now.
>
> **2026-10-09 ACTIVE PACKAGE — SHOPIFY-DAILY-DRAFT**
> - Status: **SOURCE PASS / MERGE HOLD / PRODUCTION HOLD**.
> - PR #34: `gpt/shopify-daily-draft-20261009@5cfcc2b0dc492cdde52c5a798369e243cd193919` → base `handoff/20261008-golive-spec@102565df789a035e6b8ae415ce7b694b919d927f`.
> - CI + Preview PASS; Preview is mock mode and safe.
> - Owner acceptance for source: general IDs may live-publish DRAFT when the single-draft allowlist is absent; ACTIVE remains server-blocked by default.
> - Current required decision: explicit Owner approval to merge PR #34. Do not merge automatically.
> - After merge: separately request Production approval, remove/disable the single-draft allowlist as part of the approved transition, keep ACTIVE flag false, then run exactly 1 fresh full-flow DRAFT smoke.
> - Immediate next package after DRAFT smoke PASS: `SHOPIFY-ACTIVE-GO-LIVE`, followed by exactly 1 real ACTIVE smoke before free ACTIVE use.
> - Reserved runtime files for PR #34: `src/lib/shopify/liveTestGuard.ts`, `scripts/verify-shopify-live-test-guard.mjs`, `.env.example`.
>
> **2026-10-09 POST-PR33 ACTIVE HANDOFF**
> - Final authority：`102565df789a035e6b8ae415ce7b694b919d927f`。
> - `UI-FLOW-STABILIZE`：✅ PASS / PR #33 merged / Owner runtime accepted。
> - **Current blocker：`SHOPIFY-DAILY-DRAFT` — NOT STARTED.**
> - Then：1 件 fresh full-flow DRAFT smoke → PASS 後標記 **GO DAILY（DRAFT）**。
> - Active agents：none；Reserved files：none until Commander opens the SHOPIFY-DAILY-DRAFT package。
> - Post-GO `UIUX-FLOW-STATE` 新增 Owner idea：Smart Station Handoff（最後一張完成才自動切下一站 + highlight；有剩餘工作則留站；failure / batch / sequential 不亂跳）。
> - Owner cadence：完成 1–2 包做 repo checkpoint，再換新 Commander。
>
> **2026-10-09 NEXT-CHAT HANDOFF**
> - Final authority after PR #31 merge：`9eff0659f4a2c936b550ea5bc72ba69aa1a0567a`
> - Production：`dpl_FgaFr9nCf2bHTbpTrbC4cQpCA178` / `cb4b4d122398e765aa8c2375568756978c649334`，READY；PR #30/#31 為 docs-only，runtime 未變。
> - Current blocker：`UI-FLOW-STABILIZE`（NOT STARTED）。
> - Following package：`SHOPIFY-DAILY-DRAFT`（NOT STARTED）。
> - GO DAILY gate：以上兩包 + 1 件 fresh full-flow DRAFT smoke。
> - Active agents：none。
> - Reserved files：none until next Commander defines the package.
> - Owner cadence：完成 1–2 包就 checkpoint + 換新 Commander。
>
> **2026-10-09 Owner 流程補充**
> - 為避免 Commander 對話再次撞到長度上限，Owner 希望 **每完成 1–2 個 package 就換新 Commander 對話**。
> - 換對話前必須先把 Final HEAD / PR / PASS-HOLD / blockers / next package / reserved files 寫回 repo；新對話依 AI_START_HERE → AI_WORKING_RULES → CURRENT_STATUS → ACTIVE_TASKS 接手。
> - 前一版 planned list 漏列 PB2 與 UIUX / 規格區主線，已在 `docs/COMMANDER-ROADMAP.md` 補正。
>
> **GO DAILY 前 current sequence：**
> 1. `UI-FLOW-STABILIZE` — NOT STARTED
> 2. `SHOPIFY-DAILY-DRAFT` — NOT STARTED
> 3. 1 件 fresh full-flow smoke — PASS 後標記 GO DAILY（DRAFT）
>
> **GO DAILY 後主線：**
> `OBS-QUEUE → COPY-SAFE → PB2-COPY-STRATEGY → UIUX-SPEC-VARIANT → UIUX-CARD-WORKBENCH → UIUX-FLOW-STATE → PERF P1A → PERF P1B → CAPTURE-FILTER → Schedule V1.2 / Pricing DB → Video / advanced image → CSS`
>
# Nestory — Active Tasks

更新：2026-10-09

## Current package

**DOC-CHECKPOINT｜V1.1 / Shopify DRAFT 真實狀態回寫**

- Authority：`handoff/20261008-golive-spec@cb4b4d122398e765aa8c2375568756978c649334`
- Allowed scope：只更新專案狀態 / roadmap / active tasks / work history 文件。
- Forbidden scope：不改產品程式、不改 Supabase schema/data、不改 Vercel env、不寫 Shopify、不 deploy Production、不 merge。
- Owner acceptance：新 Agent 讀入口後，能正確知道 V1.1 已完成、VICTOR DRAFT E2E 已 PASS、下一個 blocker 是 SHOPIFY-DAILY-DRAFT，而不是重做 V1.1。
- Diff gate：
  - `AI_START_HERE.md`
  - `docs/CURRENT_STATUS.md`
  - `docs/COMMANDER-ROADMAP.md`
  - `docs/ACTIVE_TASKS.md`
  - `docs/WORK_HISTORY.md`
- Publication：`gpt/docs-checkpoint-20261009` → PR base `handoff/20261008-golive-spec`
- Merge：HOLD；沒有 Owner 明確「可以合併」不得 merge。
- Reserved files：以上 5 個 docs 檔。
- Active agents：Commander only；沒有其他 worker 被授權修改這 5 個檔案。

## Next package

**SHOPIFY-DAILY-DRAFT｜日常真 DRAFT 安全開放**

狀態：NOT STARTED。

目標：
- 一般合格商品可真寫 Shopify DRAFT。
- ACTIVE 後端一律禁止。
- 不再依賴單一 VICTOR allowlist 才能使用。
- 保留 existing role / confirm / idempotency / resumable publish safety。

開始前 Commander 必須重新查：
- current authority HEAD；
- Production deployment + `/api/status`；
- Production Shopify env scope；
- `liveTestGuard` / publish route current source。

完成 source/CI/Preview 後，Production 切換仍需 Owner 明確授權。切換後只跑 1 件 fresh smoke；PASS 才標記 **GO DAILY（DRAFT）**。

## Planned, not active

1. OBS-QUEUE
2. COPY-SAFE
3. PERF P1A
4. PERF P1B
5. CAPTURE-FILTER
6. PR #14 UIUX ideas salvage
7. PR #15 Schedule V1.2 rewire
8. Pricing DB
9. PR #12 Video
10. PERF P2 / CSS + advanced image later

不要讓兩包同時修改同一 reserved files；真正開工時由 Commander 另列 Authority / Allowed / Forbidden / Acceptance / Diff gate / Publication。
