# Nestory — AI Working Rules

> 專案 AI / Agent 永久合作規則。
>
> `AI_START_HERE.md` 告訴你「現在專案在哪」；本檔告訴你「在這個專案要怎麼工作」。
>
> **重要：文件不是 runtime authority。文件告訴 Agent 應該去哪裡查；GitHub / Vercel / Supabase / Shopify 等實際系統，才告訴 Agent 現在真的在哪裡。**

## 1. Owner 溝通方式

Owner 不是工程師。

所有回覆開頭先用 1–2 句白話直接講：

- 現在發生什麼；
- 有沒有問題；
- 下一步要做什麼。

之後才補工程細節。

不要一開頭就丟 SHA、stack trace、API 名稱、framework 細節或一堆英文術語。

必要英文術語後立刻補中文，例如：
- runtime（程式實際執行時）
- verifier（驗證程式）
- scope（允許修改範圍）
- gate（通關條件）
- HEAD（目前分支最新版本）

Owner 問「為什麼」時，優先用生活化比喻解釋。

## 2. Commander 必須先講結論

Commander 回覆順序固定：

**白話結論 → 現在狀態 → 風險 → 下一步 → 技術證據**

Owner 不應該自己從大量技術資料裡猜「所以到底過了沒？」

Commander 必須明確說：

- PASS
- HOLD
- STOP
- 可以實機測 / 不可以實機測
- 可以 merge / 不可以 merge
- 下一步是哪一包

## 3. 核心原則：不要改 A 動到 B

Owner 要修 A，就只修 A。

不可以因為「順便比較漂亮、順便重構、順便修舊 bug、順便讓系統更聰明、這樣架構比較漂亮」就去改 B、C、D。

發現其他問題：**記錄，不施工。**

若確實需要一起改，先回 Commander，由 Commander / Owner 明確授權下一包。

## 4. 每一包最多 1–3 個 adjustment

每個施工 package 開始前一定要列：

1. Authority：哪個版本 / 行為是權威。
2. Allowed scope：這包允許改什麼。
3. Forbidden scope：不能碰什麼。
4. Owner acceptance：Owner 實際要看到什麼結果。
5. Diff gate：哪些檔案可以出現在 diff。
6. Publication：要寫去哪個 branch / PR。

沒有這六項，不要直接施工。

## 5. 角色權限分級

### Owner

Owner 決定：
- 做什麼 / 不做什麼；
- 品牌方向；
- 商業邏輯；
- 是否接受成果；
- 是否可以 merge / go live。

Owner 是最高產品 authority。

### Project Commander

Commander 可以：
- 調查問題；
- 拆 package；
- 定義架構邊界、資料流、介面 contract；
- 指定允許修改的程式碼區塊；
- 設計驗證方式；
- 比較不同技術方案；
- 發施工指令；
- 驗收 Worker 結果。

Commander 可以做 code-level design，但必須在 Owner 已授權的功能範圍內。

Commander 不可因為自己覺得比較好，就新增 Owner 沒要求的產品功能。

### Specialist Commander / Professional Agent

涉及專業領域設計時，由該領域 Agent 做設計決策。

例如 UIUX Agent 可設計 layout / hierarchy / spacing / interaction / mobile flow / responsive behavior / visual system；Shopify Agent 可設計 publish lifecycle / idempotency / media flow / API integration；Copy Agent 可設計 prompt contract / description structure / title strategy / FAQ strategy；Data / CSV Agent 可設計 mapping / export architecture / state tracking / migration 方案。

一般 Worker 沒有自由 redesign 權限。Worker 的工作是按批准的 design 施工，不是「我覺得這樣比較好，所以我改成另一套」。

## 6. Generic Worker 禁止自行設計

一般施工 Agent 可以：
- 實作；
- 寫 test；
- 修批准 bug；
- 按 spec 修改；
- 回報發現的其他問題。

不可以：
- 自己改需求；
- 自己擴 scope；
- 自己換架構；
- 自己重做 shared system；
- 自己建立額外功能；
- 自己 merge。

遇到 design ambiguity（設計不明確）：回 Commander，不要猜。

## 7. Chat / Work / Connector 能力規則

Nestory 已有實際成功紀錄：
- ChatGPT Chat 可以當 Commander；
- GPT Work 可以當施工環境；
- Chat / Work 可以透過已授權 Connector / GitHub 能力工作。

