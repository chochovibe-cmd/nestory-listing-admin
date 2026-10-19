# WORKBENCH-UX 施工規格（2026-10-20）

> 指揮：Claude（設計／驗收）。施工：GPT。
> 分支：從 `origin/handoff/20261008-golive-spec`（78657f0，PR #57 合併後）開 `gpt/workbench-ux`；PR 的 base＝`handoff/20261008-golive-spec`；本規格檔（`docs/WORKBENCH-UX-施工規格-2026-10-20.md`）一起放進 PR。
> **規格沒寫的不要自己加**：不加 UI、不加 CSS、不加 migration、不加 env、不改發布／同步流程。遇到規格與程式碼對不上（行號漂移可以，函式／變數不存在不行）→ 停下回報，不要自己決定。
> 行號以 78657f0 為準，可能有 ±20 行漂移；以函式名／字串定位。

## 0. 老闆 10-19／10-20 拍板

| 題目 | 決定 |
|---|---|
| 範圍 | 這包做 WB-1～WB-4（合成一個 PR）；WB-5（快速預覽重設計、「未完成」清單、批次按鈕區）移到 UIUX-CARD-WORKBENCH，先畫 mockup |
| 輸入區預設（10-15 定案） | 第一次／沒有紀錄時＝**單一售價＋潮巢導購版**；之後**每台裝置記住上次自己點的選擇** |
| Shopify 主圖 | 「在工具裡排順序，Shopify 照這個順序；排第一的就是主圖，也可以自己指定；卡片小圖要是主圖」→ 發布規則不動（本來就是 main＋variant 依 sort_order，第一張＝主圖），改成工具裡**看得出來、點得到** |
| 誤建角色「波加曼、波克比」 | 停用（is_active=false，可復原），合併上線後由 GPT 執行，見 §7 |

正式資料依據（Claude 10-20 唯讀查）：
- 卡在 ⛔ 的 5 筆（copy_review）：`1b42068e`（巴衛、奈奈生）、`5f41b6a2`（波加曼、波克比）、`862841d8`（Hello Kitty, 酷洛米）、`fc859e0e`（Hello Kitty, 酷洛米, 大耳狗, 帕恰狗）、`32ea56ad`（酷洛米、帕恰狗、美樂蒂、布丁狗）。原因：AI 回的角色是一整串，`character_name` 存整串、tag 字典比對整串 → 對不到 → `warnings` 寫「角色「整串」尚未建立 V2 字典…」→ ⛔。
- `ip_characters` 有 1 筆誤建：id `243e29af-5f52-44a7-ba37-299bf926688b`（寶可夢／波加曼、波克比／pending／is_active=true）。
- 主圖與款式圖共用同一條 sort_order（例：`e98bc983` 雲朵小夜燈 sort 0＝款式圖、1＝主圖…）。未封存商品中 8 件第一張是款式圖（5 件已上架）。站②「主圖」分頁本來就把 main＋variant 混在同一排、可拖曳（`Station2ImagePanel.tsx` `isMainSubtabImage`），Shopify 照同一順序 → 只差卡片小圖與標示。

## 1. 範圍

| 代號 | 內容 |
|---|---|
| WB-1 | 角色 tag：多角色字串拆開比對；一鍵新增拒收整串；新增「重算 tags（不改文案）」，一鍵新增後自動跑 |
| WB-2 | 逐件審核：資料即時（單欄重生完就地換上）、不重置進度、其他彈窗開著時 Esc 不結束逐件；批次「標圖分流」失敗後自動重整 |
| WB-3 | 卡片小圖＝Shopify 主圖；圖片區標「⭐ Shopify 主圖」＋「設為主圖」；卡片「型態」欄改成編輯真正的 `product_type` |
| WB-4 | 輸入區預設＋每台裝置記住；生成／重生完成的卡片閃一下 |

### 不做（防止擴張）
- 不改 `src/lib/shopify/**` 的發布／同步／圖片排序邏輯（唯一例外：§4.1 把 `isShopifyProductMediaImage` 搬家後 `payload.ts` 改成 re-export，行為不變）。
- 不刪 `src/components/drafts/DraftQueueList.tsx`（3 支 verify 腳本還在讀它，另包處理）。
- 不處理「卡片『23 保留』與 chips 重疊」（未定位，等老闆截圖，移後包）。
- 不做 WB-5 任何東西；不改快速預覽、批次按鈕區版面。
- 不做「一鍵新增 IP」；不改 ip_catalog。
- 已上架商品不提供重算 tags（之後由 1.5 RECONCILE 同步處理）。
- 不動 globals.css；不新增 class、顏色、圓角、陰影、`!important`。
- 不碰 `.tmp/`。

---

## 2. WB-1 角色 tag

