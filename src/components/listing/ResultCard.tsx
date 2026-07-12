"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { StatusBadge } from "@/components/listing/StatusBadge";
import {
  formatReadyButPipelinePendingMessage,
  formatUnmarkedBlockMessage,
  imageSlotLabel,
  listPipelineImages,
  listUnmarkedPipelineImages,
  patchForProcessIntentPick,
  PROCESS_INTENT_LABELS
} from "@/lib/images/processMarks";
import {
  isResultCardTabId,
  RESULT_CARD_TABS,
  tabLabelWithWarn,
  type ResultCardTabId
} from "@/lib/drafts/resultCardTabs";
import type { ImageProcessIntent, PriceMode, ProductDraft, ProductImage } from "@/types/domain";
import {
  extractMissingCharacterNames,
  isCharacterMissingInWarnings,
} from "@/lib/characters/missingCharacterWarnings";

// This icon only reports whether AI text-generation itself finished, failed,
// or is still running -- it must never fall back to a green "done" check for
// needs_revision, or it visually contradicts the "需修改" status badge right
// next to it (a scanning eye reads green-checkmark as "all good").
function statusIcon(draft: ProductDraft): { icon: string; className: string } {
  if (draft.generation_status === "processing") return { icon: "↻", className: "generating" };
  if (draft.generation_status === "failed" || draft.status === "api_failed" || draft.status === "failed") {
    return { icon: "✗", className: "error" };
  }
  if (draft.status === "needs_revision") return { icon: "!", className: "revision" };
  return { icon: "✓", className: "done" };
}

const APPROVED_STATUSES = new Set(["approved", "publishing", "draft_created", "active_published"]);

const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "GPT",
  codex: "Codex",
  other: "其他"
};

// product_images only stores the public URL, not the storage path -- derive
// the path Supabase Storage needs for .remove() from it instead of tracking
// a separate column just for this.
function storagePathFromUrl(url: string): string | null {
  const marker = "/product-images/";
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
}

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

function mainThumbUrl(images: ProductImage[]): string | null {
  const mains = images
    .filter((image) => image.image_type === "main")
    .sort((a, b) => a.sort_order - b.sort_order);
  const first = mains[0] ?? images.find((image) => image.image_type !== "detail") ?? images[0];
  if (!first) return null;
  return first.processed_file_url ?? first.original_file_url ?? first.generated_file_url ?? null;
}

