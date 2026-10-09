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