### 2.1 新檔 `src/lib/characters/splitCharacterNames.ts`（client-safe，純函式）
```ts
/** WORKBENCH-UX WB-1: 「耿鬼、路卡利歐」「Hello Kitty, 酷洛米」→ 一隻一隻。不拆空白（Hello Kitty）。 */
export const CHARACTER_NAME_SEPARATOR_RE = /[、，,／/｜|＋+]+/;
export function hasCharacterNameSeparator(value: string | null | undefined): boolean
export function splitCharacterNames(value: string | null | undefined): string[]
```
- `splitCharacterNames`：`(value ?? "").split(CHARACTER_NAME_SEPARATOR_RE)` → 每段 `.trim()` → 去掉空字串與 `"不指定"` → 去重（保留第一次出現的順序）。
- `hasCharacterNameSeparator`：`CHARACTER_NAME_SEPARATOR_RE.test(value ?? "")`。
- 不拆空白、不拆 `&`、不拆「和／與」。

### 2.2 `src/lib/nestoryTagsV2.ts` `buildNestoryTagsV2Result`（約 :868 `rawCharacters`）
只改 `draft.characters` 那一段：
```ts
const rawCharacters = [
  ...(draft.characters ?? []).flatMap((value) => splitCharacterNames(value)),
  ...(draft.variants ?? []).flatMap((variant) => [ /* 原樣不動 */ ]),
].map(normalizeText).filter(Boolean);
```
variant 那段**不要**套拆分（不改既有行為）。

### 2.3 `src/app/api/generate/route.ts`
1. **搬家**：把 `toListingDraftInput`（約 :178）和它用的 `DetectedClassification` 型別搬到新檔 `src/lib/drafts/listingDraftInput.ts`（export），route.ts 改成 import。函式內容除 2.3-2 外一字不改。（route.ts 只能 export HTTP method，這是搬家原因。）
2. 搬家後的 `toListingDraftInput` 裡：`characters: detected.character ? [detected.character] : []` → `characters: splitCharacterNames(detected.character)`。
3. 約 :1030 `resolvedCharacter`：改成逐隻解析再用「、」接回：
```ts
const resolvedCharacter = splitCharacterNames(raw.detectedCharacterName)
  .map((part) =>
    resolveCanonicalCharacterName(part, {
      ipName: resolvedIp,
      ipCharacters: displayContext.ipCharacters ?? [],
      ipCatalog: ipCatalogEntries,
    }) ?? part
  )
  .join("、");
```
（空字串時結果為 `""`，與現狀相同。）

### 2.4 `src/lib/characters/missingCharacterWarnings.ts` `extractMissingCharacterNames`
比對到 `match[1]` 後，改成對 `splitCharacterNames(match[1])` 的每一段做「去重 push」。→ 舊草稿的「角色「Hello Kitty, 酷洛米」尚未建立…」會變成兩個名字、兩顆「一鍵新增」鈕（卡片兩處 UI 都是用這個函式，不用改 UI）。`isCharacterMissingInWarnings` 不改。

### 2.5 `src/app/api/characters/quick-add/route.ts`
在 `if (!characterName) {…}` 之後、驗證登入之前加：
```ts
if (hasCharacterNameSeparator(characterName)) {
  return Response.json(
    { error: "一次只能新增一個角色（名稱不能有「、」「，」「/」這類分隔符號）", code: "multi_character_name" },
    { status: 400 },
  );
}
```

### 2.6 新檔 `src/lib/drafts/recomputeDraftTags.ts`（純函式，不碰 DB）
```ts
export const TAG_DICT_WARNING_PATTERNS: RegExp[]   // 下列 6 條
export function isTagDictWarning(text: string): boolean
export function hasTagDictWarnings(warnings: string[] | null | undefined): boolean
export function buildRecomputedTags(existingTags: string[], derivedTags: string[]): string[]
export function buildRecomputedWarnings(
  existingWarnings: string[] | null | undefined,
  derivedWarnings: string[],
  opts: { ipInCatalog: boolean }
): string[]
```
- `TAG_DICT_WARNING_PATTERNS`（比對前先去掉開頭的 `⚠⛔🔍` 與空白，同 `warningTiers.ts` `normalizeWarningText` 的作法）：
  1. `/^角色「[^」]+」尚未建立\s*V2\s*字典/`
  2. `/^角色「[^」]+」尚未建立正式\s*tag_rules/`
  3. `/^角色「[^」]+」尚未建立二手\s*tag_rules/`
  4. `/^角色「[^」]+」尚未建立\s*tag_rules/`
  5. `/^IP「[^」]+」不在 V2 IP 字典中/`
  6. `/^待收編類型：/`
