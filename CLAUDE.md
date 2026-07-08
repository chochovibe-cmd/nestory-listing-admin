# Nestory 上架系統

**開始任何工作前，先完整閱讀根目錄的 `AGENTS.md`**——裡面是本專案的常駐規則
（UI 一致性鐵則、設計語言約定、工作規則、新增 UI 功能的標準流程），對所有 AI 模型有效。

再讀 `docs/交接指南-給接手的AI模型.md` 取得施工順序（Phase A–F）、已知地雷與風險清單。
UI 驗收標準：`docs/mockups/nestory-v7-mockup.html`。

最重要的三條（完整版在 AGENTS.md）：
1. 動 CSS 前先讀 `src/app/globals.css`，只用現有 tokens，禁止自創顏色/圓角/陰影值
2. 前台變更一律「先提設計方案等確認，再實作」，完成後兩主題＋手機版自查
3. SQL 只產檔不跑 CLI；不 push/deploy 除非使用者同意；用白話跟使用者溝通
