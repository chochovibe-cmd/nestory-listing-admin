# 三分支盤點與圖片 AI 改善施工規格（2026-10-08，指揮官 Claude）

> 給接手 AI（GPT / Codex / Claude）的施工規格。前置閱讀：`AI_START_HERE.md`、`docs/CURRENT_STATUS.md`、`AGENTS.md`、`docs/HANDOFF-上線收尾與優化施工規格-2026-10-07.md`。
> 本文件**不改變**上線主線（V1.0）的順序與三個授權閘門；排程、影片、圖片三條線都排在上線之後，除非店主另行批准。
> 鐵則沿用 `AGENTS.md`：不 push 主線、不 deploy、不動正式 DB、不寫真 Shopify、不呼叫付費 API，除非店主明確同意。SQL 只產 migration 檔。

## 0. 證據基準（2026-10-08 只讀盤點）

| 線 | 分支 | HEAD | PR | CI |
|---|---|---|---|---|
| 排程 | `agent/schedule-core-20261006` | `0bf0a9e` | #15 Draft | 紅 |
| 影片 | `gpt/youtube-video-phase2-20260930` | `17d5f5e` | #12 Draft | 紅 |
| 圖片 | `gpt/image-skill-low-api-20260930` | `32816db` | 無 PR | — |

- **CI 紅的根因（#15、#12 相同，非功能本身）**：typecheck / build 都過，失敗在 `node scripts/verify-all.mjs` → `scripts/verify-copy-c1-chaonest-sales-tone.mjs:246` `AssertionError: Boss hierarchy wrapper disappeared`。兩分支都不含主線 `585c99b`（PB1.4 已改寫該 verifier）。**修法：把目前主線 merge 進分支後重跑 CI。不要改 verifier 繞過。**
- **文字衝突試算**（`git merge-tree`）：三條線各自併進 `525b240` 皆無衝突；排程 × 圖片互併只有 `scripts/verify-all.mjs` 衝突（各加一行 verifier，兩行都保留即可）。
- **圖片分支整個包含影片分支**（影片 HEAD 是圖片的祖先）。圖片專屬 43 個 commit（`0994302` 起）**完全沒碰** youtube / video / publish 檔案，可乾淨拆出。
- 語意重疊檔：`src/lib/shopify/payload.ts`（排程、圖片都改）、`publishDraftSafe.ts` / `syncShopifyProduct.ts`（排程、影片都改）、`ResultCard.tsx`（排程改；上線線 PERF P1A 也會改）。合併後必須重跑 `verify:all`、`typecheck`、`build`。

## 1. 建議合併順序

1. **上線主線 V1.0 先完成**（依 10-07 規格，不受本文件影響）。
2. **排程 #15**：同步主線 → CI 綠 → 做完 §2 的 SCH-1～SCH-3 → 以「三個執行旗標全關」狀態合併。
   - 時機：最好在 PERF P1A 動 `ResultCard.tsx` **之前**合，否則等 P1A 合完再同步；兩包不可同時改 `ResultCard.tsx`。
3. **影片 #12**：做完 §3 的 VID-1～VID-4 → 同步主線 → 合併（`YOUTUBE_AUTO_UPLOAD` 預設關）。
4. **圖片**：影片合併後，主線 merge 進圖片分支即可只剩圖片差異；**若店主要圖片先於影片**，則從主線開新分支 `cherry-pick 0994302..32816db` 的 43 個圖片 commit（不得帶入影片 commit）。之後依 §4 分階段施工。

## 2. 排程線必修（`agent/schedule-core-20261006`）

行號為只讀審查時的近似位置，施工前以實際檔案為準。

