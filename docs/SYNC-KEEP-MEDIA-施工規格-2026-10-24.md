# SYNC-KEEP-MEDIA 施工規格 — 2026-10-24（Claude 指揮）

> 施工：GPT（`gpt/sync-keep-media`，從 `docs/sync-keep-media-spec` 開）。驗收測試：`scripts/verify-sync-keep-media.mjs`（Claude 先寫好，**不准改弱、不准刪**）。
> 這包**沒有任何 UI 變更**。只動下面「改哪些檔」列出的檔案。

## 1. 為什麼要做（白話）
SYNC-ROLLOUT 第 6 批 6 件同步不了，另外 1 件測試商品只同步了一半：
1. **Shopify 圖庫裡有工具不送的圖**：3c67c42b 329f516c 8b3a323e b9400278 8b3a35b9 是 10-08 前發布的，當時把詳情圖也放進了 Shopify 圖庫。同步只送主圖＋款式圖，所以會把那些圖當成「要刪」→ 409（3c67c42b 會刪 20 張）。
2. **工具有 Shopify 沒有的圖**：6ede08ef 工具多 1 張主圖，同步會把它補上去。老闆原則（10-24）：**這些商品的圖片以 Shopify 為準**，不刪、不補、不換。
3. **YouTube 影片比對錯**：工具送 `https://www.youtube.com/watch?v=ID`，Shopify 存成 `https://youtu.be/ID`。結果第一次加影片時回讀報 `readback_mismatch`（ae962018 實際發生），之後每次同步都會把同一支影片當成「刪掉再加」。

## 2. 做法（定案，不要改設計）
- `product_drafts` 加一個欄位 `shopify_media_mode`：`'tool'`（預設，維持現在行為）／`'shopify'`（圖片以 Shopify 為準）。migration 檔已寫好：`supabase/migrations/20261025100000_shopify_media_mode.sql`（含把第 6 批 6 件設成 `'shopify'`）。**不要改這個檔。**
- `shopify_media_mode = 'shopify'` 時，完整同步對 Shopify 圖片／影片**完全不動**：不新增、不刪除、不替換、不改 alt，也不改寫工具的 `product_images` 對應欄位。文字、款式、價格、SKU、成本、metafield 照常同步。成功時 `warnings` 回傳固定一句（見 §3）。
- 模式**只從資料列讀**（`draft.shopify_media_mode`），不從 request body 讀；值不是 `"shopify"`（null、空字串、大寫、其他字）一律當 `'tool'`。
- 外部影片比對一律用新函式 `videoIdentityKey()`（YouTube 轉成標準網址；其他網址只 trim）。
- 程式不依賴 migration 先套：欄位不存在時讀到 `undefined` → 當 `'tool'`，行為跟現在一樣。

## 3. 改哪些檔（只准動這些）
| 檔案 | 改什麼 |
|---|---|
| `src/lib/media/videoUrls.ts` | 檔尾新增 `videoIdentityKey` |
| `src/lib/shopify/syncShopifyProduct.ts` | 下面 7 處，其他行一行都不要動 |
| `src/types/domain.ts` | `ProductDraft` 加一行型別 |
| `package.json` | scripts 加 `"verify:sync-keep-media": "node scripts/verify-sync-keep-media.mjs"`（放在 `verify:sync-fix` 下一行） |
| `scripts/verify-all.mjs` | 清單最後（`"scripts/verify-sync-fix.mjs"` 後面）加 `"scripts/verify-sync-keep-media.mjs"`，前一行補逗號 |

已在規格分支、**不要改**：`scripts/verify-sync-keep-media.mjs`、`supabase/migrations/20261025100000_shopify_media_mode.sql`、本文件。

### 3.1 `src/lib/media/videoUrls.ts`（檔尾加）
```ts

/** Identity key for comparing external video URLs (Shopify stores YouTube as https://youtu.be/<id>). */
export function videoIdentityKey(raw: string): string {
  return canonicalizeYouTubeUrl(raw) ?? raw.trim();
}
```

### 3.2 `src/types/domain.ts`（`shopify_sync_baseline` 那行下面加一行）
```ts
  /** SYNC-KEEP-MEDIA (migration 20261025100000): 'shopify' = sync never touches Shopify media. */
  shopify_media_mode?: "tool" | "shopify";
```

### 3.3 `src/lib/shopify/syncShopifyProduct.ts`（照抄，位置用「找這段 → 換成」）
**① import**：在檔頭 import 區塊加 `import { videoIdentityKey } from "@/lib/media/videoUrls";`（跟其他 `@/lib/...` import 放一起）。import 區塊**全部結束之後**（第一個 `export type` 之前）加：
```ts
export const KEEP_SHOPIFY_MEDIA_WARNING =
  "圖片以 Shopify 為準：這次沒有新增、刪除或修改 Shopify 圖片／影片";
```

