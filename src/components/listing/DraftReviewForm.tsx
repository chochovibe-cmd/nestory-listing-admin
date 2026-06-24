"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { ProductDraft } from "@/types/domain";

export function DraftReviewForm({ draft }: { draft: ProductDraft }) {
  const router = useRouter();
  const supabase = createClient();
  const [title, setTitle] = useState(draft.title_zh ?? "");
  const [description, setDescription] = useState(draft.description_html ?? "");
  const [seoTitle, setSeoTitle] = useState(draft.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(draft.seo_description ?? "");
  const [tags, setTags] = useState(draft.tags?.join(", ") ?? "");
  const [publishMode, setPublishMode] = useState(draft.publish_mode);
  const [message, setMessage] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { error } = await supabase
      .from("product_drafts")
      .update({
        title_zh: title || null,
        description_html: description || null,
        seo_title: seoTitle || null,
        seo_description: seoDescription || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        publish_mode: publishMode
      })
      .eq("id", draft.id);

    setMessage(error ? error.message : "已儲存審核修改");
    router.refresh();
  }

  async function markApproved() {
    const response = await fetch(`/api/drafts/${draft.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    const payload = await response.json();
    setMessage(response.ok ? "已核准，尚未發布" : payload.error ?? "核准失敗");
    router.refresh();
  }

  async function requestRevision() {
    const comment = window.prompt("請輸入退回原因，讓 operator 知道要改什麼：") ?? "";
    const response = await fetch(`/api/drafts/${draft.id}/request-revision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ comment })
    });
    const payload = await response.json();
    setMessage(response.ok ? "已退回修改" : payload.error ?? "退回失敗");
    router.refresh();
  }

  async function publish() {
    if (publishMode === "active") {
      const ok = window.confirm("即將建立 Shopify ACTIVE 商品。請確認文案、價格、圖片都已審核完成。");
      if (!ok) return;
      const secondOk = window.confirm("二次確認：ACTIVE 商品可能會直接出現在商店前台，確定發布？");
      if (!secondOk) return;
    }

    const response = await fetch(`/api/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        publishMode,
        confirmActive: publishMode === "active"
      })
    });
    const payload = await response.json();
    setMessage(response.ok ? "發布流程已送出" : payload.error ?? "發布失敗");
    router.refresh();
  }

  async function exportCsv() {
    const response = await fetch("/api/exports/matrixify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: [draft.id] })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setMessage(payload.error ?? "CSV 產生失敗");
      return;
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `nestory-matrixify-${draft.id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage("CSV 備援檔已產生");
  }

  return (
    <form className="panel" onSubmit={save}>
      <div className="panel-header">
        <h2>審核與修改</h2>
        <span className="status">{draft.publish_method}</span>
      </div>
      <div className="panel-body">
        <div className="field">
          <label>商品標題</label>
          <input onChange={(event) => setTitle(event.target.value)} value={title} />
        </div>
        <div className="field">
          <label>商品描述 HTML</label>
          <textarea onChange={(event) => setDescription(event.target.value)} value={description} />
        </div>
        <div className="field">
          <label>SEO Title</label>
          <input onChange={(event) => setSeoTitle(event.target.value)} value={seoTitle} />
        </div>
        <div className="field">
          <label>SEO Description</label>
          <textarea onChange={(event) => setSeoDescription(event.target.value)} value={seoDescription} />
        </div>
        <div className="field">
          <label>Tags（逗號分隔）</label>
          <input onChange={(event) => setTags(event.target.value)} value={tags} />
        </div>
        <div className="field">
          <label>發布模式</label>
          <select onChange={(event) => setPublishMode(event.target.value as "active" | "draft")} value={publishMode}>
            <option value="active">active：審核後直接發布</option>
            <option value="draft">draft：只建立 Shopify 草稿</option>
          </select>
        </div>
        <div className="nav">
          <button type="submit">儲存修改</button>
          <button type="button" onClick={requestRevision}>退回修改</button>
          <button type="button" onClick={markApproved}>核准</button>
          <button className={publishMode === "active" ? "danger" : "primary"} type="button" onClick={publish}>
            審核並發布
          </button>
          <button type="button" onClick={exportCsv}>產生 CSV 備援</button>
        </div>
        {message ? <div className="notice">{message}</div> : null}
      </div>
    </form>
  );
}