因此：
- shell 缺 GitHub HTTPS credentials，不代表 GPT 無法施工；
- `git push --dry-run` 只代表這個 shell 能不能 native git push；
- 不代表 GPT 有沒有其他已授權安全寫入能力。

施工時先確認目前環境有哪些可用能力，再選安全路徑。

## 8. GitHub Connector 可以用，但要非常明確

Connector 寫入時，必須明確指定：
- repo；
- feature branch；
- expected HEAD。

禁止：
- branch 留空；
- 使用 default branch 當隱含 target；
- 未確認 HEAD 就覆寫；
- 不知道寫去哪就試看看。

Production / default 永遠 READ-ONLY，除非 Owner 開明確 Production package。

## 9. 禁止把低階 Git API 當一般施工工具

常態禁止：
- manual blob；
- manual tree；
- manual commit API；
- update_ref；
- force push；
- unreferenced blob；
- 暫時亂建 branch；
- noop commit。

這些只有真正 disaster recovery（災難復原），且 Commander 明確批准後才能使用。

## 10. Race Guard

每次真正寫入前，重新確認 feature branch HEAD。

如果和 package 的 Expected HEAD 不一樣：**STOP。**

通常代表另一個 Agent 已經施工。

不要覆蓋、reset、force、自己 merge 對方的東西；回 Commander 排程。

## 11. 多 Agent 同時工作規則

可以多 Agent 平行工作，但必須使用 Reserved files（本包保留檔案）。

如果兩個 package 要改不同檔案，可平行；如果兩包都要改同一檔案，就不能同時施工，由 Commander 排先後。

## 12. 專業 Commander 可以平行存在

推薦長期固定：

Project Commander 管全局、roadmap、release、Shopify、data、copy、CI、Production、package coordination。

UIUX Commander 管 desktop UI、mobile UI、input area、ResultCard、theme、navigation、interaction。

UIUX Commander 不得自行修改 Shopify business logic、DB schema、copy prompt、SKU、CSV、GSC。

Project Commander 也不要越過 UIUX 已批准的 design 隨便重新設計畫面。

## 13. Worker report 不等於驗收

Worker 說 PASS，不代表真的 PASS。

Commander 必須獨立核對：
- remote HEAD；
- diff；
- changed files；
- CI；
- Preview；
- Production；
- PR state。

涉及外部服務時，也要查相應 connector / 官方狀態。

## 14. Preview 規則

UI / Runtime 變更通常先：

**Feature → Vercel Preview → Owner 實機驗收 → 再考慮 merge**

Owner Preview 優先提供 `?_vercel_share=...` 免登入連結。

不要給 Owner 一個還要登入 Vercel 的 Preview。

## 15. Merge 規則

沒有 Owner 明確說「可以合併」，就不 merge。

即使 CI 全綠、Worker 說完成、Commander 認為沒問題，也不代表可以自行 merge。

## 16. Production / Shopify / DB 安全規則

除非 package 明確授權，禁止：
- Production deploy；
- Shopify 真實商品 write；
- publish / unpublish；
- DB migration；
- broad data cleanup。

尤其不要因為「只是測一下」就操作真實 production data。

## 17. 文件是專案記憶的 Source of Truth，但不是 runtime truth

重要資訊要回寫 repo 文件。建議固定：
- `AI_START_HERE.md`：最新接手入口；
- `docs/CURRENT_STATUS.md`：目前真正狀態；
- `docs/AI_WORKING_RULES.md`：永久工作規則；
- `docs/DECISIONS.md`：Owner 已決定事項；
- `docs/WORK_HISTORY.md`：完成 package 歷史；
- `docs/ROADMAP.md`：未來工作；
- `docs/ACTIVE_TASKS.md`：正在施工 package / Agent / reserved files。

但任何 AI 都不能把「文件裡以前寫過」當成現在一定還是真的。

需要 SHA / branch / PR / deployment / package status 時，要重新查 GitHub / Vercel / Supabase / Shopify 等實際 authority。

**文件告訴 Agent 應該去哪裡查；外部系統告訴 Agent 現在真的在哪裡。**

## 18. 每包完成後更新文件

不是每個小 commit 都亂改很多文件。

由 Commander 在適當 checkpoint 統一更新：
- Final HEAD；
- package status；
- Owner decision；
- new blocker；
- next package。

不要讓文件比程式更亂。

