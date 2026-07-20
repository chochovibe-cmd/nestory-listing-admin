# UIUX 指揮交接

> **最後更新**：2026-07-20（**UX-B2-P04 核帳＋push** `b77e9a2`）  
> **完整同步檔**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色

| 角色 | 職責 |
|---|---|
| **代理總指揮（Grok）** | 潤飾、核帳、同步、**核完自動 push**；兼 Fable 代理 |
| 外部 Claude | 第二輪 1～15（P01～P04 已完） |
| 工人 | 實作；不 push |
| 老闆 | 本機核畫面 |

## 進度快照

| 區 | 狀態 |
|---|---|
| UX-PKG1～6 | ✅ 已 push |
| **UX-B2-P01～P04** | ✅ 已 push（最新 `b77e9a2`） |
| 下一包 | **B2-P05**（等外部 Claude） |

## B2-P04 摘要

- 軸值／維度 chip：6px 方角  
- `costIsInherited` 表單旗標；主成本寫入 value；手改不連動  
- 無 migration；`syncInheritedVariantCosts` + `repriceVariants`  

## 一句話

**B2-P01～P04 已 push。下一 B2-P05。勿重做。**

## 下一刀

1. 外部 Claude **B2 5／15** → 潤飾 → 工人 → 核帳＋push  
2. 老闆掃：成本繼承、chip 形狀  
