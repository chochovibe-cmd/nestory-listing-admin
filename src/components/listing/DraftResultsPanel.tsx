"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ResultCard } from "@/components/listing/ResultCard";
import { ExportPreflightModal } from "@/components/listing/ExportPreflightModal";
import { Station3PublishModal } from "@/components/listing/Station3PublishModal";
import { StageFilterPills } from "@/components/drafts/StageFilterPills";
import { FactoryBridgeStrip } from "@/components/listing/FactoryBridgeStrip";
import { showToast } from "@/components/Toast";
import { buildFactoryBridgeSummary } from "@/lib/images/factoryBridge";
import { GENERATION_PROGRESS_EVENT, type GenerationProgress } from "@/components/listing/generationProgress";
import {
  JUMP_TO_DRAFT_EVENT,
  scrollToDraftCard,
  type JumpToDraftDetail
} from "@/lib/drafts/jumpToDraft";
import {
  runExportPreflight,
  type ExportKind,
  type ExportPreflightReport,
  type PreflightDraftInput
} from "@/lib/csv/exportPreflight";
import {
  formatStation3ResultMessage,
  shouldLeaveQueue,
  type Station3PublishSelection
} from "@/lib/drafts/station3Publish";
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
import { getStoredPricingSettings } from "@/lib/pricingSettingsStore";
import type { ProductDraft, ProductImage, ProductVariantRow } from "@/types/domain";

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
  | "sku"
>;

