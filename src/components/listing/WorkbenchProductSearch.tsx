"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { mapStatusToPipelineStage } from "@/lib/drafts/pipelineStage";
import { formatRelativeTime } from "@/lib/formatRelativeTime";
import type { DraftStatus, PipelineStage } from "@/types/domain";
import styles from "./WorkbenchProductSearch.module.css";

type SearchRow = {
  id: string;
  title_zh: string | null;
  taobao_title: string | null;
  original_title: string | null;
  sku: string | null;
  status: DraftStatus;
  pipeline_stage: PipelineStage | null;
  shopify_product_id: string | null;
  updated_at: string;
};

const STAGE_LABELS: Record<PipelineStage, string> = {
  input: "未完成",
  copy_review: "文案待審",
  image_review: "圖片待處理",
  ready: "完成待發布",
  published: "已完成",
  archived: "已封存",
};

function resultTitle(row: SearchRow): string {
  return row.title_zh?.trim() || row.taobao_title?.trim() || row.original_title?.trim() || "未命名商品";
}

function resultStage(row: SearchRow): PipelineStage {
  if (row.pipeline_stage) return row.pipeline_stage;
  return mapStatusToPipelineStage(row.status, { shopifyProductId: row.shopify_product_id });
}

export function WorkbenchProductSearch() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestRef = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }
      event.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const raw = query.trim();
    const safe = raw.replace(/[,%()]/g, " ").replace(/\s+/g, " ").trim();
    const currentRequest = ++requestRef.current;

    if (safe.length < 2) {
      setResults([]);
      setLoading(false);
      setSearched(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const supabase = createClient();
          const pattern = `%${safe}%`;
          const { data, error: searchError } = await supabase
            .from("product_drafts")
            .select(
              "id,title_zh,taobao_title,original_title,sku,status,pipeline_stage,shopify_product_id,updated_at"
            )
            .or(
              [
                `title_zh.ilike.${pattern}`,
                `taobao_title.ilike.${pattern}`,
                `original_title.ilike.${pattern}`,
                `sku.ilike.${pattern}`,
                `source_url.ilike.${pattern}`,
                `taobao_url.ilike.${pattern}`,
              ].join(",")
            )
            .order("updated_at", { ascending: false })
            .limit(12);

          if (currentRequest !== requestRef.current) return;
          if (searchError) {
            setResults([]);
            setError(searchError.message);
          } else {
            setResults((data ?? []) as SearchRow[]);
          }
          setSearched(true);
        } catch (searchFailure) {
          if (currentRequest !== requestRef.current) return;
          setResults([]);
          setSearched(true);
          setError(searchFailure instanceof Error ? searchFailure.message : "搜尋失敗");
        } finally {
          if (currentRequest === requestRef.current) setLoading(false);
        }
      })();
    }, 260);

    return () => window.clearTimeout(timer);
  }, [query]);

  function openResult(row: SearchRow) {
    const stage = resultStage(row);
    if (stage === "input") {
      router.push(`/drafts/new?draft=${encodeURIComponent(row.id)}`);
      return;
    }
    router.push(`/drafts/${encodeURIComponent(row.id)}`);
  }

  const hasQuery = query.trim().length >= 2;

  return (
    <div className={styles.search} role="search" aria-label="搜尋所有商品">
      <div className={styles.inputWrap}>
        <span className={styles.icon} aria-hidden>
          ⌕
        </span>
        <input
          ref={inputRef}
          className={styles.input}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜尋所有商品：名稱、SKU、來源網址"
          aria-label="搜尋所有商品"
        />
        <span className={styles.shortcut} aria-hidden>
          /
        </span>
      </div>

      {hasQuery ? (
        <div className={styles.results} aria-live="polite">
          <div className={styles.resultHead}>
            <span>{loading ? "搜尋中…" : `全庫搜尋 · ${results.length} 筆結果`}</span>
            <span className={styles.hint}>不受目前 40／50 件工作檯載入限制</span>
          </div>

          {error ? <div className={styles.message}>搜尋失敗：{error}</div> : null}
          {!error && searched && !loading && results.length === 0 ? (
            <div className={styles.message}>找不到符合的商品，試試名稱、SKU 或來源網址。</div>
          ) : null}

          {!error && results.length > 0 ? (
            <div className={styles.list}>
              {results.map((row) => {
                const stage = resultStage(row);
                return (
                  <button
                    className={styles.row}
                    key={row.id}
                    onClick={() => openResult(row)}
                    type="button"
                  >
                    <span className={styles.rowMain}>
                      <span className={styles.title}>{resultTitle(row)}</span>
                      <span className={styles.meta}>
                        {row.sku ? `SKU ${row.sku} · ` : ""}
                        {formatRelativeTime(row.updated_at)}
                      </span>
                    </span>
                    <span className={styles.stage}>{STAGE_LABELS[stage]}</span>
                    <span className={styles.open} aria-hidden>
                      →
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.idleHint}>輸入 2 個字以上開始搜尋；按「/」可快速聚焦。</div>
      )}
    </div>
  );
}