### SCH-1｜真正接上定時執行（P0）
- 現況：`vercel.json` 的 `crons` 只有 `/api/cron/fx`、`/api/cron/stuck-batches`，**沒有** `/api/cron/scheduled-publish`。旗標打開也不會自己跑。
- 做法：加入 cron 項目；先查 Vercel 現行方案（Hobby 只能每日一次）。排程語意是「台北日」，不是幾點幾分。觸發時刻需店主決定（建議台北 10:00 = `0 2 * * *` UTC），並在 `SchedulePublishPlanner.tsx` 畫面寫明「當天系統執行時上架，不是指定時刻」。
- 驗收：verifier 斷言 `vercel.json` 含該 path；cron route 沒有 `CRON_SECRET` 時 401。

### SCH-2｜`claimed` 卡死回收（P0）
- 現況：claim 在 `supabase/migrations/20261006121816_publish_schedule_core.sql` 約 75–86 行（`FOR UPDATE SKIP LOCKED` 正確）。只有讀草稿失敗才退回 `queued`（`runDuePublishSchedules.ts` 約 95 行）；逾時／例外時 cron `catch`（`scheduled-publish/route.ts` 約 42–47 行）不歸還。唯一索引含 `claimed`（migration 約 44–46 行），取消也不動 `claimed`（`[id]/route.ts` 約 100–102 行）→ 該草稿永遠無法再排。
- 做法：
  1. 每輪開始先回收 `claimed_at < now() - interval '15 minutes'` 的列：**先查該草稿 Shopify 實際狀態**，已 ACTIVE → `completed`，否則 → `queued`。
  2. 單輪領取量降到「`maxDuration` 內一定做得完」的數量（建議 ≤ 10），不要預設 50。
  3. 例外路徑把本輪尚未處理的列退回 `queued`。
- 若需改 SQL function，產新 migration 檔（timestamp 接續），不改已存在的 migration。
- 驗收：本機 local Supabase E2E 補一個「claim 後模擬中斷 → 下一輪回收」案例。

### SCH-3｜暫停／取消不可被覆蓋（P0）
- 現況：`runDuePublishSchedules.ts` 約 184–193 行收尾時無條件 `status: hasPending ? "active" : "completed"`，會把 `paused` / `canceled` 改回去，下一輪繼續公開。
- 做法：update 加條件 `.eq("status", "active")`（或 `.in("status", ["active"])`）；`paused` / `canceled` 只更新計數不改狀態。領取時也要排除非 `active` 群組的項目。
- 驗收：E2E 案例「群組暫停後跑一輪 → 狀態仍 paused、無項目被公開」。

### SCH-4｜公開模式與每日上限（P1）
- `runDuePublishSchedules.ts` 約 137 行寫死 `publishMode: "active"`。改為群組欄位（預設 `draft`，選 `active` 時建立排程需強確認，沿用 `PublishRecordsPanel.tsx` 的 ConfirmModal 樣式）。
- 領取條件 `scheduled_for <= 今天`（migration 約 77 行）不看 `daily_limit`：漏跑一天會一次公開最多 50 件。改為每群組每輪最多 `daily_limit` 件。
- 送 ACTIVE 前確認商品目前仍是 DRAFT，否則跳過並記錄。
- `SchedulePublishPlanner.tsx` 約 93 行日期欄加 `min`＝台北今日。

### SCH-5｜單筆結果標狀態（P1）
- `runDuePublishSchedules.ts` 約 142–152 行：`runPublishBatch` 失敗時全部標 `failed`。改為依每筆回傳結果標。
- `[id]/route.ts` 約 113–131 行手動重試：重試前先查 Shopify 遠端狀態，已上架的不可重發。

### SCH-6｜同步 trigger 欄位過濾（P1）
- `20261006122416_shopify_full_sync_state.sql` 約 172–179 行：`product_images` / `product_variants` 任一欄更新都把父草稿標 `dirty`，連回寫 `shopify_media_id` 也會，導致排程把商品擋下。新 migration：trigger 排除只改 Shopify id / 同步時間欄的更新。

### SCH 驗收總表
`pnpm run verify:all`、`typecheck`、`build`、`scripts/test-publish-schedule-local.sh`（local stack E2E）全過。執行旗標維持關閉合併；打開旗標＝新的店主授權。

## 3. 影片線必修（`gpt/youtube-video-phase2-20260930`）

