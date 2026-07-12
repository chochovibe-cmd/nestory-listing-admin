# 交接指南（給接手的 Codex／Claude 或其他 AI 模型）

> 寫於 2026-07-08。前一階段由 Claude（Fable）完成規劃與 Mockup，接下來由你接手實作。
> 使用者是非技術背景的店主，請用白話跟他溝通，避免術語轟炸。

---

## 一、開工前必讀的三份文件（照順序讀）

1. `docs/實作脈絡總整理-2026-07-07.md` — 專案現況盤點：什麼做完了、什麼沒做、三個舊版本工具的關係
2. `docs/下一階段完整計畫-2026-07-07.md` — 完整計畫。**注意第七、八節（v7.2／v7.3 修訂）優先於前面章節**，有衝突以修訂為準
3. `docs/mockups/nestory-v7-mockup.html` — v7.4 前台 Mockup，**這是 UI 驗收標準**，用瀏覽器打開實際點過一遍再動手
4. `docs/自動化流程設計-2026-07-08.md` — Phase D 前必讀：Make/n8n 節點設計、批次通知邏輯、
   Showmore 圖片決策樹、口袋清單一鍵存入、「什麼跑在哪」速查表
5. `docs/文案生成架構與角色權限-2026-07-08.md` — Phase A 前必讀：generate/analyze-images 呼叫順序、
   串流×JSON 的坑、Prompt Caching、System Prompt 修改清單（含 ALT 規則產生）、文案風險預評估
   與黃金測試集、admin/operator 角色界線、儀表板優先序

不要去讀使用者轉貼的舊對話紀錄（CHOCHONEST v7、Cloudflare Worker 佇列版等是已放棄的舊方向）；
一切以上面三份文件＋這個 repo 的現有程式碼為準。

**repo 根目錄的舊計畫檔**（`nestory_codex_context_plan.md`、`nestory_new_chat_bootstrap.md`、
`chochonest-listing-tool-團隊版轉向整理.md` 等）為歷史文件，與 docs/ 新文件衝突時**一律以新文件為準**。
已知差異舉例：舊版四角色（Admin/Operator/Reviewer/Service Worker）已演化為三角色
（admin/operator/viewer，Reviewer 因「誰上架誰審到底」的單人一條龍決策併入 operator；
Service Worker＝WORKER_API_TOKEN 後端機制不變，見【文案·四】）。

## 二、施工順序（不要跳步、不要重排）

```text
Phase A｜後端補洞（先做，不動版面）
  A1 Shopify 真實發布：關 SHOPIFY_PUBLISH_MOCK、接 Admin API token（放 Vercel 環境變數）
     第一階段只建 DRAFT＋回填 product ID／後台連結
  A2 Vision 接入：主圖+詳情圖 → image_description；規格圖 OCR → spec_text；
     兩者傳給 CopyProvider（specText 目前沒接線，見 /api/generate/route.ts）
  A3 技術修正：max_tokens 1500→3000+；更新預設模型（保持 env 可覆蓋）
  A4 查重 API（網址比對＋IP/角色/類型三維度）

Phase B｜前台流程重整（解決「圖片在文案之後」的順序顛倒）
  單一畫面流：圖片先選（背景上傳）→ 按生成才跑 上傳→Vision→文案→定價
  照 Mockup「新增商品」頁逐區實作（含利潤可改、特價/單一售價、圖片標記預設空白等）

Phase C｜App Shell：側邊收合選單（桌機，預設收合 icon 列）＋手機底部 tabbar＋設定分類收合
Phase D｜圖片 Pipeline 第二段＋圖片審核頁（滑桿比對、商品為單位卡片、佇列橫幅）
Phase E｜儀表板初版（上架數/成員/月預算/成本明細——成本要記到每筆 draft_id）
Phase F｜選品情報（商家追蹤每週掃描＋口袋清單）
```

Phase A＋B 可以合成一包做。每個 Phase 完成要能預覽驗收才進下一個。

## 三、鐵則（違反任何一條都會出事）

1. **SQL 只產 `.sql` 檔**放 `supabase/migrations/`，編號接續現有（目前到 013）。**不要跑 Supabase CLI**，使用者會自己去 SQL Editor 貼
2. 敏感 key（Shopify token、AI key、service role key）只放伺服器端環境變數，**絕不進前端、絕不 commit**
3. 部署是 **Vercel**（不是 Cloudflare——舊文件寫 Cloudflare 的是過時決定，原因：圖片處理需要 sharp）
4. Tags/Collections 永遠由規則引擎（`src/lib/contentGenerator/` + `nestoryTagsV2.ts`）產出，不給 LLM 自由發揮
5. 文案生成＝同步呼叫；只有「圖片處理＋Shopify 發布」走 worker 背景機制
6. 不要把 LLM 輸出驗證寫成 reject-and-retry 硬擋，靠人工審核把關
7. 不要重做已完成的東西（schema 合併、contentGenerator、Provider 架構、UI 骨架都在了）
8. 每完成一步回報：完成什麼／改哪些檔案／下一步建議／需要使用者手動操作嗎（Y/N）
9. 不要直接 push／deploy，除非使用者確認；commit 用 checkpoint 習慣

