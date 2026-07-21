# Mockup 差異備忘（第二真相來源）

> **這份文件是什麼**：`docs/mockups/nestory-v7-mockup.html` 是 UI 驗收標準，但有些地方
> 我們**刻意跟 Mockup 不一樣**，而且已經拍板定案。這份文件專門記錄「**跟 Mockup 不同、
> 但屬定案**」的差異，是 Mockup 之外的**第二真相來源**。
>
> **為什麼需要它**：Mockup 不會自己更新，散落在各 docs 的舊計畫也可能殘留被推翻的方向
> （2026-07-11 B1 驗收就抓到「規格圖 OCR」是三層舊文件一路傳下來的過時設定）。有這份
> 集中清單，接手的人只要「先看 Mockup、再看這份差異」就不會照著舊方向做。
>
> **規則（給所有 AI 模型）**：
> 1. 動任何前台前，先讀 Mockup 對應區塊，**再讀這份差異**，兩者衝突以這份為準。
> 2. 每個 session 只要產生新的「定案差異」，**當場補進這份文件**，不要留到下次。
> 3. 每條差異必寫三件事：**差在哪**、**為什麼**、**誰拍板**。牽涉實作狀態的再加一行**現況**。
> 4. 這裡只記「已定案的差異」；還在討論、沒拍板的不要寫進來（避免又變成新的過時來源）。

---

## 差異清單

### 差異 45：B4 失敗卡「需修改」同大＋紅字上標題列

- **差在哪**：
  1. 現況「失敗」走 station `.schip--error`、「需修改」走 `StatusBadge` `.status.action`，視覺大小不一。
  2. 正式版兩者 **同字級／同 padding 高度**（色相可仍一紅一黃）。
  3. `failReasonSummary`（如「缺少有效售價…」）從 header **下方** `.rc-fail-reason` 改到 **標題後方同一排**。
- **為什麼**：老闆 2026-07-21 第二波截圖——失敗列表掃讀要一眼對齊。
- **誰拍板**：老闆＋X 臨時代理指揮（Grok）2026-07-21。
- **現況**：✅ **UX-B4-P06 已實作**（2026-07-21｜`754a879`｜指揮核帳通過）。

### 差異 44：B4 手機結果卡三排骨架＋精簡 chrome（覆寫 Mockup 橫列＋全快捷）

- **差在哪**：
  1. Mockup／舊正式版：縮圖＋標題＋meta 橫排；快捷核准／重生／×／▸ 常駐。
  2. 正式版 **僅手機**：固定 **三排**——①標題+小標 ②左縮圖／右 chips ③左重生／右價格。
  3. 手機隱藏 checkbox、**核准**、×、▸；**保留重生**在第 3 排；多選長按、快捷左滑。
  4. **桌機維持**現況。
- **為什麼**：老闆 2026-07-21 原 #6/#7 ＋ 第二波全站結果卡重排截圖。
- **誰拍板**：老闆＋X 臨時代理指揮（Grok）2026-07-21（P04 指令第二波修訂）。
- **現況**：✅ **UX-B4-P04 已實作**（2026-07-21｜`47a96c4`｜指揮核帳通過）。

### 差異 43：B4 規格軸值自動展開列（覆寫「never auto cartesian」）

- **差在哪**：
  1. Mockup／B3-P06 主流程＝先填軸值再按「依軸值展開列」。
  2. 正式版定案：軸值有填時 **自動** `expandAndMergeVariantRows` 產生列；主 CTA 不再當必按步驟。
  3. 手填保護：`wouldDiscardHandFilled` 仍須二次確認，禁止靜默丟成本／圖。
  4. 同包：類型與軸值分層排版；列可複製再編輯（老闆 #3–#5）。
- **為什麼**：老闆 2026-07-21——有軸值就應出列，少一步。
- **誰拍板**：老闆＋X 臨時代理指揮（Grok）2026-07-21。
- **現況**：✅ **UX-B4-P03 已實作**（2026-07-21｜工人 Grok｜`6af3a25`）。`tryAutoExpandFromDimensions` 於加／刪軸值後觸發；discard 仍二次確認；類型 `.vh-dim-type` 分層；列「複製」。**待指揮核帳**。

### 差異 42：P4 網搜出處標記退出顧客文案（覆寫 B19「標來源」寫法）

- **差在哪**：
  1. B19／舊 system prompt 曾要求規格寫入時標「來源：網路」或附 URL；正式版 **P4** 後
     顧客可見欄位（描述／spec／賣點／FAQ／why／meta）**禁止任何出處註記**。
  2. 網搜仍可用；證據池第 4 層＋「不確定就不寫」誠實機制不變。
  3. 內部 warnings 仍加「🔍 含網路搜尋資訊，請核實…」（審核用，不進商品頁正文）。
  4. 後製 `stripCustomerSourceMarkers` 窄剝殘留標記（含空括號收乾）；不掃正文裸 URL。
  5. 同包：他店賣家服務類（保固／售後／退換／贈品／店鋪活動等）文案＋Vision 兩端排除。
- **為什麼**：老闆 2026-07-18 實測回饋 90——出處標記不應出現在上架文案；他店服務承諾不應寫進潮巢商品。
- **誰拍板**：老闆回饋 90＋Fable 總指揮 Q1–Q6 裁決（2026-07-19）。
- **現況**：✅ **P4 已實作（2026-07-19）**。UI 改字 ✅ **UX-S T73**（`d8cb292`）：不再寫「查來會標來源」。

### 差異 41：R4 發布紀錄四分頁＋手機 tab＋跳轉區（蓋過 Mockup 紀錄篩選／底 tab）

- **差在哪**：
  1. Mockup 發布紀錄篩選＝Shopify／Showmore／Matrixify／商品庫更新；正式版改 **四 tab**：
     批次紀錄｜失敗重試｜Shopify 草稿｜已發布／封存（輕量 30 筆＋商品庫搜尋）。
  2. 批次卡處理小標「含生圖／原圖直發」寫入 `snapshot_json.processTag`（發布當下凍結）；
     **舊批無欄位不顯示**（誠實，不回退猜）。
  3. 舊 `/drafts` 佇列列表 **permanentRedirect → /records**；`/drafts/[id]` 詳情保留。
  4. 手機底 tab：Mockup 新增／圖審／紀錄／更多 → 正式 **新增／審核／圖審／更多**
     （紀錄收進更多；審核＝`/drafts/new?pane=results`）。
  5. 輸入區生成鈕下「各站掛件總覽」（依站分組＋短日期，點擊跳卡）；手機結果頂
     「＋繼續新增」。生成鈕文案對齊 Mockup（手機短標 `✦ 生成`）。
  6. 通知深連結：圖批次→`/review?section=pending`；發布批次→`/records?tab=batches&batch=`。
- **為什麼**：實機回饋 37、41、42、44；規格書 §7／§9／§12／§14-4；Q1–Q9 全 A。
- **誰拍板**：老闆＋Fable 2026-07-17（R4 放行）。
- **現況**：✅ **R4 已實作（2026-07-17）**。零 migration。

### 差異 40：R2 三站式工作佇列（蓋過 Mockup 九籤／核准並送圖）

- **差在哪**：
  1. Mockup stage pills 仍有「全部／圖片生成中／失敗」等；正式版工作佇列只剩
     **文案審核／圖片審核／完成待發布** 三站＋每站失敗紅燈；已發布／封存退出工作佇列。
  2. Mockup 卡片 quick＝核准＋送圖並存；正式版站①只核准／重生／移出佇列，
     站②「審核」＝標記分流器（全 keep 仍走 sharp→finalize；有 AI 標記進生圖工廠）。
  3. 標記選項＝保留原圖（核准時寫入）／簡轉繁／去字／重生；表單不再催未標記。
  4. `/review` 頁名 **生圖工廠**（站②籤仍叫圖片審核）。
  5. 站③暫保留現行發布／CSV 完整功能（Q7-C），按鈕僅站③出現；R3 再升級多選匯出。
- **為什麼**：實機回饋 18–20、36–46、50、54；流程重構規格書 2026-07-16。
- **誰拍板**：老闆＋Fable（規格書 §14／R2 裁決 Q1–Q7），2026-07-17。
- **現況**：✅ **R2 已實作（2026-07-17）**。migration **030** `to_trad` 只產檔（須老闆跑 SQL 後才可寫簡轉繁標記）。

### 差異 39：E5-open 儀表板健康指標（E4 下方；熱圖／重做率／Tag 提醒）

- **差在哪**：
  1. Mockup 儀表板＝metric 卡＋成本分項／IP 佔比；正式版在 **E4 月預算下方** 加 **健康指標** 一區
     （文案重做率＋Tag 提醒率＋生成日曆熱圖），**不做** Mockup metric 整頁、**不做** E6 顧問、假 GSC。
  2. **生成熱圖 Q1-A／Q2-A**：`product_drafts.copy_generated_at`、**台灣日**、**近 8 週**（週一格網）；
     深度 0／1／2–3／≥4 用 `--accent` 透明度；當日 0＝空格；缺 014 欄 → 誠實提示。
  3. **文案重做率 Q3-A／Q4-A**：`generation_history` 近 **30 台灣日**；
     分母＝有 ≥1 筆 history 的草稿；分子＝至少一欄 `field_name` 列數 **≥2**；
     **不是** history 總列數÷草稿（避免把首次 7 欄生成當重生）；無資料 **—**；
     常駐「含 AI 重生與手動存版」；可附 AI 二次／僅手動小字。
  4. **Tag 提醒率 Q5-A**：同窗非 archived 且有 `copy_generated_at`；
     warnings **白名單**（V2 字典／IP_·角色_·類型_ tag／tag_rules 等），**不含** SEO 長度／禁忌詞；
     副項：需修改件數、Tag 空；常駐「依 warnings 字樣 · 非外部 SEO 分數」。
  5. **範圍 Q6-A**：店級語意、**不跟** E1 scope；operator 受 RLS 副標誠實。
  6. 零 migration；BX-P 禁止；頁底延後改 **E6**。
- **為什麼**：要「健康感」可觀測，但不能假精準（無 regen 類型欄、無 SEO 分數 API）。
- **誰拍板**：總指揮放行 E5-open，2026-07-14（Q1–Q6 全 A）。
- **現況**：✅ **E5-open 已實作（2026-07-14）**。`healthMetrics.ts`＋
  `DashboardTodoPanel` 健康區；`scripts/verify-e5-health-metrics.mjs`。
  不宣稱實機通過。

### 差異 38：E4-open 儀表板月預算＋AI 成本明細（E3 下方；估算非帳單）

