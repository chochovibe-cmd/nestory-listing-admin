# UIUX 指揮交接

> **最後更新**：2026-07-21（**B4 全包收官**｜HEAD 約 `0055d66`）  
> **完整同步檔（本輪真相）**：`docs/UIUX本輪改動同步-2026-07-21.md`  
> **歷史**：`docs/UIUX本輪改動同步-2026-07-19.md`（B2／PKG；勿當本輪進度）

---

## 一句話

**UX-B4-P01～P08 已核帳並 push。**  
結果卡／手機三排／規格自動展開／Tags 色 chip／Shopify 誠實 mock 文案／桌機雙欄不重疊／輸入縮圖 wrap 皆完成。  
**勿重做 B4。** 真發 Shopify 需老闆 env 手動。

---

## 進度快照

| 區 | 狀態 |
|---|---|
| UX-PKG1～6 | ✅ |
| B2-P01～P15-r2 | ✅（舊 P15 已 revert） |
| B3-P01～P06 | ✅ |
| **B4-P01～P08** | ✅ 全核帳＋push（見 07-21 同步檔 §1） |

### B4 feat 速查

| 包 | commit |
|---|---|
| P06 失敗標籤 | `754a879` |
| P02 銷售小標 | `39eba0b` |
| P04 手機三排 | `47a96c4` |
| P01 Tags | `2b5d3f7` |
| P03 規格 | `6af3a25` |
| P05 Shopify mock 文案 | `6e172ff` |
| P07 雙欄不重疊 | `5f73952` |
| P08 縮圖 wrap | `159721e` |

---

## 接手 5 步

1. `git pull` → 讀 **`docs/UIUX本輪改動同步-2026-07-21.md`**  
2. 讀 `docs/施工清單.md` 章節 **UX-B4**  
3. 差異備忘 **43／44／45**  
4. 新需求另開包；**不要**重做上表  
5. 部署異常：先確認 Vercel 是否已 build 最新 commit  

---

## 老闆待手動

- 真發：`.env.local` + Vercel `SHOPIFY_PUBLISH_MOCK=false` + 三個 `SHOPIFY_*` + 重啟／Redeploy  
- 驗收：狀態「已接真店」；product_id ≠ `mock-product-id`  

---

## 下一刀建議

1. 老闆目視部署站（雙欄、縮圖 wrap、手機三排）  
2. 新 UI／流程需求 → 新包（B5 或 P09）  
3. 勿套回 B2-P10 輸入區橫滑 nowrap（P08 已覆寫；站②橫滑保留）  
