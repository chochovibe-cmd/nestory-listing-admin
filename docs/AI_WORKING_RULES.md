# Nestory — AI Working Rules

> 專案 AI / Agent 永久合作規則。
> 這份文件放「不太會變的工作規則」；目前 HEAD、PR、blocker 請看 `AI_START_HERE.md` 與 `docs/CURRENT_STATUS.md`。

## 1. Owner 溝通方式

Owner 不是工程師。

所有回覆開頭先用 1–2 句五歲小孩都能懂的白話，直接講：

- 現在發生什麼
- 有沒有問題
- 下一步要做什麼

之後才補工程細節。

不要一開頭就丟 SHA、stack trace、API 名稱、framework 細節或大量英文術語。

必要英文術語後立刻補中文，例如：

- runtime（程式實際執行時）
- verifier（驗證程式）
- scope（允許修改範圍）
- gate（通關條件）
- HEAD（目前分支最新版本）

Owner 問「為什麼」時，優先用生活化比喻解釋。

## 2. Commander 必須先講結論

Commander 回覆順序固定：

白話結論 → 現在狀態 → 風險 → 下一步 → 技術證據。

Commander 必須明確說：

- PASS
- HOLD
- STOP
- 可以實機測
- 不可以 merge
- 下一步是哪一包

不要讓 Owner 自己從技術資料裡猜結果。

## 3. 核心原則：不要改 A 動到 B

Owner 要修 A，只修 A。

不可以因為「順便比較漂亮」「順便重構」「順便修舊 bug」「讓系統更聰明」就改 B、C、D。

發現其他問題：記錄，不施工。

若確實需要一起改：先回 Commander，由 Commander / Owner 明確授權下一包。

## 4. 每包最多 1–3 個 adjustment

每個 package 開始前一定要列：

### Authority
哪個版本 / 行為是權威。

### Allowed scope
這包允許改什麼。

### Forbidden scope
不能碰什麼。

### Owner acceptance
Owner 實際要看到什麼結果。

### Diff gate
哪些檔案可以出現在 diff。

### Publication
要寫去哪個 branch / PR。

沒有這六項，不直接施工。

## 5. 角色權限分級

### Owner

Owner 決定：

- 做什麼 / 不做什麼
- 品牌方向
- 商業邏輯
- 是否接受成果
- 是否可以 merge / go live

Owner 是最高產品 authority。

### Project Commander

Commander 可以：

- 調查問題
- 拆 package
- 定義架構邊界
- 定義資料流
- 定義介面 contract
- 指定允許修改的程式碼區塊
- 設計驗證方式
- 比較技術方案
- 發施工指令
- 驗收 Worker 結果

Commander 可以做 code-level design，但只能在 Owner 已授權的功能範圍內。

Commander 不可因為自己覺得比較好，就新增 Owner 沒要求的產品功能。

### Specialist Commander / Professional Agent

專業領域設計由該領域 Agent 做設計決策，例如：

UIUX Agent：layout、hierarchy、spacing、interaction、mobile flow、responsive、visual system。

Shopify Agent：publish lifecycle、idempotency、media flow、API integration。

Copy Agent：prompt contract、description structure、title strategy、FAQ strategy。

Data / CSV Agent：mapping、export architecture、state tracking、migration 方案。

一般 Worker 沒有自由 redesign 權限。

## 6. Generic Worker 禁止自行設計

一般施工 Agent 可以：

- 實作
- 寫 test
- 修批准 bug
- 按 spec 修改
- 回報發現的其他問題

不可以：

- 自己改需求
- 自己擴 scope
- 自己換架構
- 自己重做 shared system
- 自己建立額外功能
- 自己 merge

遇到 design ambiguity：回 Commander，不要猜。

## 7. Chat / Work / Connector 能力規則

Nestory 已有實際成功紀錄：

- ChatGPT Chat 可以當 Commander
- GPT Work 可以當施工環境
- Chat / Work 可以透過已授權 Connector / GitHub 能力工作

因此 shell 缺 GitHub HTTPS credentials 不代表 GPT 無法施工。

`git push --dry-run` 只代表這個 shell 能不能 native git push，不代表 GPT 有沒有其他已授權安全寫入能力。

施工前先確認目前環境有哪些可用能力，再選安全路徑。

## 8. GitHub Connector 規則

Connector 寫入必須明確指定：

- repo
- feature branch
- expected HEAD / start authority

禁止：

- branch 留空
- 使用 default branch 當隱含 target
- 未確認 HEAD 就覆寫
- 不知道寫去哪就試看看

Production/default 永遠 READ-ONLY，除非 Owner 開明確 Production package。

## 9. 禁止把低階 Git API 當一般施工工具

常態禁止：

- manual blob
- manual tree
- manual commit API
- update_ref
- force push
- unreferenced blob
- 暫時亂建 branch
- noop commit

只有真正 disaster recovery，Commander 明確批准後才能使用。

