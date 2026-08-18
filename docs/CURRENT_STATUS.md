# Nestory — Current Status

> 這是給新 AI session 的「唯一短版現況」。
> 更新原則：只放現在還成立的資訊；歷史細節留在舊施工文件。

更新基準：2026-08-18
目前基準分支：`codex/nestory-v0.1-safety-skeleton`
最近已知 HEAD：`1e7f951`（2026-07-21）

## 1. 專案狀態

Nestory 已不是早期 demo。核心商品上架流程、AI 文案、圖片/規格處理、審核與 Shopify publish 架構都已建立，功能完整度高；目前主要風險在「穩定化與一致性」，不是單純缺功能。

粗略判斷：
- 功能完整度：約 85–90%
- 正式上線準備度：約 70–75%

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

## 3. 現在最重要的 P0 / P1

### P0 — UI regression / CSS 疊改
2026-07-21 的 UIUX 批次改動非常密集，已確認存在「優化 → 回歸 → 補修／撤回」歷史。

先看：`docs/REGRESSION_AUDIT.md`

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

### P1 — verifier drift
`verify-no-secrets.mjs` 對 `localStorage` 的規則與目前合法 autosave 實作有衝突風險，可能造成 `verify:all` 本身失真。

### P1 — 無 GitHub CI gate
目前 repo 沒有 `.github/workflows` 正式 CI。
建議未來 gate：
- install
- `verify:all`
- `typecheck`
- `build`

## 4. UIUX 回歸稽核已確認

已確認：
- `754a879`（B4-P06）把 fail reason 移進 title row 後，後續 `24c8d9b` 又修「長文撐亂 desktop header」。
- `159721e`（B4-P08）改圖片縮圖 wrap/尺寸/角標後，`8c7db19`（B4-P09）又撤回，還原 B2-P10。
- `5f73952`（B4-P07）為解決 workbench 雙欄重疊，加入廣泛 `overflow-x: clip` / `max-width:100%` containment；這類規則可能影響 popover、badge、preview、thumb 等子元件，需繼續檢查。
- `2b5d3f7` 名義是 Tags UI，但同 commit 也改 Variant CSS，commit scope 混雜。
- `6af3a25` 名義是 UX 改善，但實際改了 Variant 自動展開行為與複製列邏輯，屬功能變更。

## 5. 功能階段摘要

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

## 6. 正式環境尚未完成確認

目前 repository 稽核不能替代正式環境稽核。
仍需確認：
- Vercel production env 是否完整
- Supabase 實際 migration / RLS 狀態
- Shopify production mode / credentials
- 一次完整 real-product E2E

## 7. 下一步建議順序

1. 完成 UIUX regression audit
2. 將已確認 UI 回歸拆成小修復包
3. 權限模型決策與 DB/RLS 一致化
4. production Supabase migration reconcile
5. verifier 修正
6. GitHub CI
7. real-product E2E
8. 再往 Phase E6/F/G

## 8. 文件使用規則

判斷「現在怎樣」優先順序：
1. `docs/CURRENT_STATUS.md`
2. 實際 source code / Git HEAD
3. `AGENTS.md`
4. `docs/Mockup差異備忘.md` / Mockup（UI 工作）
5. 歷史施工文件

`docs/施工清單.md` 很有價值，但內容很長，且混合歷史進度，不應要求每個新 session 一開始全文讀完。
