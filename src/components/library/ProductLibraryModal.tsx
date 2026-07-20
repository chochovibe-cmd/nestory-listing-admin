"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  filterLibraryRows,
  LIBRARY_FETCH_LIMIT,
  LIBRARY_SELECT_COLUMNS,
  LIBRARY_STATUSES,
  libraryCreatorLabel,
  libraryDisplayTitle,
  libraryStatusLabel,
  libraryStatusSchipClass,
  libraryTimeMeta,
  type LibraryDraftRow
} from "@/lib/library/productLibrary";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

/**
 * C4: product library as top-bar modal (not a full page).
 * Q1-A session+RLS · Q2-A honest creator · Q3-A three statuses · Q5-A client search.
 */
export function ProductLibraryModal({
  open,
  onClose
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LibraryDraftRow[]>([]);
  const [nameById, setNameById] = useState<Map<string, string>>(() => new Map());
  const [thumbById, setThumbById] = useState<Map<string, string>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedOnce, setLoadedOnce] = useState(false);

  const load = useCallback(async () => {
    if (!hasSupabaseBrowserEnv()) {
      const msg = "需要設定 Supabase 才能使用商品庫";
      showToast(msg, "error");
      setError(msg);
      setRows([]);
      setLoadedOnce(true);
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
        // UX-I T55: auth glitch → toast; keep notice for retryable empty state
        showToast(userError.message, "error");
        setError(userError.message);
        setRows([]);
        setLoadedOnce(true);
        return;
      }
      if (!user) {
        const msg = "請先登入後再開商品庫";
        showToast(msg, "error");
        setError(msg);
        setRows([]);
        setLoadedOnce(true);
        return;
      }

      // published_at may be null on some csv_ready rows; created_at is always set.
      const { data, error: draftError } = await supabase
        .from("product_drafts")
        .select(LIBRARY_SELECT_COLUMNS)
        .in("status", [...LIBRARY_STATUSES])
        .order("created_at", { ascending: false })
        .limit(LIBRARY_FETCH_LIMIT);

      if (draftError) {
        showToast(`商品庫載入失敗：${draftError.message}`, "error");
        setError(draftError.message);
        setRows([]);
        setLoadedOnce(true);
        return;
      }

      const list = ((data ?? []) as LibraryDraftRow[]).slice().sort((a, b) => {
        const ta = a.published_at || a.created_at;
        const tb = b.published_at || b.created_at;
        return tb.localeCompare(ta);
      });
      setRows(list);

      // Q2-A: resolve names only where RLS allows (self for operator; all for admin).
      const creatorIds = [
        ...new Set(list.map((r) => r.created_by).filter((id): id is string => Boolean(id)))
      ];
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", creatorIds);
        const map = new Map<string, string>();
        for (const p of profiles ?? []) {
          const id = (p as { id: string; name: string | null }).id;
          const name = (p as { id: string; name: string | null }).name;
          if (id && name?.trim()) map.set(id, name.trim());
        }
        setNameById(map);
      } else {
        setNameById(new Map());
      }

      // Thumbnails when present (no fake product images).
      const draftIds = list.map((r) => r.id);
      if (draftIds.length > 0) {
        const { data: images } = await supabase
          .from("product_images")
          .select("draft_id, original_file_url, processed_file_url, image_type, sort_order")
          .in("draft_id", draftIds)
          .in("image_type", ["main", "variant"])
          .order("sort_order", { ascending: true });

        type ImgRow = {
          draft_id: string;
          original_file_url: string | null;
          processed_file_url: string | null;
          image_type: string;
        };
        const thumbs = new Map<string, string>();
        // Prefer main, then first variant URL.
        for (const img of (images ?? []) as ImgRow[]) {
          if (img.image_type !== "main" || thumbs.has(img.draft_id)) continue;
          const url = img.processed_file_url || img.original_file_url;
          if (url) thumbs.set(img.draft_id, url);
        }
        for (const img of (images ?? []) as ImgRow[]) {
          if (thumbs.has(img.draft_id)) continue;
          const url = img.processed_file_url || img.original_file_url;
          if (url) thumbs.set(img.draft_id, url);
        }
        setThumbById(thumbs);
      } else {
        setThumbById(new Map());
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "商品庫載入失敗";
      showToast(msg, "error");
      setError(msg);
      setRows([]);
    } finally {
      setLoading(false);
      setLoadedOnce(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = window.setTimeout(() => searchRef.current?.focus(), 30);
    void load();
    return () => {
      document.body.style.overflow = prev;
      window.clearTimeout(t);
    };
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset search when closed so next open is clean.
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => filterLibraryRows(rows, query), [rows, query]);

  function goCopy(id: string) {
    onClose();
    router.push(`/drafts/${id}`);
  }

  function goImages(id: string) {
    onClose();
    router.push(`/drafts/${id}?focus=images`);
  }

  if (!open) return null;

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      role="dialog"
    >
      <div className="modal-box library-modal">
        <div className="modal-hdr">
          <span id={titleId}>🔍 商品庫</span>
          <button aria-label="關閉" className="modal-close" onClick={onClose} type="button">
            ×
          </button>
        </div>
        <div className="modal-body">
          <input
            aria-label="搜尋商品"
            className="library-search"
            onChange={(e) => setQuery(e.target.value)}
            placeholder="輸入商品名稱／IP／角色搜尋…"
            ref={searchRef}
            type="search"
            value={query}
          />

          {loading ? <p className="muted library-state">載入中…</p> : null}

          {!loading && error ? (
            <div className="notice library-state">
              {error}
              {error.includes("登入") ? (
                <>
                  {" "}
                  <Link href="/login" onClick={onClose}>
                    前往登入
                  </Link>
                </>
              ) : null}
            </div>
          ) : null}

          {!loading && !error && loadedOnce && filtered.length === 0 ? (
            <div className="library-state">
              <p className="muted">
                {query.trim()
                  ? "找不到符合的商品"
                  : "目前沒有可顯示的商品（僅列已上架／已建草稿／CSV 已備妥）"}
              </p>
              <Link className="button primary library-empty-cta" href="/drafts/new" onClick={onClose}>
                去新增商品
              </Link>
            </div>
          ) : null}

          {!loading && !error && filtered.length > 0 ? (
            <ul className="lib-list">
              {filtered.map((row) => {
                const title = libraryDisplayTitle(row);
                const time = libraryTimeMeta(row);
                const creator = libraryCreatorLabel(row.created_by, nameById);
                const thumb = thumbById.get(row.id);
                const shopifyId = row.shopify_product_id?.trim();

                return (
                  <li className="lib-row" key={row.id}>
                    {thumb ? (
                      <img alt={`${title} 商品圖`} className="lib-thumb" src={thumb} />
                    ) : (
                      <span aria-hidden className="lib-thumb lib-thumb--empty">
                        {title.slice(0, 1)}
                      </span>
                    )}
                    <div className="lib-body">
                      <div className="lib-title">{title}</div>
                      <div className="lib-meta">
                        <span className={libraryStatusSchipClass(row.status)}>
                          {libraryStatusLabel(row.status)}
                        </span>
                        <span className="lib-meta-text">
                          {time.kind} {time.label}
                          {" · by "}
                          {creator}
                          {shopifyId ? ` · Shopify #${shopifyId}` : ""}
                        </span>
                      </div>
                    </div>
                    <div className="lib-actions">
                      <Button size="sm" onClick={() => goImages(row.id)} type="button">
                        編輯圖片
                      </Button>
                      <Button size="sm" onClick={() => goCopy(row.id)} type="button">
                        編輯文案
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}
