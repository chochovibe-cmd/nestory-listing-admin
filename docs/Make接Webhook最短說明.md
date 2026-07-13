# Make 接 Webhook 最短說明（給老闆）

> 本包（D2-open）**不必**在 Make 建成功才算完成。  
> 系統已可在伺服器端自動處理「全 keep」圖片；Make 是**可選**的外部接線。

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
3. 存檔後 **Redeploy** 一次才會生效

本地開發可放進 `.env.local`（不要 commit）。

---

## 三、在 Make 建 Webhook（約 5 分鐘）

1. 登入 [Make.com](https://www.make.com) → **Create a new scenario**
2. 第一個模組選 **Webhooks → Custom webhook**
3. **Add** → 複製產生的 URL → 貼到上一步的 `MAKE_WEBHOOK_URL`
4. 點 **Redetermine data structure**（或先在本系統送一次圖），讓 Make 學會 JSON 欄位
5. 先接一個 **Tools → Set variable** 或 **Sleep** 當占位，**Save** 並 **開啟** 場景（左下 Scheduling: ON）

之後要接完整 Scenario 1（依標記分流、打 sharp／AI）再慢慢加 Router 即可；端點不用改。

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
    "policy": "all_keep_then_sharp_then_finalize",
    "batchStatus": "completed",
    "doneCount": 1,
    "failedCount": 0,
    "drafts": [
      {
        "draftId": "…",
        "decision": "run_all_keep",
        "outcome": "done",
        "sharp": "done",
        "finalize": "done"
      }
    ]
  }
}
```

| 欄位 | 意思 |
|---|---|
| `event` | 固定 `image_batch_submitted`（收單＋可選自動鏈結果） |
| `batchId` | 本批送圖 ID |
| `snapshot` | 建立當下的標記摘要（Make 應優先用這個，不要事後重讀標記） |
| `autoChain` | 伺服器已跑過的 sharp／finalize 摘要；混標可能是 `awaiting_d4` |

**注意**：Webhook 失敗**不會**讓送圖失敗（系統已吞掉錯誤）。

---

## 五、和「伺服器自動鏈」的關係（白話）

| 商品標記 | 系統自動做 | Make 還要做什麼 |
|---|---|---|
| **全部「保留原圖」** | 轉檔 WebP →（預設）上傳 Shopify 圖床 | 可只當通知／紀錄；或日後接 Email |
| **有「去簡體字／重生」** | **不**自動轉檔；商品維持佇列 `awaiting_d4` | 完整 Scenario 1 的 AI 去字／重生（**D4**，尚未做） |

---

## 六、驗收自己有沒有接上

1. Vercel 已設 `MAKE_WEBHOOK_URL` 並 redeploy  
2. Make 場景為 **ON**  
3. 在工具裡送一件「全 keep」商品  
4. Make 歷史應出現 1 筆執行；內容含 `batchId`  

若 Make 沒動、但工具仍顯示「已建立送圖批次／自動處理…」→ 代表主流程正常，只是 webhook 沒接到（檢查網址、場景開關、redeploy）。

---

## 七、本包不做什麼

- 不要求你現在就建完整 Make 分流（去字／重生／寄信）  
- Email／LINE 批次通知屬 **D6**  
- AI 去字／重生屬 **D4**
