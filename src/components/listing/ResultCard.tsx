"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { StatusBadge } from "@/components/listing/StatusBadge";
import {
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
import {
  anyCopyDirty,
  buildDraftCopyPatch,
  buildFieldVersions,
  COPY_VERSION_FIELD_LABELS,
  COPY_VERSION_FIELDS,
  copyDisplayDiffersFromDb,
  displayMapToCurrentValues,
  draftFieldContent,
  GenerationHistoryRow,
  groupHistoryByField,
  highlightsToContent,
  initialVersionIndex,
  planComboSaveHistoryInserts,
  type CopyVersionField,
  versionLabel,
} from "@/lib/drafts/copyVersionHistory";
import {
  buildSingleApproveSummary,
  modalHeading,
  primaryConfirmLabel,
  type FieldVersionInput,
} from "@/lib/drafts/approveSummary";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";
import {
  formatArchiveResultMessage,
  formatUnarchiveResultMessage,
  isArchiveBusyStatus,
  isPublishedArchiveStatus
} from "@/lib/drafts/archiveDrafts";
import { ApproveSummaryModal } from "@/components/listing/ApproveSummaryModal";
import type { ImageProcessIntent, PriceMode, ProductDraft, ProductImage } from "@/types/domain";
import {
  extractMissingCharacterNames,
  isCharacterMissingInWarnings,
} from "@/lib/characters/missingCharacterWarnings";
import {
  descriptionPreviewHtml,
  normalizeDescriptionToPlainText,
} from "@/lib/contentGenerator/htmlFormat";

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

/** B10: ← 版本 N/M → ↺ — version switch is local-only; ↺ spends LLM. */
function VersionNav({
  label,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onRegen,
  regenBusy,
  regenDisabled,
}: {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRegen: () => void;
  regenBusy: boolean;
  regenDisabled: boolean;
}) {
  return (
    <span className="version-nav" onClick={(event) => event.stopPropagation()}>
      <button
        aria-label="上一版"
        className="version-nav-btn"
        disabled={!canPrev || regenBusy}
        onClick={onPrev}
        type="button"
      >
        ←
      </button>
      <span className="version-nav-label">{label}</span>
      <button
        aria-label="下一版"
        className="version-nav-btn"
        disabled={!canNext || regenBusy}
        onClick={onNext}
        type="button"
      >
        →
      </button>
      <button
        aria-label="只重生此欄"
        className="version-nav-btn version-nav-regen"
        disabled={regenDisabled || regenBusy}
        onClick={onRegen}
        title="只重生此欄（會呼叫 AI，需花費）"
        type="button"
      >
        {regenBusy ? "…" : "↺"}
      </button>
    </span>
  );
}

function emptyVersionIndexMap(): Record<CopyVersionField, number> {
  return Object.fromEntries(COPY_VERSION_FIELDS.map((f) => [f, 0])) as Record<CopyVersionField, number>;
}

function emptyDirtyMap(): Partial<Record<CopyVersionField, boolean>> {
  return {};
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
  // fix(B10): tolerate legacy HTML rows — display/edit as plain text contract.
  const [description, setDescription] = useState(
    normalizeDescriptionToPlainText(draft.description_html ?? ""),
  );
  const [seoTitle, setSeoTitle] = useState(draft.seo_title ?? "");
  const [seoDescription, setSeoDescription] = useState(draft.seo_description ?? "");
  const [whyWeChoseIt, setWhyWeChoseIt] = useState(draft.why_we_chose_it ?? "");
  const [productHighlights, setProductHighlights] = useState(highlightsToContent(draft.product_highlights));
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
  const [regeneratingField, setRegeneratingField] = useState<CopyVersionField | null>(null);
  const [comboSaving, setComboSaving] = useState(false);
  // B11 D1-B: summary only for Shopify-affecting「核准並發布」(not pure ✓)
  const [approveSummaryOpen, setApproveSummaryOpen] = useState(false);
  const [approveSummaryBusy, setApproveSummaryBusy] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [lastArchiveIds, setLastArchiveIds] = useState<string[] | null>(null);
  const [quickAddingCharacter, setQuickAddingCharacter] = useState<string | null>(null);
  const [faqView, setFaqView] = useState<"preview" | "html">("preview");
  const [descriptionView, setDescriptionView] = useState<"preview" | "source">("preview");
  // Local mirror of pipeline marks so toggles feel instant; re-synced on refresh.
  const [imageMarks, setImageMarks] = useState<ProductImage[]>(images);
  // B10: generation_history (read-only for ←→; inserts on regen/manual commit)
  const [historyRows, setHistoryRows] = useState<GenerationHistoryRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [versionIndex, setVersionIndex] = useState<Record<CopyVersionField, number>>(emptyVersionIndexMap);
  const [copyDirty, setCopyDirty] = useState<Partial<Record<CopyVersionField, boolean>>>(emptyDirtyMap);

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
  const isArchived = draft.status === "archived";
  const canQuickApprove =
    !isArchived &&
    draft.generation_status !== "processing" &&
    draft.generation_status !== "failed" &&
    draft.status !== "failed" &&
    draft.status !== "api_failed";

  // B9: collapsed-visible notice — never silent-fail on quick actions.
  const collapsedNotice = markMessage || message;

  // fix(B12): commit notice first; defer refresh so UI isn't racing RSC.
  async function archiveOne() {
    if (isArchived || archiveBusy) return;
    if (isArchiveBusyStatus(draft.status)) {
      setMarkMessage("生成中／上架中，請稍後再封存");
      return;
    }
    setArchiveBusy(true);
    setMarkMessage("封存中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: [draft.id], action: "archive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMarkMessage(payload.error ?? "封存失敗");
        return;
      }
      const archivedIds = (payload.archivedIds as string[] | undefined) ?? [];
      setLastArchiveIds(archivedIds.length ? archivedIds : null);
      const msg =
        typeof payload.message === "string"
          ? payload.message
          : formatArchiveResultMessage({
              archivedCount: payload.archivedCount ?? 0,
              skippedBusyCount: payload.skippedBusyCount ?? 0,
              includesPublished: isPublishedArchiveStatus(draft.status)
            });
      setMarkMessage(msg);
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMarkMessage("封存連線失敗");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function unarchiveOne(ids?: string[]) {
    const targetIds = ids?.length ? ids : [draft.id];
    setArchiveBusy(true);
    setMarkMessage("解除封存中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: targetIds, action: "unarchive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMarkMessage(payload.error ?? "解除封存失敗");
        return;
      }
      setLastArchiveIds(null);
      setMarkMessage(
        typeof payload.message === "string"
          ? payload.message
          : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? targetIds.length })
      );
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMarkMessage("解除封存連線失敗");
    } finally {
      setArchiveBusy(false);
    }
  }

  const displayByField = useMemo((): Record<CopyVersionField, string> => ({
    enriched_title: title,
    why_we_chose_it: whyWeChoseIt,
    product_highlights: productHighlights,
    generated_description_html: description,
    generated_faq_html: faq,
    seo_title: seoTitle,
    meta_description: seoDescription,
  }), [title, whyWeChoseIt, productHighlights, description, faq, seoTitle, seoDescription]);

  const dbSnapshot = useMemo((): Record<CopyVersionField, string> => {
    const snap = {} as Record<CopyVersionField, string>;
    for (const field of COPY_VERSION_FIELDS) {
      snap[field] = draftFieldContent(draft, field);
    }
    return snap;
  }, [draft]);

  const historyByField = useMemo(() => groupHistoryByField(historyRows), [historyRows]);

  const versionsByField = useMemo(() => {
    const map = {} as Record<CopyVersionField, ReturnType<typeof buildFieldVersions>>;
    for (const field of COPY_VERSION_FIELDS) {
      map[field] = buildFieldVersions(historyByField[field], dbSnapshot[field]);
    }
    return map;
  }, [historyByField, dbSnapshot]);

  const setFieldDisplay = useCallback((field: CopyVersionField, value: string, markDirty: boolean) => {
    switch (field) {
      case "enriched_title":
        setTitle(value);
        break;
      case "why_we_chose_it":
        setWhyWeChoseIt(value);
        break;
      case "product_highlights":
        setProductHighlights(value);
        break;
      case "generated_description_html":
        // fix(B10): normalize only when loading history/regen, not on every keystroke.
        setDescription(markDirty ? value : normalizeDescriptionToPlainText(value));
        break;
      case "generated_faq_html":
        setFaq(value);
        break;
      case "seo_title":
        setSeoTitle(value);
        break;
      case "meta_description":
        setSeoDescription(value);
        break;
    }
    if (markDirty) {
      setCopyDirty((prev) => ({ ...prev, [field]: true }));
    }
  }, []);

  const loadHistory = useCallback(async (
    /** Prefer matching these display values when placing the version cursor (e.g. after regen). */
    matchDisplay?: Partial<Record<CopyVersionField, string>>,
  ) => {
    const { data, error } = await supabase
      .from("generation_history")
      .select("id,draft_id,field_name,content,provider,model,created_by,created_at")
      .eq("draft_id", draft.id)
      .order("created_at", { ascending: true });

    if (error) {
      setMessage(`讀取版本歷史失敗：${error.message}`);
      setHistoryLoaded(true);
      return;
    }

    const rows = (data ?? []) as GenerationHistoryRow[];
    setHistoryRows(rows);
    setHistoryLoaded(true);

    const grouped = groupHistoryByField(rows);
    const nextIndex = emptyVersionIndexMap();
    for (const field of COPY_VERSION_FIELDS) {
      const dbContent = draftFieldContent(draft, field);
      const versions = buildFieldVersions(grouped[field], dbContent);
      const prefer = matchDisplay?.[field] ?? dbContent;
      nextIndex[field] = initialVersionIndex(versions, prefer);
    }
    setVersionIndex(nextIndex);
  }, [draft, supabase]);

  // ResultCard stays mounted (same `key={draft.id}`) across regenerate/save's
  // router.refresh(), so these editable fields must be re-synced explicitly
  // when the underlying row changes -- otherwise an already-expanded card
  // keeps showing pre-regeneration text even though the DB has fresh content.
  useEffect(() => {
    setTitle(draft.title_zh ?? "");
    setDescription(normalizeDescriptionToPlainText(draft.description_html ?? ""));
    setSeoTitle(draft.seo_title ?? "");
    setSeoDescription(draft.seo_description ?? "");
    setWhyWeChoseIt(draft.why_we_chose_it ?? "");
    setProductHighlights(highlightsToContent(draft.product_highlights));
    setTags(draft.tags?.join(", ") ?? "");
    setFaq(draft.generated_faq_html ?? "");
    setSellPrice(draft.twd_price?.toString() ?? "");
    setCompareAtPrice(draft.compare_at_price?.toString() ?? "");
    setDetectedCategory(draft.detected_category ?? "");
    setSku(draft.sku ?? "");
    setPublishMode(draft.publish_mode);
    setCopyDirty(emptyDirtyMap());
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

  // B10: load history when card expands (not on list mount — avoid N queries).
  useEffect(() => {
    if (!expanded) return;
    void loadHistory();
  }, [expanded, draft.id, draft.updated_at, loadHistory]);

  function switchVersion(field: CopyVersionField, nextIndex: number) {
    const versions = versionsByField[field];
    if (nextIndex < 0 || nextIndex >= versions.length) return;
    if (copyDirty[field]) {
      const ok = window.confirm("切換將捨棄此欄未儲存修改，確定？");
      if (!ok) return;
    }
    const content = versions[nextIndex].content;
    setFieldDisplay(field, content, false);
    setCopyDirty((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
    setVersionIndex((prev) => ({ ...prev, [field]: nextIndex }));
  }

  async function insertHistoryRows(
    rows: Array<{
      draft_id: string;
      field_name: string;
      content: string;
      provider: string | null;
      model: string | null;
      created_by: string | null;
    }>,
  ) {
    if (rows.length === 0) return { error: null as string | null };
    const { error } = await supabase.from("generation_history").insert(rows);
    return { error: error?.message ?? null };
  }

  /**
   * B10: write on-screen copy combination to product_drafts + history
   * (manual dirty → history; version browse only → draft columns).
   */
  async function commitCopyCombination(): Promise<{ ok: boolean; error?: string; didCommitCopy: boolean }> {
    const display = displayByField;
    const needsDraftWrite =
      copyDisplayDiffersFromDb(display, dbSnapshot) || anyCopyDirty(copyDirty);
    const inserts = planComboSaveHistoryInserts({
      draftId: draft.id,
      userId: draft.created_by,
      display,
      dbSnapshot,
      historyByField,
      dirty: copyDirty,
    });

    // Prefer auth user for created_by when available.
    const { data: authData } = await supabase.auth.getUser();
    const userId = authData.user?.id ?? draft.created_by;
    const insertsWithUser = inserts.map((row) => ({ ...row, created_by: userId }));

    if (insertsWithUser.length > 0) {
      const { error: histErr } = await insertHistoryRows(insertsWithUser);
      if (histErr) return { ok: false, error: histErr, didCommitCopy: false };
    }

    if (needsDraftWrite || insertsWithUser.length > 0) {
      const patch = buildDraftCopyPatch(display);
      const { error } = await supabase.from("product_drafts").update(patch).eq("id", draft.id);
      if (error) return { ok: false, error: error.message, didCommitCopy: false };
    }

    setCopyDirty(emptyDirtyMap());
    await loadHistory();
    return {
      ok: true,
      didCommitCopy: needsDraftWrite || insertsWithUser.length > 0 || anyCopyDirty(copyDirty),
    };
  }

  async function saveComboOnly() {
    setComboSaving(true);
    setMessage("儲存文案組合中…");
    try {
      const result = await commitCopyCombination();
      if (!result.ok) {
        setMessage(result.error ?? "儲存失敗");
        return;
      }
      setMessage(result.didCommitCopy ? "已定案此文案組合" : "文案組合無變更");
      router.refresh();
    } finally {
      setComboSaving(false);
    }
  }

  async function save() {
    // D2: any save button should persist on-screen copy too (informative, not blocking).
    const copyWasDirty =
      anyCopyDirty(copyDirty) || copyDisplayDiffersFromDb(displayByField, dbSnapshot);
    let comboNote = "";
    if (copyWasDirty) {
      const combo = await commitCopyCombination();
      if (!combo.ok) {
        setMessage(combo.error ?? "文案組合儲存失敗");
        return;
      }
      if (combo.didCommitCopy) comboNote = "已一併定案文案組合";
    }

    const { error } = await supabase
      .from("product_drafts")
      .update({
        // Copy columns may already be written by commitCopyCombination; re-write is idempotent.
        title_zh: title || null,
        description_html: normalizeDescriptionToPlainText(description) || null,
        seo_title: seoTitle || null,
        seo_description: seoDescription || null,
        why_we_chose_it: whyWeChoseIt || null,
        product_highlights: productHighlights
          ? productHighlights
              .split("\n")
              .map((line) => line.replace(/^[・•\-\*]\s*/, "").trim())
              .filter(Boolean)
          : [],
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

    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage(comboNote ? `已儲存修改（${comboNote}）` : "已儲存修改");
    router.refresh();
  }

  async function regenerateField(field: CopyVersionField) {
    if (regenerating || regeneratingField) return;
    if (copyDirty[field]) {
      const ok = window.confirm("此欄有未儲存修改，重生將以目前畫面文字為基礎並捨棄未定案狀態，確定？");
      if (!ok) return;
    }
    setRegeneratingField(field);
    setMessage(`正在重生「${COPY_VERSION_FIELD_LABELS[field]}」…`);

    try {
      // D6: materialise virtual baseline before the new regen row lands.
      const historyCount = historyByField[field]?.length ?? 0;
      const originalContent = displayByField[field] ?? "";
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id ?? draft.created_by;

      if (historyCount === 0 && originalContent.trim()) {
        const { error: baseErr } = await insertHistoryRows([
          {
            draft_id: draft.id,
            field_name: field,
            content: originalContent,
            provider: null,
            model: null,
            created_by: userId,
          },
        ]);
        if (baseErr) {
          setMessage(`寫入原版歷史失敗：${baseErr}`);
          return;
        }
      }

      const currentValues = displayMapToCurrentValues(displayByField, draft);
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          field,
          provider: readStoredAiProvider(),
          mode: readStoredRunMode(),
          currentValues,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "單欄重生失敗");
        return;
      }

      const value = payload?.result?.value;
      let nextText = "";
      if (typeof value === "string") {
        nextText = value;
        setFieldDisplay(field, value, false);
      } else if (Array.isArray(value)) {
        nextText = (value as string[]).join("\n");
        setFieldDisplay(field, nextText, false);
      }
      setCopyDirty((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
      setMessage(`「${COPY_VERSION_FIELD_LABELS[field]}」已重生`);
      await loadHistory({ [field]: nextText });
      router.refresh();
    } catch {
      setMessage("單欄重生連線失敗");
    } finally {
      setRegeneratingField(null);
    }
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
    setCopyDirty(emptyDirtyMap());
    if (expanded) await loadHistory();
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

  /** B11: on-screen dirty (D3-B) — same signals as B10 save path. */
  function hasUncommittedCopy(): boolean {
    return anyCopyDirty(copyDirty) || copyDisplayDiffersFromDb(displayByField, dbSnapshot);
  }

  function buildFieldVersionInputs(): FieldVersionInput[] {
    return COPY_VERSION_FIELDS.map((field) => {
      const versions = versionsByField[field];
      const total = versions.length;
      const idx = total === 0 ? 0 : Math.min(versionIndex[field] ?? 0, total - 1);
      return {
        field,
        versionNumber: total === 0 ? 1 : idx + 1,
        total: total === 0 && (displayByField[field] ?? "").trim() ? 1 : total,
      };
    });
  }

  // B11 D1-B: open summary for Shopify path only (replaces window.confirm — D2-A).
  function openApproveAndPublishSummary() {
    setApproveSummaryOpen(true);
  }

  /**
   * Approve and publish after summary confirm.
   * D3-B: if dirty, commit via B10 commitCopyCombination first (所見即所核).
   */
  async function confirmApproveAndPublishFromSummary() {
    setApproveSummaryBusy(true);
    try {
      if (hasUncommittedCopy()) {
        setMessage("定案文案組合中…");
        const combo = await commitCopyCombination();
        if (!combo.ok) {
          setMessage(combo.error ?? "文案組合定案失敗，已取消發布");
          return;
        }
      }

      setApproveSummaryOpen(false);
      setMessage("核准中...");
      const approveResponse = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
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
        body: JSON.stringify({ publishMode, confirmActive: publishMode === "active" }),
      });
      const payload = await publishResponse.json();
      setMessage(
        publishResponse.ok
          ? payload.message ?? "已核准並發布（可至發布紀錄查詢）"
          : [payload.error, payload.hint].filter(Boolean).join(" — ") || "發布失敗"
      );
      router.refresh();
    } catch {
      setMessage("核准／發布連線失敗");
    } finally {
      setApproveSummaryBusy(false);
    }
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

  // B5 裁決 3A: block when unmarked (specific which/how many).
  // B14 1A: single 送圖 also creates a 1-item image batch (no Make webhook yet).
  // B9: always surface markMessage while collapsed (never silent).
  async function sendImages() {
    setMessage("");
    const block = formatUnmarkedBlockMessage(imageMarks);
    if (block) {
      setMarkMessage(block);
      return;
    }
    setMarkMessage("建立送圖批次中…");
    try {
      const response = await fetch("/api/drafts/batch/send-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: [draft.id] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hint = typeof payload.hint === "string" ? `\n${payload.hint}` : "";
        setMarkMessage((payload.error ?? "建立送圖批次失敗") + hint);
        return;
      }
      setMarkMessage(
        typeof payload.message === "string"
          ? payload.message
          : "已建立送圖批次（1 件），處理管線 Phase D 接通後自動執行"
      );
    } catch {
      setMarkMessage("建立送圖批次失敗（網路錯誤）");
    }
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
        {/* B9 quick actions; B12: archived view hides ✓/▶ — only 解除封存 */}
        <span className="rc-quick" onClick={(event) => event.stopPropagation()}>
          {isArchived ? (
            <button
              className="mini-btn rc-quick-btn"
              disabled={archiveBusy}
              onClick={() => void unarchiveOne()}
              title="解除封存，回到列表預設篩選可見"
              type="button"
            >
              {archiveBusy ? "…" : "解除封存"}
            </button>
          ) : (
            <>
              <button
                className="mini-btn rc-quick-btn"
                disabled={quickBusy || regenerating || regeneratingField != null || !canQuickApprove}
                onClick={() => void approveOnly()}
                title="只核准文案，不會發布到 Shopify"
                type="button"
              >
                {quickBusy ? "…" : "✓ 核准"}
              </button>
              <button
                className="mini-btn rc-quick-btn"
                disabled={quickBusy || regenerating || regeneratingField != null}
                onClick={() => void sendImages()}
                title="送圖；未標記會擋下並列出哪幾張；標記齊全會建立送圖批次"
                type="button"
              >
                ▶ 送圖
              </button>
              <button
                className="mini-btn rc-quick-btn"
                disabled={archiveBusy || quickBusy || regenerating || regeneratingField != null}
                onClick={() => void archiveOne()}
                title="軟刪除：從預設列表隱藏，可從「已封存」找回"
                type="button"
              >
                {archiveBusy ? "…" : "🗄 封存"}
              </button>
            </>
          )}
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

      {/* B9 req2: collapsed-visible notice for quick-action block/fail; B12 low-cost undo */}
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
          <span>{collapsedNotice}</span>
          {lastArchiveIds && lastArchiveIds.length > 0 ? (
            <button
              className="mini-btn"
              disabled={archiveBusy}
              onClick={() => void unarchiveOne(lastArchiveIds)}
              style={{ marginLeft: 8 }}
              type="button"
            >
              解除封存
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="rc-body">
          {/* B9: 5 underline tabs — SEO is its own page (Mockup; boss reconfirmed). */}
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
              {/* Desktop two-col balanced grid (same idea as .row AI類型/SKU); mobile stacks. */}
              <div className="rc-tabpanel-grid">
                <div className="rc-field rc-span-2">
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
                              !draft.ip_name ||
                              quickAddingCharacter === name ||
                              regenerating ||
                              regeneratingField != null
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
                <div className="row rc-span-2">
                  <div className="field">
                    <label>AI 偵測類型</label>
                    <input className="edit-input" onChange={(event) => setDetectedCategory(event.target.value)} value={detectedCategory} />
                  </div>
                  <div className="field">
                    <label>SKU</label>
                    <input className="edit-input" onChange={(event) => setSku(event.target.value)} value={sku} />
                  </div>
                </div>

                {/* B10: versioned copy fields (A7); SEO lives on its own tab */}
                {!historyLoaded ? (
                  <div className="muted rc-span-2">載入版本歷史…</div>
                ) : null}

                {(() => {
                  const fieldBusy = regeneratingField != null || regenerating || comboSaving;
                  const renderVersionHdr = (field: CopyVersionField) => {
                    const versions = versionsByField[field];
                    const idx = Math.min(versionIndex[field] ?? 0, Math.max(versions.length - 1, 0));
                    return (
                      <div className="rc-field-hdr">
                        <span className="rc-field-hdr-label">
                          {COPY_VERSION_FIELD_LABELS[field]}
                          <CopyButton getValue={() => displayByField[field]} />
                          {copyDirty[field] ? <span className="version-dirty-dot" title="未定案修改">·</span> : null}
                        </span>
                        <VersionNav
                          canNext={idx < versions.length - 1}
                          canPrev={idx > 0}
                          label={versionLabel(idx, versions)}
                          onNext={() => switchVersion(field, idx + 1)}
                          onPrev={() => switchVersion(field, idx - 1)}
                          onRegen={() => void regenerateField(field)}
                          regenBusy={regeneratingField === field}
                          regenDisabled={fieldBusy && regeneratingField !== field}
                        />
                      </div>
                    );
                  };

                  return (
                    <>
                      <div className="field">
                        {renderVersionHdr("enriched_title")}
                        <input
                          className="edit-input"
                          onChange={(event) => setFieldDisplay("enriched_title", event.target.value, true)}
                          value={title}
                        />
                      </div>
                      <div className="field">
                        {renderVersionHdr("why_we_chose_it")}
                        <textarea
                          className="edit-textarea"
                          onChange={(event) => setFieldDisplay("why_we_chose_it", event.target.value, true)}
                          rows={3}
                          value={whyWeChoseIt}
                        />
                      </div>
                      <div className="field rc-span-2">
                        {renderVersionHdr("product_highlights")}
                        <textarea
                          className="edit-textarea"
                          onChange={(event) => setFieldDisplay("product_highlights", event.target.value, true)}
                          placeholder="每點一行（可加・）"
                          rows={4}
                          value={productHighlights}
                        />
                      </div>
                      <div className="field rc-span-2">
                        <div className="rc-view-tabs">
                          {renderVersionHdr("generated_description_html")}
                        </div>
                        <div className="rc-view-tabs" style={{ marginBottom: 6 }}>
                          <span className="rc-view-tabs-buttons">
                            <button
                              className={descriptionView === "preview" ? "active" : ""}
                              onClick={() => setDescriptionView("preview")}
                              type="button"
                            >
                              預覽
                            </button>
                            <button
                              className={descriptionView === "source" ? "active" : ""}
                              onClick={() => setDescriptionView("source")}
                              type="button"
                            >
                              原始碼
                            </button>
                          </span>
                        </div>
                        {descriptionView === "preview" ? (
                          <div
                            className="rc-html-preview"
                            dangerouslySetInnerHTML={{ __html: descriptionPreviewHtml(description) }}
                          />
                        ) : (
                          <textarea
                            className="edit-textarea"
                            onChange={(event) => setFieldDisplay("generated_description_html", event.target.value, true)}
                            rows={10}
                            value={description}
                          />
                        )}
                      </div>
                      <div className="field rc-span-2">
                        <div className="rc-view-tabs">
                          {renderVersionHdr("generated_faq_html")}
                        </div>
                        <div className="rc-view-tabs" style={{ marginBottom: 6 }}>
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
                          <textarea
                            className="edit-textarea"
                            onChange={(event) => setFieldDisplay("generated_faq_html", event.target.value, true)}
                            rows={6}
                            value={faq}
                          />
                        )}
                      </div>

                      <button
                        className="btn-save-version rc-span-2"
                        disabled={comboSaving || regenerating || regeneratingField != null}
                        onClick={() => void saveComboOnly()}
                        type="button"
                      >
                        {comboSaving ? "儲存中…" : "✅ 確認儲存此版本組合"}
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          ) : null}

          {activeTab === "pricing" ? (
            <div className="rc-tabpanel" role="tabpanel">
              <div className="rc-tabpanel-grid">
                <div className="rc-field rc-span-2">
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
              <div className="rc-tabpanel-grid">
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
            </div>
          ) : null}

          {activeTab === "seo" ? (
            <div className="rc-tabpanel" role="tabpanel">
              <div className="rc-tabpanel-grid">
                {!historyLoaded ? (
                  <div className="muted rc-span-2">載入版本歷史…</div>
                ) : null}
                {(() => {
                  const fieldBusy = regeneratingField != null || regenerating || comboSaving;
                  const renderVersionHdr = (field: CopyVersionField) => {
                    const versions = versionsByField[field];
                    const idx = Math.min(versionIndex[field] ?? 0, Math.max(versions.length - 1, 0));
                    return (
                      <div className="rc-field-hdr">
                        <span className="rc-field-hdr-label">
                          {COPY_VERSION_FIELD_LABELS[field]}
                          <CopyButton getValue={() => displayByField[field]} />
                          {copyDirty[field] ? <span className="version-dirty-dot" title="未定案修改">·</span> : null}
                        </span>
                        <VersionNav
                          canNext={idx < versions.length - 1}
                          canPrev={idx > 0}
                          label={versionLabel(idx, versions)}
                          onNext={() => switchVersion(field, idx + 1)}
                          onPrev={() => switchVersion(field, idx - 1)}
                          onRegen={() => void regenerateField(field)}
                          regenBusy={regeneratingField === field}
                          regenDisabled={fieldBusy && regeneratingField !== field}
                        />
                      </div>
                    );
                  };
                  return (
                    <>
                      <div className="field">
                        {renderVersionHdr("seo_title")}
                        <input
                          className="edit-input"
                          onChange={(event) => setFieldDisplay("seo_title", event.target.value, true)}
                          value={seoTitle}
                        />
                      </div>
                      <div className="field">
                        {renderVersionHdr("meta_description")}
                        <textarea
                          className="edit-textarea"
                          onChange={(event) => setFieldDisplay("meta_description", event.target.value, true)}
                          rows={4}
                          value={seoDescription}
                        />
                      </div>
                      <button
                        className="btn-save-version rc-span-2"
                        disabled={comboSaving || regenerating || regeneratingField != null}
                        onClick={() => void saveComboOnly()}
                        type="button"
                      >
                        {comboSaving ? "儲存中…" : "✅ 確認儲存此版本組合"}
                      </button>
                    </>
                  );
                })()}
              </div>
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
          {message ? (
            <div
              className={
                message.includes("一併定案") || message.includes("已定案")
                  ? "price-soft-warn"
                  : "muted"
              }
              role="status"
              style={{ marginTop: 8 }}
            >
              {message}
            </div>
          ) : null}
          <div className="rc-actions">
            <span className="rc-actions-group">
              <button disabled={comboSaving || regeneratingField != null} onClick={() => void save()} type="button">
                儲存修改
              </button>
              <button
                disabled={regenerating || regeneratingField != null || comboSaving}
                onClick={() => void regenerate()}
                type="button"
              >
                {regenerating ? "生成中..." : "↺ 重新生成"}
              </button>
            </span>
            <span className="rc-actions-group rc-actions-group-review">
              {isArchived ? (
                <button disabled={archiveBusy} onClick={() => void unarchiveOne()} type="button">
                  {archiveBusy ? "處理中…" : "解除封存"}
                </button>
              ) : (
                <>
                  <button onClick={() => void requestRevision()} type="button">退回修改</button>
                  <button onClick={() => void sendImages()} type="button">
                    ▶ 送圖
                  </button>
                  <button
                    className={publishMode === "active" ? "danger" : ""}
                    disabled={approveSummaryBusy || comboSaving}
                    onClick={openApproveAndPublishSummary}
                    type="button"
                  >
                    ✓ 核准並發布
                  </button>
                  <button disabled={archiveBusy} onClick={() => void archiveOne()} type="button">
                    🗄 封存
                  </button>
                  <button onClick={() => void exportCsv()} type="button">產生 CSV</button>
                </>
              )}
            </span>
          </div>
        </div>
      ) : null}

      {/* B11 D1-B: Shopify 不可逆入口才開摘要；純 ✓ 核准不掛 */}
      {(() => {
        const dirty = hasUncommittedCopy();
        const summary = buildSingleApproveSummary({
          fieldVersions: buildFieldVersionInputs(),
          images: imageMarks,
          warnings: draft.warnings,
          hasDirtyCopy: dirty,
        });
        const mode = publishMode === "active" ? "active" : "draft";
        return (
          <ApproveSummaryModal
            busy={approveSummaryBusy}
            heading={modalHeading({})}
            onCancel={() => {
              if (!approveSummaryBusy) setApproveSummaryOpen(false);
            }}
            onConfirm={() => void confirmApproveAndPublishFromSummary()}
            open={approveSummaryOpen}
            primaryDanger={mode === "active"}
            primaryLabel={primaryConfirmLabel({ publishMode: mode, hasDirtyCopy: dirty })}
            rows={summary.rows}
          />
        );
      })()}
    </div>
  );
}
