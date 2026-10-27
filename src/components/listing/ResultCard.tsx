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
import {
  GENERATION_QUEUE_KICK_EVENT,
  REGEN_QUEUE_STATUS_EVENT,
  type RegenQueueStatusDetail
} from "@/components/listing/GenerationQueueRunner";
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
import type { VariantSourceOptions } from "@/lib/variants/types";
import {
  hasBlockingWarnings,
  countConfirmOnly
} from "@/lib/drafts/warningTiers";
import { gradeDraftForApprove } from "@/lib/drafts/approve...[truncated]ardArm>(null);

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
  const [recomputingTags, setRecomputingTags] = useState(false);
  const [faqView, setFaqView] = useState<"preview" | "html">("preview");
  const [descriptionView, setDescriptionView] = useState<"preview" | "source">("preview");
  // Local mirror of pipeline marks so toggles feel instant; re-synced on refresh.
  const [imageMarks, setImageMarks] = useState<ProductImage[]>(images);
  /** SYN-1: local image_flags so 生成詳情圖 toggle stays after write without full refresh */
  const [draftImageFlags, setDraftImageFlags] = useState<unknown>(draft.image_flags);
  /** 4e: 詳情圖放進商品描述 switch write in flight */
  const [descriptionImagesBusy, setDescriptionImagesBusy] = useState(false);
  /** UX-H T49: soft-remove fade on delete image */
  const [fadingImageIds, setFadingImageIds] = useState<Set<string>>(() => new Set());
  /** IMAGE-INTEGRITY: variant-bound image ✕ needs a second click (arm, auto-disarm ~6s). */
  const [imageDeleteArm, setImageDeleteArm] = useState<{ id: string; count: number } | null>(null);
  const imageDeleteArmTimerRef = useRef<number | null>(null);
  const imageDeleteBusyRef = useRef<Set<string>>(new Set());
  // B10: generation_history (read-only for ←→; inserts on regen/manual commit)
  const [historyRows, setHistoryRows] = useState<GenerationHistoryRow[]>(...[truncated]dIds);
        for (const imageId of [...cleanup.deletedIds, ...cleanup.skippedIds]) {
          pendingVariantImageDeletionIdsRef.current.delete(imageId);
        }
        if (cleanup.deletedIds.length > 0) {
          setImageMarks((current) => current.filter((image) => !cleanup.deletedIds.includes(image.id)));
        }
        if (cleanup.warnings.length > 0) showToast(cleanup.warnings.join("；"), "warn");
      }
      setVariantsDirty(false);
      await markShopifyDirty();

      const productTypeChanged =
        (productType.trim() || null) !== (draft.product_type ?? null);
      if (productTypeChanged && !draft.shopify_product_id) {
        try {
          const tagResponse = await fetch(`/api/drafts/${draft.id}/recompute-tags`, {
            method: "POST",
          });
          if (!tagResponse.ok) {
            showToast("型態已存，但 類型_ tag 沒更新，請到 Tags 分頁確認", "warn");
          }
        } catch {
          showToast("型態已存，但 類型_ tag 沒更新，請到 Tags 分頁確認", "warn");
        }
      }

      // UX-A T2 / UX-L T62: transient success → toast only
      let okMsg = comboNote ? `已儲存修改（${comboNote}）` : "已儲存修改";
      if (productTypeChanged && draft.shopify_product_id) {
        okMsg = "已儲存修改（型態已改，類型_ tag 請到 Tags 分頁確認）";
      }
      setMessage("");
      showToast(okMsg, "success");
      router.refresh();
      return true;
    } finally {
      setComboSaving(false);
    }
  }

  async function regenerateField(field: CopyVersionField) {
    if (
      regenerating ||
      regeneratingField ||
      regenQueueStatus?.status === "queued" ||
      regenQueueStatus?.status === "processing"
    ) return;

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
    setRegeneratingFiel...[truncated] click unbinds).
        unfade();
        promptVariantBound(result.blockedByVariants.reduce((sum, row) => sum + row.count, 0));
        return;
      }

      // UX-L T62: delete image result → toast
      if (!result.ok || !result.deletedIds.includes(image.id)) {
        showToast(`刪除圖片失敗：${deleteProductImagesFailureMessage(result)}`, "error");
        unfade();
      } else {
        // Local UI first: nothing below may delay the thumbnail disappearing.
        setImageMarks((current) => current.filter((row) => row.id !== image.id));
        // Unsaved local variant rows must not keep pointing at the deleted image.
        setVariantRows((rows) =>
          rows.some((row) => row.imageId === image.id)
            ? rows.map((row) => (row.imageId === image.id ? { ...row, imageId: null } : row))
            : rows
        );
        unfade();
        const unboundCount = result.unboundVariantIds.length;
        showToast(
          unboundCount > 0 ? `已刪除圖片，並解除 ${unboundCount} 個款式的圖片綁定` : "已刪除圖片",
          "success"
        );
        await markShopifyDirty();
      }
      router.refresh();
    } finally {
      imageDeleteBusyRef.current.delete(image.id);
    }
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
      ...[truncated]"danger" : "secondary"}
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
            markMessage && (markMes...[truncated]