- `hasTagDictWarnings`：任一條 warning 符合上面 6 條。
- `buildRecomputedTags`：
  - `derivedHasType = derivedTags.some(t => t.startsWith("類型_"))`
  - `keep = existingTags.filter(t => !(derivedHasType && t.startsWith("類型_")))`（新算出有 類型_ 才取代舊的；新算不出就保留舊的）
  - `add = derivedTags.filter(t => t.startsWith("IP_") || t.startsWith("角色_") || t.startsWith("類型_"))`
  - 回傳 `sortNestoryTags(dedupeNestoryTags([...keep, ...add]))`（從 `@/lib/nestoryTagsV2` import）。
  - **只加不刪**：IP_／角色_ 舊 tag 一律保留（老闆可能手動加過）；其他前綴完全不動。
- `buildRecomputedWarnings`：
  - 從舊 warnings 移除符合 `isTagDictWarning` 的；
  - 若 `opts.ipInCatalog === true`，再移除符合 `/^AI 判斷 IP「[^」]+」不在建檔清單中/` 的；
  - 接上 `derivedWarnings`；用 Set 去重保持順序。其他 warning（價格、查重、款式…）一律保留。

### 2.7 新 API `src/app/api/drafts/[id]/recompute-tags/route.ts`（只 export `POST`）
權限照抄 `src/app/api/drafts/[id]/request-revision/route.ts` 開頭：`resolveRequestPrincipal` → 非 session 回 401 → `loadAuthorizedDraft`。然後用 `createServiceSupabaseClient()`：
1. `select("*")` 讀 `product_drafts` 該筆；讀不到 404 `{ error: "Draft not found" }`。
2. `status === "archived"` → 409 `{ error: "已封存的商品不能重算 tags", code: "archived" }`。
3. `shopify_product_id` 有值 → 409 `{ error: "已上架商品不能在這裡重算 tags（之後由同步處理）", code: "published" }`。
4. 讀字典：`ip_catalog`（`select("ip_name,aliases").eq("is_active", true)`）、`ip_characters`（`select("ip_name,character_name,aliases").eq("is_active", true)`）；任一錯誤 → 500 `{ error: "讀取字典失敗：" + message }`。
5. `detected = { ip: draft.ip_name ?? "", character: draft.character_name ?? "", productType: draft.product_type ?? "", category: draft.detected_category ?? "", sku: draft.sku ?? "" }`；`payload = toListingDraftInput(draft, detected, null, draft.product_brand ?? null)`。
6. `result = buildNestoryTagsV2Result(payload, { ipCatalog, ipCharacters })`。
7. `nextTags = buildRecomputedTags(draft.tags ?? [], result.tags)`；`ipInCatalog = ipCatalog.some(e => e.ip_name === draft.ip_name)`；`nextWarnings = buildRecomputedWarnings(draft.warnings, result.warnings, { ipInCatalog })`。
8. `update({ tags: nextTags, shopify_tags: nextTags, warnings: nextWarnings, updated_at: new Date().toISOString() }).eq("id", id)`；錯誤 → 500 `{ error: "重算 tags 寫入失敗：" + message }`。
9. 回 200 `{ ok: true, tags: nextTags, warnings: nextWarnings, remainingDictWarnings: nextWarnings.filter(isTagDictWarning).length }`。
- **不呼叫任何 AI、不改任何文案欄位、不改 pipeline_stage／status**。

### 2.8 `src/components/listing/ResultCard.tsx`
1. 新 state：`const [recomputingTags, setRecomputingTags] = useState(false);`
2. 新變數（放在 `missingCharacters` 附近，約 :547）：
   - `const tagsSavedString = draft.tags?.join(", ") ?? "";`
   - `const hasUnsavedCardEdits = anyCopyDirty(copyDirty) || variantsDirty || tags !== tagsSavedString;`
   - `const canRecomputeTags = hasTagDictWarnings(draft.warnings) && !draft.shopify_product_id && draft.status !== "archived";`
3. 新函式 `async function recomputeTags(): Promise<boolean>`（放在 `quickAddCharacter` 前）：
   - `if (recomputingTags) return false;` `if (hasUnsavedCardEdits) { showToast("有未儲存的修改，請先按儲存再重算 tags", "warn"); return false; }`
   - `setRecomputingTags(true)`；`fetch(\`/api/drafts/${draft.id}/recompute-tags\`, { method: "POST" })`
   - 非 ok：`showToast(payload.error ?? "重算 tags 失敗", "error")`，回 false。
   - ok 且 `payload.remainingDictWarnings > 0`：`showToast(\`已重算 tags，還有 ${payload.remainingDictWarnings} 項角色／IP 不在字典\`, "warn")`；否則 `showToast("已重算 tags（文案沒有變）", "success")`。回 true。
   - catch：`showToast("重算 tags 連線失敗", "error")`，回 false。
   - finally：`setRecomputingTags(false)`；`router.refresh()`。