- **差在哪**：
  1. Mockup 示意＝metric「本月 AI 花費 NT$／預算」＋「算力成本明細」分 **文案／Vision／生圖／截圖**；
     正式版在 **E3 Make 額度下方** 加 **月預算 · AI 成本**卡，**仍不做** E5 熱圖／E6 顧問、
     **不做** Mockup 分項假帳（Vision／Image 未進 draft 成本）。
  2. **數字來源**：`product_drafts.generation_cost_estimate`（A13 文案 token 估算 USD）合計；
     **null 不計 $0**；本月歸屬 **Q1-A**＝`copy_generated_at` 台灣月界（缺戳不硬塞）。
  3. **顯示 Q3-A**：預算預設 **NT$600**；USD→NT$ **固定 32**（標「約」，非牌告）；
     主 NT$／副 USD；≥80% 黃字；常駐 **「估算 · 非信用卡帳單」**＋**僅文案 token**。
  4. **範圍 Q2-A**：成本卡 **不跟** E1/E2 scope；店級語意（operator 受 RLS，副標誠實）。
  5. **明細 Q5-A**：前 20 筆可點 **`/drafts/[id]`**；可附最近 `generation_model` 小字。
  6. **分模型 Q4-A**：本包 **合計 only**（累加成本＋最後 model 無法誠實拆 Claude/GPT 金額）。
  7. 缺 014 欄 → 誠實 migration 提示；零 migration；BX-P 禁止；無 Settings 改預算 UI。
- **為什麼**：老闆要月預算警戒與單件成本；只能顯示系統真有記的文案估算，不能裝帳單。
- **誰拍板**：總指揮放行 E4-open，2026-07-14（Q1–Q6 全 A）。
- **現況**：✅ **E4-open 已實作（2026-07-14）**。`costBudgetStats.ts`＋
  `DashboardTodoPanel` 成本區；`scripts/verify-e4-cost-budget.mjs`。
  不宣稱實機通過。

### 差異 37：E3-open 儀表板 Make 額度錶（E2 下方；估算非 Make 帳單）

- **差在哪**：
  1. Mockup 儀表板示意＝今日上架／AI 花費等 metric；正式版在 **E2 流程漏斗下方**
     加 **Make 額度**卡（本月 N／上限預設 1000、剩餘、bar、≥80% 黃字），
     **E4 成本已另包**；**仍不做** E5 熱圖／E6 顧問。
  2. **數字來源 Q1-A**：本系統可觀測批次加權估算——
     `Σ image_batches.total_count × 8 ＋ Σ publish_batches.total_count × 3`
     （本月、`created_at`）；**不是** Make 官方 billing API。
  3. 常駐標示 **「估算 · 非 Make 帳單」**；副標說明加權與台北月界。
  4. **月界**：`Asia/Taipei` 當月 1 日 00:00～下月 1 日（開頁「今天」）。
  5. **範圍 Q2-A**：額度卡 **永遠全隊**（與 E1/E2 scope 下拉脫鉤）；
     待辦／漏斗仍跟 scope。RLS 仍約束 operator 可見列。
  6. **缺表 Q4-A**：025／027 未建 → 誠實提示 migration，不假 0。
  7. 上限／權重：code 預設 1000／8／3；本包無 Settings UI（Q3-A）；
     不改 `notifyMake` 落庫（Q5-A）。零 migration；BX-P 禁止。
- **為什麼**：一眼看離免費額度多近；無 Make API 時只能誠實估算。
- **誰拍板**：總指揮放行 E3-open，2026-07-14（Q1–Q5 全 A）。
- **現況**：✅ **E3-open 已實作（2026-07-14）**。`makeQuotaStats.ts`＋
  `DashboardTodoPanel` 額度區；`scripts/verify-e3-make-quota.mjs`。
  不宣稱實機通過。

### 差異 35：E2-open 儀表板流程漏斗（E1 下方；非 Mockup metric 整頁）

- **差在哪**：
  1. Mockup 儀表板示意＝今日上架／成員／AI 花費／IP 榜；正式版在 **E1 今日待辦下方**
     加 **流程漏斗**（各階段件數＋平均停留），**仍不做** Mockup metric／成本／IP 榜
     （E3–E6）。
  2. **主幹**（status **互斥**）：待輸入／進行中（`pending_input|pending_copy|processing`）
     → 文案待審（`ready_for_review`）→ 已核准・待發布（`approved|publishing`）
     → 已發布（`draft_created|active_published|csv_ready`）。
  3. **側翼**（不進主幹）：需修改／失敗（失敗含 `generation_status=failed`，與
     stageFilter 對齊；`pending_input`+生成失敗只算失敗、不雙算待輸入）。
  4. **圖審副列（A′）**：D5 `pending_review`；**可與主幹重疊**；平均停留本包 **—**。
  5. **平均停留（Q2-A）**：積壓件 `now − 進入時間戳`；可靠欄＝
     待輸入 `created_at`、文案待審 `copy_generated_at`、已核准 `reviewed_at`；
     缺戳／終態／側翼 → 誠實 **—**（**不用** `updated_at` 假算）。
  6. 資料＝E1 **同 fetch／scope／上限 200**；可點 sessionStorage stage 跳轉（同 E1）；
     樣式 `.panel`／`.schip`／tokens＋相對寬 bar；零 migration；BX-P 禁止。
- **為什麼**：開工一眼看卡關階段；A13 時間戳夠用的先顯示，不夠的不裝懂。
- **誰拍板**：總指揮放行 E2-open，2026-07-14（Q1 A+A′、Q2–Q6 全 A）。
- **現況**：✅ **E2-open 已實作（2026-07-14）**。`funnelStats.ts`＋`DashboardTodoPanel`
  漏斗區；`scripts/verify-e2-funnel.mjs`。不宣稱實機通過。

### 差異 34：D8b-open Showmore 文案改寫輕量（規則模板 v2；非完整 LLM 改寫）

- **差在哪**：
  1. **位置**：僅 Showmore **匯出邊界**組裝改寫版（`assembleShowmoreCopy`）；
     **不寫** `showmore_title`／`showmore_description`／`showmore_faq` 欄（Q1-A）；
     Shopify／DB 主文案（`title_zh`／`description_html` 等）**不改**。
  2. **標題 Q2-A**：嚴格模板
     `【{IP}】{主體}-{特色}｜{類別／情境詞}｜收藏送禮推薦`；缺零件略過、不硬湊。
  3. **簡述**：規則一句話（有 IP／類型才完整）；不再固定空字串（覆寫差異 28 簡述空）。
  4. **內文結構**：A–E 字母段 → 商品介紹／商品特色（✔）／商品資訊（➼ 有據才列）／
     常見問題 FAQ／公版尾段；禁來源平台與內文價格。
  5. **FAQ Q3-A**：有 `generated_faq_html` 用既有；無則 2 條公版（現貨／色差）。
  6. **尾段 Q4-B**：**僅 code 預設**（交貨＋運送）；**零 migration**、不讀 team_settings。
  7. **LLM Q5-A**：本包無真呼叫；`rewriteMode` 永遠 `rules`；無 key 不影響匯出。
  8. 加價／案 A 圖／D8a 嵌圖預設關／D10 影片尾／D9 健檢 **保留**；案 B zip 不做。
- **為什麼**：完整 D8 最後一塊「改寫版」用規則先對齊模板 v2 與 SEO 差異化，
  避免卡金鑰；語意級 LLM 改寫留後續。
- **誰拍板**：總指揮放行 D8b-open，2026-07-14（Q1-A／Q2-A／Q3-A／Q4-B／Q5-A／Q6-A）。
- **現況**：✅ **D8b-open 已實作（2026-07-14）**。
  `src/lib/csv/showmoreCopyRewrite.ts`＋`showmore.ts` 接線；
  `scripts/verify-d8b-showmore-rewrite.mjs`。完整 D8（案 B／真 LLM 寫欄）**不勾滿**。
  **未**宣稱 Showmore 後台實機通過。

### 差異 33：D10-open 影片欄位（YouTube → Shopify EXTERNAL_VIDEO）

- **差在哪**：
  1. Mockup **無**影片欄；正式版依【自動·四之一b】在工作檯第 4 段加**收合**「影片連結」
     （選填、最多 3 條 YouTube，一行一個）；**不**進核心四項常駐。
  2. 存 `product_drafts.video_urls`（migration **005** 既有 jsonb，型別 `string[]`）；
     **零新 SQL**；不存影片檔、不走 Storage。
  3. 發布：`productCreate` 的 `media` 在 IMAGE 後併 `EXTERNAL_VIDEO`（`originalSource`＝
     正規化後的 YouTube watch URL）；**不**另呼叫 `productCreateMedia`（新建路徑）。
  4. 非 YouTube／無法解析：DB 可暫存原字串；**發布時 skip** 並寫 `warnings` 黃字，不擋發布。
  5. Showmore 匯出：內文尾輕量附 `▶ 商品影片：` 連結（有合法 YouTube 才加）；**不寫回** DB 描述。
  6. **Matrixify 不動**（無標準影片欄；Shopify 走 API）。ResultCard 本包不編影片（Q7-A）。
  7. 第二階段（YouTube Data API 自動上傳／Shopify 原生影片檔）不做。
- **為什麼**：沿用店主「手動上傳 YouTube 再貼連結」習慣；商品頁可播＋轉換，操作最輕。
- **誰拍板**：總指揮放行 D10-open，2026-07-14（Q1–Q8 全 A）。
- **現況**：✅ **D10-open 已實作（2026-07-14）**。`src/lib/media/videoUrls.ts`；
  payload／publishDraft／showmore／WorkspaceInputPanel／autosave；
  `scripts/verify-d10-video.mjs`。真店輪播／Showmore 後台歸週五統一實機。

### 差異 32：E1-open 儀表板今日待辦（優先於 Mockup metric 整頁）

- **差在哪**：
  1. Mockup 儀表板頁示意＝今日上架／成員／AI 花費／成本明細／IP 佔比；正式版 **E1-open**
     **先做「今日待辦」四卡**（文案待審／圖片待審／失敗／待發布），**不做** Mockup 那排
     metric／成本／IP 榜（留給 E2–E6）。
  2. 「今日」＝**積壓待辦（backlog）**，**不**用日曆「今天」過濾；舊案未清仍顯示。
  3. 分桶：文案＝`ready_for_review`；圖審＝D5 `pending_review`（done 且未
     `image_flags.image_review=approved`）；失敗＝draft/api/generation 失敗 **∪**
     `image_status=failed`（同件不雙算總數，副標「含圖失敗 n」）；待發布＝
     `approved|publishing`。
  4. 可點跳轉：文案→`/drafts/new`＋sessionStorage stage `copy_review`；圖審→`/review`；
     失敗／待發布→`/drafts`＋queue stage；**無** `?stage=` URL（本包不改 query）。
  5. admin 預設「只看我的」、可切全部；operator 只看自己；session+RLS；統計上限 200 筆
     誠實提示；**0 件四卡仍顯示**。
  6. 樣式：現站 `.panel`／`.schip`／tokens；BX-P 禁止；零 migration。
