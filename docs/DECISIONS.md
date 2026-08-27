# Nestory — Decisions

> Owner / Commander 已確認、會影響後續工作的決策紀錄。
> 這裡記「決定了什麼」；live SHA / PR / deployment 請重新查 GitHub / Vercel。

## 2026-08-27 — Project memory split

Owner 決定專案文件正式分兩層：

- `AI_START_HERE.md`：目前專案狀態、做到哪、最新 HEAD、PR、blocker、下一步。
- `docs/AI_WORKING_RULES.md`：長期不太會變的合作規則。

並新增：

- `docs/CURRENT_STATUS.md`
- `docs/DECISIONS.md`
- `docs/WORK_HISTORY.md`
- `docs/ROADMAP.md`
- `docs/ACTIVE_TASKS.md`

重要原則：文件不是 live engineering authority。文件告訴 Agent 去哪裡查；GitHub / Vercel / 外部服務告訴 Agent 現在真的在哪裡。

## 2026-08-27 — COPY C1 status

Owner 已實機確認 `COPY C1.P1 Preview layout PASS`。

PR #9 仍保持 OPEN / NOT MERGED。

沒有 Owner 明確 merge approval 前，不得自行 merge。

## 2026-08-27 — COPY quality 拆包

下一階段不再叫 recovery。

Copy quality 拆為：

1. `COPY C2 — Description Quality`
2. `COPY C3 — Title Quality`
3. `COPY C4 — Metafield + FAQ Quality`

禁止一次大改 description + title + FAQ + shared system。

## 2026-08-27 — COPY C2 design direction

C2 只改善「潮巢導購版」description 的內容品質，不重做 C1 已 PASS 的 layout / Preview contract。

C2 三個 adjustment：

1. 商品專屬購買理由：從 evidence 選出本商品 facts，轉成合理 feature → benefit / usage reason。
2. 生活感寫法：減少抽象 AI 稱讚與萬用句，改成具體、有使用畫面的潮巢小編語氣。
3. 三段分工：商品介紹 / 收藏亮點 / 導購小標不能重複換句話講同一賣點。

C2 不得自行修改 shared prompt engine、其他 tone、title、FAQ、SKU、spec、Web Search、Vision、Shopify、CSV、DB。

## 2026-08-27 — Owner acceptance philosophy for copy

文案品質不能只用「CI 綠」判定。

自動驗證負責防 regression；Owner 真商品實測負責最後品質 acceptance。

C2 Owner acceptance：

- 第一段不是 AI 萬用問句。
- evidence 足夠時至少自然使用 3 個本商品專屬 facts。
- 收藏亮點優先 feature → benefit / 情境，不是純形容詞。
- 三個 section 不重複講同一件事。
- 導購小標段提供新的使用 / 收藏理由，不是全文 summary。
- C1 已 PASS 的三段 hierarchy、bullets、Preview、tone preservation 不退步。

## 2026-08-27 — Multi-Agent boundary

Owner 會另外開 UIUX Commander。

UIUX Commander 可以設計 layout、spacing、hierarchy、interaction、mobile flow、responsive、theme。

UIUX Commander 不得自行修改 Shopify business logic、DB、copy prompt、SKU、CSV、GSC。

多 Agent 平行工作時必須使用 Reserved files；兩包碰同一檔案就不能平行。

## 2026-08-27 — Commander role

Project Commander 負責：

- 全局
- roadmap
- package 拆分
- GitHub
- CI
- Vercel
- copy
- Shopify
- CSV
- GSC
- Production safety
- multi-Agent coordination
- Worker 獨立驗收

Commander 可以做 code-level design，但不可超越 Owner 授權的產品範圍。

## 2026-08-27 — Chat / Work / Connector capability

Nestory 已有實際成功紀錄：ChatGPT Chat 可當 Commander、GPT Work 可當施工環境、Chat / Work 可使用已授權 GitHub / Connector 能力。

因此 shell 沒有 GitHub HTTPS credentials，不等於 GPT 無法施工。

`git push --dry-run` 不再作為 GPT 能不能施工的唯一 hard gate。

安全要求仍然是：明確 repo、feature branch、expected HEAD、Race Guard、diff gate、Commander 驗收。

## 2026-08-27 — Git safety

Production/default 預設 READ-ONLY。

常態禁止 manual blob / tree / commit API / update_ref / force push / unreferenced blob / noop commit / 亂建暫時 branch。

低階 Git API 只允許真正 disaster recovery 且 Commander 明確批准。

## 2026-08-27 — Production / Shopify / DB safety

未經 Owner 明確 package 授權，禁止：

- Production deploy
- Shopify 真實商品 write
- publish / unpublish
- DB migration
- broad data cleanup

ONE controlled Shopify smoke 只能在未來明確 Go-Live package 執行。

## Existing product data — Pingu

舊 Pingu 的 `spec_text` 有歷史污染；existing-first contract 會保留既有非空規格。

決策：不要在 COPY package 偷做 DB cleanup。

若要修舊 business data，另開 narrow data repair package 並由 Owner 明確批准。

## Preview experience

Owner Preview 優先提供 `?_vercel_share=...` 免登入連結。

UI / runtime package 通常走：Feature → Vercel Preview → Owner 實機驗收 → 才考慮 merge。