4. `quickAddCharacter` 成功分支（現在 `showToast(okMsg, "success")` 那裡）改成：
   - `hasUnsavedCardEdits` 為 true → `showToast(\`已新增「${characterName}」。有未儲存的修改，儲存後再按「重算 tags」\`, "warn")`，不重算。
   - 否則 → 不顯示原本的 okMsg，直接 `await recomputeTags()`（由它出 toast）。
5. 把 `canRecomputeTags`、`recomputingTags`、`hasUnsavedCardEdits`、`onRecomputeTags={() => void recomputeTags()}` 傳給 `ResultCardCopyPanel` 和 `ResultCardTagsPanel`（兩處呼叫點約 :3073 與 :3192）。

### 2.9 「重算 tags」按鈕（兩處，同一顆樣式）
按鈕本體（兩處完全一樣）：
```tsx
<Button
  size="sm"
  variant="secondary"
  disabled={recomputingTags || hasUnsavedCardEdits || regenerating}
  onClick={onRecomputeTags}
  title={hasUnsavedCardEdits ? "有未儲存的修改，請先儲存" : "字典補好後重新檢查角色／IP／類型 tag；不呼叫 AI、不改文案"}
  type="button"
>
  {recomputingTags ? "重算中…" : "重算 tags（不改文案）"}
</Button>
```
- **位置 A**：`src/components/listing/result-card/ResultCardCopyPanel.tsx`，「AI 偵測」那個 `rc-field` 裡。`canRecomputeTags` 為 true 時，在現有 `rc-quick-add-list` 的**最後一列之後**加一列 `<div className="rc-quick-add-row">{按鈕}</div>`；若 `missingCharacters` 是空的（例如只有 IP 不在字典），就自己渲染 `<div className="rc-quick-add-list"><div className="rc-quick-add-row">{按鈕}</div></div>`。`regenerating` 在這個元件用它現有的 `regenerating || regeneratingField != null`。
- **位置 B**：`src/components/listing/result-card/ResultCardTagsPanel.tsx`「提醒」`rc-field` 裡，三個分組 map 結束之後、`rc-field` 結束之前，`canRecomputeTags` 為 true 時加 `<div className="rc-warning-line">{按鈕}</div>`。
- 不加任何說明小字（說明放 title）。不新增 class。

---

## 3. WB-2 逐件審核不被打斷

### 3.1 根因（Claude 已確認的部分）
`DraftResultsPanel.openSequentialReview`（約 :1676）把 `{draft, images, variantPrices}` **拍照存成 state**；之後 router.refresh 帶來的新資料不會進逐件畫面。ResultCard 只在 `draft.updated_at` 變了才把欄位同步（ResultCard 約 :805），快照的 updated_at 永遠不變 → 單欄重生寫回 DB 後，逐件畫面裡還是舊文案。

### 3.2 `src/components/listing/DraftResultsPanel.tsx`
1. 把 `seqReviewQueue` state 換成：
```ts
const [seqReviewRound, setSeqReviewRound] = useState<{
  id: number;
  ids: string[];
  snapshot: Map<string, SequentialReviewQueueItem>;
} | null>(null);
const seqRoundCounterRef = useRef(0);
```
2. 新 memo `draftsById`（`new Map(drafts.map(d => [d.id, d]))`），新 memo `seqReviewQueue`：
```ts
const seqReviewQueue = useMemo<SequentialReviewQueueItem[]>(() => {
  if (!seqReviewRound) return [];
  return seqReviewRound.ids.map((id) => {
    const live = draftsById.get(id);
    if (!live) return seqReviewRound.snapshot.get(id)!;
    return { draft: live, images: imagesByDraft.get(id) ?? [], variantPrices: variantsByDraft.get(id) ?? EMPTY_VARIANT_PRICES };
  });
}, [seqReviewRound, draftsById, imagesByDraft, variantsByDraft]);
```
   （順序永遠照開場時的 ids；資料永遠用最新 props；props 裡找不到的那筆才用快照。）
3. `openSequentialReview`：組好 `queue` 後改成 `seqRoundCounterRef.current += 1; setSeqReviewRound({ id: seqRoundCounterRef.current, ids: queue.map(i => i.draft.id), snapshot: new Map(queue.map(i => [i.draft.id, i])) })`。
4. overlay `onClose`：`setSeqReviewRound(null)`（取代 `setSeqReviewQueue([])`）。
5. `<SequentialReviewOverlay>` 多傳 `roundId={seqReviewRound?.id ?? 0}`。

