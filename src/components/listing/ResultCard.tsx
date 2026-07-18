"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { showToast } from "@/components/Toast";
import { StatusBadge } from "@/components/listing/StatusBadge";
import {
  secondaryStatusForResultCard,
  stationFlowPrimaryLabel
} from "@/lib/drafts/stationCardStatusDisplay";
import {
  formatUnmarkedBlockMessage,
  imageSlotLabel,
  listPipelineImages,
  listUnmarkedPipelineImages,
  patchForProcessIntentPick,
  PROCESS_INTENT_LABELS,
  PROCESS_INTENT_OPTIONS
} from "@/lib/images/processMarks";
import {
  countImageMarkSummary,
  decideStation2Review,
  formatMarkSummaryLine,
  formatStation2ArmLabel,
  formatStation2ConfirmHint,
  formatStation2PrimaryLabel,
  formatStation2SuccessToast,
} from "@/lib/drafts/stationRoute";
import { Station2ImagePanel } from "@/components/listing/Station2ImagePanel";
import { resolveDraftStation } from "@/lib/drafts/stationFilter";
import { formatDraftFailSummary } from "@/lib/drafts/failReasons";
import {
  gradeDraftWarnings,
  hasBlockingWarnings,
  countConfirmOnly
} from "@/lib/drafts/warningTiers";
import { RegenCopyModal } from "@/components/listing/RegenCopyModal";
import { LockedCopyPreview } from "@/components/listing/LockedCopyPreview";
import { COPY_TONES, type CopyTone } from "@/lib/providers/copy";
import {
  isResultCardTabId,
  RESULT_CARD_TABS,
  tabLabelWithWarn,
  type ResultCardTabId
} from "@/lib/drafts/resultCardTabs";
import {
  collectSellPricesForCard,
  formatPriceRangeLabel
} from "@/lib/variants/priceDisplay";
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
import type { FieldVersionInput } from "@/lib/drafts/approveSummary";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";
import {
  formatArchiveResultMessage,
  formatUnarchiveResultMessage,
  isArchiveBusyStatus,
  isPublishedArchiveStatus
} from "@/lib/drafts/archiveDrafts";
import { ExportPreflightModal } from "@/components/listing/ExportPreflightModal";
import { Station3PublishModal } from "@/components/listing/Station3PublishModal";
import {
  runExportPreflight,
  type ExportKind,
  type ExportPreflightReport
} from "@/lib/csv/exportPreflight";
import {
  formatStation3ResultMessage,
  shouldLeaveQueue,
  type Station3PublishSelection
} from "@/lib/drafts/station3Publish";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import { VariantEditor } from "@/components/listing/VariantEditor";
import {
  clampDimensions,
  dbRowsToForm,
  formRowsToDbInserts,
  isVariantRowFilled,
  persistVariantsSafe,
  type SupabaseLike,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";
import type { ImageProcessIntent, PriceMode, ProductDraft, ProductImage } from "@/types/domain";
import {
  extractMissingCharacterNames,
  isCharacterMissingInWarnings,
} from "@/lib/characters/missingCharacterWarnings";
import {
  descriptionPreviewHtml,
  normalizeDescriptionToPlainText,
} from "@/lib/contentGenerator/htmlFormat";

/** UX-M T64: full-enough row for dbRowsToForm (price range still uses twd_price). */
type ResultCardVariantRow = {
  twd_price?: number | null;
  option1_value?: string | null;
  option2_value?: string | null;
  option3_value?: string | null;
  option1_name?: string | null;
  option2_name?: string | null;
  option3_name?: string | null;
  cny_price?: number | null;
  compare_at_price?: number | null;
  price_locked?: boolean | null;
  sort_order?: number | null;
  inventory_quantity?: number | null;
  inventory_policy?: string | null;
  sku?: string | null;
  image_id?: string | null;
};

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

/** B10: ← 版本 N/M → 重生 — version switch is local-only; 重生 spends LLM. */
/** UX-L T61: optional arm labels for discard double-confirm (no window.confirm). */
function VersionNav({
  label,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onRegen,
  regenBusy,
  regenDisabled,
  switchArmDir = null,
  regenArmed = false,
}: {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRegen: () => void;
  regenBusy: boolean;
  regenDisabled: boolean;
  /** UX-L T61: which version arrow is armed for discard confirm */
  switchArmDir?: "prev" | "next" | null;
  /** UX-L T61: regen button armed for discard confirm */
  regenArmed?: boolean;
}) {
  return (
    <span className="version-nav" onClick={(event) => event.stopPropagation()}>
      <button
        aria-label={switchArmDir === "prev" ? "再點確認切到上一版" : "上一版"}
        className={`version-nav-btn${switchArmDir === "prev" ? " danger" : ""}`}
        disabled={!canPrev || regenBusy}
        onClick={onPrev}
        title={switchArmDir === "prev" ? "再點一次確認切換（會捨棄未存修改）" : undefined}
        type="button"
      >
        {switchArmDir === "prev" ? "⚠" : "←"}
      </button>
      <span className="version-nav-label">{label}</span>
      <button
        aria-label={switchArmDir === "next" ? "再點確認切到下一版" : "下一版"}
        className={`version-nav-btn${switchArmDir === "next" ? " danger" : ""}`}
        disabled={!canNext || regenBusy}
        onClick={onNext}
        title={switchArmDir === "next" ? "再點一次確認切換（會捨棄未存修改）" : undefined}
        type="button"
      >
        {switchArmDir === "next" ? "⚠" : "→"}
      </button>
      <button
        aria-label="只重生此欄"
        className={`version-nav-btn version-nav-regen${regenArmed ? " danger" : ""}`}
        disabled={regenDisabled || regenBusy}
        onClick={onRegen}
        title={
          regenArmed
            ? "再點一次確認：以畫面文字重生，未定案會捨棄"
            : "只重生此欄（會呼叫 AI，需花費）"
        }
        type="button"
      >
        {regenBusy ? "重生中" : regenArmed ? "⚠ 確認重生" : "重生"}
      </button>
    </span>
  );
}

/** UX-L T61: discard-edit arm (independent from actionArm review/revision/return). */
type DiscardArm =
  | null
  | { kind: "switch"; field: CopyVersionField; nextIndex: number }
  | { kind: "regen"; field: CopyVersionField }
  | { kind: "collapse" };

/** T26: 描述／FAQ 預覽預設限高，可展開全文；local state 不寫 localStorage */
function CopyPreviewBlock({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rc-copy-preview${expanded ? " is-expanded" : ""}`}>
      <div
        className="rc-html-preview rc-copy-preview-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        className="mini-btn rc-copy-preview-toggle"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        {expanded ? "收合" : "展開全文"}
      </button>
    </div>
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
  defaultExpanded = false,
  variantPrices = [],
  leaving = false
}: {
  draft: ProductDraft;
  images: ProductImage[];
  checked?: boolean;
  onToggle?: () => void;
  defaultExpanded?: boolean;
  /** P1-5 price range + UX-M T64 specs hydrate */
  variantPrices?: ResultCardVariantRow[];
  /** UX-H T49: archive leave fade (display only) */
  leaving?: boolean;
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
  // UX-M T64: specs tab local state (hydrate from draft.variant_dimensions + variants)
  const [variantDimensions, setVariantDimensions] = useState<VariantDimension[]>([]);
  const [variantRows, setVariantRows] = useState<VariantFormRow[]>([]);
  const [variantWarning, setVariantWarning] = useState<string | null>(null);
  const [variantsDirty, setVariantsDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [markMessage, setMarkMessage] = useState("");
  const [regenerating, setRegenerating] = useState(false);
  const [regeneratingField, setRegeneratingField] = useState<CopyVersionField | null>(null);
  const [comboSaving, setComboSaving] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenTone, setRegenTone] = useState<CopyTone>(COPY_TONES[0]);
  const [regenNotes, setRegenNotes] = useState("");
  const [lockedPreviewOpen, setLockedPreviewOpen] = useState(false);
  // R3 station③ multi-select
  const [station3Open, setStation3Open] = useState(false);
  const [station3Busy, setStation3Busy] = useState(false);
  const [station3Selection, setStation3Selection] = useState<Station3PublishSelection | null>(null);
  const [exportQueue, setExportQueue] = useState<ExportKind[]>([]);
  const [exportPreflightReport, setExportPreflightReport] =
    useState<ExportPreflightReport | null>(null);
  const [exportMarkLeave, setExportMarkLeave] = useState(true);
  const [exportBusy, setExportBusy] = useState(false);
  const [cardExportKind, setCardExportKind] = useState<ExportKind>("matrixify");
  const [pendingApiResult, setPendingApiResult] = useState<{ ok: boolean; message: string } | null>(
    null
  );
  const [approveSummaryBusy, setApproveSummaryBusy] = useState(false);
  const [quickBusy, setQuickBusy] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [lastArchiveIds, setLastArchiveIds] = useState<string[] | null>(null);
  /** UX-E T46: archive undo window (10s). */
  const archiveUndoTimerRef = useRef<number | null>(null);
  /** UX-E T28: inline double-confirm for destructive card actions (not discard-edit). */
  const [actionArm, setActionArm] = useState<
    null | "review" | "revision" | "return-copy" | "return-image"
  >(null);
  /** UX-L T61: discard uncommitted edit — separate from actionArm. */
  const [discardArm, setDiscardArm] = useState<DiscardArm>(null);

  function clearCardArchiveUndoTimer() {
    if (archiveUndoTimerRef.current != null) {
      window.clearTimeout(archiveUndoTimerRef.current);
      archiveUndoTimerRef.current = null;
    }
  }

  function armCardArchiveUndo(ids: string[]) {
    clearCardArchiveUndoTimer();
    if (!ids.length) {
      setLastArchiveIds(null);
      return;
    }
    setLastArchiveIds(ids);
    archiveUndoTimerRef.current = window.setTimeout(() => {
      setLastArchiveIds(null);
      archiveUndoTimerRef.current = null;
    }, 10_000);
  }

  useEffect(() => () => clearCardArchiveUndoTimer(), []);
  const [quickAddingCharacter, setQuickAddingCharacter] = useState<string | null>(null);
  const [faqView, setFaqView] = useState<"preview" | "html">("preview");
  const [descriptionView, setDescriptionView] = useState<"preview" | "source">("preview");
  // Local mirror of pipeline marks so toggles feel instant; re-synced on refresh.
  const [imageMarks, setImageMarks] = useState<ProductImage[]>(images);
  /** UX-H T49: soft-remove fade on delete image */
  const [fadingImageIds, setFadingImageIds] = useState<Set<string>>(() => new Set());
  // B10: generation_history (read-only for ←→; inserts on regen/manual commit)
  const [historyRows, setHistoryRows] = useState<GenerationHistoryRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [versionIndex, setVersionIndex] = useState<Record<CopyVersionField, number>>(emptyVersionIndexMap);
  const [copyDirty, setCopyDirty] = useState<Partial<Record<CopyVersionField, boolean>>>(emptyDirtyMap);

  // UX-M T64: re-hydrate specs when server data identity changes (not on every parent render)
  const variantsHydrateKey = useMemo(
    () =>
      JSON.stringify({
        id: draft.id,
        dims: draft.variant_dimensions ?? null,
        rows: variantPrices.map((v) => ({
          o1: v.option1_value,
          o2: v.option2_value,
          o3: v.option3_value,
          n1: v.option1_name,
          n2: v.option2_name,
          n3: v.option3_name,
          cost: v.cny_price,
          sell: v.twd_price,
          cmp: v.compare_at_price,
          lock: v.price_locked,
          qty: v.inventory_quantity,
          pol: v.inventory_policy,
          sku: v.sku,
          img: v.image_id,
          sort: v.sort_order
        }))
      }),
    [draft.id, draft.variant_dimensions, variantPrices]
  );

  useEffect(() => {
    const dimsRaw = Array.isArray(draft.variant_dimensions)
      ? (draft.variant_dimensions as VariantDimension[])
      : [];
    const { dimensions, rows } = dbRowsToForm(dimsRaw, variantPrices);
    setVariantDimensions(dimensions);
    setVariantRows(rows);
    setVariantsDirty(false);
    setVariantWarning(null);
    // Key captures dims + rows content; draft/variantPrices used inside intentionally.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate only when variantsHydrateKey changes
  }, [variantsHydrateKey]);

  const { icon, className } = statusIcon(draft);
  // B6: 卡片只跟讀 price_mode（不做完整切換 UI）；migration 020 前 fallback 特價。
  const priceMode: PriceMode = draft.price_mode === "single" ? "single" : "sale";
  const profit = draft.twd_price != null && draft.twd_cost != null ? draft.twd_price - draft.twd_cost : null;
  // P1-5 / 回饋 49: multi-variant → price range on collapsed card
  const priceRangeLabel = useMemo(() => {
    const fromLocal = variantsDirty
      ? variantRows
          .filter(isVariantRowFilled)
          .map((r) => {
            const n = Number(r.sellPrice);
            return Number.isFinite(n) && n > 0 ? n : null;
          })
      : variantPrices.map((v) => v.twd_price);
    const prices = collectSellPricesForCard({
      draftPrice: draft.twd_price,
      variantPrices: fromLocal
    });
    return formatPriceRangeLabel(prices);
  }, [draft.twd_price, variantPrices, variantsDirty, variantRows]);

  const variantImageOptions = useMemo(
    () =>
      imageMarks
        .filter((img) => img.image_type === "main" || img.image_type === "variant")
        .map((img, i) => ({
          id: img.id,
          url: String(img.processed_file_url || img.original_file_url || img.generated_file_url || ""),
          label: `主圖 ${i + 1}`
        }))
        .filter((img) => img.url),
    [imageMarks]
  );
  const profitPct =
    profit != null && draft.twd_price && draft.twd_price > 0
      ? Math.round((profit / draft.twd_price) * 100)
      : null;
  const pipelineImages = listPipelineImages(imageMarks);
  const unmarkedImages = listUnmarkedPipelineImages(imageMarks);
  const unmarkedBlockMessage = formatUnmarkedBlockMessage(imageMarks);
  const missingCharacters = extractMissingCharacterNames(draft.warnings);
  const characterChipWarned = isCharacterMissingInWarnings(draft.character_name, draft.warnings);
  const station = resolveDraftStation(draft);
  const isCopyStation = station === "copy_review";
  const isImageStation = station === "image_review";
  const isReadyStation = station === "ready";
  const copyLocked = isImageStation || isReadyStation;
  const warningSummary = useMemo(
    () =>
      gradeDraftWarnings(draft.warnings, {
        ip_name: draft.ip_name,
        character_name: draft.character_name,
        title_zh: draft.title_zh,
        twd_price: draft.twd_price,
        twd_cost: draft.twd_cost,
        missingCharacterInDict: missingCharacters.length > 0,
        missingIp: !draft.ip_name?.trim(),
      }),
    [draft.warnings, draft.ip_name, draft.character_name, draft.title_zh, draft.twd_price, draft.twd_cost, missingCharacters.length]
  );
  const confirmWarnCount = countConfirmOnly(warningSummary);
  const blockWarnCount = warningSummary.blockCount;
  const suggestWarnCount = warningSummary.suggestCount;
  const markSummary = useMemo(() => countImageMarkSummary(imageMarks), [imageMarks]);
  /** UX-F T35: live station② button labels from decideStation2Review */
  const station2Btn = useMemo(() => {
    const decision = decideStation2Review({ images: imageMarks });
    if (decision.action === "advance_ready") {
      return {
        primary: formatStation2PrimaryLabel(true, 0),
        arm: formatStation2ArmLabel(true, 0),
        title: "全保留 → 待發布（$0／不等工廠）",
      };
    }
    if (decision.action === "send_images") {
      return {
        primary: formatStation2PrimaryLabel(false, decision.aiCount),
        arm: formatStation2ArmLabel(false, decision.aiCount),
        title: `有 AI 標記 → 生圖工廠（${decision.aiCount} 張）`,
      };
    }
    return {
      primary: "標圖通過",
      arm: "⚠ 再點確認",
      title: decision.action === "blocked" ? decision.reason : "標圖分流",
    };
  }, [imageMarks]);
  const detectTypeLabel = draft.product_type || draft.detected_category || "";
  // T8: migration 034；未寫入／未跑 migration 時 undefined → 不顯示
  const generationToneLabel =
    typeof draft.generation_tone === "string" && draft.generation_tone.trim()
      ? draft.generation_tone.trim()
      : "";
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
  // UX-I T53: surface generation_error / warnings on failed cards (display only).
  const failReasonSummary = formatDraftFailSummary(draft);

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
      armCardArchiveUndo(archivedIds);
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
    setMarkMessage("復原中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: targetIds, action: "unarchive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMarkMessage(payload.error ?? "復原失敗");
        return;
      }
      clearCardArchiveUndoTimer();
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
      // UX-L T62: transient error → toast
      showToast(`讀取版本歷史失敗：${error.message}`, "error");
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
    // UX-L T61: dirty → inline double-confirm (no window.confirm)
    if (copyDirty[field]) {
      const armed =
        discardArm?.kind === "switch" &&
        discardArm.field === field &&
        discardArm.nextIndex === nextIndex;
      if (!armed) {
        setDiscardArm({ kind: "switch", field, nextIndex });
        setMessage("再點一次確認切換（會捨棄未存修改）");
        return;
      }
    }
    setDiscardArm(null);
    if (
      message.startsWith("再點一次確認切換") ||
      message.startsWith("再點一次確認：") ||
      message.startsWith("再點一次確認收合")
    ) {
      setMessage("");
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
    setDiscardArm(null);
    // UX-L T62: in-progress via button「儲存中…」only
    try {
      const result = await commitCopyCombination();
      if (!result.ok) {
        showToast(result.error ?? "儲存失敗", "error");
        setMessage("");
        return;
      }
      // UX-A T2 / UX-L T62: transient success → toast only
      const okMsg = result.didCommitCopy ? "已定案此文案組合" : "文案組合無變更";
      setMessage("");
      showToast(okMsg, result.didCommitCopy ? "success" : "info");
      router.refresh();
    } finally {
      setComboSaving(false);
    }
  }

  async function save() {
    // D2: any save button should persist on-screen copy too (informative, not blocking).
    // UX-M T64: also writes variant_dimensions + product_variants (persistVariantsSafe).
    setDiscardArm(null);
    const copyWasDirty =
      anyCopyDirty(copyDirty) || copyDisplayDiffersFromDb(displayByField, dbSnapshot);
    let comboNote = "";
    if (copyWasDirty) {
      const combo = await commitCopyCombination();
      if (!combo.ok) {
        showToast(combo.error ?? "文案組合儲存失敗", "error");
        setMessage("");
        return;
      }
      if (combo.didCommitCopy) comboNote = "已一併定案文案組合";
    }

    const dimsForSave = clampDimensions(variantDimensions);
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
        publish_mode: publishMode,
        // UX-M T64: axis defs on draft (same column as WorkspaceInputPanel)
        variant_dimensions: dimsForSave
      })
      .eq("id", draft.id);

    if (error) {
      showToast(error.message || "儲存失敗", "error");
      setMessage("");
      return;
    }

    // UX-M T64: insert-first overwrite via shared lib (no new API)
    // Cast: browser client matches SupabaseLike; avoid TS2589 on full generic client.
    const inserts = formRowsToDbInserts(dimsForSave, variantRows.filter(isVariantRowFilled));
    const persistResult = await persistVariantsSafe(
      supabase as unknown as SupabaseLike,
      draft.id,
      inserts.map((row) => ({ ...row, draft_id: draft.id }))
    );
    if (!persistResult.ok) {
      showToast(persistResult.error || "款式儲存失敗", "error");
      setMessage("");
      return;
    }

    setVariantsDirty(false);
    // UX-A T2 / UX-L T62: transient success → toast only
    const okMsg = comboNote ? `已儲存修改（${comboNote}）` : "已儲存修改";
    setMessage("");
    showToast(okMsg, "success");
    router.refresh();
  }

  async function regenerateField(field: CopyVersionField) {
    if (regenerating || regeneratingField) return;
    // UX-L T61: dirty → inline double-confirm (no window.confirm)
    if (copyDirty[field]) {
      const armed = discardArm?.kind === "regen" && discardArm.field === field;
      if (!armed) {
        setDiscardArm({ kind: "regen", field });
        setMessage("再點一次確認：以畫面文字重生，未定案會捨棄");
        return;
      }
    }
    setDiscardArm(null);
    setRegeneratingField(field);
    // UX-L T62: in-progress via button label only

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
          showToast(`寫入原版歷史失敗：${baseErr}`, "error");
          setMessage("");
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
        showToast(payload.error ?? "單欄重生失敗", "error");
        setMessage("");
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
      setMessage("");
      showToast(`「${COPY_VERSION_FIELD_LABELS[field]}」已重生`, "success");
      await loadHistory({ [field]: nextText });
      router.refresh();
    } catch {
      showToast("單欄重生連線失敗", "error");
      setMessage("");
    } finally {
      setRegeneratingField(null);
    }
  }

  async function regenerate() {
    setRegenerating(true);
    setDiscardArm(null);
    // UX-L T62: in-progress via modal busy; result → toast
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: draft.id,
          provider: readStoredAiProvider(),
          mode: readStoredRunMode(),
          tone: regenTone,
          regenNotes: regenNotes.trim() || undefined
        })
      });
      const payload = await response.json();
      if (response.ok) {
        setMessage("");
        showToast("重新生成完成", "success");
        setCopyDirty(emptyDirtyMap());
        setRegenOpen(false);
        setRegenNotes("");
      } else {
        setMessage("");
        showToast(payload.error ?? "重新生成失敗", "error");
      }
      if (expanded) await loadHistory();
      router.refresh();
    } catch {
      setMessage("");
      showToast("重新生成連線失敗", "error");
    } finally {
      setRegenerating(false);
    }
  }

  /** R2/R3 + UX-F T35: station② 標圖分流 — 全 keep → 待發布；有 AI → 生圖工廠 */
  async function stationReview() {
    setMarkMessage("");
    if (hasBlockingWarnings(warningSummary)) {
      setMarkMessage(`⛔ 必修：${warningSummary.block.map((w) => w.text).join("；")}`);
      setActionArm(null);
      return;
    }
    const decision = decideStation2Review({ images: imageMarks });
    if (decision.action === "blocked") {
      setMarkMessage(decision.reason);
      setActionArm(null);
      return;
    }
    if (decision.action !== "send_images" && decision.action !== "advance_ready") return;
    // UX-E T28 + T35: double-confirm with 待發布／生圖工廠 wording
    if (actionArm !== "review") {
      setActionArm("review");
      setMarkMessage(formatStation2ConfirmHint(decision.allKeep, decision.aiCount));
      return;
    }
    setActionArm(null);
    setQuickBusy(true);
    setMarkMessage("分流送出中…");
    try {
      if (decision.action === "advance_ready") {
        const response = await fetch("/api/drafts/batch/advance-ready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftIds: [draft.id] })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok && !payload.ok) {
          const err = payload.error ?? payload.message ?? "進入待發布失敗";
          setMarkMessage(err);
          showToast(err, "error");
          return;
        }
        const okMsg =
          typeof payload.message === "string" ? payload.message : formatStation2SuccessToast({ advanced: true, sentToFactory: false });
        setMarkMessage(okMsg);
        showToast(okMsg, "success");
        router.refresh();
        return;
      }
      const response = await fetch("/api/drafts/batch/send-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: [draft.id] })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const hint = typeof payload.hint === "string" ? `\n${payload.hint}` : "";
        const err = (payload.error ?? "送生圖工廠失敗") + hint;
        setMarkMessage(err);
        showToast(payload.error ?? "送生圖工廠失敗", "error");
        return;
      }
      const okMsg =
        typeof payload.message === "string"
          ? payload.message
          : formatStation2SuccessToast({ advanced: false, sentToFactory: true });
      setMarkMessage(okMsg.includes("工廠") ? okMsg : `${okMsg} · 可到生圖工廠查看`);
      showToast(okMsg, "success");
      router.refresh();
    } catch {
      setMarkMessage("分流連線失敗");
      showToast("分流連線失敗", "error");
    } finally {
      setQuickBusy(false);
    }
  }

  async function returnFromReady(target: "copy_review" | "image_review") {
    // §2.2：標圖（非「圖片審核」）；T9 / UX-E T28：double-confirm、不要理由
    const label = target === "copy_review" ? "改文案" : "改標圖";
    const armKey = target === "copy_review" ? "return-copy" : "return-image";
    if (actionArm !== armKey) {
      setActionArm(armKey);
      // arm 文案留卡內（不作 toast）
      setMessage(`再點一次確認退回${label}`);
      return;
    }
    setActionArm(null);
    setQuickBusy(true);
    try {
      const response = await fetch(`/api/drafts/${draft.id}/return-stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err = typeof payload.error === "string" ? payload.error : "退回失敗";
        // UX-L T62: toast only, no dual setMessage
        setMessage("");
        showToast(err, "error");
        return;
      }
      const okMsg =
        typeof payload.message === "string" ? payload.message : `已退回${label}`;
      setMessage("");
      showToast(okMsg, "success");
      router.refresh();
    } catch {
      setMessage("");
      showToast("退回連線失敗", "error");
    } finally {
      setQuickBusy(false);
    }
  }

  async function approveOnly() {
    if (hasBlockingWarnings(warningSummary)) {
      // 阻斷必修留卡內
      setMessage(`⛔ 必修：${warningSummary.block.map((w) => w.text).join("；")}`);
      return;
    }
    setMarkMessage("");
    setQuickBusy(true);
    // UX-L T62: in-progress via button busy; result → toast
    setMessage("");
    try {
      const approveResponse = await fetch(`/api/drafts/${draft.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const payload = await approveResponse.json().catch(() => ({}));
      if (!approveResponse.ok) {
        setMessage("");
        showToast(payload.error ?? "核准失敗", "error");
        return;
      }
      // UX-A T2 + §2.2 站名：標圖（覆寫「圖片審核」）
      setMessage("");
      showToast("已核准文案 → 進入標圖（文案已鎖定）", "success");
      router.refresh();
    } catch {
      setMessage("");
      showToast("核准連線失敗", "error");
    } finally {
      setQuickBusy(false);
    }
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
        showToast(payload.error ?? "一鍵新增角色失敗", "error");
        return;
      }
      const okMsg =
        typeof payload.message === "string"
          ? payload.message
          : `已處理角色「${characterName}」，請按重新生成以產出角色 tag`;
      showToast(okMsg, "success");
    } catch {
      showToast("一鍵新增角色連線失敗", "error");
    } finally {
      setQuickAddingCharacter(null);
    }
  }

  /** T9 / UX-E T28: ②→① 退回 double-confirm，不要求打字理由（API comment optional） */
  async function requestRevision() {
    if (actionArm !== "revision") {
      setActionArm("revision");
      // arm 文案留卡內（不作 toast）
      setMessage("再點一次確認退回文案（文案將解鎖）");
      return;
    }
    setActionArm(null);
    setQuickBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/drafts/${draft.id}/request-revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment: "" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err =
          typeof payload.error === "string" ? payload.error : "退回失敗";
        setMessage("");
        showToast(err, "error");
        return;
      }
      setMessage("");
      showToast("已退回文案（已解鎖）", "success");
      router.refresh();
    } catch {
      setMessage("");
      showToast("退回連線失敗", "error");
    } finally {
      setQuickBusy(false);
    }
  }

  /** B11: on-screen dirty (D3-B) — same signals as B10 save path. */
  function hasUncommittedCopy(): boolean {
    return anyCopyDirty(copyDirty) || copyDisplayDiffersFromDb(displayByField, dbSnapshot);
  }

  function hasUncommittedPricing(): boolean {
    const draftSell = draft.twd_price != null ? String(draft.twd_price) : "";
    const draftCmp =
      priceMode === "single"
        ? ""
        : draft.compare_at_price != null
          ? String(draft.compare_at_price)
          : "";
    const curSell = sellPrice.trim();
    const curCmp = priceMode === "single" ? "" : compareAtPrice.trim();
    return curSell !== draftSell || curCmp !== draftCmp;
  }

  /** Copy / pricing / specs — any card edit that needs footer save. */
  function hasUncommittedEdits(): boolean {
    return hasUncommittedCopy() || hasUncommittedPricing() || variantsDirty;
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

  async function runStation3CardFlow(selection: Station3PublishSelection) {
    setStation3Open(false);
    setStation3Selection(selection);
    setStation3Busy(true);
    setApproveSummaryBusy(true);
    setDiscardArm(null);
    let apiSucceeded: boolean | null = null;
    let apiMessage = "";
    try {
      if (hasUncommittedCopy()) {
        // UX-L T62: busy flag covers progress; result toast
        const combo = await commitCopyCombination();
        if (!combo.ok) {
          setMessage("");
          showToast(combo.error ?? "文案組合定案失敗，已取消", "error");
          return;
        }
      }

      if (selection.shopify !== "none") {
        const publishResponse = await fetch(`/api/drafts/${draft.id}/publish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publishMode: selection.shopify,
            confirmActive: selection.shopify === "active"
          })
        });
        const payload = await publishResponse.json().catch(() => ({}));
        apiSucceeded = publishResponse.ok && payload.ok !== false;
        apiMessage = publishResponse.ok
          ? payload.message ?? "Shopify 完成"
          : payload.error ?? "發布失敗";
        setPendingApiResult({ ok: Boolean(apiSucceeded), message: apiMessage });
        if (!apiSucceeded) {
          showToast(apiMessage, "error");
        }
      }

      const csvKinds: ExportKind[] = [];
      if (selection.matrixify) csvKinds.push("matrixify");
      if (selection.showmore) csvKinds.push("showmore");

      if (!csvKinds.length) {
        const left = shouldLeaveQueue({
          selection,
          apiSucceeded,
          csvSucceeded: null
        });
        const summary = formatStation3ResultMessage({
          selection,
          apiSucceeded,
          apiMessage,
          csvSucceeded: null,
          leftQueue: left
        });
        setMessage("");
        showToast(
          summary,
          apiSucceeded === false ? "error" : apiSucceeded ? "success" : "info"
        );
        setStation3Selection(null);
        setPendingApiResult(null);
        router.refresh();
        return;
      }

      const markLeave = shouldLeaveQueue({
        selection,
        apiSucceeded: selection.shopify === "none" ? null : apiSucceeded,
        csvSucceeded: true
      });
      setExportMarkLeave(markLeave);
      openNextCardExport(csvKinds, markLeave);
    } catch {
      setMessage("");
      showToast("發布／匯出連線失敗", "error");
      setStation3Selection(null);
      setPendingApiResult(null);
    } finally {
      setStation3Busy(false);
      setApproveSummaryBusy(false);
    }
  }

  function openNextCardExport(kinds: ExportKind[], markLeave: boolean) {
    if (!kinds.length) return;
    const [kind, ...rest] = kinds;
    const markup = getStoredPricingSettings().showmoreMarkupPercent;
    const report = runExportPreflight(
      [
        {
          id: draft.id,
          title_zh: title || draft.title_zh,
          taobao_title: draft.taobao_title,
          original_title: draft.original_title,
          status: draft.status,
          pipeline_stage: draft.pipeline_stage,
          sku: draft.sku,
          twd_price: sellPrice ? Number(sellPrice) : draft.twd_price,
          twd_cost: draft.twd_cost,
          compare_at_price: compareAtPrice ? Number(compareAtPrice) : draft.compare_at_price,
          price_mode: draft.price_mode,
          description_html: description || draft.description_html,
          description_plain: draft.description_plain,
          variant_dimensions: draft.variant_dimensions,
          product_images: images
        }
      ],
      { kind, showmoreMarkupPercent: markup }
    );
    setExportQueue(rest);
    setExportMarkLeave(markLeave);
    setCardExportKind(kind);
    setExportPreflightReport(report);
  }

  async function removeImage(image: ProductImage) {
    setFadingImageIds((prev) => new Set(prev).add(image.id));
    await new Promise((r) => window.setTimeout(r, 250));
    const url = image.processed_file_url ?? image.original_file_url;
    const path = url ? storagePathFromUrl(url) : null;
    if (path) {
      await supabase.storage.from("product-images").remove([path]);
    }
    const { error } = await supabase.from("product_images").delete().eq("id", image.id);
    // UX-L T62: delete image result → toast
    if (error) {
      showToast(`刪除圖片失敗：${error.message}`, "error");
    } else {
      showToast("已刪除圖片", "success");
    }
    if (error) {
      setFadingImageIds((prev) => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
    } else {
      setImageMarks((current) => current.filter((row) => row.id !== image.id));
      setFadingImageIds((prev) => {
        const next = new Set(prev);
        next.delete(image.id);
        return next;
      });
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

  async function confirmCardExport() {
    if (!exportPreflightReport?.canExport) return;
    const kind = cardExportKind;
    setExportBusy(true);
    // UX-L T62: progress via exportBusy; result → toast
    try {
      const endpoint =
        kind === "showmore" ? "/api/exports/showmore" : "/api/exports/matrixify";
      const body: Record<string, unknown> = {
        draftIds: [draft.id],
        markLeaveQueue: exportMarkLeave
      };
      if (kind === "showmore") {
        body.showmoreMarkupPercent = getStoredPricingSettings().showmoreMarkupPercent;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        setMessage("");
        showToast(payload.error ?? "CSV 產生失敗", "error");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `nestory-${kind}-${draft.id}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);

      if (exportQueue.length) {
        setExportPreflightReport(null);
        openNextCardExport(exportQueue, exportMarkLeave);
        return;
      }

      const sel = station3Selection ?? {
        shopify: "none" as const,
        matrixify: kind === "matrixify",
        showmore: kind === "showmore"
      };
      const api = pendingApiResult;
      const summary = formatStation3ResultMessage({
        selection: sel,
        apiSucceeded: sel.shopify === "none" ? null : api?.ok ?? null,
        apiMessage: api?.message,
        csvSucceeded: true,
        csvNote: "CSV 已下載",
        leftQueue: exportMarkLeave
      });
      setMessage("");
      showToast(summary, "success");
      setExportPreflightReport(null);
      setStation3Selection(null);
      setPendingApiResult(null);
      router.refresh();
    } catch {
      setMessage("");
      showToast("CSV 下載連線失敗", "error");
    } finally {
      setExportBusy(false);
    }
  }

  function selectTab(tab: ResultCardTabId) {
    if (!isResultCardTabId(tab)) return;
    // T7: 站① 沒有圖片分頁
    if (isCopyStation && tab === "images") return;
    setActiveTab(tab);
  }

  // T7: 若卡從他站轉入 copy_review 且仍停在 images，退回文案 tab
  useEffect(() => {
    if (isCopyStation && activeTab === "images") {
      setActiveTab("copy");
    }
  }, [isCopyStation, activeTab]);

  function tryToggleExpand() {
    // UX-L T61: collapse with dirty edits → inline double-confirm (no window.confirm)
    // UX-M T64: include specs / pricing dirty
    if (expanded && hasUncommittedEdits()) {
      if (discardArm?.kind !== "collapse") {
        setDiscardArm({ kind: "collapse" });
        setMessage("再點一次確認收合（不會自動儲存）");
        return;
      }
    }
    setDiscardArm(null);
    if (message.startsWith("再點一次確認收合")) {
      setMessage("");
    }
    setExpanded((current) => !current);
  }

  return (
    <div
      className={`result-card${expanded ? " active" : ""}${copyLocked ? " is-copy-locked" : ""}${leaving ? " is-leaving" : ""}`}
      id={`draft-card-${draft.id}`}
    >
      <div className="rc-header" onClick={() => tryToggleExpand()}>
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
            <img
              alt={`${draft.title_zh || draft.taobao_title || "商品"} 主圖`}
              className="rc-thumb-img"
              src={thumbUrl}
            />
          ) : (
            <span className="rc-thumb-placeholder">◈</span>
          )}
        </span>
        <span className="rc-headmain">
          <span className="rc-title">{draft.title_zh || draft.taobao_title || "商品草稿"}</span>
          {/* B4: 收合列即可見 IP／角色／類型 chips＋⚠（不用展開才發現未建檔） */}
          {draft.ip_name || draft.character_name || detectTypeLabel || generationToneLabel || confirmWarnCount > 0 || blockWarnCount > 0 || suggestWarnCount > 0 || copyLocked ? (
            <span className="rc-detect-chips">
              {draft.ip_name ? <span className="rc-detect-chip">{draft.ip_name}</span> : null}
              {draft.character_name ? (
                <span className={`rc-detect-chip${characterChipWarned ? " is-warn" : ""}`}>
                  {characterChipWarned ? "⚠ " : ""}
                  {draft.character_name}
                </span>
              ) : null}
              {detectTypeLabel ? <span className="rc-detect-chip">{detectTypeLabel}</span> : null}
              {/* T8: 有 generation_tone 才顯示；null/空不唬「預設」 */}
              {generationToneLabel ? (
                <span className="rc-detect-chip rc-tone-chip" title={`文案語氣：${generationToneLabel}`}>
                  🎙 {generationToneLabel}
                </span>
              ) : null}
              {blockWarnCount > 0 ? (
                <span className="rc-detect-warn is-block" title={warningSummary.block.map((w) => w.text).join("\n")}>
                  ⛔ {blockWarnCount}
                </span>
              ) : null}
              {confirmWarnCount > 0 ? (
                <span className="rc-detect-warn" title={warningSummary.confirm.map((w) => w.text).join("\n")}>
                  ⚠ {confirmWarnCount} 項待確認
                </span>
              ) : null}
              {suggestWarnCount > 0 ? (
                <span
                  className="rc-detect-chip rc-detect-suggest"
                  title={warningSummary.suggest.map((w) => w.text).join("\n")}
                >
                  🔍 {suggestWarnCount}
                </span>
              ) : null}
              {copyLocked ? <span className="rc-detect-chip" title="文案已鎖定">🔒 已鎖定</span> : null}
            </span>
          ) : null}
          {isImageStation ? (
            <span className="rc-meta-marks muted">{formatMarkSummaryLine(markSummary)}</span>
          ) : null}
        </span>
        {isCopyStation && priceRangeLabel ? (
          <div className="rc-price-stack">
            <span className="rc-price">{priceRangeLabel}</span>
            {priceMode === "sale" && draft.compare_at_price && !priceRangeLabel.includes("~") ? (
              <span className="rc-compare muted">定價 NT${draft.compare_at_price.toLocaleString()}</span>
            ) : null}
            {profit != null && !priceRangeLabel.includes("~") ? (
              <span className="rc-profit">
                利潤 NT${profit.toLocaleString()}
                {profitPct != null ? `（約 ${profitPct}%）` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
        {isReadyStation && priceRangeLabel ? (
          <div className="rc-price-stack">
            <span className="rc-price">{priceRangeLabel}</span>
          </div>
        ) : null}
        {/* R2: station-scoped quick actions */}
        <span className="rc-quick" onClick={(event) => event.stopPropagation()}>
          {isArchived ? (
            <button
              className="mini-btn rc-quick-btn"
              disabled={archiveBusy}
              onClick={() => void unarchiveOne()}
              title="解除封存"
              type="button"
            >
              {archiveBusy ? "…" : "解除封存"}
            </button>
          ) : isCopyStation ? (
            <>
              <button
                className="mini-btn rc-quick-btn"
                disabled={
                  quickBusy ||
                  regenerating ||
                  regeneratingField != null ||
                  !canQuickApprove ||
                  hasBlockingWarnings(warningSummary)
                }
                onClick={() => void approveOnly()}
                title={
                  hasBlockingWarnings(warningSummary)
                    ? "有必修警告，無法核准（⛔ 必修）"
                    : "核准文案 → 標圖"
                }
                type="button"
              >
                {quickBusy ? "…" : "✓ 核准"}
              </button>
              <button
                className="mini-btn rc-quick-btn"
                disabled={quickBusy || regenerating || regeneratingField != null}
                onClick={() => setRegenOpen(true)}
                title="重新生成（可換語氣／填方向）"
                type="button"
              >
                ↻ 重生
              </button>
              <button
                className="mini-btn rc-quick-btn"
                disabled={archiveBusy || quickBusy || regenerating || regeneratingField != null}
                onClick={() => void archiveOne()}
                title="移出工作佇列（可救回）"
                type="button"
              >
                {archiveBusy ? "…" : "🗄 移出"}
              </button>
            </>
          ) : isImageStation ? (
            <>
              <button
                className={`mini-btn rc-quick-btn${actionArm === "review" ? " danger" : ""}`}
                disabled={quickBusy || hasBlockingWarnings(warningSummary)}
                onClick={() => void stationReview()}
                title={
                  actionArm === "review"
                    ? formatStation2ConfirmHint(
                        station2Btn.primary.includes("待發布"),
                        markSummary.aiCount
                      )
                    : station2Btn.title
                }
                type="button"
              >
                {quickBusy
                  ? "…"
                  : actionArm === "review"
                    ? station2Btn.arm
                    : station2Btn.primary}
              </button>
              <button
                className="mini-btn rc-quick-btn"
                disabled={quickBusy}
                onClick={() => setLockedPreviewOpen(true)}
                title="定稿預覽（唯讀）"
                type="button"
              >
                📄
              </button>
              <button
                className={`mini-btn rc-quick-btn${actionArm === "revision" ? " danger" : ""}`}
                disabled={quickBusy}
                onClick={() => void requestRevision()}
                title={actionArm === "revision" ? "再點確認退回文案" : "退回修改文案（解鎖）"}
                type="button"
              >
                {actionArm === "revision" ? "⚠ 確認退回" : "↩ 退回"}
              </button>
            </>
          ) : isReadyStation ? (
            <>
              <button
                className="mini-btn rc-quick-btn"
                disabled={approveSummaryBusy || comboSaving || station3Busy}
                onClick={() => setStation3Open(true)}
                title="發布／匯出（API 與 CSV 可多選）"
                type="button"
              >
                發布／匯出
              </button>
              <button
                className={`mini-btn rc-quick-btn${actionArm === "return-copy" ? " danger" : ""}`}
                disabled={quickBusy}
                onClick={() => void returnFromReady("copy_review")}
                title={actionArm === "return-copy" ? "再點確認退回改文案" : "退回改文案"}
                type="button"
              >
                {actionArm === "return-copy" ? "⚠ 確認" : "↩ 改文案"}
              </button>
              <button
                className={`mini-btn rc-quick-btn${actionArm === "return-image" ? " danger" : ""}`}
                disabled={quickBusy}
                onClick={() => void returnFromReady("image_review")}
                title={actionArm === "return-image" ? "再點確認退回改圖" : "退回改圖"}
                type="button"
              >
                {actionArm === "return-image" ? "⚠ 確認" : "↩ 改圖"}
              </button>
            </>
          ) : null}
        </span>
        <span className="rc-toggle">{expanded ? "▾" : "▸"}</span>
      </div>

      {/* UX-J T56: primary = station/flow Chinese; StatusBadge only when incremental */}
      <div className="rc-status-chips">
        {(() => {
          const primary = stationFlowPrimaryLabel(draft);
          const secondary = secondaryStatusForResultCard(draft);
          return (
            <>
              <span
                className={
                  primary.kind === "fail"
                    ? "schip schip--error"
                    : "schip schip--run"
                }
              >
                {primary.label}
              </span>
              {secondary ? <StatusBadge status={secondary} /> : null}
            </>
          );
        })()}
        {!isCopyStation && pipelineImages.length > 0 && unmarkedImages.length > 0 ? (
          <span className="img-mark-status" title={unmarkedBlockMessage ?? undefined}>
            <span className="st-dot" />
            圖片未標記（{unmarkedImages.length}）
          </span>
        ) : null}
      </div>
      {failReasonSummary ? (
        <p className="rc-fail-reason" role="status" title={failReasonSummary}>
          {failReasonSummary}
        </p>
      ) : null}

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
              title="10 秒內可復原"
              type="button"
            >
              復原
            </button>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="rc-body">
          {/* R2: station② only image marks; station① keeps full tabs; station③ full + publish */}
          {isImageStation ? (
            <div className="rc-tabs" role="tablist" aria-label="卡片分頁">
              <button
                aria-selected
                className="rc-tab active"
                role="tab"
                type="button"
              >
                圖片
              </button>
            </div>
          ) : (
            <div className="rc-tabs" role="tablist" aria-label="卡片分頁">
              {/* T7: 站① 無「圖片」分頁；站③ 保留完整 tabs */}
              {RESULT_CARD_TABS.filter((tab) => !(isCopyStation && tab.id === "images")).map((tab) => (
                <button
                  aria-selected={activeTab === tab.id}
                  className={`rc-tab${activeTab === tab.id ? " active" : ""}`}
                  key={tab.id}
                  onClick={() => selectTab(tab.id)}
                  role="tab"
                  type="button"
                >
                  {tabLabelWithWarn(tab.id, confirmWarnCount + blockWarnCount)}
                </button>
              ))}
            </div>
          )}

          {!isImageStation && activeTab === "copy" ? (
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
                    const switchArmDir: "prev" | "next" | null =
                      discardArm?.kind === "switch" && discardArm.field === field
                        ? discardArm.nextIndex < idx
                          ? "prev"
                          : discardArm.nextIndex > idx
                            ? "next"
                            : null
                        : null;
                    const regenArmed =
                      discardArm?.kind === "regen" && discardArm.field === field;
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
                          regenArmed={regenArmed}
                          regenBusy={regeneratingField === field}
                          regenDisabled={fieldBusy && regeneratingField !== field}
                          switchArmDir={switchArmDir}
                        />
                      </div>
                    );
                  };

                  const specTextDisplay = (draft.spec_text ?? "").trim();

                  return (
                    <>
                      {/* UX-N T66: destination group labels (R26 UI) */}
                      <div className="rc-copy-group rc-span-2">
                        <div className="rc-copy-group-title">標題與賣點</div>
                        <p className="rc-copy-group-dest muted">→ 標題／賣點 metafield</p>
                      </div>
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

                      <div className="rc-copy-group rc-span-2">
                        <div className="rc-copy-group-title">上架描述</div>
                        <p className="rc-copy-group-dest muted">→ 商品介紹內文</p>
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
                          <CopyPreviewBlock html={descriptionPreviewHtml(description)} />
                        ) : (
                          <textarea
                            className="edit-textarea"
                            onChange={(event) => setFieldDisplay("generated_description_html", event.target.value, true)}
                            rows={10}
                            value={description}
                          />
                        )}
                      </div>

                      <div className="rc-copy-group rc-span-2">
                        <div className="rc-copy-group-title">規格中繼</div>
                        <p className="rc-copy-group-dest muted">→ Shopify 規格／給 D 段</p>
                      </div>
                      <div className="rc-field rc-span-2">
                        <div className="rc-label">商品規格（唯讀）</div>
                        {specTextDisplay ? (
                          <div className="rc-text rc-spec-readonly">{specTextDisplay}</div>
                        ) : (
                          <div className="muted">（空）</div>
                        )}
                      </div>

                      <div className="rc-copy-group rc-span-2">
                        <div className="rc-copy-group-title">FAQ</div>
                        <p className="rc-copy-group-dest muted">→ FAQ metafield</p>
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
                          <CopyPreviewBlock html={faq || "<p>尚無內容</p>"} />
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

          {/* UX-M T64: 規格 = 款式／變體（非站②規格圖）；站①③可編，站②不出現此 tab */}
          {!isImageStation && activeTab === "specs" ? (
            <div className="rc-tabpanel" role="tabpanel">
              <div className="rc-field rc-span-2">
                <div className="rc-label">規格（款式）</div>
                {variantDimensions.length === 0 && variantRows.filter(isVariantRowFilled).length === 0 ? (
                  <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                    尚未建立款式 — 可新增維度或一列
                  </p>
                ) : null}
                <div className="rc-specs-wrap">
                  <VariantEditor
                    currency="CNY"
                    dimensions={variantDimensions}
                    images={variantImageOptions}
                    onDimensionsChange={(dims) => {
                      setVariantDimensions(dims);
                      setVariantsDirty(true);
                    }}
                    onRowsChange={(rows) => {
                      setVariantRows(rows);
                      setVariantsDirty(true);
                    }}
                    onWarning={setVariantWarning}
                    priceMode={priceMode}
                    pricingSettings={getStoredPricingSettings()}
                    productCost={
                      draft.cny_price != null && Number.isFinite(Number(draft.cny_price))
                        ? Number(draft.cny_price)
                        : null
                    }
                    rows={variantRows}
                    warning={variantWarning}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {!isImageStation && activeTab === "pricing" ? (
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

          {/* T7: 站① 永不渲染圖片 tab；站② UX-F T30 三分頁；站③ 可經「圖片」tab 唯讀標記 */}
          {isImageStation ? (
            <div className="rc-tabpanel" role="tabpanel">
              <Station2ImagePanel
                draftId={draft.id}
                images={imageMarks}
                onImagesChange={setImageMarks}
                unmarkedBlockMessage={
                  unmarkedImages.length > 0 ? unmarkedBlockMessage : null
                }
              />
            </div>
          ) : !isCopyStation && activeTab === "images" ? (
            <div className="rc-tabpanel" role="tabpanel">
              {imageMarks.length > 0 ? (
                <div className="rc-field">
                  <div className="rc-label">圖片（站③ 可檢視；改標記請回標圖站）</div>
                  {pipelineImages.length > 0 ? (
                    <div className="imgmark-list">
                      {pipelineImages.map((image, index) => {
                        const src =
                          image.processed_file_url ?? image.original_file_url ?? image.generated_file_url ?? "";
                        const slot = imageSlotLabel(image, index + 1);
                        const intents = PROCESS_INTENT_OPTIONS;
                        return (
                          <div
                            className={`imgmark-row${fadingImageIds.has(image.id) ? " is-fading" : ""}`}
                            key={image.id}
                          >
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
                                  title={
                                    intent === "to_trad"
                                      ? "需先在 Supabase 執行 migration 030；D4 尚未真的做圖編會誠實跳過"
                                      : PROCESS_INTENT_LABELS[intent]
                                  }
                                  type="button"
                                >
                                  {image.process_intent === intent
                                    ? `✓ ${PROCESS_INTENT_LABELS[intent]}`
                                    : PROCESS_INTENT_LABELS[intent]}
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
                          <div
                            className={`thumb-wrap${fadingImageIds.has(image.id) ? " is-fading" : ""}`}
                            key={image.id}
                          >
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
                <div className="muted">尚無商品圖。</div>
              )}
            </div>
          ) : null}

          {!isImageStation && activeTab === "tags" ? (
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
                {blockWarnCount + confirmWarnCount + suggestWarnCount > 0 ? (
                  <div className="rc-field">
                    <div className="rc-label">提醒</div>
                    {/* T31 可選：三級分組標題（必修／待確認／建議） */}
                    {(
                      [
                        { key: "block", title: "⛔ 必修", items: warningSummary.block },
                        { key: "confirm", title: "⚠ 待確認", items: warningSummary.confirm },
                        { key: "suggest", title: "🔍 建議", items: warningSummary.suggest },
                      ] as const
                    ).map((group) =>
                      group.items.length > 0 ? (
                        <div className="rc-warn-group" key={group.key}>
                          <div className="rc-warn-group-title muted">{group.title}</div>
                          {group.items.map((w) => {
                            const missingFromLine = extractMissingCharacterNames([w.text]);
                            return (
                              <div className="rc-warning-line" key={`${group.key}-${w.text}`}>
                                <div
                                  className={
                                    group.key === "block"
                                      ? "price-soft-warn rc-warn-line-block"
                                      : group.key === "confirm"
                                        ? "price-soft-warn"
                                        : "muted"
                                  }
                                >
                                  {w.text}
                                </div>
                                {missingFromLine.map((name) => (
                                  <button
                                    className="mini-btn"
                                    disabled={!draft.ip_name || quickAddingCharacter === name || regenerating}
                                    key={`${w.text}-${name}`}
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
                      ) : null
                    )}
                  </div>
                ) : (
                  <div className="muted">目前沒有待確認提醒。</div>
                )}
              </div>
            </div>
          ) : null}

          {!isImageStation && activeTab === "seo" ? (
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
                    const switchArmDir: "prev" | "next" | null =
                      discardArm?.kind === "switch" && discardArm.field === field
                        ? discardArm.nextIndex < idx
                          ? "prev"
                          : discardArm.nextIndex > idx
                            ? "next"
                            : null
                        : null;
                    const regenArmed =
                      discardArm?.kind === "regen" && discardArm.field === field;
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
                          regenArmed={regenArmed}
                          regenBusy={regeneratingField === field}
                          regenDisabled={fieldBusy && regeneratingField !== field}
                          switchArmDir={switchArmDir}
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

          {/* R2 footer: station-scoped actions only */}
          {isReadyStation ? (
            <div className="field">
              <label>發布模式</label>
              <select onChange={(event) => setPublishMode(event.target.value as "active" | "draft")} value={publishMode}>
                <option value="active">active：審核後直接發布</option>
                <option value="draft">draft：只建立 Shopify 草稿</option>
              </select>
              <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                R3 將升級為多選匯出
              </p>
            </div>
          ) : null}
          {/* UX-L T62: message 只留 arm／⛔ 阻斷；瞬時成敗改 toast */}
          {message ? (
            <div
              className={
                message.startsWith("⛔") || message.startsWith("再點一次確認")
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
            {isCopyStation ? (
              <>
                <span className="rc-actions-group">
                  {hasUncommittedEdits() ? (
                    <button disabled={comboSaving || regeneratingField != null} onClick={() => void save()} type="button">
                      儲存此版本
                    </button>
                  ) : null}
                  <button
                    disabled={regenerating || regeneratingField != null || comboSaving}
                    onClick={() => setRegenOpen(true)}
                    type="button"
                  >
                    {regenerating ? "生成中..." : "↻ 重新生成"}
                  </button>
                </span>
                <span className="rc-actions-group rc-actions-group-review">
                  <button
                    disabled={quickBusy || hasBlockingWarnings(warningSummary)}
                    onClick={() => void approveOnly()}
                    type="button"
                  >
                    ✓ 核准
                  </button>
                  <button disabled={archiveBusy} onClick={() => void archiveOne()} type="button">
                    🗄 移出佇列
                  </button>
                </span>
              </>
            ) : null}
            {isImageStation ? (
              <span className="rc-actions-group rc-actions-group-review">
                <button
                  className={actionArm === "review" ? "danger" : undefined}
                  disabled={quickBusy || hasBlockingWarnings(warningSummary)}
                  onClick={() => void stationReview()}
                  title={station2Btn.title}
                  type="button"
                >
                  {quickBusy
                    ? "處理中…"
                    : actionArm === "review"
                      ? station2Btn.arm
                      : station2Btn.primary}
                </button>
                <button onClick={() => setLockedPreviewOpen(true)} type="button">
                  📄 定稿預覽
                </button>
                <button
                  className={actionArm === "revision" ? "danger" : undefined}
                  disabled={quickBusy}
                  onClick={() => void requestRevision()}
                  type="button"
                >
                  {actionArm === "revision" ? "⚠ 確認退回文案" : "↩ 退回修改文案"}
                </button>
              </span>
            ) : null}
            {isReadyStation ? (
              <span className="rc-actions-group rc-actions-group-review">
                {isArchived ? (
                  <button disabled={archiveBusy} onClick={() => void unarchiveOne()} type="button">
                    {archiveBusy ? "處理中…" : "解除封存"}
                  </button>
                ) : (
                  <>
                    {/* UX-M T64: 站③ 規格／商品級價可編，需有儲存入口 */}
                    {hasUncommittedEdits() ? (
                      <button
                        disabled={comboSaving || station3Busy}
                        onClick={() => void save()}
                        type="button"
                      >
                        儲存修改
                      </button>
                    ) : null}
                    <button
                      disabled={approveSummaryBusy || comboSaving || station3Busy}
                      onClick={() => setStation3Open(true)}
                      type="button"
                    >
                      發布／匯出
                    </button>
                    <button
                      className={actionArm === "return-copy" ? "danger" : undefined}
                      disabled={quickBusy}
                      onClick={() => void returnFromReady("copy_review")}
                      type="button"
                    >
                      {actionArm === "return-copy" ? "⚠ 確認退回文案" : "↩ 退回改文案"}
                    </button>
                    <button
                      className={actionArm === "return-image" ? "danger" : undefined}
                      disabled={quickBusy}
                      onClick={() => void returnFromReady("image_review")}
                      type="button"
                    >
                      {actionArm === "return-image" ? "⚠ 確認退回改圖" : "↩ 退回改圖"}
                    </button>
                  </>
                )}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}

      <Station3PublishModal
        busy={station3Busy}
        draftCount={1}
        onCancel={() => {
          if (!station3Busy) setStation3Open(false);
        }}
        onConfirm={(sel) => void runStation3CardFlow(sel)}
        open={station3Open}
      />

      <ExportPreflightModal
        busy={exportBusy}
        onCancel={() => {
          if (!exportBusy) {
            setExportPreflightReport(null);
            setExportQueue([]);
          }
        }}
        onConfirm={() => void confirmCardExport()}
        open={Boolean(exportPreflightReport)}
        report={exportPreflightReport}
      />

      <RegenCopyModal
        busy={regenerating}
        costHint={
          draft.generation_cost_estimate != null
            ? `上次文案成本約 US$${Number(draft.generation_cost_estimate).toFixed(4)}（本次重生約略相當）`
            : "預估：約一次完整文案生成費用（依模型計價）"
        }
        notes={regenNotes}
        onCancel={() => {
          if (!regenerating) setRegenOpen(false);
        }}
        onConfirm={() => void regenerate()}
        onNotesChange={setRegenNotes}
        onToneChange={setRegenTone}
        open={regenOpen}
        tone={regenTone}
      />

      <LockedCopyPreview
        open={lockedPreviewOpen}
        onClose={() => setLockedPreviewOpen(false)}
        title={title}
        tags={tags}
        sellPrice={sellPrice}
        compareAt={compareAtPrice}
        why={whyWeChoseIt}
        highlights={productHighlights}
        description={description}
      />
    </div>
  );
}
