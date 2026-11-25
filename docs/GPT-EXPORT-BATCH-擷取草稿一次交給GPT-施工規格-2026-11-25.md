# GPT-EXPORT-BATCH：擷取草稿一次交給 GPT（施工規格，2026-11-25，Claude）

基底：`handoff/20261008-golive-spec` @ `2bdaf9e`。施工分支：`gpt/export-batch`。
前一包：`docs/GPT-HANDOFF-交給GPT原始匯出-施工規格-2026-11-02.md`（本包只在它上面加一顆批次鈕，其餘規則照舊）。

## 0. 為什麼要做

這週老闆不用 AI 生成，改用「交給 GPT」過渡流程。老闆現在的做法：

1. 在淘寶／天貓用外掛一件一件抓 → 每件變成一張**擷取草稿**（`source_type = 'capture'`、`status = 'pending_input'`），出現在「快速預覽 → 未完成草稿」。
2. 一件一件點開（整頁導到 `/drafts/new?draft=<id>`）→ 按「📤 送出給 GPT」→ 再回快速預覽點下一件。
3. 全部送完，再到右邊「交給 GPT」分頁勾選、匯出 CSV。

老闆要的是：**抓完 → 一次全部送出、一次匯出**，不用一件一件開、一件一件按，也不要畫面跳來跳去。

## 1. 改動總覽（只有這三件）

| # | 改什麼 | 一句話 |
|---|---|---|
| A | 「交給 GPT」分頁頂端加一條「全部送給 GPT」 | 把我還沒送的擷取草稿一次標成交給 GPT，送完自動勾好，老闆直接按匯出 |
| B | 「交給 GPT」分頁鈕的顯示條件和數字 | 有沒送的擷取草稿時也要出現，數字把它們算進去 |
| C | 單件「送出給 GPT」後不跳頁 | 只跳 toast，網址拿掉 `?draft=`，右邊分頁和手機分頁都不動 |

**不需要 migration。** `source_type` 欄位在初始 schema 就有（default `'manual'`），外掛匯入時寫 `'capture'`（`src/lib/import/mapCaptureFields.ts`）。

## 2. 什麼叫「還沒送的擷取草稿」

同時符合以下全部條件的 `product_drafts`：

- `source_type = 'capture'`
- `status = 'pending_input'`
- `gpt_handoff_at is null`
- `created_by = 目前登入者`（只送自己抓的；admin 切「全部成員」也一樣只算自己的）

依 `created_at` 新到舊，最多取 **100** 筆（跟匯出上限一致；超過的下一輪再送）。

手動輸入的半成品（`source_type = 'manual'`）**不算**，不要動到。

## 3. A — 「全部送給 GPT」列

### 3.1 資料來源（server）

`src/app/drafts/new/page.tsx`：在現有 GPT 清單查詢（約 136 行）旁邊，加一個查詢：

```ts
const { data: captureUnsentRows } = await supabase.from("product_drafts")
  .select("id")
  .eq("source_type", "capture")
  .eq("status", "pending_input")
  .is("gpt_handoff_at", null)
  .eq("created_by", user.id)
  .order("created_at", { ascending: false })
  .limit(100);
const captureUnsentIds = (captureUnsentRows ?? []).map((row) => row.id as string);
```

`captureUnsentIds: string[]` 一路往下傳：`page.tsx` → `WorkbenchPageClient`（新 prop，預設 `[]`）→ `DraftResultsPanel`（新 prop `captureUnsentIds?: string[]`，預設 `[]`）→ `GptRawList`（新 prop `captureUnsentIds: string[]`）。

### 3.2 新 API：`POST /api/drafts/gpt-handoff/batch`

新檔 `src/app/api/drafts/gpt-handoff/batch/route.ts`。

- Body：`{ draftIds: string[] }`。不是非空字串陣列 → 400 `請選擇要送出的擷取草稿`；超過 100 筆 → 400 `一次最多送出 100 件`。先去重。
- 沒登入 → 401 `請先登入`。
- 角色：照 `src/app/api/drafts/batch/archive/route.ts` 的寫法，用 `canOperate(profile?.role)`；不通過 → 403 `目前帳號沒有送出權限`。
- 用 service client 一次更新，**條件全部寫在 update 的 where 裡**（不是先讀再寫）：

```ts
const now = new Date().toISOString();
const { data, error } = await service.from("product_drafts")
  .update({ gpt_handoff_at: now, gpt_exported_at: null })
  .in("id", ids)
  .eq("created_by", user.id)
  .eq("source_type", "capture")
  .eq("status", "pending_input")
  .is("gpt_handoff_at", null)
  .select("id");
```

