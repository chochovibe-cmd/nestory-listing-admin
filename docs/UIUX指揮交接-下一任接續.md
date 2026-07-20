# UIUX 指揮交接

> **最後更新**：2026-07-20（**UX-PKG5 程式核帳＋push** `dd9a83c`）  
> **完整同步檔**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色

| 角色 | 職責 |
|---|---|
| **代理總指揮（Grok）** | UIUX 核帳／同步；**兼 Fable 代理**（資料流裁決寫 §2.10）；核完自動 push；不寫 code |
| 外部 Claude | 包 1～6 設計指令 |
| 工人 | 實作；不 push |
| Fable（回歸） | 先讀 §2.10／§2.10b 與施工清單代理筆記 |
| 老闆 | 本機核畫面 |

## 進度快照

| 區 | 狀態 |
|---|---|
| T74–T153 | 程式完成，待 Claude 核畫面 |
| **UX-PKG1～5** | ✅ 程式核＋**已 push**；畫面待老闆 |
| 下一包 | **UX-PKG6**（等外部 Claude） |
| git | 已 push 至含 `dd9a83c`；核完自動 push |

## 近期 commits

- `dd9a83c` — **UX-PKG5**：藏輸入規格；結果卡可編 spec_text  
- `165feee` — Fable 代理 PKG5 裁決 docs  
- `ba8506c` — PKG4 來源雙卡＋ Variant 分組  
- `591c9ee` — PKG3 手機 nav／Dashboard／生成 sticky  

## PKG5 摘要（Fable 代理期間）

- 輸入無「商品規格」框；`specText` 背景仍進 payload  
- note 引導可寫材質尺寸  
- 結果卡規格可編＋save 寫 `spec_text`；未動 API  

## 一句話

**PKG1～5 已 push；下一包 6／6。Fable 回歸看 §2.10。勿重做 1～5。**

## 下一刀

1. 外部 Claude **包 6** → 工人 → 核帳＋push  
2. 老闆本機核 PKG1～5  
3. Claude 核 T74–T153  