export function ResultCard({
  draft,
  images,
  checked,
  onToggle,
  defaultExpanded = false
}: {
  draft: ProductDraft;
  images: ProductImage[];
  checked?: boolean;
  onToggle?: () => void;
  defaultExpanded?: boolean;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [activeTab, setActiveTab] = useState<ResultCardTabId>("copy");
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
  const [markMessage, setMarkMessage] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickAddingCharacter, setQuickAddingCharacter] = useState<string | null>(null);
  const [faqView, setFaqView] = useState<"preview" | "html">("preview");
  // Local mirror of pipeline marks so toggles feel instant; re-synced on refresh.
  const [imageMarks, setImageMarks] = useState<ProductImage[]>(images);

  const { icon, className } = statusIcon(draft);
  // B6: 卡片只跟讀 price_mode（不做完整切換 UI）；migration 020 前 fallback 特價。
  const priceMode: PriceMode = draft.price_mode === "single" ? "single" : "sale";
  const profit = draft.twd_price != null && draft.twd_cost != null ? draft.twd_price - draft.twd_cost : null;
  const profitPct =
    profit != null && draft.twd_price && draft.twd_price > 0
      ? Math.round((profit / draft.twd_price) * 100)
      : null;
  const pipelineImages = listPipelineImages(imageMarks);
  const unmarkedImages = listUnmarkedPipelineImages(imageMarks);
  const unmarkedBlockMessage = formatUnmarkedBlockMessage(imageMarks);
  const missingCharacters = extractMissingCharacterNames(draft.warnings);
  const characterChipWarned = isCharacterMissingInWarnings(draft.character_name, draft.warnings);
  const warnCount = draft.warnings?.length ?? 0;
  const detectTypeLabel = draft.product_type || draft.detected_category || "";
  const thumbUrl = mainThumbUrl(imageMarks);
  const canQuickApprove =
    draft.generation_status !== "processing" &&
    draft.generation_status !== "failed" &&
    draft.status !== "failed" &&
    draft.status !== "api_failed";

  // B9: collapsed-visible notice — never silent-fail on quick actions.
  const collapsedNotice = markMessage || message;

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

  useEffect(() => {
    // Normalize before migration 019 is applied (fields may be missing at runtime).
    setImageMarks(
      images.map((image) => ({
        ...image,
        process_intent: image.process_intent ?? null,
        is_spec_process: Boolean(image.is_spec_process)
      }))
    );
  }, [images]);

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
        // B6: 單一售價存檔時強制清掉定價，避免殘留劃線價。
        compare_at_price:
          priceMode === "single" ? null : compareAtPrice ? Number(compareAtPrice) : null,
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

  // B4: one-click write ip_characters (pending). Does not auto-regenerate (5A).
  async function quickAddCharacter(characterName: string) {
    if (!characterName.trim()) return;
    setQuickAddingCharacter(characterName);
    setMessage("");
    try {
      const response = await fetch("/api/characters/quick-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          characterName,
          ipName: draft.ip_name ?? "",
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "一鍵新增角色失敗");
        return;
      }
      setMessage(
        typeof payload.message === "string"
          ? payload.message
          : `已處理角色「${characterName}」，請按重新生成以產出角色 tag`,
      );
    } catch {
      setMessage("一鍵新增角色連線失敗");
    } finally {
      setQuickAddingCharacter(null);
    }
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

  // B9 D1-C: collapsed quick ✓ = pure approve (no publish).
  async function approveOnly() {
    setMarkMessage("");
    setQuickBusy(true);
    setMessage("核准中...");
    try {
      const approveResponse = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await approveResponse.json().catch(() => ({}));
      if (!approveResponse.ok) {
        setMessage(payload.error ?? "核准失敗");
        return;
      }
      setMessage("已核准文案（尚未發布）");
      router.refresh();
    } catch {
      setMessage("核准連線失敗");
    } finally {
      setQuickBusy(false);
    }
  }

  // Approve and publish are merged into one click -- same person does both
  // steps in practice, so there's no value in a separate confirm-then-publish
  // round trip. Still two API calls under the hood (approve's audit trail in
  // review_logs stays intact), just fired back to back.
  async function approveAndPublish() {
    if (publishMode === "active") {
      if (!window.confirm("即將核准並建立 Shopify ACTIVE 商品，確定發布？")) return;
    }

    setMessage("核准中...");
    const approveResponse = await fetch(`/api/drafts/${draft.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({})
    });
    if (!approveResponse.ok) {
      const payload = await approveResponse.json().catch(() => ({}));
      setMessage(payload.error ?? "核准失敗");
      return;
    }

    setMessage("發布中...");
    const publishResponse = await fetch(`/api/drafts/${draft.id}/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ publishMode, confirmActive: publishMode === "active" })
    });
    const payload = await publishResponse.json();
    setMessage(publishResponse.ok ? "已核准並發布" : payload.error ?? "發布失敗");
    router.refresh();
  }

  async function removeImage(image: ProductImage) {
    const url = image.processed_file_url ?? image.original_file_url;
    const path = url ? storagePathFromUrl(url) : null;
    if (path) {
      await supabase.storage.from("product-images").remove([path]);
    }
    const { error } = await supabase.from("product_images").delete().eq("id", image.id);
    setMessage(error ? `刪除圖片失敗：${error.message}` : "已刪除圖片");
    if (!error) {
      setImageMarks((current) => current.filter((row) => row.id !== image.id));
    }
    router.refresh();
  }

  // B5: client-side update under existing product_images RLS (owner of
  // unpublished draft / reviewer). Does not loosen policies.
  async function setProcessIntent(image: ProductImage, intent: ImageProcessIntent) {
    const patch = patchForProcessIntentPick(intent, image.is_spec_process);
    setMarkMessage("");
    const { error } = await supabase
      .from("product_images")
      .update({
        process_intent: patch.process_intent,
        is_spec_process: patch.is_spec_process
      })
      .eq("id", image.id);

    if (error) {
      setMarkMessage(`標記失敗：${error.message}`);
      return;
    }

    setImageMarks((current) =>
      current.map((row) =>
        row.id === image.id
          ? { ...row, process_intent: patch.process_intent, is_spec_process: patch.is_spec_process }
          : row
      )
    );
    router.refresh();
  }

  async function toggleSpecOnCard(image: ProductImage) {
    const nextOn = !image.is_spec_process;
    const patch = nextOn
      ? { is_spec_process: true, process_intent: "de_text" as const }
      : { is_spec_process: false, process_intent: null };
    setMarkMessage("");
    const { error } = await supabase
      .from("product_images")
      .update(patch)
      .eq("id", image.id);

    if (error) {
      setMarkMessage(`規格圖標記失敗：${error.message}`);
      return;
    }

    setImageMarks((current) =>
      current.map((row) =>
        row.id === image.id
          ? { ...row, is_spec_process: patch.is_spec_process, process_intent: patch.process_intent }
          : row
      )
    );
    router.refresh();
  }

  // B5 裁決 3A: block when unmarked (specific which/how many); when all marked,
  // explain Phase D pipeline is not wired yet — no Make webhook here.
  // B9: always surface markMessage while collapsed (never silent).
  function sendImages() {
    setMessage("");
    const block = formatUnmarkedBlockMessage(imageMarks);
    if (block) {
      setMarkMessage(block);
      return;
    }
    setMarkMessage(formatReadyButPipelinePendingMessage(imageMarks));
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

  function selectTab(tab: ResultCardTabId) {
    if (!isResultCardTabId(tab)) return;
    setActiveTab(tab);
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
        {/* B9 D4-A: main thumb on collapsed row */}
        <span className="rc-thumb" aria-hidden={thumbUrl ? undefined : true}>
          {thumbUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="rc-thumb-img" src={thumbUrl} />
          ) : (
            <span className="rc-thumb-placeholder">◈</span>
          )}
        </span>
        <span className="rc-headmain">
          <span className="rc-title">{draft.title_zh || draft.taobao_title || "商品草稿"}</span>
          {/* B4: 收合列即可見 IP／角色／類型 chips＋⚠（不用展開才發現未建檔） */}
          {draft.ip_name || draft.character_name || detectTypeLabel || warnCount > 0 ? (
            <span className="rc-detect-chips">
              {draft.ip_name ? <span className="rc-detect-chip">{draft.ip_name}</span> : null}
              {draft.character_name ? (
                <span className={`rc-detect-chip${characterChipWarned ? " is-warn" : ""}`}>
                  {characterChipWarned ? "⚠ " : ""}
                  {draft.character_name}
                </span>
              ) : null}
              {detectTypeLabel ? <span className="rc-detect-chip">{detectTypeLabel}</span> : null}
              {warnCount > 0 ? (
                <span className="rc-detect-warn">⚠ {warnCount} 項待確認</span>
              ) : null}
            </span>
          ) : null}
        </span>
        {draft.twd_price ? (
          <div className="rc-price-stack">
            <span className="rc-price">NT${draft.twd_price.toLocaleString()}</span>
            {priceMode === "sale" && draft.compare_at_price ? (
              <span className="rc-compare muted">定價 NT${draft.compare_at_price.toLocaleString()}</span>
            ) : null}
            {profit != null ? (
              <span className="rc-profit">
                利潤 NT${profit.toLocaleString()}
                {profitPct != null ? `（約 ${profitPct}%）` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        {/* B9: quick actions — stopPropagation so row does not toggle */}
        <span className="rc-quick" onClick={(event) => event.stopPropagation()}>
          <button
            className="mini-btn rc-quick-btn"
            disabled={quickBusy || regenerating || !canQuickApprove}
            onClick={() => void approveOnly()}
            title="只核准文案，不會發布到 Shopify"
            type="button"
          >
            {quickBusy ? "…" : "✓ 核准"}
          </button>
          <button
            className="mini-btn rc-quick-btn"
            disabled={quickBusy || regenerating}
            onClick={sendImages}
            title="送圖；未標記會擋下並列出哪幾張"
            type="button"
          >
            ▶ 送圖
          </button>
        </span>
        <span className="rc-toggle">{expanded ? "▾" : "▸"}</span>
      </div>

      {/* Status chips row (always visible when collapsed or expanded) */}
      <div className="rc-status-chips">
        <StatusBadge status={draft.status} />
        {pipelineImages.length > 0 && unmarkedImages.length > 0 ? (
          <span className="img-mark-status" title={unmarkedBlockMessage ?? undefined}>
            <span className="st-dot" />
            圖片未標記（{unmarkedImages.length}）
          </span>
        ) : null}
      </div>

      {/* B9 req2: collapsed-visible notice for quick-action block/fail */}
      {collapsedNotice ? (
        <div
          className={
            markMessage && (markMessage.includes("還沒標記") || markMessage.includes("沒標記") || markMessage.includes("沒有可送"))
              ? "rc-collapsed-notice is-warn"
              : markMessage && markMessage.includes("尚未接通")
                ? "rc-collapsed-notice"
                : "rc-collapsed-notice"
          }
          role="status"
        >
          {collapsedNotice}
        </div>
      ) : null}

      {expanded ? (
        <div className="rc-body">
          {/* B9 D3-A: 4 underline tabs; SEO inside 文案 */}
          <div className="rc-tabs" role="tablist" aria-label="卡片分頁">
            {RESULT_CARD_TABS.map((tab) => (
              <button
                aria-selected={activeTab === tab.id}
                className={`rc-tab${activeTab === tab.id ? " active" : ""}`}
                key={tab.id}
                onClick={() => selectTab(tab.id)}
                role="tab"
                type="button"
              >
                {tabLabelWithWarn(tab.id, warnCount)}
              </button>
            ))}
          </div>

          {activeTab === "copy" ? (
            <div className="rc-tabpanel" role="tabpanel">
              <div className="rc-field">
                <div className="rc-label">快速狀態</div>
                <div className="rc-text">
                  {APPROVED_STATUSES.has(draft.status) ? (
                    <span className="audit-badge ok">已審核</span>
                  ) : (
                    <span className="audit-badge">待審核</span>
                  )}
                  　來源：{draft.source_platform ?? "-"}
                  　成本：{draft.cny_price.toLocaleString()}
                  　模式：{priceMode === "single" ? "單一售價" : "特價"}
                  　定價：
                  {priceMode === "single"
                    ? "不適用"
                    : draft.compare_at_price
                      ? `NT$${draft.compare_at_price.toLocaleString()}`
                      : "未填"}
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
              <div className="rc-field">
                <div className="rc-label">AI 偵測</div>
                <div className="rc-text">
                  IP：{draft.ip_name || "—"}
                  ｜角色：{draft.character_name || "—"}
                  {characterChipWarned ? " ⚠" : ""}
                  ｜型態：{detectTypeLabel || "—"}
                  ｜SKU：{sku || "—"}
                </div>
                {missingCharacters.length > 0 ? (
                  <div className="rc-quick-add-list">
                    {missingCharacters.map((name) => (
                      <div className="rc-quick-add-row" key={name}>
                        <span className="price-soft-warn">
                          ⚠ 角色「{name}」尚未建檔
                          {!draft.ip_name ? "（請先確認 IP 已建檔）" : ""}
                        </span>
                        <button
                          className="mini-btn"
                          disabled={
                            !draft.ip_name || quickAddingCharacter === name || regenerating
                          }
                          onClick={() => void quickAddCharacter(name)}
                          type="button"
                        >
                          {quickAddingCharacter === name ? "新增中…" : "一鍵新增角色"}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
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
            </div>
          ) : null}

          {activeTab === "pricing" ? (
            <div className="rc-tabpanel" role="tabpanel">
              <div className="rc-field">
                <div className="rc-label">定價</div>
                {draft.twd_cost != null ? (
                  <div className="muted">
                    成本 NT${draft.twd_cost.toLocaleString()}
                    {profit != null ? ` ／ 利潤 NT$${profit.toLocaleString()}` : null}
                    {profitPct != null ? `（約 ${profitPct}%）` : null}
                    {priceMode === "single" ? " ／ 單一售價（無劃線定價）" : " ／ 特價模式"}
                  </div>
                ) : null}
                <div className="row">
                  <div className="field">
                    <label>售價 TWD</label>
                    <input className="edit-input" min="0" onChange={(event) => setSellPrice(event.target.value)} type="number" value={sellPrice} />
                  </div>
                  {priceMode === "sale" ? (
                    <div className="field">
                      <label>定價 TWD</label>
                      <input className="edit-input" min="0" onChange={(event) => setCompareAtPrice(event.target.value)} type="number" value={compareAtPrice} />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {activeTab === "images" ? (
            <div className="rc-tabpanel" role="tabpanel">
              {imageMarks.length > 0 ? (
                <div className="rc-field">
                  <div className="rc-label">圖片處理標記（預設不選，未標記不能送圖）</div>
                  {pipelineImages.length > 0 ? (
                    <div className="imgmark-list">
                      {pipelineImages.map((image, index) => {
                        const src =
                          image.processed_file_url ?? image.original_file_url ?? image.generated_file_url ?? "";
                        const slot = imageSlotLabel(image, index + 1);
                        const intents = (image.is_spec_process
                          ? (["de_text"] as ImageProcessIntent[])
                          : (["keep", "de_text", "regenerate"] as ImageProcessIntent[]));
                        return (
                          <div className="imgmark-row" key={image.id}>
                            <div className="thumb-wrap">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img alt={image.alt_text ?? slot} className="imgmark-thumb" src={src} />
                              <button
                                className="thumb-remove"
                                onClick={() => void removeImage(image)}
                                title="移除這張圖片"
                                type="button"
                              >
                                ✕
                              </button>
                            </div>
                            <span className="imgmark-slot-label">{slot}</span>
                            <span className="imgmark-btns">
                              {intents.map((intent) => (
                                <button
                                  aria-pressed={image.process_intent === intent}
                                  className={`img-mark-btn${image.process_intent === intent ? " active" : ""}`}
                                  key={intent}
                                  onClick={() => void setProcessIntent(image, intent)}
                                  type="button"
                                >
                                  {image.process_intent === intent ? `✓ ${PROCESS_INTENT_LABELS[intent]}` : PROCESS_INTENT_LABELS[intent]}
                                </button>
                              ))}
                              {!image.is_spec_process ? (
                                <button
                                  aria-pressed={false}
                                  className="img-mark-btn"
                                  onClick={() => void toggleSpecOnCard(image)}
                                  type="button"
                                >
                                  規格圖
                                </button>
                              ) : (
                                <button
                                  aria-pressed
                                  className="img-mark-btn active"
                                  onClick={() => void toggleSpecOnCard(image)}
                                  type="button"
                                >
                                  ✓ 規格圖
                                </button>
                              )}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                  {imageMarks.some((image) => image.image_type === "detail") ? (
                    <div className="thumbs" style={{ marginTop: 10 }}>
                      {imageMarks
                        .filter((image) => image.image_type === "detail")
                        .map((image) => (
                          <div className="thumb-wrap" key={image.id}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              alt={image.alt_text ?? "詳情圖"}
                              src={image.processed_file_url ?? image.original_file_url ?? image.generated_file_url ?? ""}
                            />
                            <button
                              className="thumb-remove"
                              onClick={() => void removeImage(image)}
                              title="移除這張圖片"
                              type="button"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                    </div>
                  ) : null}
                  {unmarkedImages.length > 0 && unmarkedBlockMessage ? (
                    <div className="img-mark-warn" role="status">{unmarkedBlockMessage}</div>
                  ) : null}
                </div>
              ) : (
                <div className="muted">尚無商品圖。請在左側上傳主圖後再標記／送圖。</div>
              )}
            </div>
          ) : null}

          {activeTab === "tags" ? (
            <div className="rc-tabpanel" role="tabpanel">
              <div className="field">
                <label>Tags <CopyButton getValue={() => tags} /></label>
                <div className="rc-tags">
                  {tags.split(",").map((tag) => tag.trim()).filter(Boolean).map((tag) => (
                    <span className="rc-tag" key={tag}>{tag}</span>
                  ))}
                </div>
                <input className="edit-input" onChange={(event) => setTags(event.target.value)} value={tags} />
              </div>
              {draft.warnings?.length ? (
                <div className="rc-field">
                  <div className="rc-label">提醒</div>
                  {draft.warnings.map((warning) => {
                    const missingFromLine = extractMissingCharacterNames([warning]);
                    return (
                      <div className="rc-warning-line" key={warning}>
                        <div className="price-soft-warn">{warning}</div>
                        {missingFromLine.map((name) => (
                          <button
                            className="mini-btn"
                            disabled={!draft.ip_name || quickAddingCharacter === name || regenerating}
                            key={`${warning}-${name}`}
                            onClick={() => void quickAddCharacter(name)}
                            type="button"
                          >
                            {quickAddingCharacter === name ? "新增中…" : `一鍵新增「${name}」`}
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="muted">目前沒有待確認提醒。</div>
              )}
            </div>
          ) : null}

          {/* Footer actions — all tabs share; only-add (D1-C keeps 核准並發布) */}
          <div className="field">
            <label>發布模式</label>
            <select onChange={(event) => setPublishMode(event.target.value as "active" | "draft")} value={publishMode}>
              <option value="active">active：審核後直接發布</option>
              <option value="draft">draft：只建立 Shopify 草稿</option>
            </select>
          </div>
          <div className="rc-actions">
            <span className="rc-actions-group">
              <button onClick={() => void save()} type="button">儲存修改</button>
              <button disabled={regenerating} onClick={() => void regenerate()} type="button">
                {regenerating ? "生成中..." : "↺ 重新生成"}
              </button>
            </span>
            <span className="rc-actions-group rc-actions-group-review">
              <button onClick={() => void requestRevision()} type="button">退回修改</button>
              <button onClick={sendImages} type="button">
                ▶ 送圖
              </button>
              <button className={publishMode === "active" ? "danger" : ""} onClick={() => void approveAndPublish()} type="button">
                ✓ 核准並發布
              </button>
              <button onClick={() => void exportCsv()} type="button">產生 CSV</button>
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}