- `error` → 500 `送出失敗，資料未更新，請稍後重試`。
- 更新到 0 筆 → 409 `這些擷取草稿已經送過或有變動，請重新整理`。
- 成功 → 200 `{ sentIds: string[], skipped: number }`（`skipped = ids.length - sentIds.length`）。
- **只改這兩個欄位。** 不改 status、pipeline_stage、價格、款式、圖片，不 enqueue 生成，不呼叫 AI，不碰 Shopify。

### 3.3 畫面（`src/components/listing/GptRawList.tsx`）

**顯示條件：** `!exported && captureUnsentIds.length > 0`（只在「待匯出」篩選下出現；已匯出篩選、或沒有未送的擷取草稿時，整條不渲染）。

**位置：** 在現有 `pill-group`（待匯出／已匯出）**下面**、`rc-batch-strip` **上面**。

**結構（照抄，不准改 class、文字）：**

```tsx
<div className="notice gpt-capture-bar" role="status">
  <span>還有 {N} 件擷取草稿還沒送</span>
  <Button type="button" size="sm" variant="primary" disabled={Boolean(busy)} onClick={() => void sendAllCaptures()}>
    {busy === "send" ? "送出中…" : `全部送給 GPT（${N}）`}
  </Button>
</div>
```

- `N = captureUnsentIds.length`。
- `busy` 型別擴充成 `"export" | "archive" | "send" | null`；送出中時匯出、封存、勾選也一起 disabled（現有寫法本來就看 `busy`）。
- **不要確認框**：這個動作可以復原（點「回輸入區」改用 AI 生成就會離開清單），老闆要的是少按。

**CSS（`src/app/globals.css`，加在 `.results-batch-notice` 那段後面，只准加這一條，不准 `!important`）：**

```css
/* GPT-EXPORT-BATCH: 「全部送給 GPT」列 */
.gpt-capture-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  margin: 8px 0 10px;
}
```

手機版：靠 `flex-wrap` 換行，不准水平捲動。

### 3.4 按下去的流程

1. `setBusy("send")`，`fetch("/api/drafts/gpt-handoff/batch", { method: "POST", body: JSON.stringify({ draftIds: captureUnsentIds }) })`。
2. 失敗：toast（`"error"`）`送出失敗：<API 回的 error>`；連線錯（`TypeError`）→ `送出失敗：連線失敗，請稍後再試`；其他 → `送出失敗：請稍後再試`。然後 `router.refresh()`（409 時清單才會更新）。
3. 成功：
   - 把 `sentIds` 存進一個 ref（例：`pendingSelectRef.current = new Set(sentIds)`）。
   - toast（`"success"`）：`skipped === 0` → `已送出 {sentIds.length} 件，已幫你勾好，按「匯出原始 CSV」就能下載`；`skipped > 0` → 同一句後面加 `（{skipped} 件已送過或有變動，略過）`。
   - `window.dispatchEvent(new CustomEvent("nestory:gpt-handoff-changed"))`（DraftResultsPanel 既有監聽會 `router.refresh()`；**不要**另外再呼叫 `router.refresh()`，避免刷兩次）。
4. `finally { setBusy(null) }`。

**自動勾選：** 現有 `useEffect(() => { setSelected(new Set()); }, [exported, products]);` 改成：

```ts
useEffect(() => {
  const pending = pendingSelectRef.current;
  if (pending && !exported) {
    const ready = products.filter((p) => pending.has(p.id) && !p.gpt_exported_at).map((p) => p.id);
    if (ready.length) {
      pendingSelectRef.current = null;
      setSelected(new Set(ready));
      return;
    }
  }
  setSelected(new Set());
}, [exported, products]);
```

（refresh 回來、新送的商品出現在 `products` 之後才勾，勾的是這次送出的那批；以前就在待匯出、這次沒送的不勾。）

勾好之後老闆按**現有**的 `⬇ 匯出原始 CSV（N）` 就好，匯出流程完全不改。

## 4. B — 「交給 GPT」分頁鈕

`src/components/listing/DraftResultsPanel.tsx` 傳給 `StageFilterPills` 的兩個數字改成：

```ts
gptTotalCount={scopedGptProducts.length + captureUnsentIds.length}
gptPendingCount={scopedGptProducts.filter((d) => !d.gpt_exported_at).length + captureUnsentIds.length}
```