### VID-1｜`maxDuration` 被寫進註解（P0，一行修）
- `src/app/api/drafts/[id]/publish/route.ts` 與 `src/app/api/drafts/batch/publish/route.ts` 約 13 行，原始碼是字面 `\n`：
  `// YouTube Phase 2 can download + upload one product video before Shopify.\nexport const maxDuration = 300;`
  → `export` 在註解內，不生效。改成真正換行的兩行。
- 補 verifier：斷言兩個 route 有獨立一行 `export const maxDuration`。

### VID-2｜預設不公開（P1）
- `src/lib/youtube/upload.ts` 約 19–22、49–58 行預設 `public`。改預設 `unlisted`；Shopify 只發 DRAFT 時不得產生公開影片。description 補商品名＋店名（不放價格）。

### VID-3｜防重複上傳與額度（P1）
- `ensureDraftVideos.ts` 約 118–151、236–268 行：以 `team_settings` 的 URL hash 做冪等，兩個並行發布會都 miss 而重複上傳；上傳成功但寫 map 失敗，下次又傳。
- YouTube `videos.insert` = 1600 units / 每日 10,000 ≈ **每天約 6 支**（分支文件寫 1 unit / 100 支是錯的，順手更正 `docs/CURRENT_STATUS.md` 對應段）。
- 做法：上傳前先寫「進行中」鎖（唯一鍵＝draft_id + video hash）；記錄每日已用 units，超過預算整批停止影片步驟（Shopify 照發）。

### VID-4｜影片不拖發布（P1）
- `publishDraftSafe.ts` 約 406 行、`syncShopifyProduct.ts` 約 558 行：影片下載（45s）＋上傳在發布同一請求內，批次每件最多 3 支影片，300s 仍可能爆。
- 做法：Shopify 先發布不等影片；影片改走既有 worker 線或 `youtube-upload` route 背景補，完成後再把影片嵌入 Shopify 描述。

### VID-5／VID-6（P2）
- refresh token 密文在 `team_settings`，`006_team_settings.sql` 約 22–25 行 `using (true)` 讓任何登入者可讀密文 → 新 migration 排除該 key 的 authenticated 讀取，或改存 service-role-only 表。
- `fetchServerVideo.ts` 約 168–221 行接受 `application/octet-stream` 無 magic bytes 檢查 → 只收 `video/*` 或檢查 mp4/webm 檔頭。

### 店主手動設定（合併時才做）
Google Cloud 專案啟用 YouTube Data API v3、OAuth Web client、consent screen；Redirect URI `https://nestory-listing-admin.vercel.app/api/settings/youtube/callback`；Vercel env `YOUTUBE_OAUTH_CLIENT_ID`、`YOUTUBE_OAUTH_CLIENT_SECRET`、`YOUTUBE_OAUTH_REDIRECT_URI`、`YOUTUBE_TOKEN_ENCRYPTION_KEY`；部署後設定頁連一次 YouTube。

## 4. 圖片 AI 改善（`gpt/image-skill-low-api-20260930`）

### 4.1 店主目標（不可偏離）
店主日常要的五件事：**簡轉繁、去掉沒質感的字、長方形改正方形且商品不變形、用商品圖＋實拍生成精美主圖、用商品資訊生成「像廣告」的詳情圖（不是規格表）**。參考：PAPAYA 電腦教室〈我用一個 Claude Skill 省下了所有生成圖片和影片的訂閱費用〉（YouTube `WyJJFzbdjuY`）——Skill 先把一句話擴寫成完整拍攝指令、以參考圖做圖生圖、同指令多模型比較、生成前確認比例與解析度。

### 4.2 現況已有（保留，不重做）
`square_pad`（Sharp 零 API 補方形）、`square_ai`、`hero_enhance`、`creative_hero`、`ad_creative`；舊「重生」已從新選項隱藏；Skill 輸出以 `image_flags["image_skill_source:<id>"]` 保護不被 Sharp 覆蓋；`generated_detail` 優先嵌入描述。底層 batch → AI → Sharp → finalize → review → Shopify **不要重做**。

