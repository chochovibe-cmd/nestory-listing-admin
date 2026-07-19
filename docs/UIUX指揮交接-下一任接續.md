# UIUX 指揮交接

> **最後更新**：2026-07-19  
> **完整同步檔（其他對話必讀）**：`docs/UIUX本輪改動同步-2026-07-19.md`

## 角色（§0）

| 角色 | 職責 |
|---|---|
| UIUX 指揮（Grok） | 排程、T 帳本、骨架、本輪代理實作 |
| Claude UIUX 審查 | 設計規格段＋收工核畫面 |
| Fable | 系統／prompt／資料／發布 |
| 老闆 | 定案、T106、BX-P 累積 |

## 進度快照

| 區 | 狀態 |
|---|---|
| 主線 A～S | ✅ |
| T74–T119（AA～AC 等） | **程式已寫，待 Claude 核畫面** |
| BX1–BX10 | ✅ 全做完（見同步檔 §2.2） |
| SYN-1 站②生成詳情圖 UI | ✅（flag 後端原本就有） |
| T112-r3 胖鈕截圖修 | ✅ |
| git | 本輪功能收口 `34ab4d3`；分支超前 origin、**未 push** |
| Fable 債 | **T105** 按鈕 class 全收斂；**T84** CSS modules |
| 老闆 | **T106** 審核 tab 改名？；**BX-P** 版面打磨延後 |

## 本輪 commits（功能）

- `0ed471f` — AA–AC 質感／a11y 等 ＋ T112-r3  
- `04f35c1` — SYN-1 生成詳情圖 toggle ＋ BX5 busyLabel  
- `1658fbe` — 規格／工人指令／清單 docs  
- `34ab4d3` — BX2／6／7／9／10  

## 關鍵新檔（勿漏）

- `src/lib/drafts/quickUndo.ts`（BX2）  
- `src/lib/drafts/generateCostHint.ts`（BX7）  
- `src/lib/drafts/toneMemory.ts`（BX10）  
- `src/components/review/ImageLightbox.tsx`（BX9）  
- Toast：`actionLabel` + `onAction`（`Toast.tsx` / `toastEvents.ts`）

## API 小改

- `POST /api/generate` 成功 JSON 多 **`detectedIpName`**（BX10 記語氣用；不改生成語意）

## 一句話

**BX 加分項與 SYN-1 UI 已清；擴展包待 Claude 核。詳見 `docs/UIUX本輪改動同步-2026-07-19.md`。未 push。**

## 下一刀（勿重做已完成項）

1. Claude 核 AA～AC（T74–T119）畫面  
2. 老闆拍 T106  
3. Fable：T105／T84  
4. **不要**主動開 BX-P 順手美化  
