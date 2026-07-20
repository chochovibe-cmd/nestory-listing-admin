# UIUX 指揮交接

> **最後更新**：2026-07-20（**Fable 代理裁決 PKG5**；PKG1～4 已 push）  
> **完整同步檔**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色

| 角色 | 職責 |
|---|---|
| **代理總指揮（Grok）** | UIUX 排程／核帳／同步；**兼 Fable 代理**（系統資料流裁決、記錄給 Fable 回歸）；核完自動 push；不寫 code |
| 外部 Claude | 包 1～6 設計指令 |
| 工人 | 實作；不 push |
| Fable（回歸後） | 收回系統／prompt／資料；先讀同步檔 §2.10 與施工清單「Fable 代理」筆記 |
| 老闆 | 定案、本機核畫面 |

## 進度快照

| 區 | 狀態 |
|---|---|
| T74–T153 | 程式完成，待 Claude 核畫面 |
| **UX-PKG1～4** | ✅ 程式核＋**已 push**；畫面待老闆 |
| BX／A19／D9／P7／BTN | ✅ |
| 下一包 | **UX-PKG5** 規格資料流（**Fable 代理裁決已定**，可發工） |
| git | PKG1～4 已 push；核完自動 push |

## 近期 commits

- `ba8506c` — **UX-PKG4**：來源雙卡＋ Variant 按鈕分組  
- `591c9ee` — **UX-PKG3**：手機 nav／Dashboard／生成 sticky  
- `6c04a77` / `c77087a` — PKG2／PKG1  

## PKG4 摘要

- 標題區：連結卡｜截圖卡（點／拖／Ctrl+V；無 dropzone class）  
- 移除 helper-links／fetch-box  
- Variant：①→②→③；左設定、右執行；展開 primary  

## 一句話

**PKG1～4 已 push；PKG5 資料流已由 Grok 代 Fable 裁決（§2.10），可發工。勿重做 1～4。**

## 下一刀

1. **UX-PKG5** 工人（裁決見同步檔 §2.10）→ 核帳＋push  
2. 老闆本機核 PKG1～4（＋5）  
3. 外部 Claude 包 6；Claude 核 T74–T153  

