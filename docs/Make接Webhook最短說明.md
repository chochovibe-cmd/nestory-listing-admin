# Make 接 Webhook 最短說明（給老闆）

> 系統已可在伺服器端自動處理「全 keep」圖片；混標可試有限張 AI（D4）。  
> Make 是**可選**的外部接線——**不必**直呼 OpenAI Image API。

---

## 一、你要達成什麼？

按「送圖」後，若 Vercel 有設定 `MAKE_WEBHOOK_URL`，系統會 **POST 一筆 JSON** 到你的 Make 場景（事件名：`image_batch_submitted`）。  
沒設這個網址 → **略過、不報錯**，主流程照常。

---

## 二、在 Vercel 填環境變數（約 1 分鐘）

1. 打開 Vercel → 專案 → **Settings → Environment Variables**
2. 新增：
   - **Name**：`MAKE_WEBHOOK_URL`
   - **Value**：Make 給你的 Webhook 網址（下一步會拿到）
3. 另請確認已有（D4 用）：
   - `OPENAI_API_KEY`（已有即可）
   - 可選：`OPENAI_IMAGE_MODEL`（預設 `gpt-image-1`）
   - Worker 呼叫用：`WORKER_API_TOKEN`
4. 存檔後 **Redeploy** 一次才會生效

本地開發可放進 `.env.local`（不要 commit）。

---

## 三、在 Make 建 Webhook（約 5 分鐘）

1. 登入 [Make.com](https://www.make.com) → **Create a new scenario**
2. 第一個模組選 **Webhooks → Custom webhook**
3. **Add** → 複製產生的 URL → 貼到上一步的 `MAKE_WEBHOOK_URL`
4. 點 **Redetermine data structure**（或先在本系統送一次圖），讓 Make 學會 JSON 欄位
5. 先接一個 **Tools → Set variable** 或 **Sleep** 當占位，**Save** 並 **開啟** 場景（左下 Scheduling: ON）

之後若要對 `awaiting_d4` 的 draft 補跑 AI，加 HTTP 模組打下方 `ai-process` 即可。

---

## 四、系統會送什麼？（摘要）

```json
{
  "event": "image_batch_submitted",
  "batchId": "uuid",
  "readyCount": 2,
  "blockedCount": 0,
  "regenerateItemCount": 0,
  "snapshot": [ { "draftId": "…", "title": "…", "images": [ … ] } ],
  "autoChain": {
    "policy": "all_keep_then_sharp_then_finalize_hybrid_d4",
    "batchStatus": "completed",
    "doneCount": 1,
    "failedCount": 0,
    "drafts": [
      {
        "draftId": "…",
        "decision": "run_all_keep",
        "outcome": "done",
        "sharp": "done",
        "finalize": "done",
        "d4": "skipped"
      }
    ]
  },
  "d4": {
    "attempted": 0,
    "awaiting": 1,
    "drafts": []
  }
}
```

| 欄位 | 意思 |
|---|---|
| `event` | 固定 `image_batch_submitted`（收單＋可選自動鏈結果） |
| `batchId` | 本批送圖 ID |
| `snapshot` | 建立當下的標記摘要（Make 應優先用這個，不要事後重讀標記） |
| `autoChain` | 伺服器已跑過的 sharp／finalize／有限 AI 摘要；混標可能 `awaiting_d4` |
| `d4` | 可選：本批 AI 嘗試摘要（無混標時可為 null） |

**注意**：Webhook 失敗**不會**讓送圖失敗（系統已吞掉錯誤）。

---

## 五、和「伺服器自動鏈」的關係（白話）

| 商品標記 | 系統自動做 | Make 還要做什麼 |
|---|---|---|
| **全部「保留原圖」** | 轉檔 WebP →（預設）上傳 Shopify 圖床 | 可只當通知／紀錄；或日後接 Email（D6） |
| **有「去簡體字／重生」** | keep 張先轉檔／上圖床；時間夠時**試最多 1 張 AI**；其餘維持佇列 `awaiting_d4` | **不必直呼 OpenAI**。對未完成的 draft 呼叫下方 `ai-process`（可 loop） |

---

## 六、D4：Make／腳本呼叫 AI 去字／重生

**端點**：`POST https://你的網域/api/images/ai-process`  
**Auth**（二選一，與 sharp／finalize 相同）：

- Header：`Authorization: Bearer <WORKER_API_TOKEN>`  
- 或已登入 operator／admin 的 session cookie  

**Body 範例**：

```json
{
  "draftId": "草稿 UUID",
  "imageIds": ["可選-只跑這些圖的 UUID"],
  "autoSharp": true,
  "autoFinalize": true
}
```

| 欄位 | 預設 | 意思 |
|---|---|---|
| `draftId` | 必填 | 一件商品 |
| `imageIds` | 全部 de_text／regen | 可只跑未完成的張 |
| `autoSharp` | `true` | AI 後轉 WebP temp |
| `autoFinalize` | `true` | 再上傳 Shopify CDN |

**注意**：

- 只處理標記為「去簡體字／重生」的管線圖；「保留原圖」請走 sharp／送圖鏈。  
- 單次最長約 60 秒、最多 12 張候選；多張請分多次呼叫。  
- **不要**在 Make 再放一份 OpenAI key 直呼 Image API（除非你自己要）；Vercel 已有 `OPENAI_API_KEY`（見差異 24）。  
- 失敗不會塞假圖；可看草稿黃字 warnings 或圖片 `processing_error`。

---

## 七、驗收自己有沒有接上

1. Vercel 已設 `MAKE_WEBHOOK_URL` 並 redeploy  
2. Make 場景為 **ON**  
3. 在工具裡送一件「全 keep」商品  
4. Make 歷史應出現 1 筆執行；內容含 `batchId`  

若 Make 沒動、但工具仍顯示「已建立送圖批次／自動處理…」→ 代表主流程正常，只是 webhook 沒接到（檢查網址、場景開關、redeploy）。

混標 AI：可在 HTTP 模組打 `ai-process`，或先靠送圖鏈試 1 張後再補呼叫。

---

## 八、本說明不強迫你現在做

- 不要求立刻建完整 Make 分流  
- Email／LINE 批次通知屬 **D6**  
- 不要求 Make 直呼 OpenAI（**D4 已在 Vercel**）
