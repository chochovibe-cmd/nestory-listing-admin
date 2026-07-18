# 三主題 token 檢查清單

> 來源：Claude UIUX 筆記 1-11／UX-K T60。  
> 改 `src/app/globals.css` 任何設計 token 前必讀；改完至少在 **dark / nordic / kitty** 各看一眼。

## 何時必查

改下列任一类 CSS 變數時，**三主題都要過一次**：

| 類別 | 代表 token |
|---|---|
| 狀態色 | `--warn`、`--success`、`--danger`、`--idle`、`--warn-text` |
| 品牌／強調 | `--accent`、`--accent2`、`--accent3`、`--accent-fg` |
| 文字 | `--text`、`--text-muted`、`--text-dim`、`--on-solid` |
| 面／線 | `--bg`、`--surface`、`--surface2`、`--border`、`--border-soft` |
| 狀態皮 | `--chip-*`、`.schip` 相關 border／文字色 |

## 硬規則

1. **狀態字不可用過淺色當 text**  
   - nordic／kitty 的 `--warn` 常是淺黃，**不要**當正文色。  
   - 狀態文字用 `--warn-text`、`--text-dim` 或 `color-mix(...%, var(--text))` 等已保證可讀的 token。
2. **`.sel` ≠ `.schip`**  
   - 使用者選取＝`.sel`（accent 外框／ring／硬邊偏移可保留）  
   - 系統狀態＝`.schip`（淡底＋狀態色字＋淡框，非實心色塊）
3. **禁止**為了「好看」只調 dark 而漏 nordic／kitty（歷史 bug：狀態填滿＋白字在淺主題對比不足）。
4. **不新造色值**：優先重用既有 token；新變數要在三個 `body[data-theme]` 區塊各寫一筆。

## 快速自查（改完打勾）

- [ ] dark：狀態字／chip／按鈕文字可讀  
- [ ] nordic：同上（尤其 `--warn`、`--accent3`）  
- [ ] kitty：同上（尤其 topbar `--header-bg`、`--success` 與 link 不撞）  
- [ ] 選取態 `.sel` 在三主題仍明顯（含硬邊 `--card-active-shadow`）  
- [ ] 手機寬度（約 375）無橫向爆版  

## 指令一行

```bash
node scripts/b15-style-probe.mjs
```

失敗請誠實回報（勿自稱實機通過）。需要瀏覽器時確認本機 Chrome 路徑或設 `CHROME_PATH`。