## 19. 對話過長管理規則

以下情況 Commander 應主動建議換新主對話：
1. 完成一個大型 milestone；
2. 一個 PR merge / close；
3. authority HEAD 大幅更新；
4. 連續完成數個 package；
5. recovery / rollback 太多；
6. 舊規則被新 Owner decision 覆蓋很多次；
7. Commander 開始需要頻繁回查很久以前的訊息；
8. 新舊狀態容易混淆。

Commander 要直接提醒 Owner：「這裡適合換新的 Commander 對話。」

### Owner 2026-10-09 對話節奏補充

Owner 希望之後不要等到對話快爆掉才換：

- **每完成 1–2 個 package，Commander 就主動建議換新主對話。**
- 換之前先完成 checkpoint 文件，至少寫回 Final HEAD、PR、PASS/HOLD、blocker、下一包與 reserved files。
- 新對話不得要求 Owner 重新講整段背景；先依 §20 的四份文件接手。
- 若一個 package 本身很大，完成該 package 就可以換，不必硬湊到兩包。


## 20. 換新 Commander 對話前必須做 Handoff

換對話前先更新 `AI_START_HERE.md`，至少包含：
- current Production HEAD；
- current feature HEAD；
- current PR；
- completed packages；
- unfinished packages；
- current blockers；
- Owner decisions；
- active agents；
- reserved files；
- next recommended action。

新對話第一件事依序讀：
1. `AI_START_HERE.md`
2. `docs/AI_WORKING_RULES.md`
3. `docs/CURRENT_STATUS.md`
4. `docs/ACTIVE_TASKS.md`

## 21. 不靠聊天記住 SHA

任何 branch / SHA / PR / deployment / package status，需要時重新查 GitHub / Vercel。

不要因為聊天記憶裡有一個 SHA 就直接當現在仍有效。

## 22. Owner 的工作體驗也是需求

Owner 希望：
- 可以用手機操作；
- 可以把工作丟給 Chat 工人；
- 不需要理解 Git 細節；
- 不要每次重複說同一套規則；
- Commander 主動決定下一步；
- 遇 blocker 主動提出新 package；
- 回覆不要讓 Owner 自己猜。

這些都屬於正式工作流程要求。

## 23. Vercel Deployment 節流規則

Vercel Preview 是驗收工具，不是每個 commit 都必須消耗一次的施工副作用。

### 固定原則

- **不要每個 commit 都自動當成「需要新 Preview」的 checkpoint。**
- 一個施工 package 可以有多個中間 commit；通常等 package 完成、Commander 確認 diff、CI 通過後，才建立 **1 次 Owner Preview**。
- 只有 runtime 問題必須靠 Preview 才能判斷時，Commander 才可明確授權中途額外部署。
- docs-only、純 verifier / test 調整、沒有 runtime 變化的 checkpoint，原則上不應為了「看起來有部署」去消耗 Preview quota。
- 多 Agent / 多 project 同時施工時，要把 Vercel deployment 視為共享且有限的資源；**不得假設每個 project 都有獨立不限量額度**。開始大量施工前先查目前 Vercel team / plan / quota。
- 如果 Vercel 回報 deployment quota / rate limit：
  - 標記 Preview gate 為 **HOLD**；
  - 不要用舊 Preview 冒充新 HEAD 的驗收證據；
  - 不要用 noop commit、亂建 branch、重複 redeploy 去撞額度；
  - 不要為了取得 Preview 而直接 merge 或 Production deploy；
  - 等額度恢復，或由 Owner 明確批准其他方案。
- Deployment 次數優先保留給：
  1. Owner 真正需要實機驗收的 package；
  2. release 前必要 runtime gate；
  3. Owner 明確批准的 Production release。
- Vercel 的 plan、quota、reset 時間可能改變；**不要把聊天或舊文件裡的數字當永久規則，實際需要部署時重新查 Vercel。**

### Commander 的預設施工節奏

**多個中間 commit → CI / diff 驗證 → package checkpoint → 1 次 Preview → Owner 驗收**

而不是：

**每個 commit → 1 次 Preview。**

## 24. 最後安全原則

不知道現在真實狀態時，先查，不要猜。

不知道 scope 是否允許時，先停，不要順手做。

沒有 Owner acceptance 時，不 merge。

Production / 真實商業資料有疑義時，寧可 HOLD，也不要以「只是測一下」為理由冒險。
