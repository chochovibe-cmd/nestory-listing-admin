"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { showToast } from "@/components/Toast";
import { StatusBadge } from "@/components/listing/StatusBadge";
import { Button } from "@/components/ui/Button";
import {
  secondaryStatusForResultCard,
  stationFlowPrimaryLabel
} from "@/lib/drafts/stationCardStatusDisplay";
import {
  formatUnmarkedBlockMessage,
  listPipelineImages,
  listUnmarkedPipelineImages,
  patchForProcessIntentPick
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
import {
  STATION2_IMAGE_SUBTABS,
  station2SubtabCount,
  type Station2ImageSubtab,
} from "@/lib/images/station2ImageTabs";
import {
  undoApproveDrafts,
  undoArchiveDrafts,
  undoStation2Drafts,
  UNDO_TOAST_MS
} from "@/lib/drafts/quickUndo";
import {
  recalledToneForIp,
  rememberToneForIp
} from "@/lib/drafts/toneMemory";
import { resolveDraftStation } from "@/lib/drafts/stationFilter";
import { formatDraftFailSummary } from "@/lib/drafts/failReasons";
import { formatSaleStatusBadge } from "@/lib/saleStatus";
import {
  gradeDraftWarnings,
  hasBlockingWarnings,
  countConfirmOnly
} from "@/lib/drafts/warningTiers";
import {
  formatAbsoluteLocalTime,
  formatRelativeTime
} from "@/lib/formatRelativeTime";
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
  type CopyVersionField
} from "@/lib/drafts/copyVersionHistory";
import type { FieldVersionInput } from "@/lib/drafts/approveSummary";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";
import {
  formatArchiveResultMessage,
  formatUnarchiveResultMessage,
  isArchiveBusyStatus,
  isPublishedArchiveStatus
} from "@/lib/drafts/archiveDrafts";
import {
  ExportPreflightModal,
  type ExportPreviewRow
} from "@/components/listing/ExportPreflightModal";
import { Station3PublishModal } from "@/components/listing/Station3PublishModal";
import {
  runExportPreflight,
  type ExportKind,
  type ExportPreflightReport
} from "@/lib/csv/exportPreflight";
import { buildMatrixifyRows, type MatrixifyDraft } from "@/lib/csv/matrixify";
import { buildShowmoreRows, type ShowmoreDraft } from "@/lib/csv/showmore";
import { resolveShopifyStoreDomain } from "@/lib/shopify/clientStoreDomain";
import {
  formatStation3ResultMessage,
  shouldLeaveQueue,
  type Station3PublishSelection
} from "@/lib/drafts/station3Publish";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
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
import { normalizeDescriptionToPlainText } from "@/lib/contentGenerator/htmlFormat";
import { type DiscardArm } from "@/components/listing/result-card/resultCardUi";
import { isCardGestureInteractiveTarget } from "@/components/listing/result-card/cardGestureTarget";
import { ResultCardCopyPanel } from "@/components/listing/result-card/ResultCardCopyPanel";
import { ResultCardSpecsPanel } from "@/components/listing/result-card/ResultCardSpecsPanel";
import { ResultCardPricingPanel } from "@/components/listing/result-card/ResultCardPricingPanel";
import { ResultCardTagsPanel } from "@/components/listing/result-card/ResultCardTagsPanel";
import { ResultCardSeoPanel } from "@/components/listing/result-card/ResultCardSeoPanel";
import { ResultCardImagesPanel } from "@/components/listing/result-card/ResultCardImagesPanel";

/** UX-B3-P04: align with MobileTabbar FAB long-press */
export const LONG_PRESS_MS = 500;
const GESTURE_MOVE_PX = 10;
const SWIPE_ACTION_W = 210;
const SWIPE_ACTION_W_SINGLE = 140;

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


// product_images only stores the public URL, not the storage path -- derive
// the path Supabase Storage needs for .remove() from it instead of tracking
// a separate column just for this.
function storagePathFromUrl(url: string): string | null {
  const marker = "/product-images/";
  const index = url.indexOf(marker);
  return index === -1 ? null : url.slice(index + marker.length);
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
  // A19: list prefers 320px thumb when present
  return (
    first.list_thumb_url ??
    first.processed_file_url ??
    first.original_file_url ??
    first.generated_file_url ??
    null
  );
}