意思：只要有沒送的擷取草稿，分頁鈕就會出現；鈕上數字＝待匯出＋還沒送的擷取草稿。`StageFilterPills.tsx` 本身不改。

## 5. C — 單件「送出給 GPT」不跳頁

`src/components/listing/WorkspaceInputPanel.tsx` 約 1874 行 `if (handoffMode === "gpt") { ... }` 成功分支：

1. **先查清楚老闆說的「跳到交給 GPT 分頁」是哪段程式造成的**（我讀到的程式碼裡沒有明確切 `stage` 到 `"gpt"` 的地方；可能嫌疑：`router.refresh()` 時網址還帶著 `?draft=<剛送出的 id>`、`WorkbenchMobileShell` 的 pane 切換、sessionStorage `nestory:results-station` 記住了 `"gpt"`）。找到「送出 GPT 後才會觸發」的切分頁／導頁程式，**只准刪那段觸發**，回報寫出檔案、行號、原因。找不到就回報「找不到」，不要亂改別的。
2. 送出成功後，網址若帶 `draft` 參數，拿掉它（也拿掉 `notice`），其他參數（例如 `pane`）保留：

```ts
if (typeof window !== "undefined") {
  const params = new URLSearchParams(window.location.search);
  if (params.has("draft") || params.has("notice")) {
    params.delete("draft");
    params.delete("notice");
    const qs = params.toString();
    router.replace(qs ? `/drafts/new?${qs}` : "/drafts/new", { scroll: false });
  }
}
```

（`WorkspaceInputPanel` 已經有 `const router = useRouter()`，直接用。）這樣按 F5 不會把剛送出的那件又載回表單。

3. 現有 toast `已送到「交給 GPT」：<標題前 20 字>`、`resetForNextItem()`、dispatch `nestory:gpt-handoff-changed` 都**保留不動**。
4. 驗收標準：送出後①右邊卡片區停在原本的分頁（原本在「文案」就還是「文案」）②手機版停在「新增 → 輸入」③捲動位置不跳回頂端④表單清空可以抓下一件。

## 6. 不准做

- 不准加規格以外的按鈕、欄位、說明文字、確認框、動畫、顏色、自動切分頁。
- 不准改「交給 GPT」清單列的樣子、匯出 CSV 的內容／表頭／檔名、`/api/exports/gpt-raw`、`src/lib/csv/gptRawExport.ts`。
- 不准動 AI 生成、文案管線、生成佇列、`/api/generate`、`extension/`、`src/lib/import/**`、發布／同步、Shopify 任何寫入。
- 不准改 DB schema、不准新增 migration、不准跑 Supabase CLI。
- 不准新增 `!important`；CSS 只准加 3.3 那一條。
- 不准 deploy、不准合併、不准改正式站資料。本機 `.env.local` 是正式資料庫，**只能唯讀**，不准用它跑會寫入的測試。

## 7. 完成標準

1. 在 `scripts/verify-gpt-handoff.mjs` 補原始碼檢查（照檔案既有的 `read()` + `assert` 風格），至少：
   - `page.tsx` 的未送查詢含 `source_type`／`capture`、`pending_input`、`gpt_handoff_at` is null、`created_by`、`limit(100)`。
   - 新 route 的 update 帶 `.eq("created_by"`、`.eq("source_type", "capture")`、`.eq("status", "pending_input")`、`.is("gpt_handoff_at", null)`，且 update 物件只有 `gpt_handoff_at` 與 `gpt_exported_at` 兩個 key；有 100 筆上限與 409 訊息。
   - `GptRawList.tsx` 含 `gpt-capture-bar`、`全部送給 GPT（`、`還有 `…`件擷取草稿還沒送`、`送出中…`。
   - `WorkspaceInputPanel.tsx` 含 `params.delete("draft")` 與 `router.replace(`，且整個檔案**不含** `router.push(`（基底也沒有）。
   - `globals.css` 含 `.gpt-capture-bar`，且整個檔案 `!important` 出現次數仍是 12（基底 `2bdaf9e` 的數字）。
2. `npm run verify:all`、`npm run typecheck`、`npm run build` 全過。
3. 開 **Draft PR** 到 `handoff/20261008-golive-spec`，標題 `GPT-EXPORT-BATCH：擷取草稿一次交給 GPT`。PR 說明列出：改了哪些檔、第 5 節找到的跳頁原因（或「找不到」）、驗證結果。
4. 等老闆貼「Claude 審查 PASS」後才合併（squash 或 merge commit 照 repo 慣例）。**上線不歸 GPT 做。**
