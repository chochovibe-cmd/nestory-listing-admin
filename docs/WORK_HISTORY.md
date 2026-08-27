# Nestory — Work History

> 只記重要 package / milestone，不把每個小 commit 都塞進來。
> SHA 只當歷史證據；需要當現在施工 gate 時必須重新查 live state。

## 2026-08-18 — Production Supabase reconcile

已完成 production DB reconcile 與 migration tracking 起點整理。

重點：
- production precheck / apply / postcheck 完成。
- 既有商品資料 row counts 保持一致。
- tracked migration 從 audited 2026-08-18 state 開始，不假裝舊 001–039 曾被 CLI 管理。
- 後續 schema 變更必須用 tracked migration；不要 replay 舊 migration 到 production。

## 2026-08-20～2026-08-24 — ResultCard / Variant UI stabilization

完成多輪 mobile / desktop UIUX package、corrective、owner real-device QA 與 rollback。

核心流程教訓：
- 一包最多 1–3 adjustments。
- Owner 否決的設計要正常 revert，不用 force rewrite history。
- UI / runtime 以 Preview + Owner 實機驗收為重要 gate。

PR #8 `Mobile ResultCard R3 final owner layout` 最終已 merge。

Production 功能 authority 曾落在 PR #8 merge commit：
`21e9d1c90697797aaa6d982e9454ccd4a6955fd8`。

## 2026-08-24 — Shopify lifecycle safety

完成 Shopify lifecycle safety package 的程式層修正與 verifier：

- publish 先 DRAFT staging，再完成同步後 ACTIVE。
- retry / existing product idempotency，避免重複 `productCreate`。
- real unpublish / republish lifecycle contract。

這些安全能力不代表可以任意做真實 Shopify write；真實 publish / unpublish 仍需 Owner 明確 Go-Live package。

## 2026-08-24～2026-08-27 — COPY C1

原始 Owner 需求：新增第 7 種 AI 文案語氣「潮巢導購版」，借用商品頁閱讀節奏，不抄競品內容，實際文字使用潮巢品牌語氣。

### C1 initial build

早期施工曾發生 scope creep，把 tone-specific 需求擴大到 shared systems，例如 Evidence Pack、Vision bridge、spec merge、structured title assembly、FAQ 等。

這成為後續 recovery 的主要原因。

### R0A — Shared data pipeline recovery

Final R0A commit：
`17005bc73d87c24fba54fe78d26fa414477fdb6a`

完成：
- Evidence Pack 移除。
- Full Generate Vision bridge 移除。
- Image analysis / Web Search / spec 行為回 Production authority。
- existing-first `spec_text` contract 恢復。

### R0B — Title / SKU / FAQ recovery

完成：
- title 回 Owner 最小差異：separator ` | `、第二段 append product type、第三段回 Production 行為。
- SKU 回 Production authority。
- FAQ 回 Production 3–5 題既有 contract。

### R0B.3 — Tone preservation

修正 single-field regen 造成 `generation_tone` 跳回其他 tone 的 bug。

Recovery HEAD：
`e3558aa2976fdbca016dfcb4d4c110c8034dfa9a`

CI #321 PASS。

### Restore Chaochao-only copy contract

Commit：
`9c4ac5d60e23b9c546b744706f99914683325b33`

完成：
- 潮巢專屬 exact 3-section description contract。
- anti-AI boilerplate。
- feature → benefit。
- evidence safety。
- ResultCard Preview 使用 stored generation tone / sale status。

### C1.P1 — Preview fallback

Final feature HEAD：
`5c160942a269574737d6876cf035ce73099a6aa0`

Commit：`fix: tolerate missing Chaochao preview heading prefix`

CI #324 SUCCESS。

Vercel Preview：
`dpl_HjFD8dyxHbs42TkGgGyPiV1aqvJa` READY / Preview。

Owner real-device：**COPY C1.P1 Preview layout PASS**。

PR #9 仍 OPEN / NOT MERGED。

## 2026-08-26 — Production accidental-write recovery

曾因未指定 branch 的寫入意外在 Production/default 建立空檔。

Accidental commit：
`3f72e8b0e574085c895fd5c0bcc4a45640e4a3a2`

Recovery commit：
`6960a0cd257590abb6c1ccb7c97a2c3e772714d3`

結論：
- 沒有 force / rewrite history。
- Production tree 已恢復原 functional state。
- 之後 Connector write 必須明確 repo / feature branch / expected HEAD。
- default branch 不可當隱含 write target。

## 2026-08-27 — Commander documentation reset

Owner 決定把專案記憶正式分層：

- `AI_START_HERE.md`：live handoff snapshot / 下一步。
- `docs/AI_WORKING_RULES.md`：永久工作規則。
- `docs/CURRENT_STATUS.md`：目前狀態。
- `docs/DECISIONS.md`：Owner decisions。
- `docs/WORK_HISTORY.md`：milestones。
- `docs/ROADMAP.md`：未來工作。
- `docs/ACTIVE_TASKS.md`：active package / Agent / reserved files。

Docs-only branch：
`agent/docs-commander-checkpoint-20260827`

這包禁止 runtime、Shopify、Supabase、Vercel config 修改。