- **為什麼**：開工第一眼要能清佇列；Mockup metric 需量產與成本資料，E1 先交付最高 CP 值。
- **誰拍板**：總指揮放行 E1-open，2026-07-14（Q1–Q6 全 A）。
- **現況**：✅ **E1-open 已實作（2026-07-14）**。`todoBuckets.ts`＋`DashboardTodoPanel`；
  `scripts/verify-e1-todo-buckets.mjs`。統一實機／登入畫面未代測。

### 差異 31：D8a-open 描述嵌圖（Shopify／Matrixify 邊界；Showmore 預設不插）

- **差在哪**：
  1. 【文案·三之五】「發布時描述後插 1 主圖＋1 詳情（含 ALT，可關）」；正式版 **D8a-open**
     在 **`buildShopifyProductPayload` 與 Matrixify `Body HTML`** 邊界追加，**不寫** DB
     `description_html`（與 A23 純文字契約一致）。
  2. 最多 **2** 張；略 `spec`；選圖：main → detail → `generated_detail`（當 scene）→ 其他；
     URL＝processed→original→generated；有 alt 用 alt，否則標題。
  3. **可關 Q1-A**：env `DESCRIPTION_EMBED_IMAGES`／`NESTORY_DESCRIPTION_EMBED_IMAGES`—
     未設＝**開**；`0`/`false`/`off`＝關（與嵌圖前相同）。
  4. **Showmore Q4-A**：**預設不插**（後台 HTML `<img>` 未實測）；僅
     `SHOWMORE_DESCRIPTION_EMBED_IMAGES=true` 才用同一 builder。
  5. **CDN 誠實**：同次 productCreate 無法保證 CDN；優先用現有 URL（含已 finalize 的
     shopify CDN）；非 CDN 仍可嵌（Q6-A），不硬擋。
  6. 串接順序：body HTML → **嵌圖** → 內部連結 → FAQ JSON-LD。無 Settings UI（Q3-A）。
- **為什麼**：發布頁資訊密度／描述內 SEO 圖；包小、可 mock、接既有圖欄。
- **誰拍板**：總指揮放行 D8a-open，2026-07-14（Q1–Q6 全 A）。
- **現況**：✅ **D8a-open 已實作（2026-07-14）**。`descriptionEmbed.ts`；
  `scripts/verify-d8a-description-embed.mjs`。

### 差異 30：#2-open 發布批次完成通知（publish_batch_done；非 #3/#4）

- **差在哪**：
  1. 【自動·二】事件 #2「發布批次完成」＋ D7 `publish_batches.notify_sent_at` 本只留欄；
     正式版 **#2-open** 接線：`runPublishBatch` 終態寫入後
     `safeTryNotifyPublishBatchIfComplete`（對稱 D6 事件 #1）。
  2. **終態 Q1-A**：只看 `publish_batch_items` 全為 `done|failed|skipped`——不單靠 batch.status。
  3. **文案 Q2-B**：Email 失敗／略過**必列**標題+原因；成功清單 **≤20**（其餘引導去紀錄頁）；
     LINE Flex **只件數**＋按鈕「打開紀錄」→ `/records`（不用長清單）。
  4. **雙通道／Q3b**：Resend + LINE Messaging Flex（禁 LINE Notify）；**≥1 通道 sent 才 claim**
     `notify_sent_at`；全 skip／全 error 不 claim；條件更新防雙寄。
  5. 通知失敗**不改** `runPublishBatch.ok`；無 key skip 不 500；**零 migration**；
     不做 #3/#4、不擴 stuck Cron 補寄 publish、不改 Settings（Q5-A）、禁 BX-P。
- **為什麼**：D6 中心＋D7 帳本已齊，補「發布做完通知我」閉環；包小可 mock。
- **誰拍板**：總指揮放行 #2-open，2026-07-14（Q1 A／Q2 B／Q3 A／Q4 A／Q5 A）。
- **現況**：✅ **#2-open 已實作（2026-07-14）**。`tryNotifyPublishBatchIfComplete`＋
  `templates/publishBatch.ts`；`scripts/verify-d6-notify.mjs` 含 #2 cases。

### 差異 1：生成進度卡不做「假串流動畫」

- **差在哪**：Mockup 的生成卡有「規則引擎先吐 Tags」＋「LLM 文案逐字串流打字機效果」的
  四步驟動畫（`runGenerate()` 用 setTimeout 假裝）。正式版**只做誠實的兩段真實進度**
  （① 建立草稿 → ② 圖片分析 → ③ AI 文案生成 → ④ 完成），對應我們真的兩次網路請求
  （analyze-images、generate），**不做逐字串流、不做早出 Tags**。
- **為什麼**：後端目前不是串流 API，tags 也是包在 generate 裡一起算，做不出真的逐字/早出，
  硬做就是騙人的假動畫。要真串流得先把後端串流化。
- **誰拍板**：老闆，2026-07-11（B1 設計三裁決點之一）。
- **現況**：B1 已實作誠實兩段進度卡。真串流化列在 **A20**（實測後評估 Vision→LLM 合併單一
  SSE），做到了再回來把進度卡升級。

### 差異 2：圖片改「主圖／詳情圖」兩框，規格改手填欄位（規格圖 OCR 廢棄，引擎轉 B3）

- **差在哪**：
  - Mockup 圖片區是「商品圖片（含每張縮圖可切『規格圖』標記）」＋「詳情圖」，且舊計畫
    （清單 A2、`docs/文案生成架構與角色權限-2026-07-08.md`、更早的分支原型三上傳框）都寫著
    **對「規格圖」做 OCR** 抽規格文字。
  - **定案**：圖片欄位只有**主圖框**＋**詳情圖框**兩個。**沒有獨立的「規格圖上傳框」，
    也不對圖片做規格 OCR**。
  - **規格＝自動產生為主、欄位可改為輔（老闆 2026-07-11 二次拍板）**：老闆不會手填規格，
    必須自動化。生成時由 LLM 依「證據池」整理出規格寫回 `spec_text`；證據池優先序＝
    **款式/Variant 選項文字 ＞ 淘寶原標題 ＞ 詳情圖轉錄文字 ＞ Vision 客觀屬性 ＞ 保守通用規格**。
    表單的「商品規格」欄改成**常駐可編輯的補充/修正入口，預設留空**——留空完全合法、
    生成不得因空而擋；`spec_text` 有值（操作者補充/修正）就尊重不覆蓋，空才用自動整理回寫
    （並加一條黃字提醒審核）。數字紅線：可寫證據池裡「賣家自己標的」數字（款式/標題/詳情圖），
    禁止 AI 看圖目測不存在的數字，沒可靠尺寸就不寫尺寸。未來由 **B3 截圖/網址辨識** 與
    **規格自動補全 v2（Web Search 搜同款）** 再擴充證據池；OCR/辨識引擎保留、路徑改指到 B3。
  - Mockup 裡縮圖上的「規格圖」按鈕，真正意思是**該圖要做去簡體字影像處理的標記**
    （不是 OCR 來源）——那屬於影像處理標記，見差異 3 / B5。
  - 另外：**詳情圖的 Vision prompt 要能把圖上看得到的廣告文案／賣點也轉錄出來**
    （詳情圖是給 AI 讀資訊用）。
- **為什麼**：規格圖 OCR 是三層舊文件一路傳下來、早就被推翻的方向；把規格綁在圖片辨識上
  又慢又不準。老闆不會手填，所以規格要自動化（從賣家已標的資訊整理），手填只當補充/修正。
- **誰拍板**：老闆，2026-07-11（B1 驗收抓出 stale-doc drift）＋同日二次拍板規格改自動產生為主。
- **現況**：✅ **已對齊（2026-07-11）**。`ImageUploader.tsx` 收成主圖／詳情圖兩框；
  `/api/analyze-images` 廢除規格 OCR 且**不回寫 `spec_text`**（修掉被 null 蓋掉的地雷）；
  詳情圖 Vision prompt 補【圖上文字】轉錄段；文案輸出加 `[[spec]]` 段依證據池自動整理規格，
  `spec_text` 為空時回寫（＋黃字提醒）、有值則尊重；表單「商品規格」欄改「選填，留空自動整理」。
  辨識引擎 `ocrSpecImages` 保留在 visionProvider 給 **B3** 沿用。待老闆實機驗收
  （主圖/詳情圖辨識＋詳情圖廣告字轉錄＋自動規格整理正確且不捏造數字＋手填時被尊重）。

### 差異 3：每張縮圖的「圖片標記」UI（B5 已補齊）

- **差在哪**：Mockup 每張縮圖上有可切換的「規格圖」標記（實為「去簡體字影像處理」的
  逐圖標記，見差異 2）。B1 先**不做**這套 per-thumbnail 標記 UI，維持簡單的上傳框。
- **為什麼**：B1 範圍是「圖片先選＋背景上傳＋進度卡」，逐圖影像處理標記是獨立主題，
  塞進 B1 會膨脹；排定在 **B5** 一起做。
- **誰拍板**：老闆，2026-07-11（B1 設計三裁決點之二）；B5 實作裁決 2026-07-12
  （1A 表單＋卡片雙層、2A 只擋送圖不擋核准、3A 標記齊只提示 Phase D 未接通）。
- **現況**：✅ **B5 已對齊（2026-07-12）**。左表單主圖縮圖可切「規格圖」；右卡片完整
  處理方式（保留原圖／去簡體字／重生主圖，預設空白）；未標記擋送圖並具體列出張別；
  詳情圖不標記。migration 019 待老闆執行。真送圖 webhook 仍屬 Phase D。

### 差異 4：B6 價格區相對 Mockup 的定案微差

- **差在哪**：
  1. 利潤主顯示 **NT$ 絕對金額**（可手改 A 案），旁加 **約 xx%** 小字（Mockup 只有金額）。
  2. 右側 ResultCard **不做**完整「特價／單一」切換 UI，只**跟讀** `price_mode`
     （單一模式藏定價欄、存檔清 `compare_at_price`）。
  3. 定價規則設定仍在表單下方收合（現有），不強制改成 Mockup 設定頁跳轉。
  4. 售價低於成本／成本為 0：**黃字警告不硬擋**（清倉賠售真實需求；Mockup 未寫）。
