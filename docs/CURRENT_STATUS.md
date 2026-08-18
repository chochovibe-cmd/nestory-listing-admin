# Nestory — Current Status

> 這是給新 AI session 的「唯一短版現況」。
> 更新原則：只放現在還成立的資訊；歷史細節留在舊施工文件；實際變更歷史看 `docs/CHANGELOG.md`。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前整理／穩定化工作：`agent/p0-mobile-resultcard-expand`（stack：cleanup → P0-1 → P0-2 → P0-3）

## 1. 專案狀態

Nestory 已不是早期 demo。核心商品上架流程、AI 文案、圖片/規格處理、審核與 Shopify publish 架構都已建立，功能完整度高；目前主要風險在「穩定化與一致性」，不是單純缺功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 70–75%

目前策略：**暫停擴新功能，先完成 regression / state consistency / verifier / production readiness。**

## 2. 已完成或相對成熟

- 新增商品工作檯、圖片、來源、價格、規格、語氣、AI 生成
- Vision / screenshot / URL recognition
- 結果卡、版本、Tags、規格管理
- 行動版與多主題 UI
- Shopify publish server flow
- `SHOPIFY_PUBLISH_MOCK=true` 安全預設；live 缺憑證會誠實失敗
- 發布批次與記錄
- Sharp / 圖片處理 / AI 去字重生流程
- Supabase schema/migration 已累積至 `039_*`
- FX cron、部分通知、部分 Showmore 流程
- 真實 Shopify DRAFT 流程曾成功跑過

## 3. 2026-08-18 穩定化目前進度

第一輪 UIUX / state regression audit 已完成。主線修復目前已做到 P0-3：

### P0-1 Variant dimensions / rows atomic confirm — 已實作，待完整驗證/merge
- 分支：`agent/p0-variant-atomic-confirm`
- 單一 commit：`171bbaa` — `fix(variants): keep axis confirm atomic`
- destructive axis change 未確認前不再先改 dimensions；確認後 dimensions + rows 一起套用。

### P0-2 Variant duplicate option protection — 已實作並 squash，待完整驗證/merge
- 分支：`agent/p0-variant-duplicate-protection`
- canonical reference：該 branch HEAD / message `fix(variants): protect duplicate option combinations`
- 四層 guard：expand/merge、Workspace pre-submit、shared persistence、Shopify publish 409。
- 不加 DB unique index，因現有 insert-first → delete-old replacement 會先與舊 rows 撞 unique。
- Vercel 曾回 `success`；專案 verifier/typecheck/實機仍待跑。

### P0-3 Mobile ResultCard selectMode expand affordance — 已實作，待手機驗證/squash/merge
- 分支：`agent/p0-mobile-resultcard-expand`
- canonical reference：該 branch HEAD / message `fix(mobile): restore ResultCard expand affordance`
- root cause：mobile selectMode 的 header tap 只切換選取，但 B4-P04 CSS 隱藏整個 `.rc-quick-row`，連唯一的 `.rc-toggle` 一起消失。
- 修法：新增 mobile-scoped `src/app/stabilization.css`，只恢復原有 44×44 `.rc-toggle`；`.rc-quick`、`.rc-dismiss-btn` 仍隱藏。
- `layout.tsx` 在 `globals.css` 後載入此 hotfix；新增 `verify-mobile-resultcard-expand.mjs` 並納入 `verify:all`。
- code-only diff 已確認相對 P0-2 為 1 commit / 5 files，沒有帶回舊 handoff 文件。
- Vercel 目前為 pending；手機實機與自有 verifier 尚未跑。

詳細：
- `docs/STABILIZATION_PLAN.md`
- `docs/CHANGELOG.md`
- `docs/audits/RESULTCARD-B3P02-B3P04-B4P04-B4P06-AUDIT-2026-08-18.md`

**下一個直接修復：P1-1 Mobile interactive-target gesture guard。**

## 4. 現在最重要的 P0 / P1

### P1 — Mobile card interactive gesture guard
`rc-header` 捕捉 touchstart/move/end；重生、toggle 等 interactive child 雖會 stop click，但 touch 仍可能冒泡，造成 long-press selection / swipe 誤觸。