### 3.3 `src/components/listing/SequentialReviewOverlay.tsx`
1. props 加 `roundId: number`（必填），JSDoc 改成「order fixed at open; item data is live」。
2. 重置邏輯（約 :114-120）：`syncedQueue !== queue` 改成比 `roundId`：
```ts
const [syncedRoundId, setSyncedRoundId] = useState(roundId);
if (syncedRoundId !== roundId) {
  setSyncedRoundId(roundId);
  setReview(createSequentialReviewState(queue.map((item) => item.draft.id)));
}
```
   注意：首次 mount 時 `syncedRoundId === roundId`，review 是空的 → 為了開場能正確建立，初始值用 `useState(-1)`（任何真實 roundId 都 ≥1）。
3. 下一個 `useEffect` 的依賴 `[open, queue, isImageMode]` → `[open, roundId, isImageMode]`（不然每次 refresh 都會把分頁切回去）。
4. 快捷鍵 `onKeyDown` 第一行（`isComposing` 判斷之後）加：
```ts
// WB-2: another dialog (重生／版本／確認) is on top → its own Esc/keys win.
if (document.querySelector(".modal-overlay.open:not(.seq-review-overlay)")) return;
```
5. 傳給 overlay 內 `ResultCard` 的 `isJumpTarget={flashDraftId === current.draft.id}`（prop `flashDraftId?: string | null`，由 DraftResultsPanel 傳 §5.3 的 `doneFlashId`）。

### 3.4 「跳出」先重現再修（必做，寫進 PR 說明）
本機 `npm run dev`、右上角執行模式切「測試模式」（不花錢），站① 選 2 件以上 → 逐件審核 → 在第 1 件按任一欄位的單欄重生。修改前先記錄現象：(a) 跑完逐件畫面有沒有關掉；(b) 卡片內容有沒有換新。
- 若 3.2／3.3 改完後**不再跳出**：PR 說明寫「原因＝快照／Esc（擇一或兩者，寫你觀察到的）」即可。
- 若改完**仍會跳出**：在 `DraftResultsPanel` 暫時加 `useEffect(() => { console.log("DRP mount"); return () => console.log("DRP unmount"); }, [])` 確認是不是整個面板被重新掛載；**把觀察結果回報給 Claude 後停下，不要自己改面板結構**；暫時 log 不准留在 commit 裡。

### 3.5 批次「標圖分流」失敗後自動重整（`DraftResultsPanel.batchStationReview`，約 :985）
兩個失敗 `return` 前（`advance-ready` 失敗那個、`send-images` 失敗那個）各加一行 `router.refresh();`。原因：第一步可能已經把幾件移到待發布，畫面要跟上。不改其他文案與流程。

---

## 4. WB-3 卡片顯示對齊

### 4.1 新檔 `src/lib/images/shopifyMainImage.ts`（client-safe）
```ts
/** Shopify 商品圖＝main＋variant（詳情圖、spec 類型不送）。從 payload.ts 搬來，行為不變。 */
export function isShopifyProductMediaImage(image: { image_type: string }): boolean
/** 與 payload.ts buildShopifyProductPayload 相同：篩 isShopifyProductMediaImage、依 sort_order 由小到大（穩定排序）。 */
export function sortShopifyMediaImages<T extends { image_type: string; sort_order: number }>(images: T[]): T[]
/** Shopify 主圖＝sortShopifyMediaImages 的第一張；沒有就 null。 */
export function pickShopifyMainImage<T extends { image_type: string; sort_order: number }>(images: T[]): T | null
```
- `src/lib/shopify/payload.ts`：刪掉自己的 `isShopifyProductMediaImage` 定義，改成 `export { isShopifyProductMediaImage } from "@/lib/images/shopifyMainImage";`＋檔內 import 使用。**`buildShopifyProductPayload` 的排序那幾行不要改。** 其他檔（syncShopifyProduct、publishDraftSafe）照舊從 payload import，不要動。

### 4.2 卡片小圖 `ResultCard.tsx` `mainThumbUrl`（約 :212）
```ts
function mainThumbUrl(images: ProductImage[]): string | null {
  const first =
    pickShopifyMainImage(images) ??
    images.find((image) => image.image_type !== "detail") ??
    images[0];
  if (!first) return null;
  return first.list_thumb_url ?? first.processed_file_url ?? first.original_file_url ?? first.generated_file_url ?? null;
}
```

