# COPY-A 交接（2026-11-10，原 COPY-A 對話 → 新帳號接手）

> 老闆換帳號繼續（同一台電腦，本機資料夾都在）。新對話先讀本檔，再讀 `docs/COPY-A-文案地基-施工規格-2026-11-03.md`。
> 對老闆一律繁體中文、白話。施工交 Codex（額度用完就寫雲端 GPT 開工單給老闆轉貼），Claude 設計＋審查。

## 1. 現在到哪
| 項目 | 狀態 |
|---|---|
| A1（紅色提醒、每步記成本、模型旋鈕） | ✅ 11-04 上線：#87 → handoff `8280203`，Production `dpl_C4ERrvcD…`。**還沒驗收**：老闆照常生成 1 件 → 唯讀查該件 `generation_runs.output_payload.cost` 三段都有、`reported:true` |
| A2（三段式、證據、檢查、自動補寫、品牌在前） | **Draft PR #88**，分支 `gpt/copy-a2` @ `1b1841a`。本機 verify:all／typecheck／build 全綠、verify-copy-a 61/61、PR CI 綠。**未合併、未上線** |
| 寫手盲測 | ✅ 完成（老闆已打分），結果見 §2 |
| 文案瘦身（老闆 11-10 提議） | 方向已查證可行，**老闆尚未最後確認細節**（見 §3），還沒施工 |

## 2. 盲測結果（規則：便宜寫手 ≥ 最高分 90% 就用便宜的）
| 寫手（OpenRouter 代號） | 平均分 | 每件寫手成本 | 10 件成功 |
|---|---|---|---|
| **Gemini 3 Flash `google/gemini-3-flash-preview`** | **4.00** | NT$0.22 | ✅ |
| DeepSeek V4.1 Flash `deepseek/deepseek-v4.1-flash` | 3.11 | NT$0.06 | ❌ 1 件沒產出 |
| GPT-5.4 `openai/gpt-5.4` | 2.80 | NT$0.69 | ✅ |
| Claude Sonnet 5.5 `anthropic/claude-sonnet-5.5` | 2.50 | NT$0.63 | ✅ |

- **勝出：Gemini 3 Flash**（唯一過 3.6 門檻、也最高分）。硬傷（簡體／亂編數字）扣掉誤判後 4 家都是 0。
- 看懂商品：維持 `gpt-4o-mini`（22/27 最高；Haiku 5.5 有 9 件 JSON 退回保守版、Gemini 19/27 且貴）。
- 測試設定：temperature 0.7、`TEXT_AI_REASONING_EFFORT=low`。
- 評分頁（老闆私人）：https://claude.ai/artifact/UpVJuSWiSZHFR3AtNucTkr（分數存在它的 db `blindtest/scores`，含老闆逐版評語，**改寫法時很值得讀**）。原始輸出在原對話暫存區，已不保證存在。
- 注意：`gemini-3-flash-preview` 是 preview 版，日後若下架，生成會失敗→A1 紅條會提醒→改環境變數換模型。

## 3. 老闆 11-10 的文案瘦身提議（待確認後放進 A2 再上線）
查證：正式站商品頁（例 https://www.chochonest.com/products/pingu-headphones-badge-keychain）已另外顯示「商品亮點」（購買鈕下）、折疊區「商品規格」「商品特色」「問與答 FAQ」「為什麼潮巢選它」，底部固定區塊「🚚 運送與運費：多數商品為海外代購，約 7–14 個工作天出貨」。所以文案裡的收藏亮點／商品資訊／出貨句都重複。

Claude 提的瘦身版（老闆提議＋Claude 補 2 點）：
- **正文只留 2 段**：`商品介紹`（獨特賣點＋情緒價值，約 120–200 字）、`適合誰`（2 點，具體到「買給自己或送誰」，不准兩點講同一件事）。
- 拿掉 `收藏亮點`（亮點欄位照寫 3 點短句）、`商品資訊`（規格由程式從事實表出）、`購買提醒`（真有用的提醒如 220V／要裝電池才變一題 FAQ；一般照顧方式不寫）。
- **FAQ 2–4 題**：只放影響買不買、頁面上看不到答案的；不准問到貨、非電器的「台灣能用嗎」、重複規格／款式名的題；回答先講結論、40 字內、不准「商品資料顯示…」開頭。
- **不知道就不寫**（Claude 補）：顧客文案禁止「資料未提供／目前沒有標示／無法確認」類句子；答不出的 FAQ 直接拿掉。copyChecks 要抓這類句子並列入自動補寫。
- **出貨句只留台灣現貨**（Claude 補）：AI 完全不寫出貨；程式的 `saleStatusNoticeHtml`（`htmlFormat.ts` 約 :330／:339，潮巢語氣）只在銷售狀態＝台灣現貨時加一行，其他狀態不加（固定區塊已寫）。
- **為什麼選它** 1 句、45 字內。
- 預估：正文 ~665 字 → ~250 字，寫手輸出少約四成。
- 老闆評語重點（多數版本共通）：字太多、重點被稀釋；同件事重複；「海外代購」到處出現；FAQ 問低智商題／自問自答；「不知道」的句子不該出現；商品介紹要多一點商品獨特賣點與導購感；適合誰要讓人一眼想到買給誰。
- 這些也要同步：`buildChaochaoDescriptionFormat`／`buildChaochaoBriefWriterSystemPrompt`／FAQ 規則（`chaochaoPrompt.ts`）、`htmlFormat.ts` 段落組裝（可能有舊測試鎖 4 段格式，要同步改）、`lengthBudget.ts` 字數、`copyChecks.ts`、`verify-copy-a.mjs` 加對應測試。