**② `verifyReadback` 的影片比對**：
```ts
  const remoteVideos = new Set(
    remote.media.nodes
      .filter((media) => media.mediaContentType === "EXTERNAL_VIDEO")
      .map((media) => media.originUrl)
      .filter((value): value is string => Boolean(value))
      .map(videoIdentityKey)
  );
  for (const url of desiredVideoUrls) {
    if (!remoteVideos.has(videoIdentityKey(url))) mismatches.push(`media.externalVideo:${url}`);
  }
```
（mismatch 字串維持原本的 `url`，不要改成 key。）

**③ `syncShopifyProduct` 裡 `const imageMatch = matchImages(` 那段**換成：
```ts
  const keepShopifyMedia = draft.shopify_media_mode === "shopify";
  const syncedVideoInputs = keepShopifyMedia ? [] : desiredVideoInputs;
  const imageMatch = keepShopifyMedia
    ? { desired: [] as DesiredImage[], identityError: null }
    : matchImages(
        images,
        imageMediaInputs,
        before.media.nodes,
        images.some((image) => Boolean(image.shopify_media_id))
      );
```
（上面的 `image_payload_mismatch` 檢查保留不動。）

**④ 影片配對與移除清單**：
```ts
  const desiredVideoUrls = syncedVideoInputs.map((item) => item.originalSource);
  const desiredVideoKeys = new Set(desiredVideoUrls.map(videoIdentityKey));
  for (const remote of before.media.nodes) {
    if (
      remote.mediaContentType === "EXTERNAL_VIDEO" &&
      remote.originUrl &&
      desiredVideoKeys.has(videoIdentityKey(remote.originUrl))
    ) {
      matchedMediaIds.add(remote.id);
    }
  }
  const mediaRemovals = keepShopifyMedia
    ? []
    : before.media.nodes.filter(
        (item) =>
          (item.mediaContentType === "IMAGE" || item.mediaContentType === "EXTERNAL_VIDEO") &&
          !matchedMediaIds.has(item.id)
      );
```

**⑤ `requestSummary`**：在 `videoCount` 那行改成 `videoCount: syncedVideoInputs.length,`，並在它下面加一行 `mediaMode: keepShopifyMedia ? "shopify" : "tool",`。`requestHash` 那行**不要動**。

**⑥ `newMedia` 的影片過濾**：
```ts
      ...syncedVideoInputs.filter(
        (item) =>
          !before?.media.nodes.some(
            (remote) =>
              remote.mediaContentType === "EXTERNAL_VIDEO" &&
              Boolean(remote.originUrl) &&
              videoIdentityKey(remote.originUrl as string) === videoIdentityKey(item.originalSource)
          )
      )
```

**⑦ 回讀後的圖片重新配對＋成功回傳**：
```ts
    const rematchedImages = keepShopifyMedia
      ? []
      : matchImages(images, imageMediaInputs, after.media.nodes, false).desired;
```
最後的成功 return 換成：
```ts
    return {
      ok: true,
      productId,
      remoteUpdatedAt: after.updatedAt,
      warnings: keepShopifyMedia ? [KEEP_SHOPIFY_MEDIA_WARNING] : []
    };
```
`altUpdates`、`newImageItems`、圖片 identity 寫回那幾段**不用改**：`desiredImages`／`rematchedImages` 是空陣列時它們自然不做事。

## 4. 禁止
- 不准改任何 UI／元件／CSS、`shopify-resolve`／`shopify-diff` route、`publishDraftSafe.ts`、`payload.ts`、`shopifyMainImage.ts`。
- 不准把模式做成 request 參數、環境變數或全域預設。
- 不准改 `matchImages`、`verifyReadback` 的其他比對規則（圖片 alt、款式、metafield 都照舊）。
- 不准跑任何 SQL、不准連 Supabase 套 migration（老闆自己貼）。
- 不准新增 `!important`、不准動 `scripts/verify-sync-keep-media.mjs` 與 migration 檔。

## 5. 驗收
- CI（verify:all → typecheck → build）全綠；`verify:sync-keep-media` 17/17、`verify:sync-fix` 22/22。
- Claude 在本機用同一個測試檔＋逐行看 diff 審查（Claude 10-24 已用原型確認 17 項都能做到、既有 sync 測試不受影響）。
- 上線後順序：老闆在 Supabase 貼 migration → Claude 唯讀確認 6 件是 `'shopify'` → 老闆同意後 Claude 同步第 6 批、重送 ae962018。

## 6. 不在這包
- 工具畫面顯示「圖片以 Shopify 為準」標記／切換開關（之後若需要，排進 UIUX）。
- 把 Shopify 獨有圖收回工具。