## 四、程式碼裡的已知地雷（前人踩過的）

- `globals.css` 有三層疊加的主題覆蓋，最後一層常把 `box-shadow`／`border-color` 重設，
  「選中狀態看起來沒反應」時先查最終 computed style，不要先懷疑 JS
- `nestoryTagsV2.ts` 的 `mapSaleStatusTag()` 曾有 OpenCC 台/臺 轉換 bug（已修）；
  若重新同步老闆工具的 zip 會蓋掉修正，要重新檢查
- `image_description`／`spec_text` 欄位存在但**從沒有人寫入**（Vision 沒接），這是 Phase A2 要解的
- 現有 `WorkspaceInputPanel.tsx` 的 stage 機制（先生成才給傳圖）就是 Phase B 要拆掉的東西

## 五、視覺系統約定（實作 CSS 時遵守，Mockup 已示範）

- 使用者選取＝`.sel`（accent 外框／ring／fill）；系統狀態＝`.schip`（透明／淡底＋狀態色字＋淡框，非實心）；狀態色：灰=未開始/黃=進行中/綠=完成/紅=失敗
- 框線兩級：外層面板＋CTA 用深色，內層元素用 `--line-soft` 淡線＋柔陰影；卡片內欄位不加框，用留白＋字重分層
- 狀態用全文字（「文案已生成・待審核」），不用縮寫
- 關鍵操作 icon 用 SVG（lucide），emoji 只留裝飾
- 主題預設淺色，localStorage 記住選擇；按鈕 hover 微浮起、active 微縮

## 六、需要使用者準備的東西（依 Phase）

- Phase A：Shopify Admin API token（custom app，商品讀寫權限）→ 設進 Vercel
- Phase A：OpenAI API key（Vision 用，GPT-4o-mini 等級）→ 已有 ANTHROPIC/OPENAI key 的話沿用
- Phase D：Image Provider key（GPT Image）
- Phase E：GSC 網站驗證（可後補）
- Phase F：Hostinger VPS＋n8n（最後才需要）

## 七、最終體檢發現的待補事項（2026-07-08，實作時要處理）

### ⚠ 技術風險（Phase A 就要面對）

1. **Vercel 函式逾時**：第一段是同步流程（Vision＋LLM 串流可能 15–40 秒），免費方案預設 10 秒截斷。
   解法擇一或並用：Vision 與文案拆成兩支 API 分開呼叫／文案路由改串流回應（設 `maxDuration`）／升級 Pro。
   **實測一件商品的完整耗時後再決定**，不要假設能跑完。
2. **Vercel 4.5MB 請求上限**：所有圖片（商品圖、截圖辨識）一律**瀏覽器直傳 Supabase Storage**，
   API 只收 URL，不收檔案本體（老闆工具的多圖上傳 bug 就是這個原因）。
3. **Shopify API 限速**（每秒 2 請求）：批次匯入要逐件排隊送，含圖片 stagedUpload 更要控速。

### 流程缺口（排進對應 Phase）

4. 商品**刪除／封存**入口（archived 狀態已存在，缺 UI）——Phase B 順手做
5. 文案欄位**直接手動編輯**（不只切版本/重生；手改內容也存成一個版本進 generation_history）——Phase B
6. 「一鍵新增角色/tag」**治理**：成員新增的先標待整理，Admin 在設定頁有合併確認清單——Phase C 之後
7. 已上架商品**下架**按鈕（商品庫內，轉 Shopify 草稿狀態）——Phase D 之後

### 圖床架構（2026-07-08 定案：Supabase＝暫存工作區、Shopify Files＝永久圖床，全免費方案可行）

使用者不升級 Vercel Pro、不升級 Supabase。圖片流程如下，實作時照做：

1. **輸入時**：原圖瀏覽器直傳 Supabase Storage（暫存），公開 URL 餵給 Vision（API 只收網址）
2. **第二段處理**：sharp 在 Vercel「一張圖一次函式呼叫」（秒級不逾時）；AI 去字/重生由 Make/Codex
   直接呼叫 Image API（長等待不經過 Vercel）
3. **最終 WebP 上傳 Shopify Files**：`stagedUploadsCreate`（拿暫存上傳網址，小 JSON）→ 檔案直傳
   Shopify 儲存桶（不經 Vercel）→ `fileCreate` 註冊 → 取得 cdn.shopify.com 永久 URL → URL 字串存回
   `product_images.processed_file_url`
