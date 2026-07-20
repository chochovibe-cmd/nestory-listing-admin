# UIUX 指揮交接

> **最後更新**：2026-07-20（**UX-PKG2 程式核帳通過** `6c04a77`；PKG1+2 未 push）  
> **完整同步檔（其他對話必讀）**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色（§0）

| 角色 | 職責 |
|---|---|
| **代理總指揮（Grok）** | Fable 額度不足期間：規劃、發包潤飾、**核帳**、進度文件同步；**不自己寫 code** |
| UIUX 指揮／排程 | 同代理總指揮；T 帳本、包序、跨對話同步檔 |
| 外部 Claude UIUX | 設計＋發包指令（包 1～6 等）；可寫進指令的樣式＝規格可做 |
| Claude UIUX 審查 | 設計規格段＋收工核畫面（若額度可用） |
| Fable | 系統／prompt／資料／發布（額度恢復後歸還） |
| 工人 | 實作；不 push；回報格式交總指揮核 |
| 老闆 | 定案、本機核畫面、轉貼工人回報 |

## 進度快照

| 區 | 狀態 |
|---|---|
| 主線 A～S | ✅ |
| T74–T119（AA～AC 等） | **程式已寫，待 Claude 核畫面** |
| UX-AD T127–T130 | **程式已寫，待 Claude 核畫面** |
| UX-AE T131–T136 | **程式已寫，待 Claude 核畫面** |
| **UX-AF T137–T153** | **程式已寫，待 Claude 核畫面** |
| **UX-PKG1（包 1／6）** | ✅ **程式核帳通過**（`c77087a`）；畫面待老闆本機；**未 push** |
| **UX-PKG2（包 2／6）** | ✅ **程式核帳通過**（`6c04a77`）；畫面待老闆本機；**未 push** |
| BX1–BX10 | ✅（含站② **▶ 逐件標圖**） |
| A19 雙尺寸上傳 | ✅ 程式＋DB；migration **039 老闆已跑** |
| D9 商品頁預覽 | ✅ 示意 tab + Shopify 官網 iframe |
| BX-P 第一刀 | ✅；**第二刀等截圖** |
| P7 T84/T105 | ✅；CSS modules 長期債仍在 |
| UX-BTN／S1–S5／BTN2–6／SYS | ✅ |
| git | 至 AF 曾 push；**PKG1+docs+PKG2 未 push**（HEAD≈`6c04a77`） |
| 老闆 | **核 PKG1＋PKG2 畫面**；BX-P2 截圖；T106 不改名已結 |

## 本輪 commits（近期）

- `6c04a77` — **UX-PKG2**：更多選單部署狀態攤平  
- `c1411e0` — docs PKG1 核帳同步  
- `c77087a` — **UX-PKG1**：header／站名／匯率／字級／側欄／刪 JumpStrip 元件／toast  
- `be0010d` — UX-AF 十九：error.tsx + loading + 待辦空 CTA  
- `c1c1168` — UX-AF 十八：reduced-motion + 手機進場 + toast 避 tabbar  
- `bdf5285` — UX-AF 十七：modal + dark 影 + hover  
- `b9cd355` — UX-AF 十六：focus／error 光暈／scrollbar  

## UX-PKG1／PKG2 核帳結論（代理總指揮 2026-07-20）

| 包 | 判定 |
|---|---|
| PKG1 1-1～1-6 | ✅ 程式通過（`c77087a`） |
| PKG2 2-1～2-4 | ✅ 程式通過（`6c04a77`） |
| typecheck | ✅ 綠 |
| 畫面 | ⏳ 老闆本機核 |
| push | ❌ 未 push（正確） |

**PKG1 摘要**：站名長文案；匯率今日主／套用中次；側欄 «» 預設展開；刪 StationJumpStrip 元件。  
**PKG2 摘要**：⋯更多內部署四列常駐＋滿寬檢查連線；無「部署 ▾」；section 頂線分隔。

## 一句話

**PKG1+PKG2 程式過帳未 push；T74–T153 仍待核畫面。下一刀：老闆看畫面 → 外部 Claude 包 3～6 → 總指揮核帳同步。勿重做 PKG1／PKG2／AF／BX。**

## 下一刀（勿重做已完成項）

1. **老闆本機核 PKG1＋PKG2**  
2. **外部 Claude 包 3～6** 發工 → 工人 → 代理總指揮核帳＋同步文件  
3. **Claude 核畫面** T74–T153（可與上並行）  
4. BX-P2 **等截圖**  
5. 可選：**修 verify 腳本債**（r2 to_trad；r4「圖審」→「工廠」）  
6. **不要重做**：BX／AF／**UX-PKG1**／**UX-PKG2**  