- **為什麼**：審核端手改售價已夠用；完整卡片模式切換會膨脹 B6；% 小字幫店主掃一眼毛利。
- **誰拍板**：老闆，2026-07-12（B6 設計五項建議＋三點補要求）。
- **現況**：✅ **B6 已對齊（2026-07-12）**。左表單 price-mode／price-live／利潤 A 案／
  直填台幣；migration 020 `price_mode` 只產檔待執行。
  另：利潤驅動時若售價追上定價，定價自動跳**嚴格高於售價**的下一階美化價
  （2026-07-12 B3 順手補修）。

### 差異 5：B3 網址抓取／截圖辨識相對 Mockup

- **差在哪**：
  1. ~~Mockup「自動抓取」示意會抓回標題等；正式版**前端入口齊**，後端淘寶爬蟲**誠實停用**
     （提示改用截圖或手填；網址仍存 `source_url`／`taobao_url` 供查重與日後 Phase G）。~~
     → **已由差異 36／B3-fetch-open 覆寫**：server 輕量試抓；淘寶擋＝info 黃字；非 F3 全站爬蟲。
  2. 截圖辨識做完整（Vision 結構化回填標題／¥成本／備註／規格；規格截圖可填簡單款式列），
     **只填空白欄**（2A），不覆蓋手改。
  3. 截圖暫存走 `{userId}/temp-screenshots/`，**不建草稿、不寫 product_images**；辨識結束刪暫存
     （刪失敗靜默）。上限 4 張。
  4. 表單網址查重只接 A12 的 **URL 比對**；IP／角色／類型三維度留給 B4。
  5. 款式多維度／規格彈窗完整表仍屬 **B7**；本包規格截圖只餵現有簡表＋`spec_text`。
- **為什麼**：爬蟲屬後期基礎建設；暫存不建草稿減少 BX4 空草稿；2A 避免誤蓋手填。
- **誰拍板**：老闆，2026-07-12（B3 設計 1A/2A/3A/4A＋三補要求）。
- **現況**：✅ **B3 入口＋截圖已對齊（2026-07-12）**；網址抓取見 **差異 36**。

### 差異 36：B3-fetch-open 來源網址輕量抓取（覆寫差異 5 條 1「完全停用」）

- **差在哪**：
  1. 差異 5 寫後端淘寶爬蟲**誠實停用**；B3-fetch-open 改為 **`POST /api/fetch-source-url` server 輕量試抓**
     （timeout、UA、redirect 逐跳 SSRF gate、body 上限、og／title／JSON-LD Product）。
  2. 成功回填 **只填空白欄**（2A，重用 `planScreenshotFill`）；Q3-A **不從 HTML 填款式列**。
  3. 淘寶／天貓反爬、503、空 body、無可用欄位 → **`.b3-status.info` 黃字**（不是系統壞掉）；
     網址仍保留；A12 URL 查重與抓取**並行**。
  4. Q2-A：非 CNY／¥ 價格不填成本；非法／私網 SSRF → 紅字錯誤。
  5. **不是** F3 Puppeteer／VPS／n8n／G1 哨兵／繞過登入。零 SQL。
  6. 驗收：`node scripts/verify-b3-fetch.mjs`（fixture，不打真淘寶）。
- **為什麼**：老闆要「按自動抓取會真的試」；淘寶擋屬產品正確行為，截圖仍是主備援。
- **誰拍板**：總指揮，2026-07-14（B3-fetch-open 發包；工人方案 Q1–Q5 全 A）。
- **現況**：✅ **B3-fetch-open 已對齊（2026-07-14）**。

### 差異 7：B7 款式多維度／發布接線（相對 Mockup 的定案）

- **差在哪**：
  1. 拖曳排序 ⠿ **本包不做**（加入順序＝sort_order）；Mockup 有長按拖曳。
  2. 款式圖「另外上傳」**不做第二上傳口**，請用上方商品圖區再選圖。
  3. 角色名單讀 `ip_characters`（可搜尋），生成前也能勾；不是 Mockup 寫死示範角色。
  4. 只建立表單有的列（不自動笛卡尔積）；Shopify 用 productOptions＋BulkUpdate 首列＋BulkCreate 其餘。
  5. 款式圖掛 Shopify media **best-effort 不硬擋**（D 階段圖床再強化）。
  6. 列數上限 **50**（黃字），Mockup 未寫。
  7. `cny_price` 語意改為「成本（來源幣）」；舊表單從未寫此欄、曾把混雜數字寫進 `twd_price`（見 migration 022 註解）。
- **為什麼**：避免幽靈款式與爆量列；發布端補齊 A14 發現的缺口；與 B2／B3 對齊。
- **誰拍板**：老闆，2026-07-12（B7 設計 D1–D8 全 A＋四補要求）。
- **現況**：✅ **B7 已對齊（2026-07-12）**。migration 022 只產檔；`VariantEditor`＋發布 `productVariantsBulkCreate`；
  腳本 `scripts/verify-b7-variants.mjs`。

### 差異 8：B8 Web Search 預設常駐開啟（Mockup 示意為關）

- **差在哪**：Mockup 的 Web Search 開關示意為關閉；正式版**預設開啟**，趕時間才手動關。
- **為什麼**：舊分支預設關是因為當年用 LLM 內建搜尋太貴；已定案改 Tavily 外接（幾乎免費），
  開著文案與規格證據才豐富。後端未接上前不可翻預設（會每筆多一條黃字警告）——B8/B19 接線後才翻。
- **誰拍板**：老闆，2026-07-12（施工清單 B8 註記）。
- **現況**：✅ **B8/B19 已對齊（2026-07-12）**。Tavily provider＋draft 快取（migration 023）、
  證據池 v2、語氣 6 款＋模型單次切換；無 key 誠實降級。Vercel 環境變數待部署時補。

### 差異 6：B4 一鍵新增角色只寫 ip_characters（pending），不寫 tag_rules

- **差在哪**：Mockup Tags 分頁文案寫「一鍵新增進規則庫（tag_rules＋ip_characters）」。
  正式版**只寫 `ip_characters`**，並標 `review_status=pending`（migration 021）；
  **不**插入 `tag_rules` 列。
- **為什麼**：現行 shopify tags 權威是 Tags V2（`nestoryTagsV2`＋`ip_characters` 字典）；
  `tag_rules` 角色 mapping 已被 V2 覆寫，再寫一列是死資料。重生時另過濾含 `tag_rules` 的
  幽靈警告（與既有 error 過濾同精神），避免「V2 已修好但仍見 tag_rules 黃字」。
  pending 審核 UI 屬 Phase C。
- **誰拍板**：老闆，2026-07-12（B4 設計裁決 1A）。
- **現況**：✅ **B4 已對齊（2026-07-12）**。API `POST /api/characters/quick-add`；
  重複判斷先 NFKC＋trim；收合列 detect chips＋⚠；三維度查重寫入 `draft.warnings`。
  migration 021 只產檔待老闆 SQL Editor 執行。

### 差異 9：結果卡內部分頁 — SEO 獨立第五頁；階段 pills 歸 B12（已對齊）

- **差在哪**：
  1. Mockup 卡片展開是 **5 個底線分頁**（文案／定價／圖片／Tags／**SEO**）。
     曾短暫定案 4 頁（SEO 併文案）；**老闆實際使用後改回五分頁**（SEO 標題＋Meta 描述獨立）。
  2. Mockup 結果區有 **階段 pills 篩選**（文案待審／圖片生成中／圖片待審…）。正式版
     **B9 不做**；歸 **B12**。B12 用**現有狀態詞彙**（不發明新 status），也不抄尚未上線的
     Phase D「圖片生成中／圖片待審」當主 pill（會永遠 0）。
- **為什麼**：五分頁回到 Mockup 原設計；階段篩選與佇列／封存狀態模型綁在一起。
- **誰拍板**：老闆，2026-07-12（B9）→ 驗收回饋五頁 → **B12 2026-07-12 D1–D7 全 A**。
- **現況**：
  - ✅ **B9 分頁**：`ResultCard` 五頁；批次列桌機 sticky、手機 static。
  - ✅ **B12 階段 pills＋封存（2026-07-12）**：共用 `stageFilter.ts`／`StageFilterPills`；
    工作檯＋佇列：全部｜待輸入｜文案待審｜需修改｜已核准｜圖片未標記｜失敗｜已發布｜已封存；
    預設「全部」藏 archived；`status=archived`＋migration 024 還原欄位；
    批次封存跳過 processing/publishing 並彙總；已封存視圖 quick 只留「解除封存」；
    已發布封存提示 Shopify 仍在店。腳本 `scripts/verify-b12-archive-filter.mjs`。

### 差異 10：B10 版本列／儲存語意相對 Mockup

- **差在哪**：
  1. Mockup 有獨立「✅ 確認儲存此版本組合」；正式版**兩者都保留**，且底部「儲存修改」
     若文案有變更會**一併定案組合**（黃字「已一併定案文案組合」告知，不擋操作）——
     單人作業下任一儲存鈕都應把畫面現狀存好。
  2. 歷史為空時**不**在展開卡片時寫 seed 列進 `generation_history`；UI 以虛擬
     「版本 1/1（目前值）」顯示 DB 現值，第一次 ↺ 或手改定案才把原值補寫為 baseline。
  3. SEO 標題／Meta 與其他 5 欄一視同仁都有 version-nav＋↺（併在文案分頁，見差異 9）。
- **為什麼**：避免「只按儲存修改、組合沒入庫」；避免看一眼就寫庫；與 A7 七欄契約對齊。
- **誰拍板**：老闆，2026-07-12（B10 設計 D1–D7 ＋ D2／D6 微調）。
- **現況**：✅ **B10 已對齊（2026-07-12）**。`copyVersionHistory.ts`＋ResultCard version-nav；
  無 migration 024；腳本 `scripts/verify-b10-version-history.mjs`。

### 差異 11：B11 核准前摘要彈窗 — 只掛 Shopify 不可逆入口；dirty 先定案

- **差在哪**：
  1. Mockup 在收合「✓ 核准」、展開核准、批次核准等**多數核准鈕**都開同一摘要彈窗。
     正式版 **D1-B**：摘要**只**架在會動 Shopify 的入口——
     單件「✓ 核准並發布」、批次「核准並建草稿／核准並上架」。
     **純核准**（收合 ✓ 核准、✓ 批次核准）**維持直跑、不開彈窗**。
  2. **D3-B**：單件摘要若畫面文案有未定案變更，主鈕改「**先定案並送出**」，
     送出前走 B10 `commitCopyCombination` 同一路徑（所見即所核）；乾淨時維持
     「仍要送出」／ACTIVE「仍要送出並上架」（D2-A，取代 `window.confirm`）。
  3. 其餘對齊 Mockup：文案版本組合＋圖片標記統計（D5-A 純核准路徑不掛窗故只在發布摘要見）＋
     未處理警告＋「返回處理／仍要送出」；手機底部抽屜；批次 D4-A 一個彙總窗、
     有問題件標題截短 14 字＋…。