export function DraftResultsPanel({
  drafts,
  images,
  variants = []
}: {
  drafts: ProductDraft[];
  images: ProductImage[];
  /** P1-5: multi-variant sell prices for card range display */
  variants?: VariantPriceRow[];
}) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
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
    }, 10_000);
  }

  useEffect(() => () => clearArchiveUndoTimer(), []);
  // B12 fix: hide archived/unarchived rows immediately; refresh only corrects.
  const [optimisticHide, setOptimisticHide] = useState<OptimisticHideMap>(() => new Map());
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
  }>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const [pendingApiResult, setPendingApiResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

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

  // R4 §7: jump strip → switch station + scroll to card
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
      // Wait a tick for filter re-render then scroll
      window.setTimeout(() => scrollToDraftCard(detail.draftId), 80);
    }
    window.addEventListener(JUMP_TO_DRAFT_EVENT, onJump);
    return () => window.removeEventListener(JUMP_TO_DRAFT_EVENT, onJump);
  }, []);

  // B9: remember sort preference for this browser tab session.
  // R2 / UX-B T6: remember three-station + fail filter for this tab session.
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.sessionStorage : null;
    setSortMode(readStoredResultSort(storage));
    setStage(readStoredResultsFilter(storage, STATION_FILTER_STORAGE_KEY_RESULTS));
  }, []);

  // Drop optimistic hides once server props already reflect archive/unarchive.
  useEffect(() => {
    setOptimisticHide((prev) => reconcileOptimisticHide(prev, drafts));
  }, [drafts]);

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

  // R2: work queue excludes input / published / archived
  const workQueueDrafts = useMemo(() => filterWorkQueueDrafts(drafts), [drafts]);

  /**
   * UX-F T29: client classify enrolled pipeline drafts → factory bridge.
   * Use all non-archived loaded drafts (not only 三站 work queue) so
   * processing/pending factory items still show after leaving 標圖.
   */
  const factoryBridgeSummary = useMemo(() => {
    const active = drafts.filter((d) => d.status !== "archived");
    return buildFactoryBridgeSummary(active, imagesByDraft);
  }, [drafts, imagesByDraft]);

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
      const okMsg = `已核准 ${payload.approvedCount ?? n} 筆文案（尚未發布）`;
      setMessage(okMsg);
      showToast(okMsg, "success");
      setSelectedIds(new Set());
      router.refresh();
    } catch {
      setMessage("批次核准連線失敗");
      showToast("批次核准連線失敗", "error");
    } finally {
      setBusy(false);
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
    clearArchiveUndo();
    setMessage(`分流中（已選 ${n} 筆）…`);
    const messages: string[] = [];
    try {
      if (advanceIds.length) {
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
      showToast(toastLine, "success");
      setSelectedIds(new Set());
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMessage("批次分流連線失敗");
      showToast("批次分流連線失敗", "error");
    } finally {
      setBusy(false);
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

  function openNextExportPreflight(
    kinds: ExportKind[],
    draftIds: string[],
    markLeaveQueue: boolean
  ) {
    if (!kinds.length) return;
    const [kind, ...rest] = kinds;
    const markup = getStoredPricingSettings().showmoreMarkupPercent;
    const report = runExportPreflight(buildPreflightInputs(draftIds), {
      kind,
      showmoreMarkupPercent: markup
    });
    setExportQueue(rest);
    setExportPreflight({
      kind,
      report,
      draftIds,
      markupPercent: kind === "showmore" ? markup : undefined,
      markLeaveQueue
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
        scheduleRouterRefresh(() => router.refresh());
        return;
      }

      // Q3: mark leave only when API ok or CSV-only
      const markLeaveQueue = shouldLeaveQueue({
        selection,
        apiSucceeded: selection.shopify === "none" ? null : apiSucceeded,
        csvSucceeded: true
      });
      openNextExportPreflight(csvKinds, draftIds, markLeaveQueue);
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
      openNextExportPreflight(rest, draftIds, markLeaveQueue);
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
        showToast(okMsg, "success");
        if (archivedIds.length) {
          setOptimisticHide((prev) => applyOptimisticHide(prev, archivedIds, "archived"));
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

  const showToolbar = workQueueDrafts.length > 0 || drafts.length > 0;
  const isCopyStation = stage === "copy_review";
  const isImageStation = stage === "image_review";
  const isReadyStation = stage === "ready";

  return (
    <section className="panel results-panel">
      <div className="panel-header rc-panel-header">
        <h2>◈ 生成結果（三站工作佇列）</h2>
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
          <>
            <div className="results-batch-toolbar" role="toolbar" aria-label="批次操作與排序">
              <label className="check-row results-batch-check">
                <input
                  checked={allSelected}
                  onChange={toggleAll}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  type="checkbox"
                />
                全選
              </label>
              <span className="batch-selected-count">
                {selectedIds.size > 0 ? `已選 ${selectedIds.size} 筆` : "勾選商品以使用批次操作"}
              </span>
              {/* UX-E T27: hide batch actions until selection; primary + 更多 overflow */}
              {selectedIds.size > 0 ? (
                <div className="batch-actions">
                  {isCopyStation ? (
                    <>
                      <button
                        className={`btn-mini batch-primary-action${batchArm?.action === "approve" ? " danger" : ""}`}
                        disabled={busy || !selectedArray.length}
                        onClick={() => void batchApproveOnly()}
                        title={
                          batchArm?.action === "approve"
                            ? batchArm.hint
                            : "核准文案 → 進入圖片審核；未標記圖寫入保留原圖"
                        }
                        type="button"
                      >
                        {batchArm?.action === "approve"
                          ? `⚠ 再點確認核准 ${selectedArray.length} 筆`
                          : "✓ 批次核准"}
                      </button>
                      <details className="batch-more">
                        <summary className="btn-mini">更多 ▾</summary>
                        <div className="batch-more-menu">
                          <button
                            className="btn-mini"
                            disabled={busy || !selectedArray.length}
                            onClick={() => void batchArchiveOrUnarchive("archive")}
                            title="移出工作佇列（軟刪除，可救回）"
                            type="button"
                          >
                            🗄 移出佇列
                          </button>
                        </div>
                      </details>
                    </>
                  ) : null}
                  {isImageStation ? (
                    <>
                      <button
                        className={`btn-mini batch-primary-action${batchArm?.action === "review" ? " danger" : ""}`}
                        disabled={busy || !selectedArray.length}
                        onClick={() => void batchStationReview()}
                        title={
                          batchArm?.action === "review"
                            ? batchArm.hint
                            : "標圖分流：全保留→待發布；有 AI 標記→生圖工廠"
                        }
                        type="button"
                      >
                        {batchArm?.action === "review"
                          ? `⚠ 再點確認 ${selectedArray.length} 筆`
                          : "✓ 批次標圖通過"}
                      </button>
                      <details className="batch-more">
                        <summary className="btn-mini">更多 ▾</summary>
                        <div className="batch-more-menu">
                          <button
                            className="btn-mini"
                            disabled={busy || !selectedArray.length}
                            onClick={() => void batchArchiveOrUnarchive("archive")}
                            title="移出工作佇列（軟刪除，可救回）"
                            type="button"
                          >
                            🗄 移出佇列
                          </button>
                        </div>
                      </details>
                    </>
                  ) : null}
                  {isReadyStation ? (
                    <button
                      className="btn-mini batch-primary-action"
                      disabled={busy || station3Busy || !selectedArray.length}
                      onClick={() => openStation3Modal()}
                      title="發布／匯出：API 上架或草稿、Matrixify、Showmore 可多選"
                      type="button"
                    >
                      發布／匯出
                    </button>
                  ) : null}
                </div>
              ) : null}
              <label className="results-sort-label">
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
          </>
        ) : null}

        {/* UX-B T6: three stations always-on (even 0); fail pill when fail > 0 */}
        <StageFilterPills counts={stageCounts} onChange={onStageChange} stage={stage} />

        {/* UX-F T29: 工廠橋接（N=M=K=0 時元件自隱藏） */}
        <FactoryBridgeStrip summary={factoryBridgeSummary} />

        {message ? (
          <div className="notice results-batch-notice" role="status">
            <span style={{ whiteSpace: "pre-wrap" }}>{message}</span>
            {lastArchiveIds && lastArchiveIds.length > 0 ? (
              <button
                className="btn-mini"
                disabled={busy}
                onClick={() => void undoLastArchive()}
                style={{ marginLeft: 10 }}
                title="10 秒內可復原"
                type="button"
              >
                復原
              </button>
            ) : null}
          </div>
        ) : null}

        {drafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">在左側輸入商品資料並送出，生成結果會出現在這裡</p>
          </div>
        ) : workQueueDrafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">目前沒有在工作佇列的商品</p>
            <Link className="button primary empty-state-cta" href="/drafts/new">
              去新增商品
            </Link>
          </div>
        ) : visibleDrafts.length === 0 && !progress ? (
          <div className="empty-state">
            <div className="empty-icon">◈</div>
            <p className="muted">這個篩選下沒有商品</p>
            <button
              className="button empty-state-cta"
              onClick={clearResultsFilter}
              type="button"
            >
              清除篩選
            </button>
          </div>
        ) : (
          <div className="results-list" id="results-list">
            {visibleDrafts.map((draft) => (
              <ResultCard
                checked={selectedIds.has(draft.id)}
                draft={draft}
                images={imagesByDraft.get(draft.id) ?? []}
                key={draft.id}
                onToggle={() => toggleOne(draft.id)}
                variantPrices={variantsByDraft.get(draft.id) ?? []}
              />
            ))}
          </div>
        )}
      </div>

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
