# UIUX 指揮交接

> **最後更新**：2026-07-19（補齊 A–D／BX-P1／iframe 同步）  
> **完整同步檔（其他對話必讀）**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色（§0）

| 角色 | 職責 |
|---|---|
| UIUX 指揮（Grok） | 排程、T 帳本、骨架、本輪代理實作 |
| Claude UIUX 審查 | 設計規格段＋收工核畫面 |
| Fable | 系統／prompt／資料／發布 |
| 老闆 | 定案、BX-P2 截圖（**T106 已定不改**） |

## 進度快照

| 區 | 狀態 |
|---|---|
| 主線 A～S | ✅ |
| T74–T119（AA～AC 等） | **程式已寫，待 Claude 核畫面** |
| UX-AE T131–T136 | **程式已寫，待 Claude 核畫面**（第十三～十五批） |
| BX1–BX10 | ✅（含站② **▶ 逐件標圖**） |
| A19 雙尺寸上傳 | ✅ 程式＋DB；migration **039 老闆已跑** |
| D9 商品頁預覽 | ✅ 示意 tab + Shopify 官網 iframe（擋則新分頁） |
| BX-P 第一刀 | ✅ 儀表板並排／去重複估算 chip；**第二刀等截圖** |
| SYN-1 站②生成詳情圖 UI | ✅ |
| T112-r3 胖鈕 | ✅ |
| git | 功能曾收口 `34ab4d3`；**後續 A19／iframe／BX-P1／站②逐件可能未 commit**；分支超前 origin、**未 push** |
| Fable 債 | **T105** 按鈕 class 全收斂；**T84** CSS modules |
| 老闆 | **BX-P2** 截圖（T106 不改名已結） |

## 本輪 commits（已入庫功能）

- `0ed471f` — AA–AC 質感／a11y 等 ＋ T112-r3  
- `04f35c1` — SYN-1 生成詳情圖 toggle ＋ BX5 busyLabel  
- `1658fbe` — 規格／工人指令／清單 docs  
- `34ab4d3` — BX2／6／7／9／10  

（A19／站②逐件／iframe／BX-P1 **以工作區＋施工清單為準**，勿假設已在上列 commit。）

## 關鍵新檔（勿漏）

- `src/lib/drafts/quickUndo.ts`（BX2）  
- `src/lib/drafts/generateCostHint.ts`（BX7）  
- `src/lib/drafts/toneMemory.ts`（BX10）  
- `src/components/review/ImageLightbox.tsx`（BX9）  
- `src/lib/images/clientImageResize.ts`（A19）  
- `src/lib/shopify/storefrontUrl.ts`、`clientStoreDomain.ts`（D9 iframe）  
- `supabase/migrations/039_image_dual_size_urls.sql`  
- Toast：`actionLabel` + `onAction`

## API 小改

- `POST /api/generate` → **`detectedIpName`**（BX10）  
- `GET /api/status` → **`shopifyStoreDomain`**（D9）  
- `analyze-images` 優先 **`vision_mid_url`**（A19）

## 一句話

**BX 加分＋站②逐件＋A19（039 已跑）＋D9 iframe＋BX-P1 已清；T74–T119 待 Claude 核。詳見同步檔。已 push。**

## 下一刀（勿重做已完成項）

1. Claude 核 AA～AC（T74–T119）畫面  
2. ~~老闆拍 T106~~ → **已定不改**（維持「審核」）  
3. Fable：T105／T84  
4. BX-P2 **等截圖再開**（勿無圖零碎美化）  
5. **不要重做**：BX2/6/7/9/10、SYN-1 toggle、站②逐件、A19、Shopify iframe、BX-P1、UX-BTN/S1–S5/BTN2–3  

