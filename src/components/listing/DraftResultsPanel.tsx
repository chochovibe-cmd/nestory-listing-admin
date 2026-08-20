"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ResultCard } from "@/components/listing/ResultCard";
import { ExportPreflightModal } from "@/components/listing/ExportPreflightModal";
import { Station3PublishModal } from "@/components/listing/Station3PublishModal";
import {
  SequentialReviewOverlay,
  type SequentialReviewMode,
  type SequentialReviewQueueItem
} from "@/components/listing/SequentialReviewOverlay";
import { StageFilterPills } from "@/components/drafts/StageFilterPills";
import { FactoryBridgeStrip } from "@/components/listing/FactoryBridgeStrip";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { buildFactoryBridgeSummary } from "@/lib/images/factoryBridge";
import { GENERATION_PROGRESS_EVENT, type GenerationProgress } from "@/components/listing/generationProgress";
import {
  JUMP_DRAFT_ID_FIRST,
  JUMP_TO_DRAFT_EVENT,
  clearJumpDraftId,
  readJumpDraftId,
  scrollToDraftCard,
  type JumpToDraftDetail
} from "@/lib/drafts/jumpToDraft";
import {
  runExportPreflight,
  type ExportKind,
  type ExportPreflightReport,
  type PreflightDraftInput
} from "@/lib/csv/exportPreflight";
import { resolveShopifyStoreDomain } from "@/lib/shopify/clientStoreDomain";
import { buildMatrixifyRows, type MatrixifyDraft } from "@/lib/csv/matrixify";
import { buildShowmoreRows, type ShowmoreDraft } from "@/lib/csv/showmore";
import {
  formatStation3ResultMessage,
  shouldLeaveQueue,
  type Station3PublishSelection
} from "@/lib/drafts/station3Publish";
import type { ExportPreviewRow } from "@/components/listing/ExportPreflightModal";
import {
  RESULT_SORT_OPTIONS,
  type ResultSortMode,
  readStoredResultSort,
  sortResultDrafts,
  writeStoredResultSort
} from "@/lib/drafts/resultSort";
import {
  countStations,
  DEFAULT_RESULTS_FILTER,
  filterDraftsByResultsFilter,
  filterWorkQueueDrafts,
  isResultsFilterKey,
  isStationFilterKey,
  pickDefaultResultsFilter,
  readStoredResultsFilter,
  STATION_FILTER_STORAGE_KEY_RESULTS,
  type ResultsFilterKey,
  writeStoredResultsFilter
} from "@/lib/drafts/stationFilter";
import {
  decideStation2Review,
  formatStation2BatchRouteSummary,
  formatStation2SuccessToast,
} from "@/lib/drafts/stationRoute";
import {
  formatArchiveResultMessage,
  formatUnarchiveResultMessage
} from "@/lib/drafts/archiveDrafts";
import {
  applyOptimisticHide,
  filterByOptimisticHide,
  reconcileOptimisticHide,
  type OptimisticHideMap
} from "@/lib/drafts/optimisticArchiveHide";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";
import {
  undoApproveDrafts,
  undoArchiveDrafts,
  undoStation2Drafts,
  UNDO_TOAST_MS
} from "@/lib/drafts/quickUndo";
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import { isAdmin } from "@/lib/auth/roles";
import { libraryCreatorLabel } from "@/lib/library/productLibrary";
import { createClient } from "@/lib/supabase/client";
import type {
  ProductDraft,
  ProductImage,
  ProductVariantRow,
  UserRole
} from "@/types/domain";

/** UX-B2-P14: workbench results list scope (align Dashboard / 紀錄) */
type ResultsScopeMode = "mine" | "all";

/**
 * Workbench variant row for ResultCard price range + UX-M T64 specs hydrate.
 * Only-add: keeps price-range fields; extra columns feed dbRowsToForm.
 */
export type VariantPriceRow = Pick<
  ProductVariantRow,
  | "id"
  | "draft_id"
  | "twd_price"
  | "compare_at_price"
  | "sort_order"
  | "option1_value"
  | "option2_value"
  | "option3_value"
  | "option1_name"
  | "option2_name"
  | "option3_name"
  | "sku"
  | "cny_price"
  | "price_locked"
  | "inventory_quantity"
  | "inventory_policy"
  | "image_id"
>;

/** Stable empty ref so ResultCard hydrate effect does not thrash on every render. */
const EMPTY_VARIANT_PRICES: VariantPriceRow[] = [];

/** UX-B4-P04: dismissible mobile gesture tip (long-press / swipe). */
const RC_GESTURE_HINT_KEY = "nestory-rc-gesture-hint-v1";