- **為什麼**：
  - D1-B：快速 ✓ 的價值是一鍵不打斷；純核准可逆（有「退回修改」），摘要應留給
    動 Shopify 的不可逆步驟。
  - D3-B：與 B10「儲存修改一併定案」同一原則，不要另寫一套定案邏輯。
- **誰拍板**：老闆，2026-07-12（B11 裁決 D1-B／D2-A／D3-B／D4-A／D5-A）。
- **現況**：✅ **B11 已對齊（2026-07-12）**。`approveSummary.ts`＋`ApproveSummaryModal`；
  單件核准並發布／批次建草稿·上架掛摘要；純核准直跑；腳本 `verify-b11-approve-summary.mjs`。

### 差異 12：B13 自動保存／連續上架／BX4 恢復條（相對 Mockup）

- **差在哪**：
  1. Mockup 生成鈕下常駐 `.gen-hint`「送出後保留來源…」；正式版 **D2-A** 不常駐 hint，
     只靠生成成功 message「表單已清空，可直接填下一筆」（資訊密度）。
  2. 恢復條是 **BX4**（Mockup 未畫完整），開頁偵測 localStorage；**約 X 分鐘前** 用真實
     `savedAt`；**超過 7 天直接清掉**不跳條。
  3. 丟棄 **D1-A** 軟封存（B12 API）＋盡力清圖，不硬刪 draft（authenticated 無 DELETE）。
  4. 恢復時圖片預覽 **不** 自動載回（D3-A），有 draftId 則黃字提示伺服器已有圖。
  5. 連續上架 light reset（保留來源／狀態／語氣／長度／WebSearch／priceMode）與 autosave
     同規則清 localStorage，避免打架。
- **為什麼**：單人作業、少字、對齊 B1 draftId 與 B12 封存能力。
- **誰拍板**：老闆，2026-07-12（B13 設計 D1–D4 全 A＋三補要求）。
- **現況**：✅ **B13＋BX4 已對齊（2026-07-12）**。`workspaceAutosave.ts`＋`WorkspaceInputPanel`；
  腳本 `scripts/verify-b13-workspace-autosave.mjs`。fix(B12) 樂觀隱藏＋defer refresh 同 session。

### 差異 14：B16 手機工作檯（子分頁／斷點／tabbar）

- **差在哪**：
  1. Mockup 手機有「✦ 輸入｜◈ 結果」子分頁；正式版 **B16 已做**（`WorkbenchMobileShell`，
     `<960px` sticky）。
  2. **D1-A**：生成進度 `visible` 時自動切到「結果」（看進度卡／新卡），不是等成功後才切。
  3. **D7**：工作檯子分頁／觸控／抽屜對齊 **960px**；**MobileTabbar 暫留 768** 不動
     （四格／凸起「＋」仍屬 C1／BX6）。
  4. 規格列堆疊、B11 摘要抽屜、B7 pop 底部抽屜：**沿用既有**，B16 不重做。
- **為什麼**：鐵則 &lt;960px；tabbar 改斷點牽動 header 收合，另包處理較安全。
- **誰拍板**：老闆，2026-07-13（B16 設計 D1–D8 全 A＋D7 附註）。
- **現況**：✅ **B16 已對齊（2026-07-13）**。

### 差異 15：B17 資訊密度（收合／?／手風琴）

- **差在哪**：
  1. 表單核心常駐＝標題（含網址／截圖 helper）＋圖片＋成本／特價模式＋生成；
     **AI 文案／款式／規格／備註預設收合**，有內容或非預設設定時自動展開。
  2. **B13 恢復草稿**回填後，有內容的收合區**強制打開**（避免以為資料丟了）。
  3. Mockup 灰色說明小字 → **`FieldHelp` ?**（手機觸控 ≥44px、點外面／Esc 關）；
     語氣卡 `tone-desc` **保留**（D6-A）；警告／錯誤／查重仍常駐條件顯示。
  4. 手機手風琴四段（基本→圖片→價格規格→風格）：前進條件**只自動推進、不硬擋**，
     隨時可點任一段標題（含往回、沒填標題也能看圖片）。
  5. 上傳區加高、主圖縮圖 **96px**。
- **為什麼**：AGENTS 資訊密度規範；老闆確認收合表 A–K 與三補要求。
- **誰拍板**：老闆，2026-07-13（B17 設計＋三補）。
- **現況**：✅ **B17 已對齊（2026-07-13）**。`CollapsibleSection`／`FieldHelp`／form-acc-step。

### 差異 13：B14 送圖建批次（Mockup 未畫 batch 表，行為定案）

- **差在哪**：
  1. Mockup／B5 標記齊全時只提示「Phase D 未接通」；正式版 **B14** 在標記齊全時會
     **建立 `image_batches` 紀錄**（batch_id＋items＋發起人＋時間＋queued），提示改為
     「已建立送圖批次（N 件），處理管線 Phase D 接通後自動執行」。
  2. **單件 ▶ 送圖也建 1 件批次（1A）**，與批次送圖同一 API，避免 Phase D 通知特判。
  3. **不改** `image_status`／`draft.status`（2A）——誠實排隊，不假「處理中」。
  4. 可重複送圖建新批；`current_image_batch_id` 指最新；舊 item 不自動 skipped（3A 簡化）。
  5. `snapshot_json` **必做**：建立當下每 draft 的 process_intent 輕量摘要，Phase D webhook
     吃快照不吃事後被改過的標記。
  6. `regenerate_item_count`＝含 ≥1 張重生主圖的**商品數**（4A），對齊【自動·二】通知文案。
- **為什麼**：【自動·二】批次通知與 Make 收單的資料前提；真管線仍 Phase D。
- **誰拍板**：老闆，2026-07-12（B14 設計 1A／2A／3A 簡化／4A＋必做 snapshot）。
- **現況**：✅ **B14 已對齊（2026-07-12）**。migration **025 只產檔待執行**；
  `POST /api/drafts/batch/send-images`；腳本 `verify-b14-image-batch.mjs`。

### 差異 16：C1 App Shell 導覽（側欄／四格 tabbar／斷點）

- **差在哪**：
  1. **桌機側欄**照 Mockup（預設收合 icon 列、`localStorage nestory_nav` 記住），但**加「商品佇列」**
     （Mockup 側欄沒畫；正式版 `/drafts` 是日常入口，只加不減 Q5-A）。
  2. **手機四格＝Q2-C**：新增／佇列／圖審／**更多**——不是 Mockup 字面「新增／圖審／紀錄／更多→選品」，
     也不是舊計畫「更多含設定」。第四格「更多」開**底部抽屜**（沿用 B11 `modal-overlay`），
     列 **紀錄／儀表板／選品** 三個佔位入口；**設定入口留给 C2**，不提前生。
  3. **斷點 Q3-A**：側欄／tabbar／頂欄工具收合**一律 &lt;960**（覆寫差異 14「MobileTabbar 暫留 768」）。
     768–959 死區驗收：800px 必有 tabbar、無側欄。
  4. **頂欄 `☰ 分頁` 移除（Q1-A）**——頁面導覽只走側欄／tabbar；頂欄只留工具（模型／匯率／主題／登出）。
  5. **未上線頁（圖審／紀錄／儀表板／選品）＝死佔位**：標題＋「即將推出」＋回工作檯；
     無假按鈕／假列表（B18 防污染）。`/review` 原 redirect→`/drafts/new` 已改佔位。
  6. **BX6** 中央凸起「＋」**不做**（另項）。
- **為什麼**：只加不減保住佇列；四格要能日常切換；960 對齊鐵則與 Mockup shell，避免死區；
  佔位保持「死」以免 B18 真人驗收誤點。
- **誰拍板**：老闆／總指揮，2026-07-13（C1 裁決 Q1-A／Q2-C／Q3-A／Q4-A／Q5-A＋四條施工要求）。
- **現況**：✅ **C1 已對齊（2026-07-13）**。`AppSidebar`／`MobileTabbar`／`lib/nav.ts`／
  佔位頁 `review|records|dashboard|scouting`；無 SQL。
  （設定入口已由 **差異 17／C2** 補上：側欄底＋更多抽屜。）
  **導覽順序已由差異 26 覆寫**（2026-07-14）：佇列不再主線第二位／不再佔手機主 tab。

### 差異 29：D9-open 匯出前健檢＋CSV 預覽（＋商品頁示意／Shopify iframe）

- **差在哪**：
  1. **流程**：⬇ Showmore／⬇ Matrixify／卡片「產生 CSV」→ **先**健檢預覽 Modal →
     確認後才 `downloadCsv`／export API（Q4-A：export route **不**二次硬擋 preflight）。
  2. **規則**（純函式 `exportPreflight`，不 LLM）：
     - **error 擋下**：標題空、無售價、狀態非 approved／api_failed／csv_ready、
       **Showmore 無商品圖**（略 spec）；選中 0 件。
     - **warn 可續**：描述空、缺成本、特價缺原價、多款式未展開、僅原圖無 processed、
       **Matrixify 無圖**。
     - **info**：Showmore 庫存 999／重量 0.1kg 預設（不單獨改成「仍要下載」文案）。
  3. **預覽 UI**：件數、Showmore 加價%、每件售價／原價（售價＝`showmorePricing` 同 D8）、
     錯誤／警告列表；有 error 主鈕 **disabled**；有 warn 主鈕「仍要下載（含警告）」；
     另 **商品頁預覽** tab＝示意版型 ＋ **Shopify 官網 iframe**
     （`/products/{handle}`；admin 不嵌；擋嵌入則新分頁）。
  4. **資料**：工作檯用本機 drafts+images；佇列列欄不足 → `POST /api/exports/preflight`
     （不標 csv_ready、不建 job）。官網網域來自 `SHOPIFY_STORE_DOMAIN`（status 暴露 host）。
  5. **樣式**：B11 modal 殼（桌機置中／&lt;960 底部抽屜）、`.schip`／`st-dot`／tokens。
  6. **清單 D9**：健檢＋CSV 表＋商品頁示意／iframe 已補；完整「主題完全一致的商店預覽」仍可不勾滿。
