"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/Toast";
import { UNDO_TOAST_MS } from "@/lib/drafts/quickUndo";

const MOBILE_QUERY = "(max-width: 959px)";
const KNOWN_STATION_CLASSES = [
  "rc-batch-strip--copy",
  "rc-batch-strip--image",
  "rc-batch-strip--ready"
] as const;

function findFailBatchActions(): HTMLElement | null {
  if (typeof window === "undefined" || !window.matchMedia(MOBILE_QUERY).matches) return null;
  const strip = document.querySelector<HTMLElement>(".results-panel .rc-batch-strip");
  if (!strip) return null;
  if (KNOWN_STATION_CLASSES.some((className) => strip.classList.contains(className))) return null;
  const actions = strip.querySelector<HTMLElement>(".rc-batch-actions");
  if (!actions) return null;
  strip.classList.add("rc-batch-strip--fail");
  return actions;
}

function selectedDraftIds(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '.results-panel .result-card.is-checked[id^="draft-card-"]'
    )
  )
    .map((card) => card.id.replace(/^draft-card-/, ""))
    .filter(Boolean);
}

/**
 * Owner 2026-08-21: fail-filter multi-select was the only toolbar that exposed
 * Cancel without a peer action. The parent panel already owns the selection
 * state, but fail is a UI filter rather than a station and therefore renders no
 * station action. This narrow bridge only exposes the existing soft-archive API
 * on mobile fail multi-select; it does not add batch-regenerate semantics.
 */
export function FailBatchRemoveBridge() {
  const router = useRouter();
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    let currentStrip: HTMLElement | null = null;

    const sync = () => {
      if (currentStrip && !currentStrip.isConnected) currentStrip = null;
      const nextTarget = findFailBatchActions();
      const nextStrip = nextTarget?.closest<HTMLElement>(".rc-batch-strip") ?? null;
      if (currentStrip && currentStrip !== nextStrip) {
        currentStrip.classList.remove("rc-batch-strip--fail");
      }
      currentStrip = nextStrip;
      setTarget((current) => (current === nextTarget ? current : nextTarget));
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    mq.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      mq.removeEventListener("change", sync);
      currentStrip?.classList.remove("rc-batch-strip--fail");
    };
  }, []);

  async function archiveSelected() {
    const draftIds = selectedDraftIds();
    if (!draftIds.length) {
      showToast("請先勾選商品再移出佇列", "error");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds, action: "archive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showToast(payload.error ?? "批次移出佇列失敗", "error");
        return;
      }

      const archivedIds = (payload.archivedIds as string[] | undefined) ?? [];
      const message =
        typeof payload.message === "string"
          ? payload.message
          : `已移出佇列 ${archivedIds.length || draftIds.length} 筆`;

      showToast(message, "success", UNDO_TOAST_MS.archive, {
        actionLabel: archivedIds.length ? "復原" : undefined,
        onAction: archivedIds.length
          ? async () => {
              try {
                const undoResponse = await fetch("/api/drafts/batch/archive", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ draftIds: archivedIds, action: "unarchive" })
                });
                const undoPayload = await undoResponse.json().catch(() => ({}));
                showToast(
                  undoResponse.ok ? undoPayload.message ?? "已復原移出佇列" : undoPayload.error ?? "復原失敗",
                  undoResponse.ok ? "success" : "error"
                );
                router.refresh();
              } catch {
                showToast("復原連線失敗", "error");
              }
            }
          : undefined
      });

      document
        .querySelector<HTMLButtonElement>(".rc-batch-strip--fail .rc-batch-cancel")
        ?.click();
      router.refresh();
    } catch {
      showToast("批次移出佇列連線失敗", "error");
    } finally {
      setBusy(false);
    }
  }

  if (!target) return null;

  return createPortal(
    <Button
      size="sm"
      className="batch-remove-action"
      disabled={busy}
      loading={busy}
      onClick={() => void archiveSelected()}
      title="移出工作佇列（軟刪除，可救回）"
      type="button"
    >
      移出佇列
    </Button>,
    target
  );
}