### 4.3 為什麼現在的圖醜（逐條，都有程式證據）

| # | 問題 | 位置 |
|---|---|---|
| D1 | 預設品質 `economy` → `low`（約 US$0.006／張，草稿級），主圖也用 low | `imageSkills.ts` `qualityForSkill`；`ImageSkillStudio.tsx` 約 73、88 行預設 `economy` |
| D2 | 風格只有抽象形容詞，沒有背景／表面／光線／鏡頭／商品佔比／陰影 | `imageSkills.ts` `styleInstruction()` |
| D3 | 把 `image_description`（含 Vision 讀到的圖上文字）最多 700 字塞進主圖 prompt，誘導模型畫字、混亂主題 | `imageSkills.ts` `buildImageSkillPrompt` 末段 |
| D4 | 廣告圖文字層固定蓋下方 y=820～1350（約 40%），但 prompt 只說「留白」沒說留在哪 → 商品常被漸層和字蓋住；`resize cover` 還會裁切 | `adCreative.ts` 約 52–56、81 行 |
| D5 | 廣告字只有一種版型；14 字硬斷行、英文 eyebrow `CHOCHO NESTORY`＋螢光綠條，模板感重；標題直接拿 `product_highlights[0]`（長句） | `adCreative.ts`；`skill-process/route.ts` 約 196–204 行 |
| D6 | **中文字型沒進 repo**（0 個 .ttf/.otf）；而且 `fonts.ts` 只把 family 名稱給 SVG，librsvg 靠系統 fontconfig 找字，**就算放了字型檔也不會被使用** → Vercel 上中文可能空白／豆腐。主線既有 `runComposeDetailForDraft` 資訊詳情圖共用同一套，可能同病 | `src/lib/images/detailCompose/fonts.ts` 註解「path is recorded for diagnostics」 |
| D7 | `skill-process` route `maxDuration = 60`；medium／high 或多參考圖編輯可能逾時 | `skill-process/route.ts` 約 37 行 |
| D8 | 商品保真只靠 prompt 拜託；整張圖交給模型重畫，角色臉／印刷／配件仍可能被改 | `openai-image-provider.ts` `callImagesEdits` |
| D9 | 主圖輸出 1024×1024；Shopify 主圖建議 2048 級 | `sizeForSkill` |
| D10 | 只有 OpenAI 一家；無法像參考影片一樣同指令比較模型 | `openai-image-provider.ts` |

### 4.4 施工分階段（每階段驗收過才進下一階段）

#### IMG-0｜急救包（幾乎零成本；不加新功能）
- **IMG-0a 字型真正生效（D6）**
  - 放入 OFL 授權字型到 `assets/fonts/`：`NotoSansTC-Bold`、`NotoSansTC-Regular`、`NotoSerifTC-Bold`（可做常用字子集以縮小體積）。
  - 改渲染方式，二選一（優先 A）：
    A. 用 `opentype.js` 把中文字轉成 SVG `<path>` 再交給 Sharp（不依賴 fontconfig，結果可決定）。
    B. Sharp `text` 輸入搭配 `fontfile` 參數（Pango）逐行渲染成 RGBA 圖再 composite。
  - `next.config.mjs` 加 `outputFileTracingIncludes`，讓 `/api/images/skill-process` 與詳情圖 compose 相關 route 打包 `assets/fonts/**`。
  - 驗收：本機刪除／改名系統字型路徑（或設 `DETAIL_COMPOSE_FONT_DIR` 指向空目錄）仍能正確出中文；Preview 實際生成 1 張廣告圖＋1 張資訊詳情圖截圖給店主。
