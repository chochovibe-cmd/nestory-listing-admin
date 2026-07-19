# SYN-0b 混合樣張說明（Horizon 店面風格）

> 老闆選向：B2-edits 質感 ＋ **模板文字 100% 正確** ＋ **對齊真實店面 Horizon**  
> 風格依據：`品牌風格-來自Horizon主題.md`（www.chochonest.com scheme-1）  
> 日期：2026-07-19

## 交付檔

| 檔名 | 說明 |
|---|---|
| `米菲臺燈-混合-B2底A字.png` | 最終混合（Horizon 疊字） |
| `Razer皮卡丘滑鼠-混合-B2底A字.png` | 最終混合（Horizon 疊字） |
| `*-混合-底圖.png` ×2 | AI 無字底圖（奶油極簡） |
| `品牌風格-來自Horizon主題.md` | tokens 來源 |
| `syn0b-horizon-report.json` | 本輪報告 |

## 風格（對齊店面，取代先前 nordic）

| 項 | 值 |
|---|---|
| 底色 | `#faf8f3` 奶油白 |
| 標題字色 | `#2a2a2a` |
| 內文字色 | `#4a4a4a` |
| 強調鈕 | 黑底白字（無電商彩塊） |
| 線 | 極淡 `#0000000f`／`#dfdfdf` |
| 次要底 | `#f5f3f0` |
| 標題字體 | **Noto Serif TC**（本機已裝，呼應 Cormorant） |
| 內文字體 | **Noto Sans TC**（本機已裝；fallback 微軟正黑） |

氣質：極簡、留白、細線、黑白灰＋奶油白。

## 做法

1. **底圖**：`images/edits` 無字奶油棚拍底（上下留白）。  
   - 本輪**沿用**先前 SYN-0b 已驗過的無字底圖（視覺同奶油極簡、無說明文字），**本輪 API 估 $0**。  
   - 若需重產：`node scripts/syn0b-horizon-hybrid.mjs --regen-base`（預算 $0.25／含 1 次重試）。
2. **文字**：Horizon 版型 HTML 疊草稿原文 → Chrome 1080 長圖 → sharp trim。  
   規格數字**不經**生圖模型。
3. 浮水印：`SYN-0 打樣 · 非正式上架`。

## 規格抽查（正確性）

| 草稿 | 混合圖 |
|---|---|
| 15 x 15 x 30 cm | ✅ |
| 54克 | ✅ |
| Focus Pro 35K | ✅ |
| 2.4ghz／10m／2年 | ✅ |
| 標題／賣點繁中 | ✅ 清晰可讀 |

## 成本

| 項 | 估 |
|---|---|
| 本輪（Horizon 改版疊字） | **$0**（重用底圖） |
| 先前產無字底圖（歷史） | 約 $0.14（2× medium） |
| 本輪上限未動用 | $0.25 |

## 腳本

- `scripts/syn0b-horizon-hybrid.mjs`（主：Horizon 版型；可選 `--regen-base`）

**未**寫入 `product_images`、**未** push。