### 4.3 站②「主圖」分頁 `src/components/listing/Station2ImagePanel.tsx`
1. `const shopifyMainId = pickShopifyMainImage(images)?.id ?? null;`（`images`＝這個元件拿到的全部圖，不是分頁篩過的 list）。
2. 縮圖下方的 `<span className="imgmark-slot-label">{slot}</span>`：當 `subtab === "main" && image.id === shopifyMainId` 時，文字改成 `⭐ Shopify 主圖`（取代 slot 文字）；其他照舊。
3. 「設為主圖」：在 `imgmark-btns pthumb-tools` 那排四顆標記按鈕**之後**、同一個 span 裡，當 `subtab === "main" && image.id !== shopifyMainId` 時加：
```tsx
<button
  className="img-mark-btn"
  disabled={busyId === image.id}
  onClick={(e) => { e.stopPropagation(); void makeShopifyMain(image.id); }}
  onMouseDown={(e) => e.stopPropagation()}
  title="移到第一張，Shopify 會用這張當主圖"
  type="button"
>
  設為主圖
</button>
```
4. 新函式 `makeShopifyMain(imageId)`（放在 `applyReorder` 後面，寫法比照 `applyReorder`）：
   - `pool = images.filter(img => img.image_type === "main" || img.image_type === "variant" || img.image_type === "spec").slice().sort(sortByOrder)`（同 applyReorder 的 pool）
   - 把 `imageId` 那張從 pool 拿出來放到 index 0，其餘順序不變 → `reindexed = rebuilt.map((item, index) => ({ ...item, sort_order: index }))`
   - 樂觀更新 `onImagesChange(nextAll)`；`Promise.all` 逐張 `update({ sort_order })`（同 applyReorder）；失敗顯示同樣的 `排序儲存失敗：…` 訊息；成功 `showToast("已設為 Shopify 主圖", "success")`。
5. 例外提示：若 `subtab === "main"` 且 `shopifyMainId` 那張是規格圖（`isSpecImage` 為 true，所以不在這個分頁的 list 裡），在 strip（`imgmark-list imgmark-strip`）**上方**加一行 `<div className="price-soft-warn">⚠ 目前排第一的是規格圖，Shopify 會用它當主圖；想換就在要的那張按「設為主圖」。</div>`。
6. 拖曳、其他分頁（規格圖／詳情圖）完全不動。

### 4.4 站③ 圖片分頁 `src/components/listing/result-card/ResultCardImagesPanel.tsx`
只加標示、不加按鈕：`image.id === pickShopifyMainImage(全部 images)?.id` 的那張，`imgmark-slot-label` 文字改成 `⭐ Shopify 主圖`。（`全部 images`＝這個元件拿到的圖片 props，若只拿到 `pipelineImages`，就用它。）

### 4.5 卡片「型態」欄改成編輯 `product_type`
現況：「AI 偵測」顯示的「型態」是 `product_type`（Shopify 類別／productType／類型_ tag 都用它），但下方輸入框「AI 偵測類型」編的是 `detected_category`（下游幾乎沒用）→ 改了也沒效果。
1. `ResultCard.tsx`：`const [detectedCategory, setDetectedCategory] = useState(draft.detected_category ?? "")` 改成 `const [productType, setProductType] = useState(draft.product_type ?? "")`；`updated_at` 同步 effect 裡 `setDetectedCategory(...)` 改成 `setProductType(draft.product_type ?? "")`。
2. 儲存（約 :1091）：`detected_category: detectedCategory || null` 這行**刪掉**，改成 `product_type: productType.trim() || null`。（`detected_category` 欄位不再由卡片寫，DB 欄位保留。）
3. 儲存成功後（`markShopifyDirty()` 之後、成功 toast 之前）：若 `(productType.trim() || null) !== (draft.product_type ?? null)` 且 `!draft.shopify_product_id`，`await fetch(\`/api/drafts/${draft.id}/recompute-tags\`, { method: "POST" })`；失敗只 `showToast("型態已存，但 類型_ tag 沒更新，請到 Tags 分頁確認", "warn")`，不影響儲存成功。已上架的（有 `shopify_product_id`）不呼叫，toast 加一句：成功 toast 文字改成 `已儲存修改（型態已改，類型_ tag 請到 Tags 分頁確認）`。
4. `ResultCardCopyPanel.tsx`：props `detectedCategory`→`productType`、`onDetectedCategoryChange`→`onProductTypeChange`；輸入框 `<label>AI 偵測類型</label>` 改成 `<label>商品型態</label>`，`value={productType}`。位置、class 不變。
5. 其他用到 `detectTypeLabel` 的地方不動（它本來就優先顯示 `product_type`）。

---

## 5. WB-4 輸入區預設＋閃一下

### 5.1 新檔 `src/lib/drafts/workspacePrefs.ts`（寫法比照 `src/lib/drafts/toneMemory.ts`，localStorage、try/catch 吞錯）
```ts
export const WORKSPACE_PREFS_KEY = "nestory_workspace_prefs_v1";
export const FACTORY_DEFAULT_PRICE_MODE = "single" as const;
export const FACTORY_DEFAULT_TONE = "潮巢導購版";
export type WorkspacePrefs = { priceMode: "sale" | "single"; tone: string };
export function readWorkspacePrefs(storage: Storage | null | undefined, validTones: readonly string[]): WorkspacePrefs
export function writeWorkspacePref(storage: Storage | null | undefined, patch: Partial<WorkspacePrefs>): void
```
- `readWorkspacePrefs`：沒有／壞掉／值不合法 → 對應欄位用 FACTORY 預設；`priceMode` 只接受 `"sale" | "single"`；`tone` 必須在 `validTones` 裡。
- `writeWorkspacePref`：讀舊值 merge patch 再寫回。