- **為什麼**：接 D8-open 後先防髒 CSV 出去；ROI 高於 D8b／事件 #2；2026-07-19 補 iframe。
- **誰拍板**：總指揮放行 D9-open，2026-07-14（Q1–Q5 全 A）；iframe 延伸 2026-07-19 老闆要求。
- **現況**：✅ **D9-open（2026-07-14）** ＋ ✅ **示意／Shopify iframe（2026-07-19）**。
  腳本 `scripts/verify-d9-export-preflight.mjs`、`scripts/verify-storefront-url.mjs`。

### 差異 28：D8-open Showmore 匯出可用化（非完整 D8／非 D8b 改寫）

- **差在哪**：
  1. **加價**：匯出當下套用本機 `showmoreMarkupPercent`（body 帶入；server 預設 5）→
     `beautifyNestoryPrice`；**成本不加價**；原價美化後必須 **> 售價**（必要時
     `nextBeautifiedPriceAbove`）。**不寫** showmore 專用價欄、**零 SQL**。
  2. **A25**：Showmore「商品介紹」＋ Matrixify「Body HTML」皆 `formatPlainTextAsHtml`
     （`isLikelyHtml` 防二次包）；DB 仍存純文字。
  3. **圖＝案 A**：`processed_file_url` → `original_file_url`；略 `spec`；無圖空欄。
     **案 B zip 不做**（需實測 Showmore 是否吃外部 CDN 後再開）。
  4. **樣式**：維持「單一款式」一列；多款式不展開（請後台補）。
  5. **簡述**：空字串（輕量行銷模板／LLM 改寫 → **D8b**）。
  6. **匯出後**：標 `status`／`publish_status`＝`csv_ready`（對齊 Matrixify 階段可見性）；
     `publish_method` 無 `showmore_csv` enum（零 SQL）→ jobs 用 `manual`＋payload
     `export:"showmore"` 誠實標示。
  7. **紀錄頁**：灰字「Showmore／Matrixify 匯出不進本頁批次帳」（非完整 C5 filter）。
  8. 設定文案改「**匯出時已套用**」。完整 D8（模板 v2／改寫欄／team_settings 尾段）**不勾滿**。
- **為什麼**：老闆痛點「Showmore 跟規格差很多」；先把匯出主路徑可測可用，改寫全套另包防爆。
- **誰拍板**：總指揮放行 D8-open，2026-07-14（Q1–Q7 裁決定案）。
- **現況**：✅ **D8-open 已實作（2026-07-14）**。完整 D8／D8a／D8b／D9 未做。
  腳本 `scripts/verify-d8-showmore.mjs`。**未**宣稱實機通過 Showmore 後台匯入。

### 差異 27：D7 批次發布＝伺服器限速＋發布紀錄骨架（非完整 Make Scenario 2／非完整 C5）

- **差在哪**：
  1. **限速位置**：【自動·Scenario 2】寫 Make 排隊逐件；**定案**＝Vercel `runPublishBatch` 內聚
     逐件 `publishDraft`＋件間 ≥600ms（`PUBLISH_ITEM_GAP_MS` 可覆寫）；Make webhook
     `publish_batch_submitted` **可選**，無 webhook 也能發。
  2. **時間預算 Q2-A**：`maxDuration=60`、剩餘 &lt;8s 停；未跑完 item → `skipped`＋
     `time_budget`；batch **必進終態**（completed／partial_failed／failed），不整批卡 processing。
  3. **單件也建批 Q4-A**（比照 B14）；帳本表 `publish_batches`／`publish_batch_items`（027），
     與 `image_batches` 分離。
  4. **紀錄頁 C5-lite**：`/records` 批次卡＋明細＋「重送失敗件＝**新建** batch」；
     Mockup 的 Showmore／Matrixify／商品庫更新 filter 與完整 C5 **本包不做**（誠實灰字／不假列表）。
  5. **事件 #2** 只留 `notify_sent_at` 欄，**不真寄**。
  6. 表未建（027 未跑）→ 誠實提示，**不假資料**。
- **為什麼**：對齊 D2「伺服器主路徑、Make 可選」；避開 Vercel 逾時用時間預算誠實略過；
  紀錄頁要有真帳本才能脫離 ComingSoon，但不假裝完整 C5。
- **誰拍板**：總指揮放行 D7-open，2026-07-14（Q1–Q5 A／A-lite、Q6 角色矩陣不動）。
- **現況**：✅ **D7-open 已實作（2026-07-14）**。C5 清單不勾滿。⚠ 027 待 SQL Editor。

### 差異 26：導覽降級「全部草稿」（佇列移後；刪頁／Shopify 連動爭議暫緩）

- **差在哪**：
  1. 桌機側欄順序改 **Mockup 主線優先**：新增 → 圖審 → 發布紀錄 → 儀表板 → 選品 → **全部草稿**（原「商品佇列」改名、墊底；設定仍在最底 pin）。
  2. 手機四格改 **新增／圖審／紀錄／更多**（對齊 Mockup 主線）；**全部草稿**進「更多」、排在**設定前**。
  3. **路由 `/drafts` 與批次 API 全部保留**——本包只動導覽資訊架構，不刪功能。
  4. **暫不裁決**「整頁刪除、能力全併進工作檯卡片」或「改造成連動 Shopify 後台草稿」——老闆與 Fable 討論後再開（見代理紀錄 2026-07-14 分歧點）。
- **為什麼**：多一個像工作檯的一級入口易混淆；先把導覽噪音降到 Mockup 排序，功能不砍。
- **誰拍板**：老闆，2026-07-14（指揮執行最小改動；完整產品去留交 Fable）。
- **現況**：✅ **導覽已改（2026-07-14）**。`src/lib/nav.ts`；無 SQL。

### 差異 17：C2 設定頁（分類收合／入口／匯率／Prompt 骨架）

- **差在哪**：
  1. **入口 Q1-C**：**不是** Mockup 頂欄「⚙ 設定」Modal；正式版入口只在
     **桌機側欄底部**＋**手機「更多」抽屜**，頂欄不加設定齒輪（頂欄維持工具列：模型／模式／部署／匯率顯示／主題／登出）。
  2. **形態 Q3-A**：**獨立頁 `/settings`**，不是 Mockup 全站 Modal；內部分類用 **B17 `CollapsibleSection`**
     （`.adv-section`），不新造 Mockup `.set-sec`。
  3. **誰看得到 Q2-A**：admin + operator 都進得了；頁內鎖寫入——System Prompt／自動化偏好僅 Admin；
     定價／預設模型／外觀 operator 可改（與現站 localStorage 工作流一致）。
  4. **匯率 Q7-A**：頂欄 **只顯示套用中匯率**（拿掉 ↻ 直接改匯率）；「抓取今日／套用」只在設定→定價。
     每日 Cron 仍是 **C6**，本包不做。
  5. **定價 Q5-A／Q6-A／Q9-A**：沿用 `nestory_pricing_settings` localStorage + 事件；
     工作檯底部「定價規則設定」**保留可編**並雙向同步；新增 **Showmore 加價 %**（預設 5，本機暫存，D8 再轉 team_settings）。
  6. **System Prompt Q4-A-lite**：Admin UI 骨架＋誠實「待 SQL／待接線」；migration **026 只產檔、驗收不依賴**；
     **generate 不改**讀 DB prompt。
  7. **自動化 Q8-A-restricted**：Worker／Email／LINE 非敏感偏好可存本機；**Make Webhook URL 禁用**、
     禁止寫 localStorage；標 Phase D。
  8. **外觀**：三主題 dark／nordic／kitty（現站有；Mockup 只畫兩主題）——只加不減。
- **為什麼**：安全（webhook 不上前端）、不逼老闆當場跑 SQL、對齊 C1 導覽分工、BX-P 不順手美化。
- **誰拍板**：老闆／總指揮，2026-07-13（C2 裁決 Q1-C／Q2-A／Q3-A／Q4-A-lite／Q5-A／Q6-A／Q7-A／Q8-A-restricted／Q9-A）。
- **現況**：✅ **C2 已對齊（2026-07-13）**。`/settings`＋`SettingsPanel`；026 可選。
  （頂欄「今日參考」與 Cron 由 **差異 18／C6** 補齊。）

### 差異 18：C6 匯率（今日參考本機、Cron 不寫 DB、預設 4.5）

- **差在哪**：
  1. Mockup／計畫示意「全隊每日自動抓、Bar 顯示套用中＋今日」；正式版 **C6** 頂欄已顯示
     **套用中＋今日參考**，但「今日參考」先存 **本機** `nestory_fx_reference`（台灣日曆日快取），
     **不是**全隊共用 DB 欄位。
  2. **Vercel Cron**（`/api/cron/fx`，`0 16 * * *`＝16:00 UTC≈台北 00:00）只做伺服器端抓取＋log，
     本包 **`persisted: false`、不寫 team_settings**；全隊共用等 Supabase 可測再接。
  3. 開頁／Cron／手動抓取成功 → **只更新今日參考**；算價變新匯率必須設定頁「套用今日匯率」
    （寫入 `nestory_pricing_settings.rate`）。無頂欄 ↻ 一鍵套用。
  4. 預設套用中匯率維持程式 **4.5**（不改成 Mockup 示意 4.70）。
  5. 抓取走 **server** `GET /api/fx/cny-twd`（open.er-api.com），失敗誠實顯示、不塞假數字。
  6. 誰可套用：admin＋operator（對齊 C2 本機定價，Q4-A）。
- **為什麼**：外部網路／Supabase 登入暫不穩時不阻塞匯率可用性；兩數字語意不可混；免費 Cron 額度留一支給 D6。
- **誰拍板**：老闆／總指揮，2026-07-13（C6 裁決 Q1-A／Q2-A／Q3-A／Q4-A）。
- **現況**：✅ **C6 已對齊（2026-07-13）**。`fetchCnyTwdRate`／`fxReferenceStore`／
  `/api/fx/cny-twd`／`/api/cron/fx`／頂欄＋設定；腳本 `scripts/verify-c6-fx.mjs`。

### 差異 19：C4 商品庫（頂欄 Modal／RLS 範圍／預設三狀態／深連結）