- **IMG-0b 廣告圖版面對齊（D4、D5）**
  - 在 `adCreative.ts` 定義 3 個版型常數，同一份常數同時用於「prompt 留白描述」與「文字層座標」：
    - `bottom_text`：商品在上方 0–60%，下方 40% 留白放字。
    - `left_text`：商品在右側 45–100%，左 45% 留白放字。
    - `top_text`：上方 32% 留白放字，商品在下方。
  - prompt 必須寫明具體留白區，例如：`The lower 40% of the frame must be a smooth, empty continuation of the background — no objects, no props, no shadows, no product parts.`
  - 生成尺寸與輸出比例一致（4:5），以 `fit: "contain"`／補底取代 `cover` 裁切。
  - 文案：標題 ≤ 12 字、副標 ≤ 22 字；由便宜文字模型從 `product_highlights` 精煉（單次、可快取），店主可改。eyebrow 預設改為空或「潮巢玩居」，品牌條顏色改用中性 token，不要螢光綠。
- **IMG-0c 品質預設（D1、D9）**
  - `hero_enhance`、`creative_hero` 預設 `standard`（medium）；`economy` 改名「試畫（低畫質）」；新增「精修（high）」選項，按鈕旁顯示預估費用（程式現有估算：low ≈ 0.006、medium ≈ 0.053、high ≈ 0.21 美元／張 1024 方圖；以 OpenAI 官方現價為準）。
  - 施工前**查官方文件**確認 `gpt-image-2` 支援的輸出尺寸與是否支援 `input_fidelity: "high"`；支援就對所有參考圖編輯任務開啟、主圖輸出取支援的最大方形尺寸。不確定的參數不得寫死猜測值。
- **IMG-0d 逾時（D7）**：查 Vercel 方案上限後把 `skill-process` 的 `maxDuration` 提到方案允許值（目標 300）。
- **IMG-0e 固定測試集與比對腳本（後續所有階段的驗收基礎）**
  - 店主挑 10 件固定商品：絨毛、盲盒公仔、吊飾、包裝盒、耳機或鍵盤、滿版簡體促銷字主圖、長方形實拍、情境實拍、規格圖、本來就很乾淨的白底圖。
  - 腳本 `scripts/eval-image-skill.mjs`：對每件跑指定任務，輸出到 `.tmp/image-skill-eval/<timestamp>/`，並用 Sharp 拼一張「原圖｜結果」對照總表＋`report.json`（模型、品質、尺寸、費用、耗時）。仿照既有 `.tmp/copy-quality-v2-paid-current/` 的做法。
  - **付費執行每輪需店主同意，單輪上限 US$3**；先跑 `--dry-run` 印出將送出的 prompt 與預估費用。

IMG-0 驗收：測試集同一批商品，店主看對照總表判定「明顯比改前好」；廣告圖中文在 Preview 正常顯示。

#### IMG-1｜拍攝配方＋指令擴寫（D2、D3）
- 新檔 `src/lib/images/skillRecipes.ts`：每個風格一份結構化配方，欄位固定：
  `background`、`surface`、`lighting`、`camera`、`framing`（商品寬度佔畫面 55–70%、四邊最少 8% 安全邊）、`shadow`、`palette`、`props`（最多 2 件、不可搶戲）、`avoid`。
  範例（潮巢選物風）：暖白無縫紙背景；霧面淺木或亞麻桌面；左上 45° 大面積柔光、右側淡補光；50mm 視角、略高於商品 10–15°；商品置中偏下、底部柔和接觸陰影；1 件小型中性道具（陶瓷小盤／乾燥花）；避免：促銷貼紙、霓虹、雜亂背景、過度飽和。
  其餘四風格（清新極簡／可愛活潑／科技潮感／生活感）照同欄位各寫一份，具體到可拍照的程度。
- `buildImageSkillPrompt` 改為：`任務指令 → 配方 → 商品保真規則 → 店主一句話`。`image_description` 對主圖類任務只保留外觀屬性（顏色、材質、造型），**移除引號內文字與任何圖上文字**；或乾脆不帶。
- **指令擴寫（參考影片做法）**：店主在「想怎麼改」輸入一句話（例：背景換成咖啡廳木桌、有午後陽光）→ 便宜文字模型依配方欄位擴寫成完整英文拍攝指令 → 工作室顯示「AI 將這樣畫」摘要（中文一行＋可展開原文）→ 店主按生成才送圖片 API。模型名用 env（例 `OPENAI_IMAGE_PROMPT_MODEL`），不寫死。
- 驗收：IMG-0e 測試集對比 IMG-0 結果，店主判定更好；每次擴寫成本 < US$0.002。

