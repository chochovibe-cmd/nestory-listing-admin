# ⛔ 封存區（archive）— 舊方向文件，AI 不得引用

> **給所有 AI 模型的規則：這個資料夾裡的文件一律不得作為實作依據。**
> 它們是專案早期（Codex v0.1 時代，2026-06 前後）的產物，描述的架構已被取代，
> 只為保留歷史脈絡而封存（只搬不刪，git 歷史完整）。遇到與現役文件矛盾時，
> 一律以現役文件為準（入口見根目錄 `AGENTS.md` 的文件地圖）。

## 為什麼封存（每份的過時原因）

| 文件 | 過時原因 |
|---|---|
| `worker-contract.md`、`codex-skill-rules.md` | 描述「文案由排程 Codex Skill worker 產生」的舊架構——現行文案是 `/api/generate` 同步呼叫 LLM（OpenAI/Claude 雙 provider），worker 佇列僅保留給未來圖片管線與發布 |
| `api-contracts.md` | v0.1 路由契約，以 worker claim/complete 為核心，與現行 API 已大幅不符 |
| `shopify-publish-payload.md` | v0.1 payload 說明；現行 payload 經 A22（metafields）、A21（handle/JSON-LD/內部連結）、A23（HTML 轉換）大改，以 `src/lib/shopify/payload.ts`／`publishDraft.ts` 原始碼為準 |
| `deployment-checklist.md`、`mock-flow.md` | 引用已作廢的環境變數（如 `SHOPIFY_ADMIN_ACCESS_TOKEN`、`WORKER_API_TOKEN`）；Shopify 認證已改 client_credentials（見施工清單 A1） |
| `manual-qa-checklist.md`、`completion-audit.md`、`v0.1-local-wrap-up.md`、`v0.1-status-report.md`、`v0.1-team-handoff.md` | v0.1 里程碑的驗收快照與交接報告，屬歷史紀錄 |

## 仍然現役、沒有搬進來的（以免誤會）

`rls-policy-guide.md`、`rls-smoke-tests.md`、`supabase-storage.md`、`admin-bootstrap.md`
（基礎設施參考，仍有效）；`部署平台決策.md`／`部署決策重點摘要.md`（Vercel 決策紀錄，仍有效）；
四份規劃文件＋交接指南＋施工清單＋Mockup差異備忘＋Mockup（現役核心，見 AGENTS.md 文件地圖）。

（2026-07-11 由總指揮 Fable 建立，肇因：規格圖 OCR 舊方向殘留文件污染了新 session 的實作方向）
