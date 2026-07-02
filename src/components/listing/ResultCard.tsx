"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import type { ProductDraft, ProductImage } from "@/types/domain";

function statusIcon(draft: ProductDraft): { icon: string; className: string } {
  if (draft.generation_status === "processing") return { icon: "↻", className: "generating" };
  if (draft.generation_status === "failed" || draft.status === "api_failed" || draft.status === "failed") {
    return { icon: "✗", className: "error" };
  }
  return { icon: "✓", className: "done" };
}

export function ResultCard({
  draft,
  images,
  defaultExpanded = false
}: {
  draft: ProductDraft;
  images: ProductImage[];
  defaultExpanded?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [title, setTitle] = useState(draft.title_zh ?? "");
  const [description, setDescription] = useState(draft.description_html ?? "");
  const [seoTitle, setSeoTitle] = useState(draft.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(draft.seo_description ?? "");
  const [tags, setTags] = useState(draft.tags?.join(", ") ?? "");
  const [publishMode, setPublishMode] = useState(draft.publish_mode);
  const [message, setMessage] = useState("");
  const [regenerating, setRegenerating] = useState(false);

  const { icon, className } = statusIcon(draft);

  async function save() {
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

    setMessage(error ? error.message : "已儲存修改");
    router.refresh();
  }

  async function regenerate() {
    setRegenerating(true);
    setMessage("重新生成中...");
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: draft.id, provider: readStoredAiProvider() })
    });
    const payload = await response.json();
    setRegenerating(false);
    setMessage(response.ok ? "重新生成完成" : payload.error ?? "重新生成失敗");
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
    const comment = window.prompt("請輸入退回原因：") ?? "";
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
      if (!window.confirm("即將建立 Shopify ACTIVE 商品，確定發布？")) return;
    }

    const response = await fetch(`/api/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishMode, confirmActive: publishMode === "active" })
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
    <div className={`result-card${expanded ? " active" : ""}`}>
      <div className="rc-header" onClick={() => setExpanded((current) => !current)}>
        <span className={`rc-status ${className}`}>{icon}</span>
        <span className="rc-title">{draft.title_zh || draft.taobao_title || "商品草稿"}</span>
        {draft.twd_price ? <span className="rc-price">NT${draft.twd_price.toLocaleString()}</span> : null}
        <span className="rc-toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded ? (
        <div className="rc-body">
          <div className="rc-field">
            <div className="rc-label">原始標題</div>
            <div className="muted">{draft.taobao_title ?? draft.original_title ?? "-"}</div>
          </div>
          <div className="field">
            <label>商品標題</label>
            <input onChange={(event) => setTitle(event.target.value)} value={title} />
          </div>
          <div className="field">
            <label>商品描述</label>
            <textarea onChange={(event) => setDescription(event.target.value)} rows={10} value={description} />
          </div>
          <div className="field">
            <label>SEO 標題</label>
            <input onChange={(event) => setSeoTitle(event.target.value)} value={seoTitle} />
          </div>
          <div className="field">
            <label>SEO 描述</label>
            <textarea onChange={(event) => setSeoDescription(event.target.value)} value={seoDescription} />
          </div>
          <div className="field">
            <label>Tags</label>
            <div className="rc-tags">
              {tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                <span className="rc-tag" key={tag}>{tag}</span>
              ))}
            </div>
            <input onChange={(event) => setTags(event.target.value)} value={tags} />
          </div>
          {images.length > 0 ? (
            <div className="rc-field">
              <div className="rc-label">圖片</div>
              <div className="thumbs">
                {images.map((image) => (
                  <img
                    alt={image.alt_text ?? image.image_type}
                    key={image.id}
                    src={image.processed_file_url ?? image.original_file_url ?? image.generated_file_url ?? ""}
                  />
                ))}
              </div>
            </div>
          ) : null}
          {draft.warnings?.length ? (
            <div className="rc-field">
              <div className="rc-label">提醒</div>
              {draft.warnings.map((warning) => <div className="muted" key={warning}>{warning}</div>)}
            </div>
          ) : null}
          <div className="field">
            <label>發布模式</label>
            <select onChange={(event) => setPublishMode(event.target.value as "active" | "draft")} value={publishMode}>
              <option value="active">active：審核後直接發布</option>
              <option value="draft">draft：只建立 Shopify 草稿</option>
            </select>
          </div>
          <div className="rc-actions">
            <button onClick={save} type="button">儲存修改</button>
            <button disabled={regenerating} onClick={regenerate} type="button">
              {regenerating ? "生成中..." : "↺ 重新生成"}
            </button>
            <button onClick={requestRevision} type="button">退回修改</button>
            <button onClick={markApproved} type="button">核准</button>
            <button className={publishMode === "active" ? "danger" : ""} onClick={publish} type="button">
              審核並發布
            </button>
            <button onClick={exportCsv} type="button">產生 CSV</button>
          </div>
          {message ? <div className="notice">{message}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