- **差在哪**：
  1. 與 Mockup 一致：商品庫＝**上方 Bar 彈窗**（非獨立整頁、非 tabbar 第五格）；設定仍走
     **差異 17**（側欄底／更多），頂欄不加 ⚙。
  2. **資料範圍 Q1-A**：瀏覽器 session＋既有 RLS（operator 只見自己的 drafts；admin／reviewer
     見全部）。本包不做「全隊唯讀 service API」、**零 migration**。
  3. **上架人 Q2-A**：`profiles.name` 解得到就顯示；否則「成員」或短 ID；**不假造**人名；
     不做放寬 profiles RLS 的 SQL。
  4. **預設列表 Q3-A**：僅 `status ∈ {active_published, draft_created, csv_ready}`（已發布側），
     **不是**佇列的「全部未封存」；本包無「含進行中」開關。
  5. **操作**：編輯文案 → `/drafts/[id]`；編輯圖片 → `/drafts/[id]?focus=images` 捲到圖片區。
     **不是** Modal 內嵌編輯／補圖 worker／Shopify 同步（Phase D）；**無批次操作**（佇列保留）。
  6. **搜尋 Q5-A**：開窗載約 150 筆後**前端過濾**；不做 `/api/library?q=` server ilike。
  7. **手機 Q6-A**：與桌機同一顆「🔍 商品庫」在頂欄工具選單（☰）內；**不**進「更多」抽屜。
- **為什麼**：日常找已上架／已建草稿商品修文案補圖；沿用既有草稿詳情；不插隊 D／C5。
- **誰拍板**：總指揮，2026-07-13（C4 裁決 Q1–Q6 全 A）。
- **現況**：✅ **C4 已對齊（2026-07-13）**。`ProductLibraryModal`／`productLibrary` helpers／
  `HeaderControls` 入口／`DraftFocusScroll`；樣式 `library-modal`／`lib-row` layout-only。

### 差異 21：D5 圖審語意（done＋image_flags，非 awaiting_review）

- **差在哪**：
  1. 自動化 Scenario 寫 sharp 後 `image_status=awaiting_review`；DB enum **沒有**此值。
     正式版：**處理完成＝`done`**（D3）；**人審通過＝`image_flags.image_review=approved`**
     （可選 `image_reviewed_at` ISO），**不**新增 migration／enum。
  2. Mockup 橫幅有「預估 N 分鐘＋Email 通知」；正式版 D5 **只報誠實件數**（processing／failed／待審），
     無假 ETA；通知屬 **D6**。
  3. Mockup「拒絕，重新生成」示意會重排 AI；正式版 D5 **只記原因＋`image_status=failed`**，
     **不**呼叫 Image API（D4）；processed 暫存 URL **保留**。
  4. 滑桿標籤右圖為「處理後（**暫存**）」——對齊差異 20（非 Shopify CDN）。
  5. 一鍵全確認：**未展開 viewed 硬擋**（比 Mockup 雙擊確認更嚴，Q4-A）。
  6. admin 有「我的／全部」；operator 固定自己的；零 SQL。
- **為什麼**：零 migration 可上圖審；與 D3 `done` 語意銜接；避免假通知／假重生。
- **誰拍板**：總指揮，2026-07-13（D5 裁決 Q1–Q7 全 A）。
- **現況**：✅ **D5 已對齊（2026-07-13）**。`/review`＋`ImageReviewPanel`＋
  `POST /api/images/review-confirm|reject`；腳本 `scripts/verify-d5-image-review.mjs`。

### 差異 25：D6-open 圖片批次通知（事件 #1＋卡住 Cron；非四事件全做）

- **差在哪**：
  1. 【自動·二】寫四種 Email 事件＋team_settings 開關＋Make 查完成度後打
     `/api/notify/batch-done`；正式版 **D6-open** 先做 **事件 #1 圖片批次完成**＋
     **每日卡住 Cron**；#2 發布見 **差異 30**；#3 週選品／#4 月預算仍 type stub。
  2. **觸發**：終態時 **Vercel 同步** `tryNotifyImageBatchIfComplete`（auto chain／ai-process），
     **不**另開 Make 專責通知；無公開 `POST /api/notify/batch-done`（本包）。
  3. **終態判定**：只看 `image_batch_items` 全為 `done|failed|skipped`——**不可**只看
     `batch.status`（hybrid 的 `partial_failed` 可能仍有 queued）。
  4. **雙通道**：Resend Email＋LINE **Messaging API Flex**（禁 LINE Notify）；無 key →
     各 skip、不 500、不假寄；收件人 **env 白名單**（非 profiles／非 localStorage）。
  5. **冪等 Q3b B′**：`notify_sent_at`／`stuck_notified_at` 用 025 既有欄（**零 migration**）；
     **至少一通道 sent 才 claim**；全 skip／全 error 不 claim；條件更新防雙寄。
  6. 卡住：>24h 未終態 → `status=stuck`＋可選通知；Cron `/api/cron/stuck-batches`（與 fx 並列第二支）。
  7. C2 設定區 **只改說明文案**（真寄靠 env；本機勾選暫不擋 server）；禁 BX-P 打磨。
- **為什麼**：D1–D5 已齊；「批做完沒人知」最高 ROI；四事件一次做會空殼。
- **誰拍板**：總指揮，2026-07-13 夜（D6-open 裁決 Q1–Q8 A、Q3b B′）。
- **現況**：✅ **D6-open 完成**。`src/lib/notifications/*`＋cron＋接線；
  `scripts/verify-d6-notify.mjs`。

### 差異 24：D4 AI 去字／重生（Vercel Image API；Make 非必直呼）

- **差在哪**：
  1. 交接／Scenario 1 寫「AI 去字／重生由 **Make 直呼 Image API** 長等」；正式版 **D4** 改為：
     **Vercel 內聚** `runAiProcessForDraft`＋`POST /api/images/ai-process` 呼叫 OpenAI Images
     （`OPENAI_API_KEY`＋`OPENAI_IMAGE_MODEL` 等 env）；**Make 不必直呼 OpenAI**，
     可選只排程／重試打我們的 `ai-process`。
  2. 產物：`generated_file_url`（AI 成功才寫 temp）→ post-AI sharp → `processed` temp →
     預設 finalize CDN；失敗**不覆寫**已是 Shopify CDN 的 processed、不塞假 URL。
  3. **Q1-C Hybrid**：送圖鏈混標＝keep 先 sharp／finalize＋時間夠時有限張 AI（每 draft 最多 1 張）；
     未完 → item `queued`／`awaiting_d4`；獨立 API 為 Make／腳本主路徑。
  4. 全 keep 路徑維持 D2（sharp→finalize）不變。
  5. Auth 同 sharp／finalize（session `canOperate` 或 `WORKER_API_TOKEN`）。
  6. 不能 edit 的模型（如 dall-e-3）→ `de_text` 誠實失敗（見 `.env.example`）。
  7. **無 UI**（b15 跳過）；零 migration；不做 D6／D5 大改。
- **為什麼**：key 已在 Vercel；可重入 API 分張消化長等待，比強迫老闆在 Make 放第二份 OpenAI key 務實。
- **誰拍板**：總指揮，2026-07-13 晚（D4 裁決 Q1-C／Q2-A…Q9-A）。
- **現況**：✅ **D4 完成**。`openai-image-provider`／`runAiProcess`／`ai-process` route；
  hybrid `sendImagesAutoChain`；`verify-d4-ai-process.mjs`；Make 最短說明補呼叫範例。

### 差異 23：D2-open 送圖後自動鏈（覆寫差異 20「B14 不自動 sharp」）

- **差在哪**：
  1. **B14 送圖成功後**會跑伺服器端自動鏈（`runSendImagesAutoChain`），**不再**只建 batch 就結束。
  2. **原 Q1-A**：整件 pipeline 圖皆 `keep` 才自動 sharp；有 `de_text`／`regenerate` 整件不自動。
     → **已由差異 24／D4 Q1-C 覆寫為 hybrid**：混標可跑 keep＋有限 AI；未完仍 `awaiting_d4`。
  3. **Q2-A**：sharp **至少 1 張成功** → 預設 `runFinalizeForDraft`（CDN）；失敗不塞假 CDN。
  4. **內聚函式**：禁止 HTTP 自打 `/api/images/sharp-batch`／`finalize`（route 改薄殼）。
  5. **Q4-A**：序向、`maxDuration=60`、剩餘 &lt;8s 停；未跑 item 維持 `queued`；batch `partial_failed` 誠實。
  6. **Make 可選**：有 `MAKE_WEBHOOK_URL` → 收單一封 `image_batch_submitted`（含 chain 摘要；
     D4 後可加 `d4`）；無值跳過；webhook 失敗**不**讓送圖 500。
  7. **Q6-A**：只改 API `message` 誠實字串；**無**圖審／列表大 UI；b15 跳過。
  8. 失敗短句寫入 draft `warnings`（Q5b-A）；零 migration。
- **為什麼**：D3／D1／D5 已齊，日常缺口是「送圖後還要手動轉檔／上圖床」；Make 完整 Scenario 可後補。
- **誰拍板**：總指揮，2026-07-13 晚（D2-open 裁決 Q1–Q6 全 A）；混標 hybrid 見差異 24。
- **現況**：✅ **D2-open 完成**；混標 AI 見 **差異 24／D4**。

### 差異 22：D1 finalize 後才是 Shopify CDN（銜接差異 20）

- **差在哪**：
  1. **sharp 成功後**仍為 Supabase temp（`storage: supabase_temp`，差異 20 不變）。
  2. **`POST /api/images/finalize` 成功後**才覆寫 `processed_file_url`＝Shopify Files CDN
     （`cdn.shopify.com` 等官方 image/preview URL），API 標 `storage: "shopify_cdn"`。
  3. 只上傳 **main + variant**；spec／detail skip（規格圖不上 Files，對齊 A10／圖床架構）。
  4. finalize **不**重跑 sharp；來源優先 processed temp → fallback original；已是 CDN 則 skip。
  5. CDN 未 READY：短輪詢最多約 5×800ms；逾時 fail、**不塞假 CDN**。
  6. 成功後 best-effort 刪該張 Supabase `…/processed/{imageId}.webp`；**不刪 original**；
     全站 published／archived 清原圖仍屬後續。
  7. D5 滑桿文案仍可寫「處理後（暫存）」（Q5-extra 本包不改 UI）；實際 URL 可能已是 CDN。
  8. ~~未接 Make（D2）~~ → **已由差異 23／D2-open 可選 webhook＋自動鏈銜接**；publish 仍
     `processed || original`（CDN 到位後自然優先）。
- **為什麼**：圖床定案「暫存→永久 CDN」兩段式；與 D3／D5 零 migration 銜接。
- **誰拍板**：總指揮，2026-07-13（D1 裁決 Q1–Q5 全 A）。
- **現況**：✅ **D1 真 CDN 完成（2026-07-13）**。`filesUpload`＋`finalize`＋
  `verify-d1-files.mjs`；零 SQL。

### 差異 20：D-open 圖片 sharp／圖床骨架（相對 Mockup 完整圖審＋CDN）