建議修法：在 header gesture handler 中集中判斷 interactive target（button/input/select/textarea/a/[role=button] 或 `data-no-card-gesture`）直接退出；不要每顆按鈕散補 touch stop。

### P1 — P07 Variant desktop picker clipping
P07 ancestor `overflow-x:clip` 已找到會裁 Variant desktop absolute picker / hover zoom 的實際 selector 路徑；mobile portal preview 較安全。

### P1 — verifier localStorage policy
`verify-no-secrets.mjs` 目前以檔名 allowlist blanket-ban 多數 `localStorage`。合法 autosave 與 B4-P04 gesture hint 都會造成誤報，因此完整 `verify:all` 在此規則修正前不能當可靠綠燈。

### P0 — 角色與權限模型不一致
實際 TypeScript / DB enum 是 `admin | operator | reviewer`，但部分文件曾寫 viewer；而 operator 預設不能 publish。這牽涉前端 + RLS/DB guard，不可只改 `canPublish()`。

### P0 — migration 驗證落後
repo migrations 已到 039，但 `verify-sql-schema.mjs` 主要仍驗證早期 schema；尚不能證明 production Supabase 已完整套用晚期 migrations。

### P1 — 無 GitHub CI gate
目前 repo 沒有 `.github/workflows` 正式 CI。未來 gate 建議：install → `verify:all` → `typecheck` → `build`。

## 5. UIUX 回歸稽核已確認

- `754a879`（B4-P06）曾把 fail reason flex 撐亂 desktop header；後續 `24c8d9b` 已針對性修正。
- `159721e`（B4-P08）圖片縮圖方案後來由 `8c7db19`（P09）還原至 B2-P10。
- `5f73952`（B4-P07）廣泛 `overflow-x:clip`；已確認會影響 Variant desktop absolute picker / hover zoom 的 selector 路徑。
- B3-P04 + B4-P04 造成 mobile selectMode expand affordance 消失；P0-3 已做最小 hotfix，待手機驗證。
- interactive child touch 與 card gesture 的衝突仍待 P1-1。
- `2b5d3f7` / `6af3a25` 都有 commit scope 超出名稱的問題；後續一律一題一 commit。

## 6. 功能階段摘要

### Phase A/B
核心後端與主要 listing UI 大致完成。

### Phase C
- shell：完成
- settings：完成
- member management：未完成
- library：完成
- records：部分
- FX：完成

### Phase D
- Shopify files / image chain / Sharp / image review：大致完成
- 通知：部分完成
- Showmore：部分完成，真實後端驗證仍不足
- preview / YouTube carousel：有殘留驗證工作

### Phase E
E1–E5 大致完成；E6 AI advisor / competitor price 尚未完成。

### Phase F / G
大多尚未開始。**目前不建議優先做。**

## 7. 正式環境尚未完成確認

仍需確認：
- Vercel production env 是否完整
- Supabase 實際 migration / RLS 狀態
- Shopify production mode / credentials
- 一次完整 real-product E2E

## 8. 下一步建議順序

1. 收尾/squash P0-3，手機實機待有環境時驗證
2. P1-1 mobile gesture interactive-target guard
3. P07 Variant desktop picker clipping
4. verifier localStorage policy
5. 權限模型決策與 DB/RLS 一致化
6. production Supabase migration reconcile
7. GitHub CI
8. real-product E2E
9. 再往 Phase E6/F/G

## 9. 文件使用規則

判斷「現在怎樣」優先順序：
1. `docs/CURRENT_STATUS.md`
2. 實際 source code / Git HEAD
3. `docs/STABILIZATION_PLAN.md`
4. `AGENTS.md`
5. `docs/Mockup差異備忘.md` / Mockup（UI 工作）
6. `docs/CHANGELOG.md`（查已實際做過什麼）
7. 歷史施工文件

`docs/施工清單.md` 很有價值，但內容很長且混合歷史進度，不應要求新 session 一開始全文讀完。
