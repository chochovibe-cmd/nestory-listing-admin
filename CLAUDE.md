# Nestory 上架系統

**新的 Claude Code / AI coding session 請先讀根目錄 `AI_START_HERE.md`。**

最短讀取順序：
1. `AI_START_HERE.md` — 專案入口與文件地圖
2. `docs/CURRENT_STATUS.md` — 現在做到哪、已知風險、下一步
3. `AGENTS.md` — 常駐施工規則與 UI / 安全鐵則

只有工作真的涉及 UI 時，再讀：
- `docs/mockups/nestory-v7-mockup.html`
- `docs/Mockup差異備忘.md`
- `docs/REGRESSION_AUDIT.md`

不要在 session 一開始通讀全部 `docs/` 或所有 dated 施工文件；它們保留歷史，但不再是新 session 的第一入口。

最重要的常駐規則仍以 `AGENTS.md` 為準：
- 動 CSS 前先讀現有 `src/app/globals.css` 與 tokens
- 禁止新增 `!important`
- 不因 UI 優化移除或改壞既有功能
- SQL 只產 migration 檔，不自行跑 Supabase CLI
- 不 deploy，除非使用者明確同意