### 5.2 `src/components/listing/WorkspaceInputPanel.tsx`
1. `DEFAULT_TONE = TONE_OPTIONS[0].value` 改成 `const DEFAULT_TONE = FACTORY_DEFAULT_TONE;`（並確認它在 `TONE_OPTIONS` 裡）；`useState<PriceMode>("sale")` 改成 `useState<PriceMode>(FACTORY_DEFAULT_PRICE_MODE)`；旁邊註解「預設特價」改「預設單一售價（WB-4，每台裝置記住）」。
2. 新 state＋ref：`const [preferredTone, setPreferredTone] = useState<string>(DEFAULT_TONE); const preferredToneRef = useRef(preferredTone);`（每次 render 同步 `preferredToneRef.current = preferredTone`）。
3. 新 mount effect（放在 CAP-2.5 server seed effect **之前**）：`if (initialFromServer) return;` → `const prefs = readWorkspacePrefs(localStorage, TONE_OPTIONS.map(t => t.value))` → `setPriceMode(prefs.priceMode); setTone(prefs.tone); setPreferredTone(prefs.tone);`。
4. **只有使用者親手點**才寫入：
   - `handlePriceModeChange(next)` 最後 `setPriceMode(next)` 之後加 `writeWorkspacePref(localStorage, { priceMode: next })`。
   - 語氣卡 `onClick={() => setTone(option.value)}`（約 :2663）改成 `onClick={() => { setTone(option.value); setPreferredTone(option.value); writeWorkspacePref(localStorage, { tone: option.value }); }}`。
   - 還原草稿、server seed、IP 記憶自動切換、連續上架 **都不寫**。
5. 原本跟 `DEFAULT_TONE` 比的三處改成跟裝置偏好比：
   - 約 :384 `tone !== DEFAULT_TONE` → `tone !== preferredTone`
   - 約 :1550 `fields.tone !== DEFAULT_TONE` → `fields.tone !== preferredToneRef.current`
   - 約 :1951 `if (current !== DEFAULT_TONE) return current;` → `if (current !== preferredToneRef.current) return current;`（IP 記憶仍優先於裝置偏好，但不蓋掉這次手動選的）
6. 價格模式兩顆按鈕的順序、文字、樣式不動。

### 5.3 生成／重生完成閃一下（`DraftResultsPanel.tsx`）
沿用既有 `.result-card.is-jump-target` 脈衝（globals.css `jumpPulse`，不改 CSS）。
1. 新 state `const [doneFlashId, setDoneFlashId] = useState<string | null>(null)`＋timer ref；`armDoneFlash(draftId)`：清舊 timer → `setDoneFlashId(draftId)` → 8000ms 後清回 null。**不捲動、不切站。**
2. 觸發：
   - 既有 `onProgress`（約 :295）裡：`model.visible && !model.error && model.steps.length > 0 && model.steps.every(s => s.status === "done")` → `armDoneFlash(model.draftId)`。
   - 新增監聽 `REGEN_QUEUE_STATUS_EVENT`（從 `GenerationQueueRunner` import 常數）：`detail.status === "completed"` → `armDoneFlash(detail.draftId)`。cleanup 要 removeEventListener。
3. 列表卡片（約 :2084）`isJumpTarget={jumpTargetId === draft.id || doneFlashId === draft.id}`；overlay 傳 `flashDraftId={doneFlashId}`（§3.3-5）。

---

## 6. 測試與施工規則