#### IMG-2｜商品鎖死主圖：去背＋背景＋合成（D8；正版商品最關鍵）
新任務 `hero_composite`（之後成為「主圖優化」預設路徑；舊 `hero_enhance` 保留為「AI 整張重修」進階選項）：
1. **去背**：新 provider 介面 `BackgroundRemovalProvider`（`src/lib/providers/`），實作一家即可（候選：FAL 上的去背模型、Photoroom API；由施工者查現行價格與條款後提案，店主選）。輸出 RGBA PNG。
2. **背景**：
   - 免費選項：Sharp 依配方產生純色／漸層／紙紋背景（「清新極簡」預設用這個，0 API）。
   - AI 選項：依配方生成「**不含商品**的空場景」底圖（同尺寸、中央留空），一次 low／medium。
3. **合成（Sharp，決定性）**：依 `framing` 規則放置商品（寬度 60%、底線在畫面 72% 高度），加柔和接觸陰影（模糊橢圓、透明度約 0.25）；輸出 1:1 最大尺寸＋WebP。
4. **可選光影融合**：一次 low edit「只調整商品邊緣光影使其融入背景，不得改變商品」；做了就必跑 4.5 的 QA。
5. **零成本保真檢查**：未做第 4 步時，商品像素直接來自原圖，對合成結果的商品遮罩區做像素差比對（應為 0 或僅縮放誤差），超標就標「疑似改動」。
- 「長方形改正方形」也走這條：去背後重新置中到方形畫布（或保留原背景用 `square_pad`），商品永不拉伸。
- 驗收：測試集 10 件主圖，商品細節（臉、印刷、Logo、配件數）與原圖逐件一致；店主判定質感可用於 Shopify 主圖。

#### IMG-3｜第二個圖片模型＋模型比較（D10）
- 依既有 `src/lib/providers/image.ts` 介面新增 `fal-image-provider.ts`（Nano Banana 2 等；**endpoint 名稱與參數以 FAL 官方文件為準，不要猜**）。env：`FAL_KEY`、`IMAGE_SKILL_PROVIDER_<TASK>`（每任務可指定 provider）。
- 只在 `scripts/eval-image-skill.mjs --compare` 做雙模型比較（同 prompt、同參考圖），產出並排總表給店主挑；正式工作室預設只跑一家，避免每次雙倍費用。
- 店主挑定後，把各任務的勝出 provider 寫進 env 預設，並記錄於本文件。

#### IMG-4｜圖片總監（自動建議）＋改圖迴圈＋QA
- **圖片總監 Planner**：所有圖片縮成 256px 縮圖＋標題＋賣點 → **一次**便宜 Vision 呼叫 → JSON：每張 `role`（主圖候選／細節／規格資訊／款式／促銷廢圖／重複）、`action`（保留／補方形／去字／簡轉繁／商品鎖死主圖／廣告圖素材／不使用）、`reason`（≤ 20 字）、`confidence`。
  - UI：Station 2 每張圖顯示「AI 建議」標籤（沿用 `.schip`），上方「全部採用建議」＋逐張修改；**店主確認前不執行任何付費處理**，確認畫面顯示總預估費用。
  - 與 2026-09-30「不自動跑 Planner」的定案相容：Planner 只在店主按「AI 建議處理方式」時跑一次，不自動跑。