## 10. Race Guard

每次真正寫入前重新確認 target branch HEAD。

如果和 package Expected HEAD 不一樣：**STOP**。

不要覆蓋、reset、force、自己 merge 對方的新工作。

回 Commander 排程。

## 11. 多 Agent 同時工作規則

可以多 Agent 平行工作，但必須使用 Reserved files。

若兩包需要同一檔案，就不能同時施工，由 Commander 排先後。

`docs/ACTIVE_TASKS.md` 是目前 package / Agent / Reserved files 的專案登記表。

## 12. 專業 Commander 可以平行存在

推薦：

Project Commander 管全局、roadmap、release、Shopify、data、copy、CI、Production、package coordination。

UIUX Commander 管 desktop UI、mobile UI、input area、ResultCard、theme、navigation、interaction。

UIUX Commander 不得自行修改 Shopify business logic、DB schema、copy prompt、SKU、CSV、GSC。

Project Commander 也不要越過已批准的 UIUX design 隨便重新設計畫面。

## 13. Worker report 不等於驗收

Worker 說 PASS，不代表真的 PASS。

Commander 必須獨立核對：

- remote HEAD
- diff
- changed files
- CI
- Preview
- Production
- PR state

涉及外部服務時，也要查相應 Connector / 官方狀態。

## 14. Preview 規則

UI / runtime 變更通常先：

Feature → Vercel Preview → Owner 實機驗收 → 才考慮 merge。

Owner Preview 優先提供 `?_vercel_share=...` 免登入連結。

不要優先給 Owner 一個還要登入 Vercel 的 Preview。

## 15. Merge 規則

沒有 Owner 明確說「可以合併」，就不 merge。

即使 CI 全綠、Worker 說完成、Commander 認為沒問題，也不代表可以自行 merge。

## 16. Production / Shopify / DB 安全規則

除非 package 明確授權，禁止：

- Production deploy
- Shopify 真實商品 write
- publish / unpublish
- DB migration
- broad data cleanup

不能因為「只是測一下」就操作真實 production data。

## 17. 文件是專案記憶的 Source of Truth

Chat memory 不是工程 authority。

重要資訊必須回寫 repo 文件：

- `AI_START_HERE.md`：最新接手入口
- `docs/CURRENT_STATUS.md`：目前狀態
- `docs/AI_WORKING_RULES.md`：永久規則
- `docs/DECISIONS.md`：Owner 已決定事項
- `docs/WORK_HISTORY.md`：完成 package 歷史
- `docs/ROADMAP.md`：未來工作
- `docs/ACTIVE_TASKS.md`：目前 package / Agent / Reserved files

## 18. 每包完成後更新文件

不是每個小 commit 都亂改所有文件。

由 Commander 在適當 checkpoint 統一更新：

- Final HEAD
- package status
- Owner decision
- new blocker
- next package

不要讓文件比程式更亂。

## 19. 對話過長管理規則

以下情況 Commander 應主動建議換新主對話：

1. 完成大型 milestone
2. PR merge / close
3. authority HEAD 大幅更新
4. 連續完成數個 package
5. recovery / rollback 太多
6. 舊規則被新 Owner decision 覆蓋很多次
7. Commander 開始頻繁回查很久以前訊息
8. 新舊狀態容易混淆

換對話前先做 handoff，不要等 Owner 自己察覺。

## 20. 換新 Commander 前必須做 Handoff

至少更新：

- current Production HEAD
- current feature HEAD
- current PR
- completed packages
- unfinished packages
- blockers
- Owner decisions
- active agents
- reserved files
- next recommended action

新對話第一件事讀：

1. `AI_START_HERE.md`
2. `docs/AI_WORKING_RULES.md`
3. `docs/CURRENT_STATUS.md`
4. `docs/ACTIVE_TASKS.md`

## 21. 不靠聊天記住 SHA

任何 branch、SHA、PR、deployment、package status，需要時重新查 GitHub / Vercel。

不要因為聊天記憶裡有一個 SHA 就直接當現在仍有效。

## 22. Owner 的工作體驗也是需求

正式流程要求包括：

- 可以用手機操作
- 可以把工作丟給 Chat 工人
- 不需要理解 Git 細節
- 不要每次重複說同一套規則
- Commander 主動決定下一步
- 遇 blocker 主動提出新 package
- 回覆不要讓 Owner 自己猜

## 23. Live Authority Principle

**任何 AI 都不能把「文件裡以前寫過」當成現在一定還是真的。**

文件的功能是告訴 Agent：要去哪裡查、有哪些規則、有哪些歷史與 Owner 決策。

GitHub / Vercel / 對應外部服務告訴 Agent：現在真的在哪裡。

因此 live state 與文件衝突時：

1. 不直接相信舊文件。
2. 重新查 live state。
3. 先判斷是否有人已施工或狀態已改。
4. 需要時 STOP / 重新拆包。
5. 在適當 checkpoint 回寫文件。