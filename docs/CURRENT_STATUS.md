# Nestory — Current Status

> 這是給新 AI session 的「唯一短版現況」。
> 更新原則：只放現在還成立的資訊；歷史細節留在舊施工文件；實際變更歷史看 `docs/CHANGELOG.md`。

更新基準：2026-08-18
正式基準分支：`codex/nestory-v0.1-safety-skeleton`
目前整理／穩定化工作：`agent/p0-variant-duplicate-protection`（stack：cleanup → P0-1 → P0-2）

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

第一輪 UIUX / state regression audit 已完成並拆成可執行修復清單：
- `docs/STABILIZATION_PLAN.md`
- `docs/REGRESSION_AUDIT.md`
- `docs/audits/P07-CONTAINMENT-AUDIT-2026-08-18.md`
- `docs/audits/VARIANT-B3P06-B4P03-AUDIT-2026-08-18.md`
- `docs/audits/RESULTCARD-B3P02-B3P04-B4P04-B4P06-AUDIT-2026-08-18.md`

### P0-1 Variant dimensions / rows atomic confirm — 已實作，待 runtime 驗證/merge

分支：`agent/p0-variant-atomic-confirm`
單一 commit：`171bbaa` — `fix(variants): keep axis confirm atomic`

效果：軸值 add/drop 遇到會丟 hand-filled rows 時，不再先改 dimensions；第二次確認才把 pending dimensions + rows 一起套用。

### P0-2 Variant duplicate option protection — 已實作並 squash，待完整驗證/merge

分支：`agent/p0-variant-duplicate-protection`
單一 commit：以該 branch HEAD、message `fix(variants): protect duplicate option combinations` 為準。

已建立四層保護：
1. expand/merge：duplicate hand-filled loser 會進 `wouldDiscardHandFilled`，不再靜默消失。
2. Workspace：既有 pre-submit validation 在 `persistDraft()` 前擋重複 option combination。
3. ResultCard/shared persistence：`persistVariantsSafe()` 在 DB read/write 前擋 duplicate insert rows。
4. Shopify：`publishDraft()` 在 payload / `status: publishing` 前擋 legacy/manual duplicate DB rows並回 409；mock/live 都不會誤報成功。

另新增 `scripts/verify-variant-duplicate-protection.mjs`、`verify:variant-duplicates` 並納入 `verify:all`。

沒有加 DB unique index：目前 product_variants 是 insert-first 再 delete-old，直接 unique constraint 會和正常 replacement 互撞；之後若要 DB constraint，需先重設 persistence transaction 策略。

Vercel 對 P0-2 分支曾回 `success`，代表遠端 build/deploy 沒有直接失敗；但自己的 verifier、typecheck、實機案例仍未完整執行，因此**不可寫成正式驗證完成**。

詳細實際變更看 `docs/CHANGELOG.md`。

下一個修復：**P0-3 Mobile ResultCard selectMode expand affordance**。

## 4. 現在最重要的 P0 / P1

### P0 — Mobile ResultCard selectMode expand
手機多選模式下 tap card 只 toggle selection，但 B4-P04 又隱藏包含 ▸ 的 `.rc-quick-row`，造成沒有可見展開入口。這是下一個直接修復目標。

### P0 — UI regression / CSS 疊改
2026-07-21 的 UIUX 批次改動非常密集，已確認存在「優化 → 回歸 → 補修／撤回」歷史。

原則：
- 不整包 revert
- 先找最後正常錨點
- 一個問題一個小 commit
- UI 修改不可順手改業務邏輯

### P0 — 角色與權限模型不一致
目前實際 TypeScript / DB enum 是：
- `admin`
- `operator`
- `reviewer`

但部分新文件曾寫成 `admin/operator/viewer`。

更重要的是：目前 `operator` 不能 publish，而新使用者預設是 `operator`。這不是只改前端 `canPublish()` 就能解決，因為 RLS / DB guard 也牽涉權限。

在未正式決策前：不要自行把 operator 加進 publish。

### P0 — migration 驗證落後
repo migrations 已到 039，但 `verify-sql-schema.mjs` 主要仍驗證早期 schema，無法證明實際 Supabase production 已完整套用晚期 migrations。

需要：
- 對實際 Supabase schema / migration 狀態
- 補 current-schema verification

### P1 — Mobile card interactive gesture guard
`rc-header` 捕捉 touchstart/move/end；重生等 child 只 stop click，可能和 long-press selection / swipe 打架。

### P1 — P07 Variant desktop picker clipping
P07 ancestor `overflow-x:clip` 已找到會裁 Variant desktop absolute picker / hover zoom 的實際 selector 路徑；mobile portal preview 較安全。

### P1 — verifier drift
`verify-no-secrets.mjs` 目前以檔名 allowlist blanket-ban 多數 `localStorage`。合法 autosave 與 B4-P04 gesture hint 都會造成誤報，因此完整 `verify:all` 在此規則修正前不能當可靠綠燈。

### P1 — 無 GitHub CI gate
目前 repo 沒有 `.github/workflows` 正式 CI。
建議未來 gate：install → `verify:all` → `typecheck` → `build`。

## 5. UIUX 回歸稽核已確認

已確認：
- `754a879`（B4-P06）把 fail reason 移進 title row 後，後續 `24c8d9b` 又修「長文撐亂 desktop header」。
- `159721e`（B4-P08）改圖片縮圖 wrap/尺寸/角標後，`8c7db19`（B4-P09）又撤回，還原 B2-P10。
- `5f73952`（B4-P07）加入廣泛 `overflow-x: clip` / containment；已找到會裁 Variant desktop absolute image picker / hover zoom 的實際 selector 路徑。
- mobile long-press Variant zoom 使用 Portal，較不受 P07 ancestor clip 影響。
- ResultCard swipe 自己的 `overflow:hidden` 是設計行為，目前不是 P07 主因。
- `2b5d3f7` 名義是 Tags UI，但同 commit 也改 Variant CSS，commit scope 混雜。
- `6af3a25` 名義是 UX 改善，但實際改 Variant auto-expand / duplicate row 功能；兩個 Variant P0 已分別做出修復分支。
- B3-P04 + B4-P04 疊加造成 mobile selectMode expand affordance 消失，且 interactive child touch 可能和 card gesture 打架。

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

目前 repository 稽核不能替代正式環境稽核。
仍需確認：
- Vercel production env 是否完整
- Supabase 實際 migration / RLS 狀態
- Shopify production mode / credentials
- 一次完整 real-product E2E

## 8. 下一步建議順序

1. P0-3 mobile ResultCard selectMode expand affordance
2. P1 mobile gesture interactive-target guard
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
3. `docs/STABILIZATION_PLAN.md`（目前修復順序）
4. `AGENTS.md`
5. `docs/Mockup差異備忘.md` / Mockup（UI 工作）
6. `docs/CHANGELOG.md`（查已實際做過什麼）
7. 歷史施工文件

`docs/施工清單.md` 很有價值，但內容很長，且混合歷史進度，不應要求每個新 session 一開始全文讀完。
