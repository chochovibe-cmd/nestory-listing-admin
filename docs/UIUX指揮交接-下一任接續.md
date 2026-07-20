# UIUX 指揮交接

> **最後更新**：2026-07-20（補 UX-AF 第十六～十九批＋git 已 push）  
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
| UX-AD T127–T130 | **程式已寫，待 Claude 核畫面** |
| UX-AE T131–T136 | **程式已寫，待 Claude 核畫面**（第十三～十五批） |
| **UX-AF T137–T153** | **程式已寫，待 Claude 核畫面**（第十六～十九批；主線已清） |
| BX1–BX10 | ✅（含站② **▶ 逐件標圖**） |
| A19 雙尺寸上傳 | ✅ 程式＋DB；migration **039 老闆已跑** |
| D9 商品頁預覽 | ✅ 示意 tab + Shopify 官網 iframe（擋則新分頁） |
| BX-P 第一刀 | ✅ 儀表板並排／去重複估算 chip；**第二刀等截圖** |
| SYN-1 站②生成詳情圖 UI | ✅ |
| T112-r3 胖鈕 | ✅ |
| P7 T84/T105 | ✅ !important 清舊＋mini 遷移；**CSS modules 長期債**仍在 |
| UX-BTN／S1–S5／BTN2–6／SYS | ✅ |
| git | **已 push**；HEAD≈`be0010d`；與 origin 同步。Vercel Queued≠沒 push |
| 老闆 | **BX-P2** 截圖（T106 不改名已結） |

## 本輪 commits（近期 UX-AF／相關）

- `be0010d` — UX-AF 十九：error.tsx + loading skeletons + 待辦空 CTA  
- `c1c1168` — UX-AF 十八：reduced-motion + 手機頁進場 + toast 避 tabbar  
- `bdf5285` — UX-AF 十七：modal 動畫 + dark 影 + hover  
- `b9cd355` — UX-AF 十六：focus／error 光暈／scrollbar／cursor  
- `ab8880a` — UX-AD+AE T122–T136  

（更早 BX／BTN／P7 見施工清單；完整表見同步檔 §1。）

## 關鍵新檔（勿漏；含 AF）

- `src/lib/drafts/quickUndo.ts`（BX2）  
- `src/lib/drafts/generateCostHint.ts`（BX7）  
- `src/lib/drafts/toneMemory.ts`（BX10）  
- `src/components/review/ImageLightbox.tsx`（BX9）  
- `src/lib/images/clientImageResize.ts`（A19）  
- `src/lib/shopify/storefrontUrl.ts`、`clientStoreDomain.ts`（D9 iframe）  
- `supabase/migrations/039_image_dual_size_urls.sql`  
- Toast：`actionLabel` + `onAction`  
- **`src/app/error.tsx`**（T146）  
- **`src/app/{dashboard,review,records,scouting}/loading.tsx`**（T147／T149）  
- **`docs/UIUX設計規格/UX-AF-設計規格.md`**

## API 小改

- `POST /api/generate` → **`detectedIpName`**（BX10）  
- `GET /api/status` → **`shopifyStoreDomain`**（D9）  
- `analyze-images` 優先 **`vision_mid_url`**（A19）

## 一句話

**BX＋A19＋D9 iframe＋BX-P1＋P7＋UX-AF T137–T153 程式已清並 push；T74–T153 待 Claude 核畫面。詳見同步檔。勿重做 AF／BX。**

## 下一刀（勿重做已完成項）

1. **Claude 核畫面**：T74–T153（可先 AF 十六～十九＋AD/AE，再 AA～AC）  
2. ~~老闆拍 T106~~ → **已定不改**（維持「審核」）  
3. ~~Fable：T105／T84 !important~~ → **P7 已完成**；剩餘僅 CSS modules 長期債  
4. BX-P2 **等截圖再開**（勿無圖零碎美化）  
5. **不要重做**：BX2/6/7/9/10、SYN-1 toggle、站②逐件、A19、Shopify iframe、BX-P1、UX-BTN/S1–S5/BTN2–6、**P7 T84/T105**、**UX-AF T137–T153**  
