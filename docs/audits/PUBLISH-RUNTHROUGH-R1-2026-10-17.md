# PUBLISH-RUNTHROUGH R1 source 驗收 — 2026-10-17

## 結果與範圍

**SOURCE PASS；尚未 push／PR／merge／部署。** 基準 HOTFIX-2 merge `15fcdc48a087b31e12e0a5d41c88b713701c4827`；branch `codex/publish-runthrough-r1-20261017`，獨立副本 `.tmp/publish-runthrough-r1-20261017`。

原來兩次 step 能各領一件：重送請求會跳過仍在處理的商品。本次只改 `publishBatchStepwise.ts` 的領件邏輯與既有 `verify-publish-batch.mjs`：單次讀 processing＋queued，依狀態、created_at、id 排序，只競爭第一件。正在處理或 CAS 沒領到就等待，不領後件；讀取／CAS 出錯停止。等待不刷新 heartbeat，原 recovery、權限、發布函式、UI、60 秒限制及一次性舊發布路徑保持既有行為。

本機歷史 schema 與正式 metadata SELECT 均證實 `publish_batch_items.item_status` 是 text；本包沒有 schema／資料寫入。

## 證據

- Worker 使用低成本工人，指揮官獨立審關鍵 diff，要求保留原 heartbeat 行為並補強 processing 晚於 queued 的測試後收包。
- `node scripts/verify-publish-batch.mjs`：**72 passed / 0 failed**，動態載入真實 step 模組；驗證既存 processing 優先、兩請求只有一件發布、CAS 輸家等待、同時間 id 決勝，以及讀取／CAS 出錯不發布或誤收尾。既有正常發布、stale recovery、webhook 僅一次等斷言保留。
- `node scripts/verify-publish-guard.mjs`：**83 passed / 0 failed**。
- `tsc --noEmit` exit 0，語法與 `git diff --check` PASS。沒有改 route exports 或依賴，未另做完整 build；HOTFIX-2 基準本機完整 build 與遠端 CI／Preview 已成功。
- Worker 額外誤跑非本包／非現役 verify:all 的舊 `verify-d7-publish-batch.mjs`：migration 027 舊位置檢查失敗，其他 9 條通過。現有 027 位於 `supabase/history/pre_tracking_migrations/`；未為舊路徑檢查搬檔或改 SQL。沒有名為 `verify-publish-flow.mjs` 的腳本，不能宣稱執行過。

## 邊界與下一包

此包沒有完整階段游標，不能把「等待前件」稱為「逾時後從中斷點續跑」。逾時的件仍依既有 3 分鐘 stale recovery 結束；完整 R2–R4 需持久 phase／lease、遠端成功未知的對帳、每次最多 6 張圖片、同件重入與固定斷線測試。跨批次／一次性舊路徑競爭不在本包。

沒有登入後 Browser、真 Shopify E2E 或 Production 驗收；未呼叫付費模型、未修改正式商品／DB。