### 6.1 新檔 `scripts/verify-workbench-ux.mjs`，加進 `scripts/verify-all.mjs` 清單最後；`package.json` 加 `"verify:workbench-ux": "node scripts/verify-workbench-ux.mjs"`
載入方式照 `scripts/verify-shop-listing.mjs`（`register(publish-guard-loader.mjs)`，用真模組，不准測複製出來的 mirror）。必備案例：
- `splitCharacterNames`：`"耿鬼、路卡利歐、沙奈朵"`→3 個；`"Hello Kitty, 酷洛米"`→`["Hello Kitty","酷洛米"]`；`"皮卡丘、皮卡丘"`→1 個；`"不指定"`→`[]`；`null`→`[]`；`"Hello Kitty"`→1 個（不拆空白）。
- `buildNestoryTagsV2Result`：字典有 耿鬼／路卡利歐／沙奈朵，`characters: ["耿鬼、路卡利歐、沙奈朵"]` → tags 含 3 個 `角色_`，warnings 沒有「尚未建立」。
- `extractMissingCharacterNames(["角色「Hello Kitty, 酷洛米」尚未建立 V2 字典 canonical name，未輸出角色_ tag。"])` → `["Hello Kitty","酷洛米"]`。
- `buildRecomputedTags`：舊 `["定位_IP周邊","類型_吊飾掛件","角色_自己加的"]`＋新 `["IP_寶可夢","角色_耿鬼","類型_公仔模型","定位_收藏選物"]` → 含 `IP_寶可夢`、`角色_耿鬼`、`角色_自己加的`、`類型_公仔模型`，**不含** `類型_吊飾掛件`、**不含** `定位_收藏選物`（只收 IP_／角色_／類型_）、保留 `定位_IP周邊`；新算沒有 類型_ 時舊 `類型_吊飾掛件` 保留。
- `buildRecomputedWarnings`：移除 6 種字典 warning；保留一條價格 warning；`ipInCatalog:true` 移除「AI 判斷 IP「X」不在建檔清單中…」、`false` 保留。
- `hasCharacterNameSeparator("波加曼、波克比") === true`；quick-add route 原始碼含 `multi_character_name`。
- recompute-tags route：原始碼只 export `POST`；含 `shopify_product_id` 的 409 判斷；**不含** `openai`／`anthropic`／`/api/generate` 字樣。
- `pickShopifyMainImage`：`[{variant,0},{main,1}]` → variant 那張；`[{detail,0},{main,3},{main,1}]` → sort 1 的 main；`[]` → null；與 `buildShopifyProductPayload` 對同一組圖，payload 第一張 originalSource 對應的就是 pick 的那張。
- `readWorkspacePrefs`：空 storage → `{priceMode:"single", tone:"潮巢導購版"}`；壞 JSON → 同上；`{"priceMode":"sale","tone":"小編聊天口吻"}` → 照讀；tone 不在清單 → 用預設。（用假 storage 物件。）
- 原始碼斷言：`SequentialReviewOverlay.tsx` 含 `roundId`、含 `.modal-overlay.open:not(.seq-review-overlay)`、不再含 `syncedQueue !== queue`；`DraftResultsPanel.tsx` 的 `batchStationReview` 兩個失敗分支都有 `router.refresh()`；`ResultCard.tsx` 的 `mainThumbUrl` 用 `pickShopifyMainImage`、儲存不再寫 `detected_category`。

### 6.2 施工規則
- commit 訊息 `feat(workbench-ux): ...`／`fix(workbench-ux): ...`／`test(workbench-ux): ...`。
- 不新增 `!important`、不動 globals.css、不新增 class。
- `src/app/api/**/route.ts` 只能 export HTTP method。
- push 前本機（或你的沙盒）必跑並貼結果：`npm run typecheck`、`node scripts/verify-workbench-ux.mjs`、`npm run verify:all`、`npm run build`。任何一項失敗要寫原因，不得跳過。
- UI 自查（貼截圖到 PR）：站① 卡片「AI 偵測」有 ⛔ 角色時的按鈕列；Tags 分頁提醒區；站②「主圖」分頁（第一張是款式圖的商品，例如本機造一筆）；dark／nordic／kitty 三主題 ＋ 手機 375px 各一張主圖分頁截圖，確認「設為主圖」那排換行後沒有爆版、觸控高度 ≥44px 的既有規則沒被破壞。
- 回報格式：WB-1～WB-4 每項改了哪些檔案；§3.4 的重現結果；測試輸出摘要；截圖。

## 7. 上線後（GPT 執行，老闆已同意停用）
1. 唯讀確認：`select id, ip_name, character_name, review_status, is_active from ip_characters where id = '243e29af-5f52-44a7-ba37-299bf926688b';`
2. 停用：`update ip_characters set is_active = false, updated_at = now() where id = '243e29af-5f52-44a7-ba37-299bf926688b' and character_name = '波加曼、波克比';`（只動這一筆；回報影響列數＝1）。
3. 不刪資料、不動其他角色、不動那 5 筆草稿（老闆自己在卡片按「一鍵新增」或「重算 tags」）。

## 8. 指揮官驗收（Claude，唯讀）
- 那 5 筆草稿：老闆按完後查 `warnings` 不再有「角色「…、…」尚未建立」；`tags` 有對應 `角色_`；文案欄位（title_zh、description_html…）的 `updated_at` 前後內容不變。
- `ip_characters` 之後不再出現 `character_name ~ '[、，,/／]'` 的新列。
- 第一張是款式圖的那 8 件：卡片小圖＝Shopify 主圖。
