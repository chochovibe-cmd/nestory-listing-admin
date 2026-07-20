"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImageCompareSlider } from "@/components/review/ImageCompareSlider";
import { isAdmin } from "@/lib/auth/roles";
import {
  REVIEW_DRAFT_SELECT_COLUMNS,
  REVIEW_FETCH_LIMIT,
  REVIEW_QUEUE_IMAGE_STATUSES,
  canBatchConfirmAll,
  canConfirmReviewKind,
  classifyReviewQueueItem,
  countBanner,
  formatReviewFailReasons,
  formatReviewFailReasonsShort,
  formatUnviewedBlockMessage,
  pipelineImagesForReview,
  reviewDisplayTitle,
  reviewImageFieldLabel,
  reviewSchipMeta,
  type ImageReviewQueueKind,
  type ReviewDraftRow,
  type ReviewImageRow
} from "@/lib/images/imageReview";
import { showToast } from "@/components/Toast";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import type { UserRole } from "@/types/domain";

type ScopeMode = "mine" | "all";

type QueueCard = {
  draft: ReviewDraftRow;
  kind: ImageReviewQueueKind;
  images: ReviewImageRow[];
};

/**
 * D5 image review list (session + RLS).
 * Q3-A kinds · Q4-A viewed hard-block · Q5-A canOperate · Q6-A admin scope.
 */