export function ResultCard({
  draft,
  images,
  checked,
  onToggle,
  defaultExpanded = false,
  variantPrices = [],
  leaving = false,
  /** UX-AE T133: Dashboard / deep-link arrival pulse */
  isJumpTarget = false,
  /** UX-Q T70: force expanded; skip collapse */
  sequentialMode = false,
  /** BX1 延伸：站② 逐件標圖（copy＝審文案／image＝標圖） */
  sequentialStation = "copy",
  /** UX-Q T70: called only after approve / 標圖分流 API succeeds */
  onApproveSuccess,
  /** UX-Q T70: parent increments → 站① 核准 ／ 站② 標圖通過 */
  approveSignal,
  /** UX-Q T70: parent sets tab (1–5 shortcuts); null = no-op */
  externalTab = null,
  /** UX-B2-P14: default false＝「只看我的」不顯示帳號 chip */
  showOwnerChip = false,
  /** UX-B2-P14: resolved display name; no chip if empty (never dump full UUID as body) */
  ownerLabel = null,
  /** UX-B3-P04: parent has any selection → header tap toggles, not expand */
  selectMode = false,
  /** UX-B3-P04: this card's swipe is the open peer (others closed by parent) */
  swipeOpen = false,
  /** UX-B3-P04: notify parent when swipe snaps open/closed */
  onSwipeOpenChange,
  /** UX-B3-P04: touch start → parent closes other cards' swipe */
  onGestureStart,
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
  /** UX-AE T133: arrival pulse highlight (display only) */
  isJumpTarget?: boolean;
  sequentialMode?: boolean;
  sequentialStation?: "copy" | "image";
  onApproveSuccess?: () => void;
  approveSignal?: number;
  externalTab?: ResultCardTabId | null;
  /** 預設 false＝「只看我的」不顯示帳號 */
  showOwnerChip?: boolean;
  /** 已解析的顯示名；無則不渲染 chip（勿直接印整段 UUID） */
  ownerLabel?: string | null;
  /** UX-B3-P04: multi-select mode (selectedIds.size > 0) */
  selectMode?: boolean;
  /** UX-B3-P04: whether this card currently owns open swipe */
  swipeOpen?: boolean;
  onSwipeOpenChange?: (open: boolean) => void;
  onGestureStart?: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [expanded, setExpanded] = useState(defaultExpanded || sequentialMode);
  // UX-B2-P06: jump highlight only lasts ~3s; expand must stay open after it clears
  useEffect(() => {
    if (isJumpTarget) setExpanded(true);
  }, [isJumpTarget]);
  const [activeTab, setActiveTab] = useState<ResultCardTabId>(
    sequentialMode && sequentialStation === "image" ? "images" : "copy"
  );
  /** 站②：外層分頁＝主圖／規格圖／詳情圖（不再多一層「圖片」） */
  const [s2ImageSubtab, setS2ImageSubtab] = useState<Station2ImageSubtab>("main");
  const lastApproveSignalRef = useRef<number | undefined>(approveSignal);
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
  // UX-PKG5: editable mid-field spec_text (local state; not CopyVersionField)
  const [specText, setSpecText] = useState(draft.spec_text ?? "");
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
  /** UX-O T68: full CSV rows for table mode */
  const [exportFullTableRows, setExportFullTableRows] = useState<ExportPreviewRow[] | null>(
    null
  );
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
    }, UNDO_TOAST_MS.archive);
  }

  useEffect(() => () => clearCardArchiveUndoTimer(), []);
  const [quickAddingCharacter, setQuickAddingCharacter] = useState<string | null>(null);
  const [faqView, setFaqView] = useState<"preview" | "html">("preview");
  const [descriptionView, setDescriptionView] = useState<"preview" | "source">("preview");
  // Local mirror of pipeline marks so toggles feel instant; re-synced on refresh.
  const [imageMarks, setImageMarks] = useState<ProductImage[]>(images);
  /** SYN-1: local image_flags so 生成詳情圖 toggle stays after write without full refresh */
  const [draftImageFlags, setDraftImageFlags] = useState<unknown>(draft.image_flags);
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

  /* status icon removed from collapsed header (boss) */
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

  const variantCount = useMemo(
    () =>
      variantsDirty
        ? variantRows.filter(isVariantRowFilled).length
        : variantPrices.length,
    [variantPrices, variantsDirty, variantRows]
  );

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
  // UX-B4-P02: sale status short badge after title (display only).
  const saleStatusBadge = formatSaleStatusBadge(draft.sale_status);

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
      // BX2: toast 復原（卡內復原鈕仍保留；秒數與 armCardArchiveUndo 一致）
      if (archivedIds.length) {
        showToast(msg, "success", UNDO_TOAST_MS.archive, {
          actionLabel: "復原",
          onAction: async () => {
            const result = await undoArchiveDrafts(archivedIds);
            showToast(result.message, result.ok ? "success" : "error");
            if (result.ok) {
              clearCardArchiveUndoTimer();
              setLastArchiveIds(null);
            }
            scheduleRouterRefresh(() => router.refresh());
          }
        });
      }
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
    setSpecText(draft.spec_text ?? "");
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

  // SYN-1: resync generate_detail flag after list refresh / draft identity change
  useEffect(() => {
    setDraftImageFlags(draft.image_flags);
  }, [draft.id, draft.updated_at, draft.image_flags]);

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
        // UX-PKG5: editable result-card mid-field
        spec_text: specText.trim() || null,
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
      // BX10: remember tone for this IP
      rememberToneForIp(
        typeof window !== "undefined" ? window.localStorage : null,
        draft.ip_name,
        regenTone
      );
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
        showToast(okMsg, "success", UNDO_TOAST_MS.station2Ready, {
          actionLabel: "復原",
          onAction: async () => {
            const result = await undoStation2Drafts([draft.id]);
            showToast(result.message, result.ok ? "success" : "error");
            router.refresh();
          }
        });
        // BX1 延伸：逐件標圖成功才前進
        onApproveSuccess?.();
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
      // S1: 送工廠 best-effort → 15s 復原窗
      showToast(okMsg, "success", UNDO_TOAST_MS.station2Factory, {
        actionLabel: "復原",
        onAction: async () => {
          const result = await undoStation2Drafts([draft.id]);
          showToast(result.message, result.ok ? "success" : "error");
          router.refresh();
        }
      });
      // BX1 延伸：逐件標圖成功才前進
      onApproveSuccess?.();
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
      // BX2: 10s 復原核准
      showToast("已核准文案 → 進入標圖（文案已鎖定）", "success", UNDO_TOAST_MS.approve, {
        actionLabel: "復原",
        onAction: async () => {
          const result = await undoApproveDrafts([draft.id]);
          showToast(result.message, result.ok ? "success" : "error");
          router.refresh();
        }
      });
      // UX-Q T70: sequential mode advances only on success
      onApproveSuccess?.();
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

  /** UX-PKG5: local mid-field dirty (not copy-version). */
  function hasUncommittedSpecText(): boolean {
    return specText.trim() !== (draft.spec_text ?? "").trim();
  }

  /** Copy / pricing / specs — any card edit that needs footer save. */
  function hasUncommittedEdits(): boolean {
    return (
      hasUncommittedCopy() ||
      hasUncommittedPricing() ||
      variantsDirty ||
      hasUncommittedSpecText()
    );
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
      void openNextCardExport(csvKinds, markLeave);
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

  async function openNextCardExport(kinds: ExportKind[], markLeave: boolean) {
    if (!kinds.length) return;
    const [kind, ...rest] = kinds;
    const markup = getStoredPricingSettings().showmoreMarkupPercent;
    const shopifyStoreDomain = await resolveShopifyStoreDomain();
    const titleForExport = title || draft.title_zh;
    const sellForExport = sellPrice ? Number(sellPrice) : draft.twd_price;
    const compareForExport = compareAtPrice
      ? Number(compareAtPrice)
      : draft.compare_at_price;
    const descForExport = description || draft.description_html;

    // Prefer dirty local variant form; else server variantPrices (same as specs tab).
    const product_variants = variantsDirty
      ? formRowsToDbInserts(
          clampDimensions(variantDimensions),
          variantRows.filter(isVariantRowFilled)
        ).map((v) => ({
          option1_name: v.option1_name,
          option1_value: v.option1_value,
          option2_name: v.option2_name,
          option2_value: v.option2_value,
          option3_name: v.option3_name,
          option3_value: v.option3_value,
          sku: v.sku,
          twd_price: v.twd_price,
          compare_at_price: v.compare_at_price,
          cny_price: v.cny_price,
          inventory_quantity: v.inventory_quantity,
          inventory_policy: v.inventory_policy,
          sort_order: v.sort_order
        }))
      : variantPrices.map((v) => ({
          option1_name: v.option1_name ?? null,
          option1_value: v.option1_value ?? null,
          option2_name: v.option2_name ?? null,
          option2_value: v.option2_value ?? null,
          option3_name: v.option3_name ?? null,
          option3_value: v.option3_value ?? null,
          sku: v.sku ?? null,
          twd_price: v.twd_price,
          compare_at_price: v.compare_at_price,
          cny_price: v.cny_price,
          inventory_quantity: v.inventory_quantity,
          inventory_policy: v.inventory_policy,
          sort_order: v.sort_order
        }));

    const report = runExportPreflight(
      [
        {
          id: draft.id,
          title_zh: titleForExport,
          taobao_title: draft.taobao_title,
          original_title: draft.original_title,
          status: draft.status,
          pipeline_stage: draft.pipeline_stage,
          sku: sku || draft.sku,
          twd_price: sellForExport,
          twd_cost: draft.twd_cost,
          compare_at_price: compareForExport,
          price_mode: draft.price_mode,
          description_html: descForExport,
          description_plain: draft.description_plain,
          variant_dimensions: draft.variant_dimensions,
          shopify_handle: draft.shopify_handle,
          shopify_product_id: draft.shopify_product_id,
          shopify_admin_url: draft.shopify_admin_url,
          product_images: images,
          product_variants: product_variants.map((v) => ({
            option1_value: v.option1_value ?? null,
            option2_value: v.option2_value ?? null,
            option3_value: v.option3_value ?? null,
            twd_price: v.twd_price ?? null,
            sku: v.sku ?? null,
            sort_order: v.sort_order ?? 0
          }))
        }
      ],
      { kind, showmoreMarkupPercent: markup, shopifyStoreDomain }
    );

    // UX-O T68: full CSV preview rows (same builders as download; blanks intentional).
    const packed = {
      ...draft,
      title_zh: titleForExport,
      twd_price: sellForExport,
      compare_at_price: compareForExport,
      description_html: descForExport,
      sku: sku || draft.sku,
      seo_title: seoTitle || draft.seo_title,
      seo_description: seoDescription || draft.seo_description,
      product_images: images,
      product_variants
    } as MatrixifyDraft;

    const fullRows =
      kind === "showmore"
        ? (buildShowmoreRows([packed as ShowmoreDraft], {
            showmoreMarkupPercent: markup
          }) as ExportPreviewRow[])
        : (buildMatrixifyRows([packed]) as ExportPreviewRow[]);

    setExportQueue(rest);
    setExportMarkLeave(markLeave);
    setCardExportKind(kind);
    setExportPreflightReport(report);
    setExportFullTableRows(fullRows);
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
        setExportFullTableRows(null);
        void openNextCardExport(exportQueue, exportMarkLeave);
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
      setExportFullTableRows(null);
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

  // UX-Q T70: force expanded while sequential review is open
  useEffect(() => {
    if (sequentialMode) setExpanded(true);
  }, [sequentialMode, draft.id]);

  // 站② 逐件：預設打開圖片分頁
  useEffect(() => {
    if (sequentialMode && sequentialStation === "image") {
      setActiveTab("images");
    }
  }, [sequentialMode, sequentialStation, draft.id]);

  // UX-Q T70: keyboard 1–5 → externalTab
  useEffect(() => {
    if (!externalTab) return;
    selectTab(externalTab);
    // selectTab is stable enough for tab ids; avoid re-firing on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when parent pushes a tab
  }, [externalTab]);

  // UX-Q T70 / BX1：keyboard A → 站① 核准 ／ 站② 標圖通過
  useEffect(() => {
    if (approveSignal == null) return;
    if (lastApproveSignalRef.current === undefined) {
      lastApproveSignalRef.current = approveSignal;
      return;
    }
    if (approveSignal === lastApproveSignalRef.current) return;
    lastApproveSignalRef.current = approveSignal;
    if (quickBusy || regenerating || regeneratingField != null) return;

    // 站② 逐件：A＝標圖分流（兩次確認）
    if (sequentialMode && sequentialStation === "image" && isImageStation) {
      if (hasBlockingWarnings(warningSummary)) {
        setMarkMessage(`⛔ 必修：${warningSummary.block.map((w) => w.text).join("；")}`);
        return;
      }
      void stationReview();
      return;
    }

    if (!canQuickApprove || hasBlockingWarnings(warningSummary)) {
      if (hasBlockingWarnings(warningSummary)) {
        setMessage(`⛔ 必修：${warningSummary.block.map((w) => w.text).join("；")}`);
      }
      return;
    }
    void approveOnly();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- signal edge only
  }, [approveSignal]);

  function tryToggleExpand() {
    // UX-Q T70: sequential mode stays expanded
    if (sequentialMode) return;
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
    // UX-B3-P04: expanding closes swipe
    closeSwipe();
    setExpanded((current) => !current);
  }

  // UX-B3-P04: narrow viewport for mobile gestures only
  const [isNarrow, setIsNarrow] = useState(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeDragging, setSwipeDragging] = useState(false);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartRef = useRef({ x: 0, y: 0 });
  const swipeAxisRef = useRef<"none" | "h" | "v">("none");

  function clearLongPressTimer() {
    if (longPressTimerRef.current != null) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function closeSwipe() {
    setSwipeX(0);
    setSwipeDragging(false);
    onSwipeOpenChange?.(false);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 959px)");
    const sync = () => setIsNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => () => clearLongPressTimer(), []);

  // Peer closed by parent / leave multi-select → snap shut
  useEffect(() => {
    if (!swipeOpen && swipeX !== 0) {
      setSwipeX(0);
      setSwipeDragging(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only peer flag
  }, [swipeOpen]);

  useEffect(() => {
    if (expanded || selectMode || !isNarrow) {
      if (swipeX !== 0) closeSwipe();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mode gates
  }, [expanded, selectMode, isNarrow]);

  const swipeEnabled =
    isNarrow &&
    !expanded &&
    !selectMode &&
    !sequentialMode &&
    !isArchived &&
    (isCopyStation || isImageStation || isReadyStation);

  const swipeActionWidth =
    isReadyStation && !isCopyStation && !isImageStation
      ? SWIPE_ACTION_W_SINGLE
      : SWIPE_ACTION_W;

  function handleHeaderTouchStart(event: ReactTouchEvent) {
    if (!isNarrow || sequentialMode) return;
    if (isCardGestureInteractiveTarget(event.target)) {
      clearLongPressTimer();
      swipeAxisRef.current = "none";
      setSwipeDragging(false);
      return;
    }
    const touch = event.touches[0];
    if (!touch) return;
    onGestureStart?.();
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    swipeAxisRef.current = "none";
    longPressTriggeredRef.current = false;
    setSwipeDragging(false);

    if (onToggle) {
      clearLongPressTimer();
      longPressTimerRef.current = setTimeout(() => {
        longPressTriggeredRef.current = true;
        longPressTimerRef.current = null;
        closeSwipe();
        // Enter multi-select: check if not already checked
        if (!(checked ?? false)) {
          onToggle();
        }
      }, LONG_PRESS_MS);
    }
  }

  function handleHeaderTouchMove(event: ReactTouchEvent) {
    if (!isNarrow || sequentialMode || isCardGestureInteractiveTarget(event.target)) return;
    const touch = event.touches[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    if (Math.abs(dx) > GESTURE_MOVE_PX || Math.abs(dy) > GESTURE_MOVE_PX) {
      clearLongPressTimer();
    }

    if (!swipeEnabled) return;

    if (swipeAxisRef.current === "none") {
      if (Math.abs(dy) > GESTURE_MOVE_PX && Math.abs(dy) >= Math.abs(dx)) {
        swipeAxisRef.current = "v";
        return;
      }
      if (Math.abs(dx) > GESTURE_MOVE_PX && Math.abs(dx) > Math.abs(dy)) {
        swipeAxisRef.current = "h";
        setSwipeDragging(true);
        clearLongPressTimer();
      }
    }

    if (swipeAxisRef.current === "h") {
      // Left swipe only
      const next = Math.max(Math.min(dx, 0), -swipeActionWidth);
      setSwipeX(next);
    }
  }

  function handleHeaderTouchEnd(event: ReactTouchEvent) {
    if (!isNarrow) return;
    clearLongPressTimer();
    if (isCardGestureInteractiveTarget(event.target)) {
      swipeAxisRef.current = "none";
      setSwipeDragging(false);
      return;
    }
    if (swipeAxisRef.current === "h" && swipeEnabled) {
      setSwipeDragging(false);
      setSwipeX((current) => {
        const open = current < -swipeActionWidth / 2;
        const next = open ? -swipeActionWidth : 0;
        onSwipeOpenChange?.(open);
        return next;
      });
    }
    swipeAxisRef.current = "none";
  }

  function handleHeaderClick() {
    // Long-press already selected — swallow synthetic click (do not expand)
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    // Multi-select mode: tap card = toggle selection (expand via ▸ only)
    if (isNarrow && selectMode && onToggle) {
      onToggle();
      return;
    }
    tryToggleExpand();
  }

  function runSwipeAction(action: () => void) {
    action();
    closeSwipe();
  }

  // UX-B2-P07 7-6: accept halfwidth ~ (legacy) or fullwidth ～
  const isPriceRange = Boolean(priceRangeLabel && /~|～/.test(priceRangeLabel));

  function openRegenModal() {
    const remembered = recalledToneForIp(
      typeof window !== "undefined" ? window.localStorage : null,
      draft.ip_name
    );
    if (remembered && (COPY_TONES as readonly string[]).includes(remembered)) {
      setRegenTone(remembered as CopyTone);
    }
    setRegenOpen(true);
  }

  const mobileCardPrimary = stationFlowPrimaryLabel(draft);
  const mobileCardSecondary = secondaryStatusForResultCard(draft);
  const mobileCardTimeLabel = formatRelativeTime(draft.created_at);
  const mobileCardTimeTitle = formatAbsoluteLocalTime(draft.created_at);

  const titleRowEl = (
    <span className="rc-title-row">
      <span className="rc-title-flow">
        <span className="rc-title">{draft.title_zh || draft.taobao_title || "商品草稿"}</span>
        {isNarrow ? (
          <span
            className={
              mobileCardPrimary.kind === "fail"
                ? "schip schip--error rc-title-inline-station"
                : "schip schip--run rc-title-inline-station"
            }
          >
            {mobileCardPrimary.label}
          </span>
        ) : null}
        {isNarrow && mobileCardSecondary ? (
          <StatusBadge status={mobileCardSecondary} />
        ) : null}
        {isNarrow && mobileCardTimeLabel ? (
          <span
            className="rc-title-inline-time muted"
            title={mobileCardTimeTitle || undefined}
          >
            {mobileCardTimeLabel}
          </span>
        ) : null}
      </span>
      {saleStatusBadge ? (
        <span className="rc-sale-badge" title={`銷售狀態：${saleStatusBadge}`}>
          {saleStatusBadge}
        </span>
      ) : null}
      {variantCount > 0 ? (
        <span className="schip rc-variant-count">{variantCount} 個規格</span>
      ) : null}
      {failReasonSummary ? (
        <span className="rc-fail-reason" role="status" title={failReasonSummary}>
          {failReasonSummary}
        </span>
      ) : null}
    </span>
  );

  const headMetaEl = (() => {
    const timeLabel = formatRelativeTime(draft.created_at);
    const timeTitle = formatAbsoluteLocalTime(draft.created_at);
    const showOwner = showOwnerChip && Boolean(ownerLabel?.trim());
    const primary = stationFlowPrimaryLabel(draft);
    const secondary = secondaryStatusForResultCard(draft);
    return (
      <span className="rc-head-meta">
        <span
          className={
            primary.kind === "fail"
              ? "schip schip--error rc-station-chip"
              : "schip schip--run rc-station-chip"
          }
        >
          {primary.label}
        </span>
        {isImageStation ? (
          <span className="rc-meta-marks muted">
            {formatMarkSummaryLine(markSummary)}
          </span>
        ) : null}
        {secondary ? <StatusBadge status={secondary} /> : null}
        {timeLabel ? (
          <span className="rc-time-ago muted" title={timeTitle || undefined}>
            {timeLabel}
          </span>
        ) : null}
        {showOwner ? (
          <span className="rc-owner-chip" title={draft.created_by ?? undefined}>
            {ownerLabel}
          </span>
        ) : null}
      </span>
    );
  })();

  const detectTagsEl =
    draft.ip_name ||
    draft.character_name ||
    detectTypeLabel ||
    generationToneLabel ? (
      <span className="rc-detect-chips rc-detect-chips--tags">
        {draft.ip_name ? (
          <span className="rc-detect-chip rc-detect-chip--ip">{draft.ip_name}</span>
        ) : null}
        {draft.character_name ? (
          <span
            className={`rc-detect-chip rc-detect-chip--char${
              characterChipWarned ? " is-warn" : ""
            }`}
          >
            {characterChipWarned ? "⚠ " : ""}
            {draft.character_name}
          </span>
        ) : null}
        {detectTypeLabel ? (
          <span className="rc-detect-chip">{detectTypeLabel}</span>
        ) : null}
        {generationToneLabel ? (
          <span
            className="rc-detect-chip rc-detect-chip--tone rc-tone-chip"
            title={`文案語氣：${generationToneLabel}`}
          >
            🎙 {generationToneLabel}
          </span>
        ) : null}
      </span>
    ) : null;

  const detectWarnsEl =
    copyLocked || blockWarnCount > 0 || confirmWarnCount > 0 || suggestWarnCount > 0 ? (
      <span className="rc-detect-chips rc-detect-chips--warns">
        {copyLocked ? (
          <span className="rc-detect-chip" title="文案已鎖定">
            🔒 文案已鎖定
          </span>
        ) : null}
        {blockWarnCount > 0 ? (
          <span
            className="rc-detect-warn is-block"
            title={warningSummary.block.map((w) => w.text).join("\n")}
          >
            ⛔ {blockWarnCount}
          </span>
        ) : null}
        {confirmWarnCount > 0 ? (
          <span
            className="rc-detect-warn"
            title={warningSummary.confirm.map((w) => w.text).join("\n")}
          >
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
      </span>
    ) : null;

  const priceMiniEl =
    isCopyStation && priceRangeLabel ? (
      <div className="rc-price-mini">
        <div className="rc-price-mini-main">
          <span className="rc-price-mini-label">售價</span>
          <span className="rc-price-mini-value">{priceRangeLabel}</span>
        </div>
        {(priceMode === "sale" && draft.compare_at_price && !isPriceRange) ||
        (profit != null && !isPriceRange) ? (
          <div className="rc-price-mini-sub">
            {priceMode === "sale" && draft.compare_at_price && !isPriceRange ? (
              <span className="rc-price-mini-strike">
                NT${draft.compare_at_price.toLocaleString()}
              </span>
            ) : null}
            {profit != null && !isPriceRange ? (
              <span className="rc-price-mini-profit">
                利潤 NT${profit.toLocaleString()}
                {profitPct != null ? `（約 ${profitPct}%）` : ""}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
    ) : !isImageStation && priceRangeLabel ? (
      <div className="rc-price-mini">
        <div className="rc-price-mini-main">
          <span className="rc-price-mini-label">售價</span>
          <span className="rc-price-mini-value">{priceRangeLabel}</span>
        </div>
      </div>
    ) : null;

  const swipeActions =
    !isArchived && isCopyStation ? (
      <>
        <button
          className="rc-swipe-approve"
          disabled={
            regenerating ||
            regeneratingField != null ||
            !canQuickApprove ||
            hasBlockingWarnings(warningSummary) ||
            quickBusy
          }
          onClick={() => runSwipeAction(() => void approveOnly())}
          type="button"
        >
          ✓ 核准
        </button>
        <button
          className="rc-swipe-secondary"
          disabled={quickBusy || regeneratingField != null || regenerating}
          onClick={() => runSwipeAction(() => openRegenModal())}
          type="button"
        >
          ↻ 重生
        </button>
        <button
          className="rc-swipe-remove"
          disabled={archiveBusy}
          onClick={() => runSwipeAction(() => void archiveOne())}
          type="button"
        >
          移出佇列
        </button>
      </>
    ) : !isArchived && isImageStation ? (
      <>
        <button
          className="rc-swipe-approve"
          disabled={hasBlockingWarnings(warningSummary) || quickBusy}
          onClick={() => runSwipeAction(() => void stationReview())}
          type="button"
        >
          {actionArm === "review" ? station2Btn.arm : station2Btn.primary}
        </button>
        <button
          className="rc-swipe-secondary"
          disabled={quickBusy}
          onClick={() => runSwipeAction(() => void requestRevision())}
          type="button"
        >
          {actionArm === "revision" ? "⚠ 確認退回" : "↩ 退回"}
        </button>
        <button
          className="rc-swipe-remove"
          disabled={archiveBusy}
          onClick={() => runSwipeAction(() => void archiveOne())}
          type="button"
        >
          移出佇列
        </button>
      </>
    ) : !isArchived && isReadyStation ? (
      <>
        <button
          className="rc-swipe-approve"
          disabled={approveSummaryBusy || comboSaving || station3Busy}
          onClick={() => runSwipeAction(() => setStation3Open(true))}
          type="button"
        >
          發布／匯出
        </button>
        <button
          className="rc-swipe-remove"
          disabled={archiveBusy}
          onClick={() => runSwipeAction(() => void archiveOne())}
          type="button"
        >
          移出佇列
        </button>
      </>
    ) : null;

  return (
    <div className={`rc-swipe-wrap${swipeX !== 0 || swipeDragging ? " is-swiping" : ""}`}>
      {isNarrow && swipeActions ? (
        <div
          aria-hidden={swipeX === 0}
          className="rc-swipe-actions"
          style={{ width: swipeActionWidth }}
        >
          {swipeActions}
        </div>
      ) : null}
      <div
        className={`result-card rc-swipe-front${expanded ? " active" : ""}${copyLocked ? " is-copy-locked" : ""}${leaving ? " is-leaving" : ""}${isJumpTarget ? " is-jump-target" : ""}${swipeDragging ? " rc-swipe-dragging" : ""}${checked ? " is-checked" : ""}`}
        id={`draft-card-${draft.id}`}
        style={
          isNarrow && !leaving
            ? { transform: `translateX(${swipeX}px)` }
            : undefined
        }
      >
      <div
        className="rc-header"
        onClick={handleHeaderClick}
        onContextMenu={(event) => {
          // UX-B3-P04: avoid long-press callout/menu on mobile
          if (isNarrow) event.preventDefault();
        }}
        onTouchCancel={handleHeaderTouchEnd}
        onTouchEnd={handleHeaderTouchEnd}
        onTouchMove={handleHeaderTouchMove}
        onTouchStart={handleHeaderTouchStart}
      >
        {onToggle ? (
          <input
            checked={checked ?? false}
            className={`rc-checkbox${checked ? " sel" : ""}`}
            onClick={(event) => event.stopPropagation()}
            onChange={onToggle}
            type="checkbox"
            title="勾選以加入批次操作（核准/退回/發布多筆）"
            aria-label="勾選以加入批次操作"
          />
        ) : null}
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
          {/* UX-B4-P02/P06: title + sale badge + fail reason */}
          {titleRowEl}
          {/* UX-B4-P04: chips cluster (meta / tags / warns) — mobile row2 right */}
          <span className="rc-head-chips">
            {headMetaEl}
            {detectTagsEl}
            {detectWarnsEl}
          </span>
        </span>
        <span className="rc-card-summary-row">
          {isImageStation ? (
            <span className="rc-card-mark-summary muted">
              {formatMarkSummaryLine(markSummary)}
            </span>
          ) : null}
        </span>
        {/* UX-B4-P04: mobile row3 left regen (desktop hidden via CSS); price shares contents row */}
        <span className="rc-m-row3">
          {!isArchived && isCopyStation ? (
            <span
              className="rc-m-regen-slot"
              onClick={(event) => event.stopPropagation()}
            >
              <Button
                size="sm"
                className="rc-quick-btn rc-m-regen-btn"
                disabled={quickBusy || regeneratingField != null}
                loading={regenerating}
                onClick={() => openRegenModal()}
                title="重新生成（可換語氣／填方向）"
                type="button"
              >
                ↻ 重生
              </Button>
            </span>
          ) : null}
          {priceMiniEl}
        </span>
        {/* UX-B3-fix: 快捷鈕 + × + ▸ 同一列（桌機；手機整列隱藏，重生改 rc-m-regen-slot） */}
        <div className="rc-quick-row">
          <span className="rc-quick" onClick={(event) => event.stopPropagation()}>
            {isArchived ? (
              <Button
                size="sm"
                className="rc-quick-btn"
                loading={archiveBusy}
                onClick={() => void unarchiveOne()}
                title="解除封存"
                type="button"
              >
                解除封存
              </Button>
            ) : isCopyStation ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  className="rc-quick-btn"
                  disabled={
                    regenerating ||
                    regeneratingField != null ||
                    !canQuickApprove ||
                    hasBlockingWarnings(warningSummary)
                  }
                  loading={quickBusy}
                  onClick={() => void approveOnly()}
                  title={
                    hasBlockingWarnings(warningSummary)
                      ? "有必修警告，無法核准（⛔ 必修）"
                      : "核准文案 → 標圖"
                  }
                  type="button"
                >
                  ✓ 核准
                </Button>
                <Button
                  size="sm"
                  className="rc-quick-btn"
                  disabled={quickBusy || regeneratingField != null}
                  loading={regenerating}
                  onClick={() => openRegenModal()}
                  title="重新生成（可換語氣／填方向）"
                  type="button"
                >
                  ↻ 重生
                </Button>
              </>
            ) : isImageStation ? (
              <>
                <Button
                  variant={actionArm === "review" ? "danger" : "primary"}
                  size="sm"
                  className="rc-quick-btn"
                  disabled={hasBlockingWarnings(warningSummary)}
                  loading={quickBusy}
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
                  {actionArm === "review" ? station2Btn.arm : station2Btn.primary}
                </Button>
                <Button
                  size="sm"
                  className="rc-quick-btn"
                  disabled={quickBusy}
                  onClick={() => setLockedPreviewOpen(true)}
                  title="文案預覽（唯讀）"
                  type="button"
                >
                  文案預覽
                </Button>
                <Button
                  variant={actionArm === "revision" ? "danger" : "secondary"}
                  size="sm"
                  className="rc-quick-btn"
                  disabled={quickBusy}
                  onClick={() => void requestRevision()}
                  title={actionArm === "revision" ? "再點確認退回文案" : "退回修改文案（解鎖）"}
                  type="button"
                >
                  {actionArm === "revision" ? "⚠ 確認退回" : "↩ 退回"}
                </Button>
              </>
            ) : isReadyStation ? (
              <>
                <Button
                  variant="primary"
                  size="sm"
                  className="rc-quick-btn"
                  disabled={approveSummaryBusy || comboSaving || station3Busy}
                  onClick={() => setStation3Open(true)}
                  title="發布／匯出（API 與 CSV 可多選）"
                  type="button"
                >
                  發布／匯出
                </Button>
                <Button
                  variant={actionArm === "return-copy" ? "danger" : "secondary"}
                  size="sm"
                  className="rc-quick-btn"
                  disabled={quickBusy}
                  onClick={() => void returnFromReady("copy_review")}
                  title={actionArm === "return-copy" ? "再點確認退回改文案" : "退回改文案"}
                  type="button"
                >
                  {actionArm === "return-copy" ? "⚠ 確認" : "↩ 改文案"}
                </Button>
                <Button
                  variant={actionArm === "return-image" ? "danger" : "secondary"}
                  size="sm"
                  className="rc-quick-btn"
                  disabled={quickBusy}
                  onClick={() => void returnFromReady("image_review")}
                  title={actionArm === "return-image" ? "再點確認退回改圖" : "退回改圖"}
                  type="button"
                >
                  {actionArm === "return-image" ? "⚠ 確認" : "↩ 改圖"}
                </Button>
              </>
            ) : null}
          </span>
          {!isArchived && !sequentialMode ? (
            <button
              aria-label="移出工作佇列"
              className="rc-dismiss-btn"
              disabled={archiveBusy || quickBusy || regenerating || regeneratingField != null}
              onClick={(event) => {
                event.stopPropagation();
                void archiveOne();
              }}
              title="移出工作佇列（可救回）"
              type="button"
            >
              {archiveBusy ? "…" : "×"}
            </button>
          ) : null}
          <span
            className="rc-toggle"
            onClick={(event) => {
              // UX-B3-P04: in multi-select, only ▸ expands; stop header toggle-select
              event.stopPropagation();
              tryToggleExpand();
            }}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                event.stopPropagation();
                tryToggleExpand();
              }
            }}
            aria-label={expanded ? "收合卡片" : "展開卡片"}
          >
            {expanded ? "▾" : "▸"}
          </span>
        </div>
      </div>

      {/* UX-B4-P06: failReason moved into .rc-title-row (after title); no under-header banner */}

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
            <Button
              size="sm"
              className="rc-quick-btn"
              disabled={archiveBusy}
              onClick={() => void unarchiveOne(lastArchiveIds)}
              style={{ marginLeft: 8 }}
              title="10 秒內可復原"
              type="button"
            >
              復原
            </Button>
          ) : null}
        </div>
      ) : null}

      {expanded ? (
        <div className="rc-body">
          {/* R2: station② 分頁＝主圖／規格圖／詳情圖；station① 全文案 tabs；station③ full + publish */}
          {isImageStation ? (
            <div className="rc-tabs" role="tablist" aria-label="圖片類型">
              {STATION2_IMAGE_SUBTABS.map((tab) => {
                const count = station2SubtabCount(imageMarks, tab.id);
                const active = s2ImageSubtab === tab.id;
                return (
                  <button
                    aria-selected={active}
                    className={`rc-tab${active ? " active" : ""}`}
                    key={tab.id}
                    onClick={() => setS2ImageSubtab(tab.id)}
                    role="tab"
                    type="button"
                  >
                    {tab.label}
                    {count > 0 ? (
                      <span className="rc-tab-count"> {count}</span>
                    ) : null}
                  </button>
                );
              })}
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

          {/* S2: 展開分頁拆子元件（行為不變，只降 ResultCard 體積） */}
          {!isImageStation && activeTab === "copy" ? (
            <ResultCardCopyPanel
              characterChipWarned={characterChipWarned}
              comboSaving={comboSaving}
              copyDirty={copyDirty}
              description={description}
              descriptionView={descriptionView}
              detectTypeLabel={detectTypeLabel}
              detectedCategory={detectedCategory}
              discardArm={discardArm}
              displayByField={displayByField}
              draft={draft}
              faq={faq}
              faqView={faqView}
              historyLoaded={historyLoaded}
              missingCharacters={missingCharacters}
              onDescriptionViewChange={setDescriptionView}
              onDetectedCategoryChange={setDetectedCategory}
              onFaqViewChange={setFaqView}
              onQuickAddCharacter={(name) => void quickAddCharacter(name)}
              onRegenField={(field) => void regenerateField(field)}
              onSaveCombo={() => void saveComboOnly()}
              onSetFieldDisplay={setFieldDisplay}
              onSkuChange={setSku}
              onSpecTextChange={setSpecText}
              onSwitchVersion={switchVersion}
              priceMode={priceMode}
              productHighlights={productHighlights}
              quickAddingCharacter={quickAddingCharacter}
              regenerating={regenerating}
              regeneratingField={regeneratingField}
              sku={sku}
              specText={specText}
              title={title}
              versionIndex={versionIndex}
              versionsByField={versionsByField}
              whyWeChoseIt={whyWeChoseIt}
            />
          ) : null}

          {!isImageStation && activeTab === "specs" ? (
            <ResultCardSpecsPanel
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
              productCost={
                draft.cny_price != null && Number.isFinite(Number(draft.cny_price))
                  ? Number(draft.cny_price)
                  : null
              }
              variantDimensions={variantDimensions}
              variantImageOptions={variantImageOptions}
              variantRows={variantRows}
              variantWarning={variantWarning}
            />
          ) : null}

          {!isImageStation && activeTab === "pricing" ? (
            <ResultCardPricingPanel
              compareAtPrice={compareAtPrice}
              onCompareAtPriceChange={setCompareAtPrice}
              onSellPriceChange={setSellPrice}
              priceMode={priceMode}
              sellPrice={sellPrice}
              twdCost={draft.twd_cost}
            />
          ) : null}

          {/* T7: 站① 永不渲染圖片 tab；站② UX-F T30；站③ 圖片 tab */}
          {isImageStation ? (
            <div className="rc-tabpanel" role="tabpanel">
              <Station2ImagePanel
                draftId={draft.id}
                hideSubtabs
                images={imageMarks}
                imageFlags={draftImageFlags}
                onImageFlagsChange={setDraftImageFlags}
                onImagesChange={setImageMarks}
                onSubtabChange={setS2ImageSubtab}
                subtab={s2ImageSubtab}
                unmarkedBlockMessage={
                  unmarkedImages.length > 0 ? unmarkedBlockMessage : null
                }
              />
            </div>
          ) : !isCopyStation && activeTab === "images" ? (
            <ResultCardImagesPanel
              fadingImageIds={fadingImageIds}
              imageMarks={imageMarks}
              onRemoveImage={(image) => void removeImage(image)}
              onSetProcessIntent={(image, intent) => void setProcessIntent(image, intent)}
              onToggleSpec={(image) => void toggleSpecOnCard(image)}
              pipelineImages={pipelineImages}
              unmarkedBlockMessage={unmarkedBlockMessage}
              unmarkedImages={unmarkedImages}
            />
          ) : null}

          {!isImageStation && activeTab === "tags" ? (
            <ResultCardTagsPanel
              blockWarnCount={blockWarnCount}
              confirmWarnCount={confirmWarnCount}
              ipName={draft.ip_name}
              onQuickAddCharacter={(name) => void quickAddCharacter(name)}
              onTagsChange={setTags}
              quickAddingCharacter={quickAddingCharacter}
              regenerating={regenerating}
              suggestWarnCount={suggestWarnCount}
              tags={tags}
              warningSummary={warningSummary}
            />
          ) : null}

          {!isImageStation && activeTab === "seo" ? (
            <ResultCardSeoPanel
              comboSaving={comboSaving}
              copyDirty={copyDirty}
              discardArm={discardArm}
              displayByField={displayByField}
              historyLoaded={historyLoaded}
              onRegenField={(field) => void regenerateField(field)}
              onSaveCombo={() => void saveComboOnly()}
              onSetFieldDisplay={setFieldDisplay}
              onSwitchVersion={switchVersion}
              regenerating={regenerating}
              regeneratingField={regeneratingField}
              seoDescription={seoDescription}
              seoTitle={seoTitle}
              versionIndex={versionIndex}
              versionsByField={versionsByField}
            />
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
                    <Button
                      size="sm"
                      disabled={comboSaving || regeneratingField != null}
                      loading={comboSaving}
                      onClick={() => void save()}
                      type="button"
                    >
                      儲存此版本
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    disabled={regeneratingField != null || comboSaving}
                    loading={regenerating}
                    onClick={() => {
                      const remembered = recalledToneForIp(
                        typeof window !== "undefined" ? window.localStorage : null,
                        draft.ip_name
                      );
                      if (remembered && (COPY_TONES as readonly string[]).includes(remembered)) {
                        setRegenTone(remembered as CopyTone);
                      }
                      setRegenOpen(true);
                    }}
                    type="button"
                  >
                    ↻ 重新生成
                  </Button>
                </span>
                <span className="rc-actions-group rc-actions-group-review">
                  {/* T114: archive is corner × only — no footer「移出佇列」duplicate */}
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={quickBusy || hasBlockingWarnings(warningSummary)}
                    onClick={() => void approveOnly()}
                    type="button"
                  >
                    ✓ 核准
                  </Button>
                </span>
              </>
            ) : null}
            {isImageStation ? (
              <span className="rc-actions-group rc-actions-group-review">
                <Button
                  variant={actionArm === "review" ? "danger" : "primary"}
                  size="sm"
                  disabled={hasBlockingWarnings(warningSummary)}
                  loading={quickBusy}
                  onClick={() => void stationReview()}
                  title={station2Btn.title}
                  type="button"
                >
                  {actionArm === "review" ? station2Btn.arm : station2Btn.primary}
                </Button>
                <Button size="sm" onClick={() => setLockedPreviewOpen(true)} type="button">
                  文案預覽
                </Button>
                <Button
                  variant={actionArm === "revision" ? "danger" : "secondary"}
                  size="sm"
                  disabled={quickBusy}
                  onClick={() => void requestRevision()}
                  type="button"
                >
                  {actionArm === "revision" ? "⚠ 確認退回文案" : "↩ 退回修改文案"}
                </Button>
              </span>
            ) : null}
            {isReadyStation ? (
              <span className="rc-actions-group rc-actions-group-review">
                {isArchived ? (
                  <Button
                    size="sm"
                    loading={archiveBusy}
                    onClick={() => void unarchiveOne()}
                    type="button"
                  >
                    解除封存
                  </Button>
                ) : (
                  <>
                    {/* UX-M T64: 站③ 規格／商品級價可編，需有儲存入口 */}
                    {hasUncommittedEdits() ? (
                      <Button
                        size="sm"
                        disabled={station3Busy}
                        loading={comboSaving}
                        onClick={() => void save()}
                        type="button"
                      >
                        儲存修改
                      </Button>
                    ) : null}
                    <Button
                      variant="primary"
                      size="sm"
                      disabled={approveSummaryBusy || comboSaving || station3Busy}
                      onClick={() => setStation3Open(true)}
                      type="button"
                    >
                      發布／匯出
                    </Button>
                    <Button
                      variant={actionArm === "return-copy" ? "danger" : "secondary"}
                      size="sm"
                      disabled={quickBusy}
                      onClick={() => void returnFromReady("copy_review")}
                      type="button"
                    >
                      {actionArm === "return-copy" ? "⚠ 確認退回文案" : "↩ 退回改文案"}
                    </Button>
                    <Button
                      variant={actionArm === "return-image" ? "danger" : "secondary"}
                      size="sm"
                      disabled={quickBusy}
                      onClick={() => void returnFromReady("image_review")}
                      type="button"
                    >
                      {actionArm === "return-image" ? "⚠ 確認退回改圖" : "↩ 退回改圖"}
                    </Button>
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
        fullTableRows={exportFullTableRows}
        onCancel={() => {
          if (!exportBusy) {
            setExportPreflightReport(null);
            setExportFullTableRows(null);
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
    </div>
  );
}
