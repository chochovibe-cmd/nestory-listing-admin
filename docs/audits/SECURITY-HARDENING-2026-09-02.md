# Nestory — Security Hardening Package (2026-09-02)

> 範圍：本機 source hardening。這份紀錄不是 production deploy、不是 Supabase migration 已套用的證明，也不是 Shopify 真實商品測試結果。

## 1. 本包完成項目

### P0 — 伺服器抓取外部圖片的 SSRF 防護

新增共用的 `src/lib/images/fetchServerImage.ts`，所有會由 server 下載外部圖片的流程均改用它：

- 匯入商品圖片；
- Sharp 批次處理；
- 圖片 finalize；
- 詳情圖合成；
- OpenAI 回傳圖片 URL 的下載。

防護內容包括：初始 URL 與每次 redirect 都重新驗證、DNS 解析後封鎖 private／metadata 網段、限制 redirect 次數與下載大小、逾時、只接受圖片 content type，並以圖片檔案特徵做最後驗證。這會避免資料庫或請求中保存的 URL 讓伺服器去讀取內網資源。

### P1 — service-role 路由的請求授權邊界

新增 `src/lib/api/requestPrincipal.ts`，把登入 session、worker token、角色與 RLS 範圍判斷集中處理。

- 使用者 session 進入 service-role 寫入前，先透過使用者自己的 RLS client 驗證 draft ID；
- 批次操作只保留 RLS 可讀到的 canonical IDs；
- worker token 仍可處理背景任務，但不會讓無效 Bearer token 退回成一般 session；
- 8 個草稿／圖片操作路由已改接這個邊界；
- AI 圖片處理寫入 batch header 前，額外驗證 batch 與 draft 的成員關係。

新增 source migration：
`20260902090000_guard_current_image_batch_pointer.sql`。它將 `current_image_batch_id` 納入既有敏感草稿欄位 guard，防止一般 client 直接改指向其他圖片批次。

## 2. 已執行的本機證據

以下檢查均在本機 working tree 通過：

1. `pnpm install --frozen-lockfile`
2. `pnpm run typecheck`
3. `pnpm run verify:service-role-auth`
4. `pnpm run verify:secure-image-fetch`
5. `pnpm run verify:cap1`
6. `pnpm run verify:batch-archive-authorization`
7. `pnpm run verify:supabase-migration-baseline`
8. `pnpm run verify:static`、`verify:requirements`、`verify:contracts`、`verify:sql-schema`、`verify:no-secrets`、browser/client secret policy 與 `git diff --check`

既有 D3/D4、SYN1、P4 與 Shopify lifecycle source verifiers 亦已通過。`verify:all` 的全部子檢查已用分段方式完成；完整單一程序在本機時間限制前已跑過可見項目，故此文件不將它標示為新的單一命令 pass。

## 3. 未完成且不得誤標為完成的事項

- 本包已 commit 為 `f0a6bfa`，位於 `codex/security-hardening-20260902`／Draft PR #10；尚未 merge／部署 production，也沒有更動 production Supabase；
- `20260902090000_guard_current_image_batch_pointer.sql` 尚未套用到 production，必須與既有 active migrations 一起依 ledger 狀態規劃，不能重跑 `001–039` 歷史檔；
- `20260822223100_variant_split_override_semantics.sql` 已由正式 migration ledger 外部核對為**尚未套用**；
- `next build` 雖無法在本機完成（Google Fonts 網路／權限阻擋），GitHub CI #372 已在可連網 runner 成功跑完 frozen install、`verify:all`、typecheck、build；
- 2026-09-02 Vercel read-only verification：production alias 是 `READY` 的 `6960a0c`；本包 `f0a6bfa` 僅有 `READY` Preview，沒有 production deployment；
- Shopify mock publish 與 owner 明確批准後的一筆 controlled real-product E2E 都仍未執行。

## 4. 後續建議順序

1. Review Draft PR #10 的 Preview runtime 行為；
2. 規劃並在明確批准後套用 active migrations（先 `20260822223100`，再依相依性處理 `20260902090000`）；
3. 完成 Shopify mock，再由 owner 明確批准 controlled real-product E2E；
4. 以獨立 hardening scope 設計 14 個 existing Supabase Security Advisor warnings 的修補，不直接 revoke 已在用的 RLS helpers。