export function ImageReviewPanel() {
  const searchParams = useSearchParams();
  const section = searchParams.get("section");
  const [role, setRole] = useState<UserRole | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [roleReady, setRoleReady] = useState(false);
  const [scope, setScope] = useState<ScopeMode>("mine");
  const [cards, setCards] = useState<QueueCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [viewed, setViewed] = useState<Set<string>>(() => new Set());
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [rejectOpen, setRejectOpen] = useState<Record<string, boolean>>({});
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const admin = isAdmin(role);

  const load = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) {
      const msg = "需要設定 Supabase 才能使用生圖工廠";
      showToast(msg, "error");
      setError(msg);
      setCards([]);
      setLoading(false);
      setRoleReady(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError
      } = await supabase.auth.getUser();

      if (userError) {
        showToast(userError.message, "error");
        setError(userError.message);
        setCards([]);
        setRoleReady(true);
        return;
      }
      if (!user) {
        const msg = "請先登入";
        showToast(msg, "error");
        setError(msg);
        setCards([]);
        setUserId(null);
        setRole(null);
        setRoleReady(true);
        return;
      }

      setUserId(user.id);
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
      const nextRole = (profile?.role as UserRole | undefined) ?? null;
      setRole(nextRole);
      setRoleReady(true);

      let query = supabase
        .from("product_drafts")
        .select(REVIEW_DRAFT_SELECT_COLUMNS)
        .neq("status", "archived")
        .in("image_status", [...REVIEW_QUEUE_IMAGE_STATUSES])
        .order("updated_at", { ascending: false })
        .limit(REVIEW_FETCH_LIMIT);

      // Operator: always own (RLS also enforces). Admin: scope 我的/全部.
      // Reviewer: RLS 可見全部，無下拉 → 預設全部（代審）。
      const useMine =
        nextRole === "operator" || (isAdmin(nextRole) && scope === "mine");
      if (useMine) {
        query = query.eq("created_by", user.id);
      }

      const { data: drafts, error: draftError } = await query;
      if (draftError) {
        showToast(`圖審列表載入失敗：${draftError.message}`, "error");
        setError(draftError.message);
        setCards([]);
        return;
      }

      const rows = (drafts ?? []) as ReviewDraftRow[];
      const classified: Array<{ draft: ReviewDraftRow; kind: ImageReviewQueueKind }> = [];
      for (const draft of rows) {
        const kind = classifyReviewQueueItem({
          status: draft.status,
          image_status: draft.image_status,
          image_flags: draft.image_flags,
          current_image_batch_id: draft.current_image_batch_id
        });
        if (kind) classified.push({ draft, kind });
      }

      const ids = classified.map((c) => c.draft.id);
      let imagesByDraft = new Map<string, ReviewImageRow[]>();
      if (ids.length > 0) {
        const { data: images, error: imageError } = await supabase
          .from("product_images")
          .select(
            "id, draft_id, image_type, original_file_url, processed_file_url, process_intent, is_spec_process, processing_error, sort_order, created_at"
          )
          .in("draft_id", ids)
          // SYN-1: include generated_detail so composed detail appears on the card
          .in("image_type", ["main", "spec", "variant", "generated_detail"])
          .order("sort_order", { ascending: true });

        if (imageError) {
          showToast(`圖審圖片載入失敗：${imageError.message}`, "error");
          setError(imageError.message);
          setCards([]);
          return;
        }

        imagesByDraft = new Map();
        for (const img of (images ?? []) as ReviewImageRow[]) {
          const list = imagesByDraft.get(img.draft_id) ?? [];
          list.push(img);
          imagesByDraft.set(img.draft_id, list);
        }
      }

      setCards(
        classified.map(({ draft, kind }) => ({
          draft,
          kind,
          images: pipelineImagesForReview(imagesByDraft.get(draft.id) ?? [])
        }))
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "圖審列表載入失敗";
      showToast(msg, "error");
      setError(msg);
      setCards([]);
      setRoleReady(true);
    } finally {
      setLoading(false);
    }
  }, [scope]);

  useEffect(() => {
    void load();
  }, [load]);

  // R4 §12: /review?section=pending → scroll to 生成完成待審
  useEffect(() => {
    if (loading || section !== "pending") return;
    const firstPending = cards.find((c) => c.kind === "pending_review");
    if (!firstPending) {
      document
        .getElementById("ir-section-pending")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    setOpenIds((prev) => new Set(prev).add(firstPending.draft.id));
    window.setTimeout(() => {
      document
        .getElementById(`ir-card-${firstPending.draft.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  }, [loading, section, cards]);

  const banner = useMemo(() => countBanner(cards), [cards]);
  const pendingIds = useMemo(
    () => cards.filter((c) => c.kind === "pending_review").map((c) => c.draft.id),
    [cards]
  );

  function markViewed(id: string) {
    setViewed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  function toggleOpen(id: string) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    markViewed(id);
  }

  async function confirmDrafts(ids: string[]) {
    if (ids.length === 0) return;
    setNotice(null);
    const res = await fetch("/api/images/review-confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftIds: ids })
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
      confirmed?: string[];
    };
    if (!res.ok) {
      // UX-I T55: op fail → toast (optional Review touch)
      const err = data.error || "確認失敗";
      showToast(err, "error");
      setNotice(err);
      return;
    }
    const ok = data.message || "已確認";
    showToast(ok, "success");
    setNotice(ok);
    const confirmed = new Set(data.confirmed ?? ids);
    setCards((prev) => prev.filter((c) => !confirmed.has(c.draft.id)));
  }

  async function onConfirmOne(id: string) {
    setBusyId(id);
    try {
      await confirmDrafts([id]);
    } finally {
      setBusyId(null);
    }
  }

  async function onBatchConfirm() {
    const gate = canBatchConfirmAll(pendingIds, viewed);
    if (!gate.allowed) {
      if (pendingIds.length === 0) {
        setNotice("沒有待審商品可確認");
        return;
      }
      setNotice(formatUnviewedBlockMessage(gate.unviewedCount));
      return;
    }
    setBatchBusy(true);
    try {
      await confirmDrafts(pendingIds);
    } finally {
      setBatchBusy(false);
    }
  }

  async function onReject(id: string) {
    setBusyId(id);
    setNotice(null);
    try {
      const res = await fetch("/api/images/review-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id, reason: rejectReason[id] ?? "" })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        const err = data.error || "拒絕失敗";
        showToast(err, "error");
        setNotice(err);
        return;
      }
      const ok = data.message || "已拒絕";
      showToast(ok, "success");
      setNotice(ok);
      setRejectOpen((p) => ({ ...p, [id]: false }));
      // Refresh so card moves to failed / shows new state
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const empty = !loading && !error && cards.length === 0;

  return (
    <main className="container">
      <section className="panel ir-panel">
        <div className="panel-header ir-page-header">
          <div className="ir-title-row">
            <h1>🏭 生圖工廠</h1>
            <span className="ir-sub">生成中／待審對比（誰上架誰審）</span>
          </div>
          {roleReady && admin ? (
            <label className="ir-scope">
              <span className="sr-only">範圍</span>
              <select
                className="ir-scope-select"
                value={scope}
                onChange={(e) => setScope(e.target.value === "all" ? "all" : "mine")}
                aria-label="範圍"
              >
                <option value="mine">只看我的</option>
                <option value="all">全部成員</option>
              </select>
            </label>
          ) : null}
        </div>

        <div className="panel-body">
          {loading ? <div className="notice">載入中…</div> : null}
          {error ? <div className="notice">{error}</div> : null}
          {notice ? <div className="notice ir-notice">{notice}</div> : null}

          {!loading && !error ? (
            <div className="irq-banner">
              <div className="irq-banner-text">
                {banner.processing > 0 || banner.failed > 0 || banner.pendingReview > 0 ? (
                  <>
                    {banner.processing > 0 ? (
                      <span>
                        ⏳ 處理中 <b>{banner.processing}</b> 件
                      </span>
                    ) : null}
                    {banner.failed > 0 ? (
                      <span>
                        {banner.processing > 0 ? " · " : null}
                        失敗 <b>{banner.failed}</b> 件
                      </span>
                    ) : null}
                    {banner.pendingReview > 0 ? (
                      <span>
                        {banner.processing > 0 || banner.failed > 0 ? " · " : null}
                        待審 <b>{banner.pendingReview}</b> 件
                      </span>
                    ) : null}
                  </>
                ) : (
                  <span>目前沒有處理中或待審的圖片</span>
                )}
              </div>
              <button
                type="button"
                className="button primary ir-batch-confirm"
                disabled={batchBusy || pendingIds.length === 0}
                onClick={() => void onBatchConfirm()}
              >
                {batchBusy ? "確認中…" : "✓ 一鍵全部確認"}
              </button>
            </div>
          ) : null}

          {empty ? (
            <div className="empty-state">
              <div className="empty-icon">◈</div>
              <p className="empty-state-title">目前沒有要審的圖</p>
              <p className="empty-state-desc">處理完文案後，待標圖的商品會出現在這裡</p>
              <Link className="act-btn fill empty-state-cta" href="/drafts/new">
                回到新增頁開始上架
              </Link>
            </div>
          ) : null}

          <div className="ir-list" id="ir-section-pending">
            {cards.map((card) => {
              const { draft, kind, images } = card;
              const open = openIds.has(draft.id);
              const title = reviewDisplayTitle(draft);
              const schip = reviewSchipMeta(kind, images.length);
              const canConfirm = canConfirmReviewKind(kind);
              const thumb =
                images[0]?.processed_file_url || images[0]?.original_file_url || null;
              const isBusy = busyId === draft.id;

              return (
                <article
                  key={draft.id}
                  className="ir-card"
                  id={`ir-card-${draft.id}`}
                  data-kind={kind}
                >
                  <button
                    type="button"
                    className={`ir-head${viewed.has(draft.id) ? " ir-head--viewed" : ""}`}
                    onClick={() => toggleOpen(draft.id)}
                    aria-expanded={open}
                  >
                    <span className="rc-thumb ir-thumb">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          className="rc-thumb-img"
                          src={thumb}
                          alt={`${title} 縮圖`}
                        />
                      ) : (
                        <span className="rc-thumb-placeholder">🖼</span>
                      )}
                    </span>
                    <span className="ir-head-main">
                      <span className="ir-head-title">{title}</span>
                      {kind === "failed" ? (
                        <span className="ir-head-fail" title={formatReviewFailReasons({ images, warnings: draft.warnings })}>
                          {formatReviewFailReasonsShort({
                            images,
                            warnings: draft.warnings
                          })}
                        </span>
                      ) : null}
                    </span>
                    <span className={schip.className}>{schip.label}</span>
                    <span className="ir-head-chev">{open ? "▴ 收合" : "▾ 點開審核"}</span>
                  </button>

                  {open ? (
                    <div className="ir-body">
                      {images.length === 0 ? (
                        <p className="notice">此商品沒有管線圖（主圖／規格／款式）</p>
                      ) : (
                        images.map((img, index) => (
                          <ImageCompareSlider
                            key={img.id}
                            label={reviewImageFieldLabel(img, index + 1)}
                            originalUrl={img.original_file_url}
                            processedUrl={img.processed_file_url}
                          />
                        ))
                      )}

                      {kind === "failed" ? (
                        <div className="notice ir-fail-note" role="alert">
                          {formatReviewFailReasons({
                            images,
                            warnings: draft.warnings
                          })}
                        </div>
                      ) : null}

                      {kind === "processing" ? (
                        <p className="notice">圖片仍在處理中，完成後可再確認。</p>
                      ) : null}

                      <div className="ir-actions">
                        <button
                          type="button"
                          className="button primary ir-btn-confirm"
                          disabled={!canConfirm || isBusy}
                          onClick={() => void onConfirmOne(draft.id)}
                        >
                          {isBusy && canConfirm ? "確認中…" : "✓ 此商品全部確認"}
                        </button>
                        <button
                          type="button"
                          className="button ir-btn-reject"
                          disabled={kind === "processing" || isBusy}
                          onClick={() =>
                            setRejectOpen((p) => ({ ...p, [draft.id]: !p[draft.id] }))
                          }
                        >
                          ✗ 拒絕
                        </button>
                      </div>

                      {rejectOpen[draft.id] ? (
                        <div className="reject-box open">
                          <textarea
                            className="ir-reject-ta"
                            rows={3}
                            placeholder="跟 AI 說要怎麼改（本包只記錄原因，不呼叫重生）"
                            value={rejectReason[draft.id] ?? ""}
                            onChange={(e) =>
                              setRejectReason((p) => ({ ...p, [draft.id]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="button primary ir-reject-submit"
                            disabled={isBusy}
                            onClick={() => void onReject(draft.id)}
                          >
                            {isBusy ? "送出中…" : "送出拒絕原因"}
                          </button>
                          <p className="cmp-hint">不會自動呼叫 Image API；狀態改為 failed 以便之後重跑。</p>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>

          {userId && roleReady && !admin ? (
            <p className="cmp-hint ir-footer-hint">目前僅顯示你自己的商品（誰上架誰審）。</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
