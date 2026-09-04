"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import type { ShopifySyncStatus } from "@/types/domain";

type SyncRequestOptions = {
  forceRemoteOverwrite?: boolean;
  confirmRemovals?: boolean;
  confirmActiveUpdate?: boolean;
};

type RemovalCounts = { variants: number; media: number };

type ModalKind =
  | "menu"
  | "archive"
  | "restore"
  | "delete"
  | "conflict"
  | "removals"
  | "active"
  | "error";

function isRealProductId(value: string | null): value is string {
  return Boolean(value && value !== "mock-product-id");
}

function syncLabel(
  productId: string | null,
  status: ShopifySyncStatus | null | undefined
): { className: string; label: string } {
  if (productId === "mock-product-id") {
    return { className: "schip schip--warn", label: "安全模式・未寫入 Shopify" };
  }
  if (!isRealProductId(productId)) {
    return { className: "schip schip--idle", label: "尚未建立 Shopify" };
  }
  switch (status) {
    case "synced":
      return { className: "schip schip--ok", label: "已同步 Shopify" };
    case "dirty":
      return { className: "schip schip--warn", label: "Shopify 有未同步修改" };
    case "syncing":
      return { className: "schip schip--run", label: "Shopify 同步中" };
    case "partial":
      return { className: "schip schip--error", label: "Shopify 部分同步・需對帳" };
    case "error":
      return { className: "schip schip--error", label: "Shopify 同步失敗" };
    case "conflict":
      return { className: "schip schip--error", label: "Shopify 有外部變更" };
    case "remote_deleted":
      return { className: "schip schip--idle", label: "Shopify 商品已刪除" };
    default:
      return { className: "schip schip--idle", label: "Shopify 已建立・待首次同步" };
  }
}

export function ShopifySyncStatusChip({
  productId,
  status,
  error
}: {
  productId: string | null;
  status?: ShopifySyncStatus | null;
  error?: string | null;
}) {
  const display = syncLabel(productId, status);
  return (
    <span className={display.className} title={error || display.label}>
      {display.label}
    </span>
  );
}

