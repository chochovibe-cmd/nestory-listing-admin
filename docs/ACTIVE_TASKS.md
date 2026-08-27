# Nestory — Active Tasks

> 多 Agent 協作登記表。任何 package 真正寫入前先重新查 target branch HEAD；本表不是 live SHA authority。

## Active / Ready for Commander Verify

### DOCS C0 — Commander Memory Reset

Owner / Commander：Project Commander

Branch：`agent/docs-commander-checkpoint-20260827`

Start authority：Production `6960a0cd257590abb6c1ccb7c97a2c3e772714d3`

Status：**READY FOR COMMANDER DIFF VERIFY**

Reserved files：

- `AI_START_HERE.md`
- `docs/CURRENT_STATUS.md`
- `docs/AI_WORKING_RULES.md`
- `docs/DECISIONS.md`
- `docs/WORK_HISTORY.md`
- `docs/ROADMAP.md`
- `docs/ACTIVE_TASKS.md`

Forbidden：

- `src/**`
- `.github/workflows/**`
- Vercel config
- Shopify runtime / config
- Supabase schema / migration / data
- COPY feature branch
- Production/default write

Owner acceptance：

- 新 Commander 依序讀 `AI_START_HERE → AI_WORKING_RULES → CURRENT_STATUS → ACTIVE_TASKS` 可以直接接手。
- 文件明確區分 snapshot 與 live authority。
- runtime diff = 0。

Publication：docs-only branch，不 merge，等待 Commander / Owner 後續決定。

## Next Runtime Package

### COPY C2 — Description Quality

Commander：Project Commander / Professional Copy Commander role

Target branch：`agent/copy-chaocao-sales-tone`

Last verified start candidate：`5c160942a269574737d6876cf035ce73099a6aa0`

**開工前必須重新查 live feature HEAD；這個 SHA 不可直接當永久 gate。**

Status：**DESIGN APPROVED / RUNTIME NOT STARTED**

Adjustments：

1. 商品專屬購買理由：facts → feature → benefit / usage reason。
2. 生活感寫法：降低 AI 萬用句與抽象稱讚，改成具體潮巢小編語氣。
3. 三段分工：商品介紹 / 收藏亮點 / 導購小標不重複賣點。

Reserved files when package actually starts：

- `src/lib/providers/systemPrompt.ts`
- COPY C2 dedicated verifier only if needed

Forbidden：

- `src/lib/providers/systemPromptBase.ts`
- title quality changes
- FAQ / metafield changes
- ResultCard Preview layout / renderer changes
- SKU
- spec / `spec_text`
- Web Search
- Vision
- Evidence Pack
- Shopify
- CSV
- DB schema / data
- pricing / variants / inventory
- other tone behavior

Owner acceptance：

- 第一段不是 AI 萬用問句。
- evidence 足夠時至少自然使用 3 個本商品專屬 facts。
- 收藏亮點優先 feature → benefit / 情境，不只抽象形容詞。
- 三個 sections 不重複換句話說同一賣點。
- 導購小標段增加新的使用 / 收藏情境，不是 summary。
- C1 已 PASS 的三段 hierarchy / bullets / Preview / tone preservation 全部不退步。

Publication：沿用 COPY feature branch / PR #9；不得 merge。

## Parallel Commander Slot

### UIUX Commander

Status：Owner 規劃另外開獨立 UIUX Commander。

Current reserved files：**NONE REGISTERED YET**。

允許：layout、spacing、hierarchy、interaction、mobile flow、responsive、theme。

禁止自行修改：Shopify business logic、DB、copy prompt、SKU、CSV、GSC。

如果 UIUX package 需要碰 `src/lib/providers/systemPrompt.ts` 或其他 COPY C2 reserved file：STOP，由 Project Commander 排序，不能平行施工。

## Planned / Not Active

### COPY C3 — Title Quality

Status：PLANNED / waits for C2 acceptance。

Reserved files：尚未指派。

### COPY C4 — Metafield + FAQ Quality

Status：PLANNED / waits for prior copy packages。

Reserved files：尚未指派。

### SHOPIFY G1 — Go-Live Audit

Status：PLANNED / READ-ONLY FIRST。

Real Shopify write：NOT AUTHORIZED。

### SHOPIFY G2 — ONE Controlled Smoke

Status：BLOCKED by G1 PASS + explicit Owner authorization。

### SM CSV A1 — Current-State Audit

Status：PLANNED / READ-ONLY FIRST。

### GSC A1 — Indexing Audit

Status：P2 / PLANNED。

## Coordination rule

若兩個 package 要改同一檔案：

**不能同時施工。**

Commander 必須排順序；另一包 HOLD。

任何 Agent 發現其他 bug：記錄，不施工，除非 Owner / Commander 另開 package。