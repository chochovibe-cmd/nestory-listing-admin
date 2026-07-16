import { permanentRedirect } from "next/navigation";

/**
 * R4 Q2-A: /drafts 佇列頁功能併入 /records 後下線。
 * permanentRedirect → 舊書籤不 404（308）.
 * /drafts/[id] 詳情路由保留.
 */
export default function DraftQueuePage() {
  permanentRedirect("/records");
}
