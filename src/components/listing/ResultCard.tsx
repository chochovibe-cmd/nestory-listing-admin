"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { ImageUploader } from "@/components/listing/ImageUploader";
import type { ProductDraft, ProductImage } from "@/types/domain";

function statusIcon(draft: ProductDraft): { icon: string; className: string } {
  if (draft.generation_status === "processing") return { icon: "↻", className: "generating" };
  if (draft.generation_status === "failed" || draft.status === "api_failed" || draft.status === "failed") {
    return { icon: "✗", className: "error" };
  }
  return { icon: "✓", className: "done" };
}

const APPROVED_STATUSES = new Set(["approved", "publishing", "draft_created", "active_published"]);

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "GPT",
  codex: "Codex",
  other: "其他"
};

function CopyButton({ getValue }: { getValue: () => string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const value = getValue();
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button className={`copy-btn${copied ? " copied" : ""}`} onClick={handleCopy} type="button">
      {copied ? "✓" : "複製"}
    </button>
  );
}

export function ResultCard({
  draft,
  images,
  userId,
  checked,
  onToggle,
  defaultExpanded = false
}: {
  draft: ProductDraft;
  images: ProductImage[];
  userId: string;
  checked?: boolean;
  onToggle?: () => void;
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
  const [faq, setFaq] = useState(draft.generated_faq_html ?? "");
  const [sellPrice, setSellPrice] = useState(draft.twd_price?.toString() ?? "");
  const [compareAtPrice, setCompareAtPrice] = useState(draft.compare_at_price?.toString() ?? "");
  const [detectedCategory, setDetectedCategory] = useState(draft.detected_category ?? "");
  const [sku, setSku] = useState(draft.sku ?? "");
  const [publishMode, setPublishMode] = useState(draft.publish_mode);
  const [message, setMessage] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [faqView, setFaqView] = useState<"preview" | "html">("preview");

  const { icon, className } = statusIcon(draft);
  const profit = draft.twd_price != null && draft.twd_cost != null ? draft.twd_price - draft.twd_cost : null;

  // ResultCard stays mounted (same `key={draft.id}`) across regenerate/save's
  // router.refresh(), so these editable fields must be re-synced explicitly
  // when the underlying row changes -- otherwise an already-expanded card
  // keeps showing pre-regeneration text even though the DB has fresh content.
  useEffect(() => {
    setTitle(draft.title_zh ?? "");
    setDescription(draft.description_html ?? "");
    setSeoTitle(draft.seo_title ?? "");
    setSeoDescription(draft.seo_description ?? "");
    setTags(draft.tags?.join(", ") ?? "");
    setFaq(draft.generated_faq_html ?? "");
    setSellPrice(draft.twd_price?.toString() ?? "");
    setCompareAtPrice(draft.compare_at_price?.toString() ?? "");
    setDetectedCategory(draft.detected_category ?? "");
    setSku(draft.sku ?? "");
    setPublishMode(draft.publish_mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.updated_at]);

  async function save() {
    const { error } = await supabase
      .from("product_drafts")
      .update({
        title_zh: title || null,
        description_html: description || null,
        seo_title: seoTitle || null,
        seo_description: seoDescription || null,
        tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        generated_faq_html: faq || null,
        twd_price: sellPrice ? Number(sellPrice) : null,
        compare_at_price: compareAtPrice ? Number(compareAtPrice) : null,
        detected_category: detectedCategory || null,
        sku: sku || null,
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
      body: JSON.stringify({ draftId: draft.id, provider: readStoredAiProvider(), mode: readStoredRunMode() })
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
        {onToggle ? (
          <input
            checked={checked ?? false}
            className="rc-checkbox"
            onClick={(event) => event.stopPropagation()}
            onChange={onToggle}
            type="checkbox"
          />
        ) : null}
        <span className={`rc-status ${className}`}>{icon}</span>
        <span className="rc-title">{draft.title_zh || draft.taobao_title || "商品草稿"}</span>
        {draft.twd_price ? (
          <div className="rc-price-stack">
            <span className="rc-price">NT${draft.twd_price.toLocaleString()}</span>
            {profit != null ? <span className="rc-profit">利潤 NT${profit.toLocaleString()}</span> : null}
          </div>
        ) : null}
        <span className="rc-toggle">{expanded ? "▾" : "▸"}</span>
      </div>
      {expanded ? (
        <div className="rc-body">
          <div className="rc-field">
            <div className="rc-label">快速狀態</div>
            <div className="rc-text">
              {APPROVED_STATUSES.has(draft.status) ? (
                <span className="audit-badge ok">已審核</span>
              ) : (
                <span className="audit-badge">待審核</span>
              )}
              　來源：{draft.source_platform ?? "-"}
              　成本：¥{draft.cny_price.toLocaleString()}
              　定價：{draft.compare_at_price ? `NT$${draft.compare_at_price.toLocaleString()}` : "未填"}
              　AI：{PROVIDER_LABELS[draft.generation_provider] ?? draft.generation_provider}
            </div>
          </div>
          <div className="rc-field">
            <div className="rc-label">原始標題</div>
            <div className="muted">{draft.taobao_title ?? draft.original_title ?? "-"}</div>
          </div>
          <div className="field">
            <label>商品標題 <CopyButton getValue={() => title} /></label>
            <input className="edit-input" onChange={(event) => setTitle(event.target.value)} value={title} />
          </div>
          <div className="field">
            <label>商品描述 <CopyButton getValue={() => description} /></label>
            <textarea className="edit-textarea" onChange={(event) => setDescription(event.target.value)} rows={10} value={description} />
          </div>
          <div className="field">
            <label>SEO 標題 <CopyButton getValue={() => seoTitle} /></label>
            <input className="edit-input" onChange={(event) => setSeoTitle(event.target.value)} value={seoTitle} />
          </div>
          <div className="field">
            <label>SEO 描述 <CopyButton getValue={() => seoDescription} /></label>
            <textarea className="edit-textarea" onChange={(event) => setSeoDescription(event.target.value)} value={seoDescription} />
          </div>
          <div className="field">
            <div className="rc-view-tabs">
              <label>FAQ <CopyButton getValue={() => faq} /></label>
              <span className="rc-view-tabs-buttons">
                <button
                  className={faqView === "preview" ? "active" : ""}
                  onClick={() => setFaqView("preview")}
                  type="button"
                >
                  預覽
                </button>
                <button
                  className={faqView === "html" ? "active" : ""}
                  onClick={() => setFaqView("html")}
                  type="button"
                >
                  HTML 原始碼
                </button>
              </span>
            </div>
            {faqView === "preview" ? (
              <div className="rc-html-preview" dangerouslySetInnerHTML={{ __html: faq || "<p>尚無內容</p>" }} />
            ) : (
              <textarea className="edit-textarea" onChange={(event) => setFaq(event.target.value)} rows={6} value={faq} />
            )}
          </div>
          <div className="row">
            <div className="field">
              <label>AI 偵測類型</label>
              <input className="edit-input" onChange={(event) => setDetectedCategory(event.target.value)} value={detectedCategory} />
            </div>
            <div className="field">
              <label>SKU</label>
              <input className="edit-input" onChange={(event) => setSku(event.target.value)} value={sku} />
            </div>
          </div>
          <div className="rc-field">
            <div className="rc-label">定價</div>
            {draft.twd_cost != null ? (
              <div className="muted">
                成本 NT${draft.twd_cost.toLocaleString()}
                {profit != null && draft.twd_price ? ` ／ 毛利 ${Math.round((profit / draft.twd_price) * 100)}%` : null}
              </div>
            ) : null}
            <div className="row">
              <div className="field">
                <label>售價 TWD</label>
                <input className="edit-input" min="0" onChange={(event) => setSellPrice(event.target.value)} type="number" value={sellPrice} />
              </div>
              <div className="field">
                <label>定價 TWD</label>
                <input className="edit-input" min="0" onChange={(event) => setCompareAtPrice(event.target.value)} type="number" value={compareAtPrice} />
              </div>
            </div>
          </div>
          <div className="field">
            <label>Tags <CopyButton getValue={() => tags} /></label>
            <div className="rc-tags">
              {tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                <span className="rc-tag" key={tag}>{tag}</span>
              ))}
            </div>
            <input className="edit-input" onChange={(event) => setTags(event.target.value)} value={tags} />
          </div>
          {images.length > 0 ? (
            <div className="rc-field">
              <div className="rc-label">已上傳圖片</div>
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
          <div className="rc-field">
            <div className="rc-label">上傳圖片</div>
            <ImageUploader draftId={draft.id} userId={userId} />
          </div>
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
            <span className="rc-actions-group">
              <button onClick={save} type="button">儲存修改</button>
              <button disabled={regenerating} onClick={regenerate} type="button">
                {regenerating ? "生成中..." : "↺ 重新生成"}
              </button>
            </span>
            <span className="rc-actions-group rc-actions-group-review">
              <button onClick={requestRevision} type="button">退回修改</button>
              <button onClick={markApproved} type="button">核准</button>
              <button className={publishMode === "active" ? "danger" : ""} onClick={publish} type="button">
                審核並發布
              </button>
              <button onClick={exportCsv} type="button">產生 CSV</button>
            </span>
          </div>
          {message ? <div className="notice">{message}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