- **差在哪**：
  1. Mockup／圖床定案終態是 **Shopify Files CDN**（`cdn.shopify.com`）；D-open 的 sharp 成功後
     `processed_file_url` 寫的是 **Supabase 暫存 WebP**（路徑 `…/processed/{imageId}.webp`），
     API 標 `storage: "supabase_temp"`，**不是**永久 CDN。
  2. Scenario 文件有 `awaiting_review`；DB `image_status` 仍用既有 enum——sharp 成功＝**`done`**
     （Q3-A），不新增 migration。
  3. `de_text`／`regenerate` **本包 skip**（等 D4 Image API）；只對 `keep`（與工程用明確
     `imageIds` 的未標記）跑 sharp。
  4. ~~B14 送圖**仍不**自動呼叫 sharp（Q5-A）；Make webhook 屬 D2。~~
     → **已由差異 23 覆寫**：送圖後全 keep 自動 sharp（＋預設 finalize）；Make webhook 可選。
  5. ~~`POST /api/images/finalize` 固定 501~~ → **已由差異 22／D1 真上傳取代**（2026-07-13）。
  6. 無圖審頁 UI（D5 後已有）、無通知（D6）；D-open 當時純 API。
- **為什麼**：先把可單測的 sharp 產能打通；Files 上傳需 `write_files`＋實機，拆下包。
- **誰拍板**：總指揮，2026-07-13（D-open 裁決 Q1–Q6 全 A）。
- **現況**：✅ **D3 完成**；D1 骨架已升級為 **差異 22 真 CDN**；送圖自動鏈見 **差異 23**。

---

## 修訂紀錄

- 2026-07-14（Grok）：差異 39 **E5-open**——儀表板健康指標（E4 下）；
  生成熱圖 8 週／文案重做率（欄≥2）／Tag 提醒率（warnings 白名單）；零 SQL。
- 2026-07-14（Grok）：差異 38 **E4-open**——儀表板月預算＋AI 成本（E3 下）；
  copy_generated_at 台灣月、NT$600@32、僅文案 token、明細 `/drafts/[id]`、
  null 不計 0、分模型本包合計 only；零 SQL。
- 2026-07-14（Grok）：差異 37 **E3-open**——儀表板 Make 額度（E2 下）；
  全隊加權估算 8+3、台灣本月、估算非帳單、缺表誠實；零 SQL。
- 2026-07-14（Grok）：差異 36 **B3-fetch-open**——`POST /api/fetch-source-url` 輕量試抓；
  2A 只填空；淘寶擋 info 黃字；SSRF 擋私網；覆寫差異 5 條 1「完全停用」；零 SQL。
- 2026-07-14（Grok）：差異 35 **E2-open**——儀表板流程漏斗（E1 下）；主幹互斥＋圖審副列；
  平均停留可靠時間戳否則 —；同 E1 scope/fetch；零 SQL。
- 2026-07-14（Grok）：差異 34 **D8b-open**——Showmore 規則模板 v2（匯出邊界）；
  標題／簡述／結構／FAQ／code 尾段；無 showmore_* 欄、無真 LLM、零 SQL；完整 D8 不勾滿。
- 2026-07-14（Grok）：差異 29 **D9-open**——匯出前健檢 error/warn＋CSV 預覽 Modal；
  Showmore／Matrixify 同層；iframe 完整 D9 未做；零 SQL。
- 2026-07-14（Grok）：差異 28 **D8-open**——Showmore 匯出加價＋美化、A25 HTML、案 A 圖欄、
  csv_ready、單一款式；完整 D8／D8b 不勾滿；零 SQL。
- 2026-07-14（Grok）：差異 27 **D7-open**——伺服器 600ms 限速批次發布＋`/records` 骨架；C5 不勾滿；027 只產檔。
- 2026-07-14（Grok）：差異 26 **導覽**——全部草稿移後／手機出主 tab；Mockup 主線四格；去留爭議交 Fable。
- 2026-07-13（Grok）：差異 25 **D6-open**——事件 #1＋卡住 Cron；Resend＋LINE Flex；
  item 終態；Q3b 成功才 claim；零 migration；非四事件／非 Make 專責通知。
- 2026-07-13（Grok）：差異 24 **D4**——Vercel 跑 Image API（ai-process）；Make 非必直呼 OpenAI；
  generated→sharp→finalize；hybrid 混標；覆寫差異 23 整件 awaiting_d4 為有限 AI。
- 2026-07-13（Grok）：差異 23 **D2-open**——送圖後全 keep→sharp→finalize；混標 awaiting_d4；
  可選 Make `image_batch_submitted`；內聚函式禁止自 fetch；覆寫差異 20 條 4。
- 2026-07-13（Grok）：差異 22 **D1**——finalize 成功＝shopify_cdn；sharp 仍 temp；
  main+variant only；短輪詢 CDN；best-effort 刪 processed temp；不刪 original；D5 文案不改。
- 2026-07-13（Grok）：差異 21 **D5**——圖審通過用 image_flags.approved；拒絕 failed＋warnings；
  無假 ETA／無 D4 重生；滑桿標暫存；viewed 硬擋一鍵確認。
- 2026-07-13（Grok）：差異 20 **D-open**——processed＝Supabase temp 非 CDN；image_status 用 done；
  de_text/regen skip；B14 原不自動 sharp（後由差異 23 覆寫）；finalize 原 501（後由差異 22 取代）。
- 2026-07-13（Grok）：差異 19 **C4** 定案並對齊——頂欄 Modal、RLS 範圍、預設三狀態、
  深連結非站內嵌、無批次、手機不進更多抽屜、零 SQL。
- 2026-07-13（Grok）：差異 18 **C6** 定案並對齊——今日參考本機 store、Cron 不寫 DB、
  頂欄套用中＋今日、預設 4.5、server 抓取誠實失敗。
- 2026-07-13（Grok）：差異 17 **C2** 定案並對齊——獨立設定頁、側欄底／更多入口、頂欄匯率只顯示、
  Prompt 骨架不依賴 SQL、Showmore % 本機、Webhook 禁用。
- 2026-07-13（Grok）：差異 16 **C1** 定案並對齊——側欄含佇列、四格 Q2-C、斷點 960、
  頂欄分頁移除、死佔位、更多抽屜不含設定（後由差異 17 補設定）。
- 2026-07-13（Grok）：差異 14 **B16**、差異 15 **B17** 定案並對齊——手機子分頁 960／tabbar 768、
  密度收合＋?＋手風琴不硬擋＋B13 恢復開區。（**tabbar 768 已被差異 16 覆寫為 960**）
- 2026-07-12（Grok）：差異 13 **B14 定案並對齊**——送圖建 image_batches／items／snapshot；
  1A 單件也建批；2A 不改 image_status；025 只產檔。
- 2026-07-12（Grok）：差異 12 **B13／BX4 定案並對齊**——autosave debounce、7 天過期、
  恢復條 savedAt、丟棄軟封存、不常駐 gen-hint、連續上架清 storage。
- 2026-07-12（Grok）：差異 9 **B12 階段 pills＋封存已對齊**——現有狀態詞彙 pills、軟刪除 archived、
  024 還原欄位、批次跳過進行中、已封存 quick 只留解除、已發布提示 Shopify 仍在。
- 2026-07-12（Grok）：差異 11 **B11 定案**——摘要只掛 Shopify 不可逆入口（D1-B）；
  dirty 主鈕先定案並送出沿用 B10 組合路徑（D3-B）；ACTIVE 由彈窗取代 confirm（D2-A）。
- 2026-07-12（Grok）：差異 9 **改回五分頁**——老闆實際使用後 SEO 獨立；手機批次列取消 sticky；
  分頁桌機雙欄 grid。
- 2026-07-12（Grok）：差異 10 **B10 已對齊**——版本列 7 欄、虛擬 v1、儲存修改一併定案、
  單欄 ↺／組合儲存；無 migration。後續修正包：描述欄統一純文字＋預覽／原始碼切換。
- 2026-07-12（Grok）：差異 9 **B9 已對齊**——卡片 4 分頁（SEO 併文案）、階段 pills 歸 B12；
  快速鈕擋送圖收合可見 notice；排序 sessionStorage。（後被本條五分頁覆寫）
- 2026-07-19（Grok）：差異 42 **P4**——顧客文案禁出處標記（雙端 prompt＋後製）；他店服務排除；
  內部 🔍 警告保留；B19 證據池誠實機制不動。UI 改字轉 UIUX。
- 2026-07-12（Grok）：差異 8 **B8/B19 已對齊**——Web Search 預設開＋Tavily＋draft 快取＋規格證據池 v2＋
  語氣 6 款／模型單次切換；IP 語氣 DEFAULT＋team_settings 覆蓋；migration 023 只產檔。
  （**P4 2026-07-19 覆寫「顧客文案標來源」**，見差異 42。）
- 2026-07-12（Grok）：差異 7 **B7 已對齊**——多維度／選圖／✎／角色多選／發布 BulkCreate；
  migration 022 只產檔。
- 2026-07-12（Grok）：差異 6 **B4 已對齊**——一鍵只寫 ip_characters（pending），不寫 tag_rules；
  021 只產檔。
- 2026-07-12（Grok）：差異 5 **B3 已對齊**；差異 4 補定價嚴格高於售價。
- 2026-07-12（Grok）：差異 4 **B6 已對齊**——特價/單一、利潤 A 案、直填、卡片跟讀；
  migration 020 只產檔。
- 2026-07-12（Grok）：差異 3 **B5 已對齊**——per-thumbnail 規格圖＋卡片 process_intent，
  未標記擋送圖；migration 019 只產檔。
- 2026-07-11（Opus）：建立本文件，記入差異 1–3（B1 session）。
- 2026-07-11（Opus）：差異 2 **已對齊**——同 session 修正 B1（analyze-images 不回寫
  spec_text＋廢 OCR、ImageUploader 收兩框、表單加規格手填欄、詳情圖 Vision 補圖上文字
  轉錄）。逐項 typecheck 綠燈、逐項 commit。待老闆實機驗收。
- 2026-07-11（Opus）：差異 2 **二次更新**——老闆拍板規格改「自動產生為主、欄位可改為輔」。
  文案加 `[[spec]]` 段依證據池（款式＞原標題＞詳情圖轉錄＞Vision 屬性＞保守通用）自動整理，
  generate 於 spec_text 空時回寫＋黃字提醒，有值則尊重；前台欄改「選填，留空自動整理」。
  施工清單新增「規格自動補全 v2：Web Search 搜同款」（綁 B8，搜尋服務商待老闆定）。