4. **發布**：`productCreateMedia` 掛已在 Files 的圖；Matrixify CSV 填 Shopify CDN URL；
   Showmore 由瀏覽器端 JSZip 抓 CDN 圖打包（不經 Vercel）
5. **清理（關鍵，沒做這步 1GB 會爆）**：商品 published 或 archived → 自動刪 Supabase 暫存原圖；
   被拒絕重生的舊版圖 → Shopify `fileDelete`。1GB ≈ 同時 60 件在途商品，rotating buffer 永遠夠
6. 規格參考圖／詳情參考圖只給 AI 看，不進 Shopify，隨暫存區清除；
   只上 Showmore 的商品圖一樣放 Shopify Files（商店層級檔案庫，與商品是否上架無關）
7. Shopify token 權限要包含 **write_files**（使用者建 token 時提醒他勾）

### 效能基準（A14 真品實測時逐項量測，不達標就回頭查對應項目）

| 動作 | 目標 | 慢了先查 |
|---|---|---|
| 頁面載入（佇列/工作檯） | <2 秒 | A18 區域對齊、A19 縮圖策略、字體改 next/font |
| 按生成 → 第一個字出現 | <8 秒 | Vision 是否平行、A19 中圖是否就緒、A20 往返次數 |
| 按生成 → 文案完整 | <30 秒 | max_tokens、模型選擇、Prompt Caching 是否生效 |
| 卡片列表捲動與縮圖 | 秒開 | A19（絕不可用原圖當縮圖） |
| 單件發布 Shopify | <10 秒 | 函式逾時、圖片是否已在 Files |
| 其他備忘 | — | Supabase 免費版閒置 7 天會暫停（開發空窗回來先去後台喚醒）；
  字體建議 next/font 自托管取代 Google Fonts 外連 |

### 實作備忘

- Email 通知建議用 Resend（Vercel 生態、免費額度夠）
- 匯率自動更新：免費 FX API 每日抓一次，僅顯示，套用由使用者按
- 手機長按拖曳：SortableJS 的 `delay` 選項
- 新資料表（口袋清單、追蹤商家等）都要補 RLS
- **真品實測關卡**：Phase A＋B 完成後，先用一件真商品跑完整條龍再開始量產
- 未來：PWA share-target 讓手機「分享→存入口袋清單」一鍵完成
- 備份習慣：每月一次全商品 Matrixify CSV 匯出當離線備份（Supabase 免費版備份能力有限）
- 錯誤監控：初期靠 Vercel logs＋generation_error 欄位；量大後可加 Sentry 免費版

### 上線後的優化方向（Phase F 之後，依價值排序，屆時再展開）

1. 訂單／庫存同步（Shopify webhook → 儀表板銷售數據＋現貨庫存自動扣減提醒）
2. 批量改價工具（匯率大變動時整批重算＋美化，沿用手動保護 ✎ 邏輯）
3. GSC 深度應用（曝光高零點擊商品的標題改寫建議、關鍵字缺口 → 選品連動）
4. AI 客服 FAQ bot（商品庫的 FAQ 資料現成，可餵給客服機器人回覆 LINE/網站提問）
5. 英文站／多語（Shopify Markets，文案管線加翻譯層即可，架構已相容）
6. 月報自動生成（儀表板數據 → AI 顧問寫成月報 Email 給老闆）
7. 官網文章工坊（AI 提案→品牌語氣長文→Shopify Blog 發布，規格見【文案·三之七】；
   使用者的「從宅文化到生活風格」一文為語氣黃金範例，要收錄進 prompt 素材）

## 八、給使用者的開場白範本（開新對話時貼這段）

```
請依序讀這兩份，其他文件等做到相關項目再讀：
1. docs/交接指南-給接手的AI模型.md
2. docs/施工清單.md（唯一進度真相）
讀完後告訴我：目前進度到哪、你這個 session 打算做清單上的哪 3–5 項、需要我準備什麼。
等我確認才動手。做完把清單打勾＋在進度筆記加一行。
SQL 只產檔不跑 CLI；不要 push 除非我說可以。
```

**交接使用守則（給使用者，解決「模型吸收不完全」的問題）**：
- **不要一次丟全部文件**——開場白只指定兩份，其他文件清單裡每項都標了代號，模型做到才讀
- **一個 session 只做 3–5 項**——做完就開新對話，長對話後段模型會遺忘前面的內容
- **每次收工驗收**：問模型「對照施工清單，念出你這次完成了哪幾項、哪些沒做完」——
  這句話會逼它自我對帳，漏做的當場現形
- 模型提出跟計畫矛盾的建議時，要求它「先引用文件的哪一節，再說你想改什麼」
- 模型選擇：清單項目規格已寫死，Sonnet 執行綽綽有餘；卡關除錯或架構判斷再換 Opus