export function ShopifySyncControls({
  draftId,
  draftStatus,
  title,
  productId,
  adminUrl,
  syncStatus,
  syncError,
  hasLocalChanges,
  disabled = false,
  onSaveLocal,
  onStatusChange,
  onRefresh
}: {
  draftId: string;
  draftStatus: string;
  title: string;
  productId: string | null;
  adminUrl: string | null;
  syncStatus?: ShopifySyncStatus | null;
  syncError?: string | null;
  hasLocalChanges: boolean;
  disabled?: boolean;
  onSaveLocal: () => Promise<boolean>;
  onStatusChange: (status: ShopifySyncStatus, error?: string | null) => void;
  onRefresh: () => void;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<ModalKind | null>(null);
  const [modalError, setModalError] = useState(syncError ?? "");
  const [deleteTitle, setDeleteTitle] = useState("");
  const [removals, setRemovals] = useState<RemovalCounts>({ variants: 0, media: 0 });
  const [pendingSync, setPendingSync] = useState<SyncRequestOptions>({});

  const realProduct = isRealProductId(productId);
  const remoteDeleted = syncStatus === "remote_deleted";
  const archived = draftStatus === "archived";

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!modal) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => cancelRef.current?.focus(), 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        setModal(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [modal, busy]);

  function closeModal() {
    if (!busy) {
      setModal(null);
      setDeleteTitle("");
    }
  }

  async function requestSync(options: SyncRequestOptions = {}) {
    setBusy(true);
    onStatusChange("syncing", null);
    try {
      const response = await fetch(`/api/drafts/${draftId}/shopify-sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const code = typeof payload.code === "string" ? payload.code : "";
        const error = typeof payload.error === "string" ? payload.error : "Shopify 同步失敗";
        setPendingSync(options);
        if (code === "remote_conflict") {
          onStatusChange("conflict", error);
          setModal("conflict");
          return;
        }
        if (code === "removal_confirmation_required") {
          setRemovals({
            variants: Number(payload.removals?.variants ?? 0),
            media: Number(payload.removals?.media ?? 0)
          });
          onStatusChange("dirty", null);
          setModal("removals");
          return;
        }
        if (code === "active_update_confirmation_required") {
          onStatusChange("dirty", null);
          setModal("active");
          return;
        }
        const nextStatus: ShopifySyncStatus =
          code === "remote_deleted"
            ? "remote_deleted"
            : code === "manual_reconciliation_required"
              ? "partial"
              : "error";
        onStatusChange(nextStatus, error);
        setModalError(error);
        setModal("error");
        showToast(error, "error");
        return;
      }

      if (payload.mock === true) {
        onStatusChange(hasLocalChanges ? "dirty" : syncStatus ?? "never", null);
        setModal(null);
        showToast("安全模式檢查完成，沒有寫入 Shopify", "info");
        return;
      }
      onStatusChange("synced", null);
      setModal(null);
      showToast("Shopify 已同步並完成回讀核對", "success");
      onRefresh();
    } catch {
      const error = "Shopify 同步連線失敗";
      onStatusChange("error", error);
      setModalError(error);
      setModal("error");
      showToast(error, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveLocalOnly() {
    setBusy(true);
    try {
      await onSaveLocal();
    } finally {
      setBusy(false);
    }
  }

  async function saveAndSync() {
    if (hasLocalChanges) {
      setBusy(true);
      const saved = await onSaveLocal();
      setBusy(false);
      if (!saved) return;
    }
    await requestSync();
  }

  async function requestLifecycle(action: "archive" | "restore" | "delete") {
    setBusy(true);
    try {
      const response = await fetch(`/api/drafts/${draftId}/shopify-lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          confirmAction: true,
          ...(action === "delete"
            ? { confirmPermanentDelete: true, confirmTitle: deleteTitle.trim() }
            : {})
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = typeof payload.error === "string" ? payload.error : "Shopify 操作失敗";
        const nextStatus: ShopifySyncStatus =
          payload.code === "manual_reconciliation_required" ? "partial" : "error";
        onStatusChange(nextStatus, error);
        setModalError(error);
        setModal("error");
        showToast(error, "error");
        return;
      }
      onStatusChange(action === "delete" ? "remote_deleted" : "synced", null);
      setModal(null);
      setDeleteTitle("");
      showToast(
        action === "archive"
          ? "Shopify 商品已封存"
          : action === "restore"
            ? "Shopify 商品已恢復為草稿"
            : "Shopify 商品已永久刪除；工具保留稽核紀錄",
        "success"
      );
      onRefresh();
    } catch {
      const error = "Shopify 操作連線失敗";
      onStatusChange("error", error);
      setModalError(error);
      setModal("error");
      showToast(error, "error");
    } finally {
      setBusy(false);
    }
  }

  if (!realProduct) return null;

  const controls = (
    <span className="rc-actions-group" onClick={(event) => event.stopPropagation()}>
      {hasLocalChanges ? (
        <Button
          disabled={disabled || busy}
          loading={busy}
          onClick={() => void saveLocalOnly()}
          size="sm"
          type="button"
        >
          只儲存工具
        </Button>
      ) : null}
      {!remoteDeleted ? (
        <Button
          className="shopify-sync-primary"
          disabled={disabled || busy}
          loading={busy}
          onClick={() => void saveAndSync()}
          size="sm"
          type="button"
          variant="primary"
        >
          {hasLocalChanges
            ? "儲存並同步 Shopify"
            : syncStatus === "synced"
              ? "重新核對同步"
              : "同步 Shopify"}
        </Button>
      ) : null}
      <Button
        disabled={disabled || busy}
        onClick={() => setModal("menu")}
        size="sm"
        type="button"
      >
        Shopify 操作
      </Button>
      {adminUrl && !remoteDeleted ? (
        <a
          className="nb-btn nb-btn--secondary nb-btn--sm"
          href={adminUrl}
          rel="noreferrer"
          target="_blank"
        >
          開啟 Shopify 後台
        </a>
      ) : null}
    </span>
  );

  const modalTitle =
    modal === "menu"
      ? "Shopify 商品操作"
      : modal === "archive"
        ? "封存 Shopify 商品"
        : modal === "restore"
          ? "恢復 Shopify 商品"
          : modal === "delete"
            ? "永久刪除 Shopify 商品"
            : modal === "conflict"
              ? "Shopify 有較新的修改"
              : modal === "removals"
                ? "確認移除 Shopify 資料"
                : modal === "active"
                  ? "確認更新公開商品"
                  : "Shopify 操作未完成";

  const dialog =
    mounted && modal
      ? createPortal(
          <div
            aria-labelledby={titleId}
            aria-modal="true"
            className="modal-overlay open"
            onClick={(event) => {
              if (event.target === event.currentTarget) closeModal();
            }}
            role="dialog"
          >
            <div className="modal-box approve-summary-modal">
              <div className="modal-hdr">
                <span id={titleId}>{modalTitle}</span>
                <button
                  aria-label="關閉"
                  className="modal-close"
                  disabled={busy}
                  onClick={closeModal}
                  type="button"
                >
                  ×
                </button>
              </div>
              <div className="modal-body">
                {modal === "menu" ? (
                  <>
                    <p className="export-pf-overview">
                      工具內封存與 Shopify 遠端操作是兩件事。這裡只處理 Shopify 商品。
                    </p>
                    <div className="mobile-more-list">
                      <Button
                        disabled={busy}
                        fullWidth
                        onClick={() => setModal(archived ? "restore" : "archive")}
                        type="button"
                      >
                        {archived ? "恢復為 Shopify 草稿" : "封存 Shopify 商品"}
                      </Button>
                      <Button
                        disabled={busy}
                        fullWidth
                        onClick={() => setModal("delete")}
                        type="button"
                        variant="danger"
                      >
                        永久刪除 Shopify 商品
                      </Button>
                    </div>
                  </>
                ) : null}

                {modal === "archive" ? (
                  <p className="export-pf-overview">
                    商品會從公開銷售中移除並改為 ARCHIVED；工具內仍保留完整資料與稽核紀錄。
                  </p>
                ) : null}
                {modal === "restore" ? (
                  <p className="export-pf-overview">
                    商品會恢復為 Shopify DRAFT，不會直接公開 ACTIVE。
                  </p>
                ) : null}
                {modal === "conflict" ? (
                  <p className="export-pf-overview">
                    Shopify 後台在上次同步後有新修改，所以系統已先停止覆蓋。若確定以工具版本為準，才繼續覆蓋。
                  </p>
                ) : null}
                {modal === "removals" ? (
                  <p className="export-pf-overview">
                    這次同步會從 Shopify 移除 <strong>{removals.variants}</strong> 個款式與
                    <strong> {removals.media}</strong> 個圖片／媒體。工具內目前內容會保留為同步後版本。
                  </p>
                ) : null}
                {modal === "active" ? (
                  <p className="export-pf-overview">
                    這是目前公開中的 ACTIVE 商品。繼續會立即更新顧客看到的內容；請確認後再執行。
                  </p>
                ) : null}
                {modal === "delete" ? (
                  <>
                    <p className="export-pf-overview">
                      這會永久刪除 Shopify 商品，無法復原。工具只保留稽核紀錄。請輸入完整商品名稱確認：
                      <strong> {title}</strong>
                    </p>
                    <div className="field">
                      <label htmlFor={`${titleId}-delete-title`}>商品名稱</label>
                      <input
                        autoComplete="off"
                        id={`${titleId}-delete-title`}
                        onChange={(event) => setDeleteTitle(event.target.value)}
                        type="text"
                        value={deleteTitle}
                      />
                    </div>
                  </>
                ) : null}
                {modal === "error" ? (
                  <p className="price-soft-warn" role="alert">
                    {modalError || "Shopify 操作未完成，沒有把它當成成功。"}
                  </p>
                ) : null}

                <div className="approve-sum-actions">
                  <button
                    className="approve-sum-btn"
                    disabled={busy}
                    onClick={closeModal}
                    ref={cancelRef}
                    type="button"
                  >
                    {modal === "error" ? "關閉" : "取消"}
                  </button>
                  {modal === "archive" ? (
                    <button
                      className="approve-sum-btn primary"
                      disabled={busy}
                      onClick={() => void requestLifecycle("archive")}
                      type="button"
                    >
                      {busy ? "處理中…" : "確認封存"}
                    </button>
                  ) : null}
                  {modal === "restore" ? (
                    <button
                      className="approve-sum-btn primary"
                      disabled={busy}
                      onClick={() => void requestLifecycle("restore")}
                      type="button"
                    >
                      {busy ? "處理中…" : "恢復為草稿"}
                    </button>
                  ) : null}
                  {modal === "delete" ? (
                    <button
                      className="approve-sum-btn primary danger"
                      disabled={busy || deleteTitle.trim() !== title.trim()}
                      onClick={() => void requestLifecycle("delete")}
                      type="button"
                    >
                      {busy ? "刪除中…" : "永久刪除"}
                    </button>
                  ) : null}
                  {modal === "conflict" ? (
                    <button
                      className="approve-sum-btn primary danger"
                      disabled={busy}
                      onClick={() =>
                        void requestSync({ ...pendingSync, forceRemoteOverwrite: true })
                      }
                      type="button"
                    >
                      {busy ? "同步中…" : "以工具版本覆蓋"}
                    </button>
                  ) : null}
                  {modal === "removals" ? (
                    <button
                      className="approve-sum-btn primary danger"
                      disabled={busy}
                      onClick={() => void requestSync({ ...pendingSync, confirmRemovals: true })}
                      type="button"
                    >
                      {busy ? "同步中…" : "確認移除並同步"}
                    </button>
                  ) : null}
                  {modal === "active" ? (
                    <button
                      className="approve-sum-btn primary danger"
                      disabled={busy}
                      onClick={() =>
                        void requestSync({ ...pendingSync, confirmActiveUpdate: true })
                      }
                      type="button"
                    >
                      {busy ? "同步中…" : "確認更新公開商品"}
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      {controls}
      {dialog}
    </>
  );
}
