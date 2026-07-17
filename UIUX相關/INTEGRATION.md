# Toast 元件整合說明

## 放檔案
- `src/lib/toast/toastEvents.ts` → 放同路徑
- `src/components/Toast.tsx` → 放同路徑
- `toast-additions.css` 的內容 → 貼到 `src/app/globals.css` 檔尾

## 掛載（layout.tsx 只需加兩行）
```tsx
import { ToastHost } from "@/components/Toast";
...
<Suspense fallback={null}>
  <MobileTabbar />
</Suspense>
<ToastHost />
```

## 使用方式（任何 client component 都能呼叫，不用 props）
```tsx
import { showToast } from "@/components/Toast";

showToast("已儲存此版本組合", "success");
showToast("上傳失敗，請重試", "error");
showToast("2 件缺重量欄位，已略過", "warn");
showToast("已切換排序：最新在前", "info"); // 預設值，可省略
```

## 建議接下來替換的地方
把目前分散的 4 個 `setError` 局部狀態（`PublishRecordsPanel`、`ProductLibraryModal`、
`ImageReviewPanel`、`DashboardTodoPanel`）以及各處 API 失敗後單純 `console.error`
或無提示的地方，統一改成 `showToast(msg, "error")`。批次動作成功後（如
`DraftQueueList.batchApproveAndPublish` 目前用 `setMessage("批次核准中...")`
這種局部文字）也可以改成 toast，成功/失敗都會有一致的視覺回饋。

`window.confirm(...)` 那幾處不建議改用 toast（toast 不該用來做「確認」），
但可以在使用者真的按下確認、動作送出成功之後，加一句 toast 收尾，例如：
```tsx
if (!approveResponse.ok) {
  showToast("批次核准失敗，請重試", "error");
} else {
  showToast(`已核准並上架 ${selectedArray.length} 件`, "success");
}
```