export function DraftResultsPanel({
  drafts,
  images,
  variants = [],
  userId = null
}: {
  drafts: ProductDraft[];
  images: ProductImage[];
  /** P1-5: multi-variant sell prices for card range display */
  variants?: VariantPriceRow[];
  /** UX-B2-P14: current user for mine filter + owner chip gate */
  userId?: string | null;
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  /** UX-B3-P04: only one card may keep swipe-open actions */
  const [openSwipeId, setOpenSwipeId] = useState<string | null>(null);
  /** UX-B4-P04: list-top hint; CSS hides on desktop */
  const [showGestureHint, setShowGestureHint] = useState(false);
  const [busy, setBusy] = useState(false);
  /** UX-B2-P14: default「只看我的」；admin 可切「全部成員」 */
  const [scope, setScope] = useState<ResultsScopeMode>("mine");
  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [nameById, setNameById] = useState<Map<string, string>>(() => new Map());
  const admin = isAdmin(role);
  /** BX5: progress text on the primary batch button itself (not toast-only) */
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [lastArchiveIds, setLastArchiveIds] = useState<string[] | null>(null);
  /** UX-E T28: inline singleWarn arm (first click → second click submits). */
  const [batchArm, setBatchArm] = useState<null | { action: "approve" | "review"; hint: string }>(
    null
  );
  /** UX-E T46: archive undo window (10s). */
  const archiveUndoTimerRef = useRef<number | null>(null);

  function clearArchiveUndoTimer() {
    if (archiveUndoTimerRef.current != null) {
      window.clearTimeout(archiveUndoTimerRef.current);
      archiveUndoTimerRef.current = null;
    }
  }

  function clearArchiveUndo() {
    clearArchiveUndoTimer();
    setLastArchiveIds(null);
  }

  function armArchiveUndo(ids: string[]) {
    clearArchiveUndoTimer();
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

  useEffect(() => () => clearArchiveUndoTimer(), []);

  // UX-B4-P04: show gesture tip until dismissed (localStorage)
  useEffect(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage.getItem(RC_GESTURE_HINT_KEY) !== "1") {
        setShowGestureHint(true);
      }
    } catch {
      setShowGestureHint(true);
    }
  }, []);

  function dismissGestureHint() {
    try {
      window.localStorage.setItem(RC_GESTURE_HINT_KEY, "1");
    } catch {
      /* ignore quota / private mode */
    }
    setShowGestureHint(false);
  }

  // B12 fix: hide archived/unarchived rows immediately; refresh only corrects.
  const [optimisticHide, setOptimisticHide] = useState<OptimisticHideMap>(() => new Map());
  /** UX-H T49 / UX-AD T128: brief leave fade before hide or refresh. */
  const [leavingIds, setLeavingIds] = useState<Set<string>>(() => new Set());
  /** UX-AE T133: Dashboard / deep-link arrival pulse target (clears after ~3s). */
  const [jumpTargetId, setJumpTargetId] = useState<string | null>(null);
  const jumpHighlightTimerRef = useRef<number | null>(null);
  const jumpArrivalHandledRef = useRef(false);
  /** Gate T133 until sessionStorage stage/sort restore finishes (avoid wrong first card). */
  const [prefsReady, setPrefsReady] = useState(false);
  const [sortMode, setSortMode] = useState<ResultSortMode>("newest");
  const [stage, setStage] = useState<ResultsFilterKey>("copy_review");
  // R3: station③ multi-select publish/export
  const [station3Open, setStation3Open] = useState(false);
  const [station3DraftIds, setStation3DraftIds] = useState<string[]>([]);
  const [station3Selection, setStation3Selection] = useState<Station3PublishSelection | null>(null);
  const [station3Busy, setStation3Busy] = useState(false);
  // CSV preflight queue for multi-export (after selection confirmed)
  const [exportQueue, setExportQueue] = useState<ExportKind[]>([]);
  const [exportPreflight, setExportPreflight] = useState<null | {
    kind: ExportKind;
    report: ExportPreflightReport;
    draftIds: string[];
    markupPercent?: number;
    markLeaveQueue: boolean;
    /** UX-O T68: full CSV rows for table mode */
    fullTableRows: ExportPreviewRow[];
  }>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [pendingApiResult, setPendingApiResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);
  /** UX-Q T70 / BX1 延伸: sequential copy or image review (snapshot at open). */
  const [seqReviewOpen, setSeqReviewOpen] = useState(false);
  const [seqReviewMode, setSeqReviewMode] = useState<SequentialReviewMode>("copy");
  const [seqReviewQueue, setSeqReviewQueue] = useState<SequentialReviewQueueItem[]>(
    []
  );

  // B1: the input panel (left) drives the 生成 progress card via a window event;
  // this panel (right) renders it at the top of the results list, matching the
  // Mockup's information architecture. On success the card auto-clears once the
  // real ResultCard lands via router.refresh; on error it stays put so the
  // operator can read which step went red and why.
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  useEffect(() => {
    function onProgress(event: Event) {
      const model = (event as CustomEvent<GenerationProgress>).detail;
      if (!model || !model.visible) {
        setProgress(null);
        return;
      }
      setProgress(model);
      const allDone = model.steps.length > 0 && model.steps.every((step) => step.status === "done");
      if (allDone) {
        setTimeout(() => setProgress(null), 1500);
      }
    }
    window.addEventListener(GENERATION_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(GENERATION_PROGRESS_EVENT, onProgress);
  }, []);

  // UX-B2-P14: resolve role so only admin sees「全部成員」toggle
  useEffect(() => {
    if (!userId) {
      setRole(null);
      setRoleReady(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", userId)
          .single();
        if (cancelled) return;
        setRole((profile?.role as UserRole | undefined) ?? null);
      } catch {
        if (!cancelled) setRole(null);
      } finally {
        if (!cancelled) setRoleReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // UX-B2-P14: batch-resolve creator display names (same pattern as 商品庫)
  useEffect(() => {
    const creatorIds = [
      ...new Set(
        drafts
          .map((d) => d.created_by)
          .filter((id): id is string => Boolean(id))
      )
    ];
    if (creatorIds.length === 0) {
      setNameById(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createClient();
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", creatorIds);
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const p of profiles ?? []) {
          const row = p as { id: string; name: string | null };
          if (row.id && row.name?.trim()) map.set(row.id, row.name.trim());
        }
        setNameById(map);
      } catch {
        if (!cancelled) setNameById(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [drafts]);

  function clearJumpHighlightTimer() {
    if (jumpHighlightTimerRef.current != null) {
      window.clearTimeout(jumpHighlightTimerRef.current);
      jumpHighlightTimerRef.current = null;
    }
  }

  /** UX-AE T133: pulse + scroll for a result card; class clears after 3s. */
  function armJumpHighlight(draftId: string) {
    clearJumpHighlightTimer();
    setJumpTargetId(draftId);
    window.setTimeout(() => {
      scrollToDraftCard(draftId, { block: "center" });
    }, 80);
    jumpHighlightTimerRef.current = window.setTimeout(() => {
      setJumpTargetId(null);
      jumpHighlightTimerRef.current = null;
    }, 3000);
  }

  // R4 §7: jump strip → switch station + scroll to card
  // T133: also pulse-highlight the target card
  useEffect(() => {
    function onJump(event: Event) {
      const detail = (event as CustomEvent<JumpToDraftDetail>).detail;
      if (!detail?.draftId) return;
      if (detail.station && isStationFilterKey(detail.station)) {
        setStage(detail.station);
        writeStoredResultsFilter(
          detail.station,
          typeof window !== "undefined" ? window.sessionStorage : null,
          STATION_FILTER_STORAGE_KEY_RESULTS
        );
      }
      armJumpHighlight(detail.draftId);
    }
    window.addEventListener(JUMP_TO_DRAFT_EVENT, onJump);
    return () => {
      window.removeEventListener(JUMP_TO_DRAFT_EVENT, onJump);
      clearJumpHighlightTimer();
    };
  }, []);

  // B9: remember sort preference for this browser tab session.
  // R2 / UX-B T6: remember three-station + fail filter for this tab session.
  // T133: prefsReady gates arrival highlight so first card uses restored station.
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    setSortMode(readStoredResultSort(storage));
    setStage(readStoredResultsFilter(storage, STATION_FILTER_STORAGE_KEY_RESULTS));
    setPrefsReady(true);
  }, []);

  // Drop optimistic hides once server props already reflect archive/unarchive.
  useEffect(() => {
    setOptimisticHide((prev) => reconcileOptimisticHide(prev, drafts));
  }, [drafts]);

  function scheduleArchiveLeave(ids: string[]) {
    if (!ids.length) return;
    setLeavingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setOptimisticHide((prev) => applyOptimisticHide(prev, ids, "archived"));
      setLeavingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    }, 280);
  }

  /** UX-AD T128: fade cards out, then refresh (approve / station2 / leave-queue). */
  function scheduleLeaveThenRefresh(ids: string[]) {
    if (!ids.length) {
      scheduleRouterRefresh(() => router.refresh());
      return;
    }
    setLeavingIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
    window.setTimeout(() => {
      setLeavingIds((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      scheduleRouterRefresh(() => router.refresh());
    }, 250);
  }

  const progressHeadStatus = progress
    ? progress.steps.some((step) => step.status === "error")
      ? "error"
      : progress.steps.every((step) => step.status === "done")
        ? "done"
        : "running"
    : null;

  const imagesByDraft = useMemo(() => {
    const map = new Map<string, ProductImage[]>();
    for (const image of images) {
      const list = map.get(image.draft_id) ?? [];
      list.push(image);
      map.set(image.draft_id, list);
    }
    return map;
  }, [images]);

  const variantsByDraft = useMemo(() => {
    const map = new Map<string, VariantPriceRow[]>();
    for (const row of variants) {
      const list = map.get(row.draft_id) ?? [];
      list.push(row);
      map.set(row.draft_id, list);
    }
    return map;
  }, [variants]);

  const stageImages = useMemo(
    () =>
      images.map((image) => ({
        draft_id: image.draft_id,
        image_type: image.image_type,
        process_intent: image.process_intent ?? null
      })),
    [images]
  );

  /**
   * UX-B2-P14: scope filter before station queue.
   * mine（預設）→ created_by === userId；all → 已載入全部（RLS 可見範圍）.
   * Operator 沒有「全部」切換；若 RLS 已只給自己，filter 仍安全.
   */
  const scopedDrafts = useMemo(() => {
    const useMine = !admin || scope === "mine";
    if (useMine && userId) {
      return drafts.filter((d) => d.created_by === userId);
    }
    return drafts;
  }, [admin, drafts, scope, userId]);

  const showOwnerChip = admin && scope === "all";

  // R2: work queue excludes input / published / archived
  const workQueueDrafts = useMemo(
    () => filterWorkQueueDrafts(scopedDrafts),
    [scopedDrafts]
  );

  /**
   * UX-F T29: client classify enrolled pipeline drafts → factory bridge.
   * Use all non-archived loaded drafts (not only 三站 work queue) so
   * processing/pending factory items still show after leaving 標圖.
   */
  const factoryBridgeSummary = useMemo(() => {
    const active = scopedDrafts.filter((d) => d.status !== "archived");
    return buildFactoryBridgeSummary(active, imagesByDraft);
  }, [scopedDrafts, imagesByDraft]);

  const stageCounts = useMemo(
    () => countStations(workQueueDrafts),
    [workQueueDrafts]
  );

  const stageFiltered = useMemo(
    () => filterDraftsByResultsFilter(workQueueDrafts, stage),
    [workQueueDrafts, stage]
  );

  const sortedDrafts = useMemo(
    () =>
      sortResultDrafts(
        stageFiltered,
        sortMode,
        stageImages
      ),
    [stageFiltered, stageImages, sortMode]
  );

  const visibleDrafts = useMemo(
    () => filterByOptimisticHide(sortedDrafts, optimisticHide),
    [sortedDrafts, optimisticHide]
  );

  // UX-AE T133: after prefs + stage filter, consume nestory:jump-draft-id once.
  // prepareTodoNavigation writes "*" (first visible card) or a specific draft id.
  useEffect(() => {
    if (!prefsReady) return;
    if (jumpArrivalHandledRef.current) return;
    if (typeof window === "undefined") return;
    const storage = window.sessionStorage;
    const raw = readJumpDraftId(storage);
    if (!raw) {
      // No pending jump — mark handled so we don't re-check every list change
      jumpArrivalHandledRef.current = true;
      return;
    }

    jumpArrivalHandledRef.current = true;
    clearJumpDraftId(storage);

    // Empty filter after prefs = nothing to highlight (drafts are server props)
    if (visibleDrafts.length === 0) return;

    const targetId =
      raw === JUMP_DRAFT_ID_FIRST
        ? visibleDrafts[0]?.id ?? null
        : visibleDrafts.some((d) => d.id === raw)
          ? raw
          : null;

    if (!targetId) return;
    armJumpHighlight(targetId);
  }, [prefsReady, visibleDrafts]);

  const allSelected =
    visibleDrafts.length > 0 && visibleDrafts.every((draft) => selectedIds.has(draft.id));
  const someSelected =
    visibleDrafts.some((draft) => selectedIds.has(draft.id)) && !allSelected;
  const selectedArray = Array.from(selectedIds);

  function toggleOne(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setOpenSwipeId(null);
  }

  // UX-B3-P04: Esc clears multi-select
  useEffect(() => {
    if (selectedIds.size === 0) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- clear on Esc only while selected
  }, [selectedIds.size]);

  function toggleAll() {
    setSelectedIds((current) => {
      if (visibleDrafts.every((draft) => current.has(draft.id))) {
        const next = new Set(current);
        for (const draft of visibleDrafts) next.delete(draft.id);
        return next;
      }
      const next = new Set(current);
      for (const draft of visibleDrafts) next.add(draft.id);
      return next;
    });
  }

  function onSortChange(next: ResultSortMode) {
    setSortMode(next);
    writeStoredResultSort(next, typeof window !== "undefined" ? window.sessionStorage : null);
  }

  function onStageChange(next: ResultsFilterKey) {
    if (!isResultsFilterKey(next)) return;
    setStage(next);
    setSelectedIds(new Set());
    setBatchArm(null);
    writeStoredResultsFilter(
      next,
      typeof window !== "undefined" ? window.sessionStorage : null,
      STATION_FILTER_STORAGE_KEY_RESULTS
    );
  }

  // Clear double-confirm arm when selection changes
  useEffect(() => {
    setBatchArm(null);
  }, [selectedArray.join("|")]);

  // R2 station①: pure approve → image_review + default keep
  async function batchApproveOnly() {
    if (!selectedArray.length) return;
    // UX-E T28: first click arms, second submits
    if (!batchArm || batchArm.action !== "approve") {
      setBatchArm({
        action: "approve",
        hint: `再點確認核准 ${selectedArray.length} 筆`
      });
      return;
    }
    setBatchArm(null);
    const n = selectedArray.length;
    setBusy(true);
    setBusyLabel(`核准中 ${n} 筆…`);
    setMessage(`核准中（已選 ${n} 筆）…`);
    clearArchiveUndo();
    try {
      const approveResponse = await fetch("/api/drafts/batch/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: selectedArray })
      });
      const payload = await approveResponse.json().catch(() => ({}));
      if (!approveResponse.ok) {
        const err = payload.error ?? "批次核准失敗";
        setMessage(err);
        showToast(err, "error");
        return;
      }
      const approvedIds =
        (payload.approvedIds as string[] | undefined) ?? selectedArray.slice(0, n);
      const okMsg = `已核准 ${payload.approvedCount ?? n} 筆文案（尚未發布）`;
      setMessage(okMsg);
      // BX2: 10s toast 復原 → return-stage copy_review
      showToast(okMsg, "success", UNDO_TOAST_MS.approve, {
        actionLabel: "復原",
        onAction: async () => {
          const result = await undoApproveDrafts(approvedIds);
          showToast(result.message, result.ok ? "success" : "error");
          scheduleRouterRefresh(() => router.refresh());
        }
      });
      setSelectedIds(new Set());
      // T128: leave fade before list refresh (leaves 審文案 filter)
      scheduleLeaveThenRefresh(approvedIds);
    } catch {
      setMessage("批次核准連線失敗");
      showToast("批次核准連線失敗", "error");
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  function openStation3Modal(ids?: string[]) {
    const draftIds = ids?.length ? ids : selectedArray;
    if (!draftIds.length) {
      setMessage("請先勾選商品再發布／匯出。");
      return;
    }
    setStation3DraftIds(draftIds);
    setStation3Open(true);
  }

  /**
   * R3 + UX-F T35: station② 標圖分流 — 全 keep → 待發布；有 AI → 生圖工廠。
   * UX-E T28: inline double-confirm; progress on notice + toast.
   */
  async function batchStationReview() {
    if (!selectedArray.length) {
      setMessage("請先勾選商品再批次標圖通過。");
      return;
    }
    const selectedDrafts = drafts.filter((d) => selectedArray.includes(d.id));
    const advanceIds: string[] = [];
    const sendIds: string[] = [];
    let totalAi = 0;
    for (const d of selectedDrafts) {
      const imgs = imagesByDraft.get(d.id) ?? [];
      const decision = decideStation2Review({ images: imgs });
      if (decision.action === "blocked") {
        setMessage(`「${d.title_zh || d.taobao_title || "未命名"}」：${decision.reason}`);
        setBatchArm(null);
        return;
      }
      if (decision.action === "advance_ready") {
        advanceIds.push(d.id);
      } else if (decision.action === "send_images") {
        sendIds.push(d.id);
        totalAi += decision.aiCount;
      }
    }
    const routeSummary = formatStation2BatchRouteSummary({
      advanceCount: advanceIds.length,
      sendCount: sendIds.length,
      totalAi,
    });
    if (!batchArm || batchArm.action !== "review") {
      setBatchArm({
        action: "review",
        hint: `再點確認：${routeSummary}`,
      });
      setMessage(
        `批次標圖 ${selectedArray.length} 件：${routeSummary}（再點一次按鈕送出）`
      );
      return;
    }
    setBatchArm(null);
    const n = selectedArray.length;
    setBusy(true);
    setBusyLabel(`分流中 ${n} 筆…`);
    clearArchiveUndo();
    setMessage(`分流中（已選 ${n} 筆）…`);
    const messages: string[] = [];
    try {
      if (advanceIds.length) {
        const stepLabel = sendIds.length
          ? `分流中 1/2（直達 ${advanceIds.length}）…`
          : `分流中 ${n} 筆…`;
        setBusyLabel(stepLabel);
        setMessage(
          sendIds.length
            ? `分流中 1/2（直達待發布 ${advanceIds.length} 件）…`
            : `分流中（已選 ${n} 筆）…`
        );
        const response = await fetch("/api/drafts/batch/advance-ready", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftIds: advanceIds })
        });
        const payload = await response.json().catch(() => ({}));
        messages.push(
          typeof payload.message === "string"
            ? payload.message
            : `${advanceIds.length} 件已到待發布`
        );
        if (!response.ok && !payload.ok) {
          setMessage(messages.join("\n"));
          showToast(messages.join("；") || "批次分流失敗", "error");
          return;
        }
      }
      if (sendIds.length) {
        const step2 = advanceIds.length
          ? `分流中 2/2（工廠 ${sendIds.length}）…`
          : `分流中 ${n} 筆…`;
        setBusyLabel(step2);
        setMessage(
          advanceIds.length
            ? `分流中 2/2（送生圖工廠 ${sendIds.length} 件）…`
            : `分流中（已選 ${n} 筆）…`
        );
        const response = await fetch("/api/drafts/batch/send-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draftIds: sendIds })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          const hint = typeof payload.hint === "string" ? `\n${payload.hint}` : "";
          messages.push((payload.error ?? "送生圖工廠失敗") + hint);
          setMessage(messages.join("\n"));
          showToast(payload.error ?? "送生圖工廠失敗", "error");
          return;
        }
        messages.push(
          typeof payload.message === "string"
            ? payload.message
            : `已送生圖工廠 ${sendIds.length} 件`
        );
      }
      const okMsg =
        messages.join("\n") ||
        formatStation2SuccessToast({
          advanced: advanceIds.length > 0,
          sentToFactory: sendIds.length > 0,
        });
      const toastLine =
        formatStation2BatchRouteSummary({
          advanceCount: advanceIds.length,
          sendCount: sendIds.length,
          totalAi,
        }) || okMsg.replace(/\n/g, " · ");
      setMessage(okMsg);
      const undoIds = [...advanceIds, ...sendIds];
      // BX2 + S1: 送工廠 best-effort → 較長 toast；純待發布用 10s
      const station2UndoMs = sendIds.length
        ? UNDO_TOAST_MS.station2Factory
        : UNDO_TOAST_MS.station2Ready;
      showToast(toastLine, "success", station2UndoMs, {
        actionLabel: "復原",
        onAction: async () => {
          const result = await undoStation2Drafts(undoIds);
          showToast(result.message, result.ok ? "success" : "error");
          scheduleRouterRefresh(() => router.refresh());
        }
      });
      setSelectedIds(new Set());
      // T128: leave fade before refresh (leaves 標圖 filter)
      scheduleLeaveThenRefresh(undoIds);
    } catch {
      setMessage("批次分流連線失敗");
      showToast("批次分流連線失敗", "error");
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function downloadCsvBlob(
    kind: ExportKind,
    draftIds: string[],
    markLeaveQueue: boolean,
    markupPercent?: number
  ): Promise<{ ok: boolean; error?: string }> {
    const endpoint =
      kind === "showmore" ? "/api/exports/showmore" : "/api/exports/matrixify";
    const filenamePrefix =
      kind === "showmore" ? "nestory-showmore" : "nestory-matrixify";
    const extraBody =
      kind === "showmore" ? { showmoreMarkupPercent: markupPercent } : {};
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds, markLeaveQueue, ...extraBody })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        return { ok: false, error: payload.error ?? "CSV 產生失敗" };
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${filenamePrefix}-${Date.now()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      return { ok: true };
    } catch {
      return { ok: false, error: "CSV 下載連線失敗" };
    }
  }

  function buildPreflightInputs(draftIds: string[]): PreflightDraftInput[] {
    return draftIds.map((id) => {
      const draft = drafts.find((row) => row.id === id);
      const imgs = imagesByDraft.get(id) ?? [];
      const vars = variantsByDraft.get(id) ?? [];
      if (!draft) {
        return {
          id,
          title_zh: null,
          status: "missing",
          pipeline_stage: null,
          product_images: [],
          product_variants: []
        };
      }
      return {
        id: draft.id,
        title_zh: draft.title_zh,
        taobao_title: draft.taobao_title,
        original_title: draft.original_title,
        status: draft.status,
        pipeline_stage: draft.pipeline_stage,
        sku: draft.sku,
        twd_price: draft.twd_price,
        twd_cost: draft.twd_cost,
        compare_at_price: draft.compare_at_price,
        price_mode: draft.price_mode,
        description_html: draft.description_html,
        description_plain: draft.description_plain,
        variant_dimensions: draft.variant_dimensions,
        shopify_handle: draft.shopify_handle,
        shopify_product_id: draft.shopify_product_id,
        shopify_admin_url: draft.shopify_admin_url,
        product_images: imgs,
        product_variants: vars.map((v) => ({
          option1_value: v.option1_value ?? null,
          option2_value: v.option2_value ?? null,
          option3_value: v.option3_value ?? null,
          twd_price: v.twd_price,
          sku: v.sku ?? null,
          sort_order: v.sort_order
        }))
      };
    });
  }

  /** UX-O T68: local drafts → full CSV-shaped rows for table preview (no API). */
  function buildFullTableRows(kind: ExportKind, draftIds: string[], markup: number): ExportPreviewRow[] {
    const packed = draftIds.map((id) => {
      const draft = drafts.find((row) => row.id === id);
      const imgs = imagesByDraft.get(id) ?? [];
      const vars = variantsByDraft.get(id) ?? [];
      if (!draft) {
        // Missing id (race / deleted): stub only — builders tolerate sparse rows.
        return {
          id,
          product_images: [],
          product_variants: []
        } as unknown as MatrixifyDraft;
      }
      const product_variants = vars.map((v) => ({
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
      return {
        ...draft,
        product_images: imgs,
        product_variants
      } as MatrixifyDraft;
    });

    if (kind === "showmore") {
      return buildShowmoreRows(packed as ShowmoreDraft[], {
        showmoreMarkupPercent: markup
      }) as ExportPreviewRow[];
    }
    return buildMatrixifyRows(packed) as ExportPreviewRow[];
  }

  async function openNextExportPreflight(
    kinds: ExportKind[],
    draftIds: string[],
    markLeaveQueue: boolean
  ) {
    if (!kinds.length) return;
    const [kind, ...rest] = kinds;
    const markup = getStoredPricingSettings().showmoreMarkupPercent;
    const shopifyStoreDomain = await resolveShopifyStoreDomain();
    const report = runExportPreflight(buildPreflightInputs(draftIds), {
      kind,
      showmoreMarkupPercent: markup,
      shopifyStoreDomain
    });
    const fullTableRows = buildFullTableRows(kind, draftIds, markup);
    setExportQueue(rest);
    setExportPreflight({
      kind,
      report,
      draftIds,
      markupPercent: kind === "showmore" ? markup : undefined,
      markLeaveQueue,
      fullTableRows
    });
  }

  async function runStation3Flow(selection: Station3PublishSelection) {
    const draftIds = station3DraftIds;
    if (!draftIds.length) return;
    setStation3Open(false);
    setStation3Selection(selection);
    setStation3Busy(true);
    setBusy(true);
    clearArchiveUndo();

    let apiSucceeded: boolean | null = null;
    let apiMessage = "";

    try {
      if (selection.shopify !== "none") {
        setMessage(
          selection.shopify === "active" ? "正式上架中（含轉檔／圖床）…" : "建立草稿中（含轉檔／圖床）…"
        );
        const response = await fetch("/api/drafts/batch/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            draftIds,
            publishMode: selection.shopify,
            confirmActive: selection.shopify === "active"
          })
        });
        const payload = await response.json().catch(() => ({}));
        const allOk =
          response.ok &&
          (payload.failed == null || payload.failed === 0) &&
          (payload.succeeded == null || payload.succeeded > 0);
        // partial: treat as not full success for leave-queue
        apiSucceeded = Boolean(allOk);
        apiMessage = response.ok
          ? payload.message ??
            `成功 ${payload.succeeded ?? 0}／失敗 ${payload.failed ?? 0}`
          : [payload.error, payload.hint].filter(Boolean).join(" — ") || "發布失敗";
        setPendingApiResult({ ok: apiSucceeded, message: apiMessage });
      }

      const csvKinds: ExportKind[] = [];
      if (selection.matrixify) csvKinds.push("matrixify");
      if (selection.showmore) csvKinds.push("showmore");

      if (csvKinds.length === 0) {
        const left = shouldLeaveQueue({
          selection,
          apiSucceeded,
          csvSucceeded: null
        });
        setMessage(
          formatStation3ResultMessage({
            selection,
            apiSucceeded,
            apiMessage,
            csvSucceeded: null,
            leftQueue: left
          })
        );
        setSelectedIds(new Set());
        setStation3Selection(null);
        setPendingApiResult(null);
        // T128: leave-queue → fade out before refresh
        if (left) scheduleLeaveThenRefresh(draftIds);
        else scheduleRouterRefresh(() => router.refresh());
        return;
      }

      // Q3: mark leave only when API ok or CSV-only
      const markLeaveQueue = shouldLeaveQueue({
        selection,
        apiSucceeded: selection.shopify === "none" ? null : apiSucceeded,
        csvSucceeded: true
      });
      void openNextExportPreflight(csvKinds, draftIds, markLeaveQueue);
    } catch {
      setMessage("發布／匯出連線失敗");
      setStation3Selection(null);
      setPendingApiResult(null);
    } finally {
      setStation3Busy(false);
      setBusy(false);
    }
  }

  async function confirmExportDownload() {
    if (!exportPreflight || !exportPreflight.report.canExport) return;
    const { kind, draftIds, markupPercent, markLeaveQueue } = exportPreflight;
    const selection = station3Selection;
    setExportBusy(true);
    setBusy(true);
    setMessage("產生 CSV 中...");
    const result = await downloadCsvBlob(kind, draftIds, markLeaveQueue, markupPercent);
    if (!result.ok) {
      setMessage(result.error ?? "CSV 失敗");
      setExportBusy(false);
      setBusy(false);
      return;
    }

    const rest = exportQueue;
    if (rest.length) {
      setExportPreflight(null);
      setExportBusy(false);
      setBusy(false);
      void openNextExportPreflight(rest, draftIds, markLeaveQueue);
      return;
    }

    // All CSV done
    const api = pendingApiResult;
    const sel = selection ?? {
      shopify: "none" as const,
      matrixify: kind === "matrixify",
      showmore: kind === "showmore"
    };
    const left = shouldLeaveQueue({
      selection: sel,
      apiSucceeded: api ? api.ok : sel.shopify === "none" ? null : null,
      csvSucceeded: true
    });
    // Fix: when selection had API, use api result
    const leftFinal = selection
      ? shouldLeaveQueue({
          selection,
          apiSucceeded: selection.shopify === "none" ? null : api?.ok ?? false,
          csvSucceeded: true
        })
      : left;

    setMessage(
      formatStation3ResultMessage({
        selection: sel,
        apiSucceeded: selection?.shopify === "none" ? null : api?.ok ?? null,
        apiMessage: api?.message,
        csvSucceeded: true,
        csvNote:
          kind === "showmore" || selection?.showmore
            ? "CSV 已下載（多款式已展開；庫存／重量為預設）"
            : "CSV 已下載",
        leftQueue: leftFinal
      })
    );
    setExportPreflight(null);
    setExportQueue([]);
    setStation3Selection(null);
    setPendingApiResult(null);
    setSelectedIds(new Set());
    setExportBusy(false);
    setBusy(false);
    // T128: leave-queue → fade out before refresh
    if (leftFinal) scheduleLeaveThenRefresh(draftIds);
    else scheduleRouterRefresh(() => router.refresh());
  }

  /**
   * SYN-1 UI: batch set image_flags.generate_detail for selected drafts.
   * Merge-only per draft; default-on semantics stay in isGenerateDetailEnabled.
   */
  async function batchSetGenerateDetail(enabled: boolean) {
    if (!selectedArray.length) {
      showToast("請先勾選商品", "error");
      return;
    }
    const n = selectedArray.length;
    setBusy(true);
    setBusyLabel(enabled ? `開詳情圖 ${n}…` : `關詳情圖 ${n}…`);
    setBatchArm(null);
    setMessage(enabled ? `批次開啟生成詳情圖（${n} 筆）…` : `批次關閉生成詳情圖（${n} 筆）…`);
    const supabase = createClient();
    let ok = 0;
    let fail = 0;
    for (const id of selectedArray) {
      const draft = drafts.find((row) => row.id === id);
      const existing =
        draft?.image_flags && typeof draft.image_flags === "object" && !Array.isArray(draft.image_flags)
          ? { ...(draft.image_flags as Record<string, unknown>) }
          : {};
      existing.generate_detail = enabled ? "true" : "false";
      const { error } = await supabase
        .from("product_drafts")
        .update({ image_flags: existing })
        .eq("id", id);
      if (error) fail += 1;
      else ok += 1;
      setBusyLabel(
        enabled ? `開詳情圖 ${ok + fail}/${n}…` : `關詳情圖 ${ok + fail}/${n}…`
      );
    }
    setBusy(false);
    setBusyLabel(null);
    const msg =
      fail > 0
        ? `生成詳情圖：成功 ${ok}、失敗 ${fail}`
        : enabled
          ? `已批次開啟生成詳情圖 ${ok} 筆`
          : `已批次關閉生成詳情圖 ${ok} 筆`;
    setMessage(msg);
    showToast(msg, fail > 0 ? "error" : "success");
    scheduleRouterRefresh(() => router.refresh());
  }

  // B12: batch archive / unarchive — busy statuses skipped per-item (like 送圖).
  // fix(B12): paint notice + optimistic hide first; defer refresh as background reconcile.
  async function batchArchiveOrUnarchive(action: "archive" | "unarchive") {
    if (!selectedArray.length) {
      setMessage(
        action === "archive"
          ? formatArchiveResultMessage({
              archivedCount: 0,
              skippedBusyCount: 0,
              includesPublished: false,
              emptySelection: true
            })
          : "請先勾選商品再批次解除封存。"
      );
      return;
    }
    const n = selectedArray.length;
    setBusy(true);
    setBusyLabel(action === "archive" ? `封存中 ${n}…` : `解除封存 ${n}…`);
    setBatchArm(null);
    setMessage(
      action === "archive" ? `封存中（已選 ${n} 筆）…` : `解除封存中（已選 ${n} 筆）…`
    );
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: selectedArray, action })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const err =
          payload.error ?? (action === "archive" ? "批次封存失敗" : "批次解除封存失敗");
        setMessage(err);
        showToast(err, "error");
        return;
      }
      if (action === "archive") {
        const archivedIds = (payload.archivedIds as string[] | undefined) ?? [];
        armArchiveUndo(archivedIds);
        const okMsg =
          typeof payload.message === "string"
            ? payload.message
            : formatArchiveResultMessage({
                archivedCount: payload.archivedCount ?? 0,
                skippedBusyCount: payload.skippedBusyCount ?? 0,
                includesPublished: Boolean(payload.includesPublished)
              });
        setMessage(okMsg);
        // BX2: toast 復原（與 notice 復原鈕並存；秒數與 armArchiveUndo 一致）
        showToast(okMsg, "success", UNDO_TOAST_MS.archive, {
          actionLabel: archivedIds.length ? "復原" : undefined,
          onAction: archivedIds.length
            ? async () => {
                const result = await undoArchiveDrafts(archivedIds);
                showToast(result.message, result.ok ? "success" : "error");
                if (result.ok) {
                  clearArchiveUndoTimer();
                  setLastArchiveIds(null);
                  setLeavingIds((prev) => {
                    const next = new Set(prev);
                    for (const id of archivedIds) next.delete(id);
                    return next;
                  });
                  setOptimisticHide((prev) =>
                    applyOptimisticHide(prev, archivedIds, "unarchived")
                  );
                }
                scheduleRouterRefresh(() => router.refresh());
              }
            : undefined
        });
        if (archivedIds.length) {
          scheduleArchiveLeave(archivedIds);
        }
      } else {
        const restoredIds =
          (payload.restoredIds as string[] | undefined) ??
          selectedArray.filter((id) => drafts.find((d) => d.id === id)?.status === "archived");
        clearArchiveUndoTimer();
        setLastArchiveIds(null);
        const okMsg =
          typeof payload.message === "string"
            ? payload.message
            : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? 0 });
        setMessage(okMsg);
        showToast(okMsg, "success");
        if (restoredIds.length) {
          setLeavingIds((prev) => {
            const next = new Set(prev);
            for (const id of restoredIds) next.delete(id);
            return next;
          });
          setOptimisticHide((prev) => applyOptimisticHide(prev, restoredIds, "unarchived"));
        }
      }
      setSelectedIds(new Set());
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      const err = action === "archive" ? "批次封存連線失敗" : "批次解除封存連線失敗";
      setMessage(err);
      showToast(err, "error");
    } finally {
      setBusy(false);
      setBusyLabel(null);
    }
  }

  async function undoLastArchive() {
    if (!lastArchiveIds?.length) return;
    setBusy(true);
    setMessage("復原中…");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: lastArchiveIds, action: "unarchive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(payload.error ?? "復原失敗");
        showToast(payload.error ?? "復原失敗", "error");
        return;
      }
      const restoredIds =
        (payload.restoredIds as string[] | undefined) ?? lastArchiveIds;
      clearArchiveUndoTimer();
      setLastArchiveIds(null);
      const okMsg =
        typeof payload.message === "string"
          ? payload.message
          : formatUnarchiveResultMessage({ restoredCount: payload.restoredCount ?? lastArchiveIds.length });
      setMessage(okMsg);
      showToast(okMsg, "success");
      setLeavingIds((prev) => {
        const next = new Set(prev);
        for (const id of restoredIds) next.delete(id);
        return next;
      });
      setOptimisticHide((prev) => applyOptimisticHide(prev, restoredIds, "unarchived"));
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMessage("復原連線失敗");
      showToast("復原連線失敗", "error");
    } finally {
      setBusy(false);
    }
  }

  /** UX-E T33: leave empty filter → station with items (or default). */
  function clearResultsFilter() {
    const next = pickDefaultResultsFilter(stageCounts, DEFAULT_RESULTS_FILTER);
    onStageChange(next === "fail" ? DEFAULT_RESULTS_FILTER : next);
  }

  /**
   * UX-AD T129: empty-state CTA —
   * mobile → 輸入 tab（/drafts/new 去掉 pane=results）；
   * desktop → focus 輸入面板第一個欄位.
   */
  function goToAddFirstProduct() {
    const isMobile =
      typeof window !== "undefined" &&
      window.matchMedia("(max-width: 960px)").matches;
    if (isMobile) {
      router.push("/drafts/new");
      return;
    }
    const root =
      document.querySelector(".workbench-pane-input") ??
      document.querySelector("#paneForm");
    const field = root?.querySelector<HTMLElement>(
      "input:not([type='hidden']):not([disabled]), textarea:not([disabled]), select:not([disabled])"
    );
    if (field) {
      field.focus();
      field.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    router.push("/drafts/new");
  }

  const showToolbar = workQueueDrafts.length > 0 || scopedDrafts.length > 0;
  const isCopyStation = stage === "copy_review";
  const isImageStation = stage === "image_review";
  const isReadyStation = stage === "ready";

  /**
   * UX-Q T70 / BX1 延伸：
   * 站① 逐件審核 · 站② 逐件標圖
   * a) selected ∩ visible; b) all visible. Snapshot at open.
   */
  function openSequentialReview() {
    if (!isCopyStation && !isImageStation) return;
    const source =
      selectedIds.size > 0
        ? visibleDrafts.filter((d) => selectedIds.has(d.id))
        : visibleDrafts;
    if (source.length === 0) {
      showToast(isImageStation ? "沒有可標圖的商品" : "沒有可審的文案", "error");
      return;
    }
    const queue: SequentialReviewQueueItem[] = source.map((draft) => ({
      draft,
      images: imagesByDraft.get(draft.id) ?? [],
      variantPrices: variantsByDraft.get(draft.id) ?? EMPTY_VARIANT_PRICES
    }));
    setSeqReviewMode(isImageStation ? "image" : "copy");
    setSeqReviewQueue(queue);
    setSeqReviewOpen(true);
  }

  return (
    <section className="panel results-panel">
      <div className="panel-header rc-panel-header">
        <h2>◈ 生成結果（三站工作佇列）</h2>
        {/* Header keeps only the station-specific sequential action. */}
        <div className="rc-header-actions">
          {isCopyStation || isImageStation ? (
            <Button
              size="sm"
              className="rc-header-seq-btn"
              disabled={busy || visibleDrafts.length === 0}
              onClick={openSequentialReview}
              title={
                isImageStation
                  ? selectedIds.size > 0
                    ? "逐件標圖已勾選商品（通過後自動下一張）"
                    : "逐件標圖目前列表全部（通過後自動下一張）"
                  : selectedIds.size > 0
                    ? "逐件審核已勾選文案（核准後自動下一張）"
                    : "逐件審核目前列表全部（核准後自動下一張）"
              }
              type="button"
            >
              {isImageStation ? "▶ 逐件標圖" : "▶ 逐件審核"}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="panel-body results-panel-body">
        {progress ? (
          <div className="gen-card">
            <div className="gen-card-head">
              <span className={`gen-dot ${progressHeadStatus}`} />
              <span className="gen-card-title">
                {progressHeadStatus === "done"
                  ? `✓ 生成完成：${progress.title}`
                  : progressHeadStatus === "error"
                    ? `✗ 生成失敗：${progress.title}`
                    : `生成中：${progress.title}…`}
              </span>
            </div>
            <div className="gen-steps">
              {progress.steps.map((step, index) => (
                <div className={`gen-step ${step.status}`} key={step.label}>
                  <span className="gs-dot">
                    {step.status === "done"
                      ? "✓"
                      : step.status === "error"
                        ? "✕"
                        : step.status === "warn"
                          ? "!"
                          : index + 1}
                  </span>
                  {step.label}
                </div>
              ))}
            </div>
            {progress.error ? <div className="gen-error">⚠ {progress.error}</div> : null}
          </div>
        ) : null}

        {showToolbar ? (
          <div className="rc-selection-guide-row">
            <label className="rc-header-select-all">
              <input
                checked={allSelected}
                onChange={toggleAll}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                type="checkbox"
                aria-label="全選目前列表"
              />
              <span>全選</span>
            </label>
            {showGestureHint ? (
              <p className="rc-gesture-hint" role="note">
                <span>長按卡片可多選；左滑可快捷</span>
                <button
                  aria-label="關閉提示"
                  className="rc-gesture-hint-dismiss"
                  onClick={dismissGestureHint}
                  type="button"
                >
                  ×
                </button>
              </p>
            ) : null}
          </div>
        ) : null}

        {/* UX-B3-P02: 有選取才出批次動作條；未選取不渲染空 toolbar */}
        {selectedIds.size > 0 ? (
          <div
            className={`rc-batch-strip${
              isCopyStation
                ? " rc-batch-strip--copy"
                : isImageStation
                  ? " rc-batch-strip--image"
                  : isReadyStation
                    ? " rc-batch-strip--ready"
                    : ""
            }`}
            role="toolbar"
            aria-label="批次操作"
          >
            <span className="rc-batch-count">已選 {selectedIds.size} 筆</span>
            <Button
              size="sm"
              className="rc-batch-cancel"
              onClick={clearSelection}
              title="取消多選"
              type="button"
            >
              取消
            </Button>
            <div className="rc-batch-actions batch-actions">
              {isCopyStation ? (
                <>
                  <Button
                    variant={batchArm?.action === "approve" ? "danger" : "primary"}
                    size="sm"
                    className="batch-primary-action"
                    disabled={!selectedArray.length}
                    loading={busy}
                    onClick={() => void batchApproveOnly()}
                    title={
                      batchArm?.action === "approve"
                        ? batchArm.hint
                        : "核准文案 → 進入標圖；未標記圖寫入保留原圖"
                    }
                    type="button"
                  >
                    {busy && busyLabel
                      ? busyLabel
                      : batchArm?.action === "approve"
                        ? `⚠ 再點確認核准 ${selectedArray.length} 筆`
                        : "✓ 批次核准"}
                  </Button>
                  <Button
                    size="sm"
                    className="batch-remove-action"
                    disabled={busy || !selectedArray.length}
                    onClick={() => void batchArchiveOrUnarchive("archive")}
                    title="移出工作佇列（軟刪除，可救回）"
                    type="button"
                  >
                    移出佇列
                  </Button>
                </>
              ) : null}
              {isImageStation ? (
                <>
                  <Button
                    variant={batchArm?.action === "review" ? "danger" : "primary"}
                    size="sm"
                    className="batch-primary-action"
                    disabled={!selectedArray.length}
                    loading={busy}
                    onClick={() => void batchStationReview()}
                    title={
                      batchArm?.action === "review"
                        ? batchArm.hint
                        : "標圖分流：全保留→待發布；有 AI 標記→生圖工廠"
                    }
                    type="button"
                  >
                    {busy && busyLabel
                      ? busyLabel
                      : batchArm?.action === "review"
                        ? `⚠ 再點確認 ${selectedArray.length} 筆`
                        : "✓ 批次標圖通過"}
                  </Button>
                  <Button
                    size="sm"
                    className="batch-detail-action"
                    disabled={busy || !selectedArray.length}
                    onClick={() => void batchSetGenerateDetail(true)}
                    title="勾選商品：開啟合成詳情圖（預設）"
                    type="button"
                  >
                    開啟詳情圖
                  </Button>
                  <Button
                    size="sm"
                    className="batch-detail-action"
                    disabled={busy || !selectedArray.length}
                    onClick={() => void batchSetGenerateDetail(false)}
                    title="勾選商品：關閉合成詳情圖（不進合成佇列）"
                    type="button"
                  >
                    關閉詳情圖
                  </Button>
                  <Button
                    size="sm"
                    className="batch-remove-action"
                    disabled={busy || !selectedArray.length}
                    onClick={() => void batchArchiveOrUnarchive("archive")}
                    title="移出工作佇列（軟刪除，可救回）"
                    type="button"
                  >
                    移出佇列
                  </Button>
                </>
              ) : null}
              {isReadyStation ? (
                <Button
                  variant="primary"
                  size="sm"
                  className="batch-primary-action"
                  disabled={busy || station3Busy || !selectedArray.length}
                  onClick={() => openStation3Modal()}
                  title="發布／匯出：API 上架或草稿、Matrixify、Showmore 可多選"
                  type="button"
                >
                  發布／匯出
                </Button>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* UX-B2-P02 2-2: 站別 pills 左；只看我的 + 排序靠右 */}
        <div className="stage-filter-row">
          <StageFilterPills
            counts={stageCounts}
            onChange={onStageChange}
            stage={stage}
            factoryPendingCount={factoryBridgeSummary.pendingReview}
          />
          <div className="stage-filter-end">
            {roleReady && admin ? (
              <label className="results-scope-label">
                <span className="sr-only">範圍</span>
                <select
                  aria-label="範圍"
                  className="ir-scope-select"
                  onChange={(event) =>
                    setScope(event.target.value as ResultsScopeMode)
                  }
                  value={scope}
                >
                  <option value="mine">只看我的</option>
                  <option value="all">全部成員</option>
                </select>
              </label>
            ) : null}
            <label className="results-sort-label">
              <span aria-hidden="true" className="results-sort-icon">
                ⇅
              </span>
              <span className="sr-only">排序</span>
              <select
                aria-label="排序"
                className="sort-sel"
                onChange={(event) => onSortChange(event.target.value as ResultSortMode)}
                value={sortMode}
              >
                {RESULT_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* UX-F T29: 生圖工廠橋接 — 僅「圖片待標示」站顯示 */}
        {stage === "image_review" ? (
          <FactoryBridgeStrip summary={factoryBridgeSummary} />
        ) : null}

        {message ? (
          <div className="notice results-batch-notice" role="status">
            <span style={{ whiteSpace: "pre-wrap" }}>{message}</span>
            {lastArchiveIds && lastArchiveIds.length > 0 ? (
              <Button
                size="sm"
                disabled={busy}
                onClick={() => void undoLastArchive()}
                style={{ marginLeft: 10 }}
                title="10 秒內可復原"
                type="button"
              >
                復原
              </Button>
            ) : null}
          </div>
        ) : null}

        {scopedDrafts.length === 0 && !progress ? (
          /* UX-AB T85 + UX-AD T129: full-empty + CTA */
          <div className="empty-state">
            <div className="empty-icon" aria-hidden>
              📦
            </div>
            <p className="empty-state-title">
              {drafts.length > 0 && scope === "mine"
                ? "目前沒有你的草稿"
                : "還沒有任何草稿"}
            </p>
            <p className="empty-state-desc">
              {drafts.length > 0 && scope === "mine"
                ? "可切換「全部成員」查看其他人，或用左側表單新增"
                : "使用左側表單新增第一筆商品"}
            </p>
            <button
              className="act-btn fill empty-state-cta"
              onClick={goToAddFirstProduct}
              type="button"
            >
              去新增第一筆商品
            </button>
          </div>
        ) : workQueueDrafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden>
              📦
            </div>
            <p className="empty-state-title">目前沒有在工作佇列的商品</p>
            <p className="empty-state-desc">新增商品後會出現在這裡</p>
            <button
              className="act-btn fill empty-state-cta"
              onClick={goToAddFirstProduct}
              type="button"
            >
              去新增第一筆商品
            </button>
          </div>
        ) : visibleDrafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon" aria-hidden>
              🔎
            </div>
            <p className="empty-state-title">這個篩選下沒有商品</p>
            <p className="empty-state-desc">試試清除篩選或換另一站</p>
            <button
              className="act-btn empty-state-cta"
              onClick={clearResultsFilter}
              type="button"
            >
              清除篩選
            </button>
          </div>
        ) : (
          <>
            <div className="results-list" id="results-list">
              {visibleDrafts.map((draft) => (
                <ResultCard
                  checked={selectedIds.has(draft.id)}
                  draft={draft}
                  images={imagesByDraft.get(draft.id) ?? []}
                  isJumpTarget={jumpTargetId === draft.id}
                  key={draft.id}
                  leaving={leavingIds.has(draft.id)}
                  onGestureStart={() => {
                    setOpenSwipeId((cur) => (cur === draft.id ? cur : null));
                  }}
                  onSwipeOpenChange={(open) => {
                    setOpenSwipeId(open ? draft.id : null);
                  }}
                  onToggle={() => toggleOne(draft.id)}
                  ownerLabel={
                    draft.created_by
                      ? libraryCreatorLabel(draft.created_by, nameById)
                      : null
                  }
                  selectMode={selectedIds.size > 0}
                  showOwnerChip={showOwnerChip}
                  swipeOpen={openSwipeId === draft.id}
                  variantPrices={variantsByDraft.get(draft.id) ?? EMPTY_VARIANT_PRICES}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* UX-Q T70 / BX1：sequential copy or image review overlay */}
      <SequentialReviewOverlay
        mode={seqReviewMode}
        onClose={() => {
          setSeqReviewOpen(false);
          setSeqReviewQueue([]);
          setSeqReviewMode("copy");
        }}
        open={seqReviewOpen}
        queue={seqReviewQueue}
      />

      <Station3PublishModal
        busy={station3Busy}
        draftCount={station3DraftIds.length}
        onCancel={() => {
          if (!station3Busy) setStation3Open(false);
        }}
        onConfirm={(sel) => void runStation3Flow(sel)}
        open={station3Open}
      />

      <ExportPreflightModal
        busy={exportBusy}
        fullTableRows={exportPreflight?.fullTableRows ?? null}
        onCancel={() => {
          if (!exportBusy) {
            setExportPreflight(null);
            setExportQueue([]);
          }
        }}
        onConfirm={() => void confirmExportDownload()}
        open={Boolean(exportPreflight)}
        report={exportPreflight?.report ?? null}
      />
    </section>
  );
}
