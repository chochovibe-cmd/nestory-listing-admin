# UIUX 指揮交接

> **最後更新**：2026-07-20（**UX-PKG4 程式核帳＋push** `ba8506c`）  
> **完整同步檔**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色

| 角色 | 職責 |
|---|---|
| **代理總指揮（Grok）** | 發包潤飾、核帳、同步文件；**核完自動 push**；不寫 code |
| 外部 Claude | 包 1～6 設計指令 |
| 工人 | 實作；不 push |
| 老闆 | 定案、本機核畫面 |

## 進度快照

| 區 | 狀態 |
|---|---|
| T74–T153 | 程式完成，待 Claude 核畫面 |
| **UX-PKG1～4** | ✅ 程式核＋**已 push**；畫面待老闆 |
| BX／A19／D9／P7／BTN | ✅ |
| 下一包 | **UX-PKG5**（等外部 Claude） |
| git | 已 push；核完自動 push |

## 近期 commits

- `ba8506c` — **UX-PKG4**：來源雙卡＋ Variant 按鈕分組  
- `591c9ee` — **UX-PKG3**：手機 nav／Dashboard／生成 sticky  
- `6c04a77` / `c77087a` — PKG2／PKG1  

## PKG4 摘要

- 標題區：連結卡｜截圖卡（點／拖／Ctrl+V；無 dropzone class）  
- 移除 helper-links／fetch-box  
- Variant：①→②→③；左設定、右執行；展開 primary  

## 一句話

**PKG1～4 已 push；下一包 5／6。勿重做 1～4／AF／BX。**

## 下一刀

1. 外部 Claude 包 5～6 → 工人 → 核帳＋push  
2. 老闆本機核 PKG1～4  
3. Claude 核 T74–T153  