## 4. 還要修的 bug（A2 合併前）
- `src/lib/copyPipeline/copyChecks.ts` 的 `SIMPLIFIED_ONLY_CHARS` 混進 **「品」**（繁簡同字）→ 每篇有「商品」都誤報簡體。刪掉「品」，並在 verify-copy-a 加一條「『商品』不算簡體」的測試。

## 5. 接下來的順序
1. 老闆確認 §3 瘦身版（或調整）。
2. 寫 §3＋§4 的施工單（更新規格加一節「§3.14 瘦身」＋ verify 測試）→ Codex（`gpt-6.1-sol` medium）在 `gpt/copy-a2` 上改；Codex 沒額度就寫雲端 GPT 開工單給老闆轉貼。
3. Claude 審 diff、本機跑 verify:all → typecheck → build。
4. **先問老闆**「要合併部署 A2 嗎？」→ 合併 #88 → 等預覽 READY → Vercel MCP `create_deployment`（`deploymentId`＝預覽、`target:"production"`）→ 驗 READY＋SHA、`/login` 200。回退點＝`dpl_C4ERrvcD…`（A1）。
5. 換寫手（也要先問）：Vercel Production 環境變數 `OPENAI_COPY_MODEL=google/gemini-3-flash-preview`、`OPENAI_COPY_TEMPERATURE=0.7`、`TEXT_AI_REASONING_EFFORT=low` → Redeploy。
6. 實機：老闆生成 2 件（1 角色收藏、1 機能用品）→ Claude 唯讀查：5 樣都有、SEO 有值、`factSheet` 有新欄位、`cost` 三段（＋fix）都有、每件 ≤ NT$2；順便完成 A1 驗收。
7. 收尾：更新 `docs/CURRENT_STATUS.md` §2、總表第 7 列；docs 分支 `docs/copy-a-spec` 跟著合併。

## 6. 位置與注意事項
- 本機 worktree：`C:/Users/s2491/Documents/nestory-copy-a`（`docs/copy-a-spec`，規格／狀態文件）、`C:/Users/s2491/Documents/nestory-copy-a1`（目前切在 `gpt/copy-a2`，已 pnpm install）。主資料夾停在舊分支，不要在那改程式。
- 本機 `.env.local`（主資料夾）連**正式資料庫**，已有 `OPENROUTER_API_KEY`（老闆 11-07 放的）；只能唯讀查。盲測腳本 `scripts/copy-a-blindtest.mjs` 讀 repo 根目錄的 `.env.local`，跑時暫時複製進 worktree、跑完刪掉；輸出放暫存區，不要放 `.tmp/`（沒被 gitignore）。
- 部署：Claude 可用 Vercel MCP 直接部署（專案 `.claude/settings.local.json` 已加允許），**但每次先問老闆**。Vercel 團隊 `chocho-nestory`（team_3B6EZHMFO5LliyCP5EUaJn7m、專案 prj_fSpIoLqAnC8kUkfoGlWyB6Y0VdWy）若回 403，用 `authorize_team_access` 產連結給老闆點。換帳號後連接器授權可能要重來。
- GitHub CI 的 build 常因 GitHub 機器抓 Google 字型失敗（`next/font … reading '1'`），重跑那個 job 即可，不是程式錯。
- `~/.claude/bin/codex-usage.js` 第 36 行在 `rl.primary` 為 null 時會當掉（查 Codex 額度用），需要時先修。
- 盲測時順手改了 `scripts/copy-a-blindtest.mjs`（寫手失敗記為失敗、繼續跑），在 `nestory-copy-a1` **尚未 commit**，下一輪一起提交。