- **改圖迴圈**：圖審退件時輸入修改要求 → 以「原圖＋上一版＋要求＋原任務配方」重做 → 新版本回圖審，舊版保留可切換比較。需新增版本資料（只產 migration 檔，例：`product_image_versions`：`id, image_id, version_no, task, provider, model, prompt_digest, file_url, cost_usd, created_at`，RLS 比照 `product_images`）。
- **AI 改動 QA（選用）**：對 `hero_enhance`、`creative_hero`、做過光影融合的結果，店主可勾「發布前檢查」：一次 Vision 比對原圖與結果（顏色、角色臉、Logo、配件數、多出物件），高風險標「AI 疑似改動商品」。
- 簡轉繁進階（日後）：OCR 讀字 → 轉台灣繁中 → 遮罩局部清字 → 用 IMG-0a 字型重新排字；比整張交給模型改字穩定。排在 IMG-4 之後，另開包。

### 4.5 禁止事項
- 不可回到「憑文字重畫商品」當預設；舊 `regenerate` 維持隱藏。
- 不可自動對每張圖跑 Vision／QA／多候選；所有付費動作都要店主按下且看得到預估費用。
- 不可在 repo 寫入 API key；新 key 只放 Vercel env 並更新 `.env.example`（空值）。
- 前端沿用既有元件與 tokens（`.sel`、`.schip`、既有 modal／底部抽屜），禁止新增 `!important`，三主題＋手機都要測。
- 不碰上線主線正在施工的檔案（`fetchRemoteImages.ts`、`extension/**`、`generationProgress.ts`、`RegenCopyModal.tsx`）。

## 5. 委派切包表

| 包 | 範圍 | 主要檔案 | 建議模型 | 驗收 |
|---|---|---|---|---|
| MRG-0 | 主線 merge 進 #15、#12 修 CI | 分支本身 | 低成本 | CI 綠 |
| SCH-1～3 | 排程 P0 | `vercel.json`、`runDuePublishSchedules.ts`、`scheduled-publish/route.ts`、新 migration | 中階（涉資料一致性） | §2 驗收＋local E2E |
| SCH-4～6 | 排程 P1 | 同上＋`SchedulePublishPlanner.tsx`、`[id]/route.ts` | 低成本 | verify:all |
| VID-1 | 一行修＋verifier | 兩個 publish route | 低成本 | verifier |
| VID-2～4 | 影片 P1 | `upload.ts`、`ensureDraftVideos.ts`、`publishDraftSafe.ts` | 中階 | verify:all＋E2E |
| IMG-0a～e | 圖片急救 | `fonts.ts`、`adCreative.ts`、`imageSkills.ts`、`ImageSkillStudio.tsx`、`next.config.mjs`、新 eval 腳本 | 低成本（0a 字型中階） | §4.4 IMG-0 驗收 |
| IMG-1 | 配方＋擴寫 | `skillRecipes.ts`、`imageSkills.ts` | 低成本實作＋指揮官審配方 | 店主看測試集 |
| IMG-2 | 商品鎖死主圖 | 新 provider、合成模組、route | 中階 | 10 件保真＋店主判定 |
| IMG-3 | 第二模型 | `fal-image-provider.ts`、eval 腳本 | 低成本 | 並排總表 |
| IMG-4 | 總監＋迴圈＋QA | 新 planner、版本 migration、Station 2 UI | 指揮官設計＋中階實作 | 另寫細規格 |

每包 gate：`pnpm run verify:all` → `typecheck` → `build`；碰既有 verifier 卡住停手回報，不改 verifier 繞過。每包完成 1 次 Preview（依 `AI_WORKING_RULES.md` §23 節流）。

## 6. 需要店主決定的事

1. 排程每天幾點執行（建議台北 10:00）、排程預設發 DRAFT 還是 ACTIVE。
2. 影片預設「不公開」是否同意。
3. 圖片要不要早於影片合併（決定 §1 第 4 點走 merge 還是 cherry-pick）。
4. IMG-0 可否在上線後立刻開工；IMG-0e 測試集的 10 件商品由店主挑選。
5. IMG-2 去背服務與 IMG-3 第二模型的供應商（施工者提案價格後再選）。
6. 每輪付費測試上限（建議 US$3）。
