"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { showToast } from "@/components/Toast";
import { gptPriceWarningsFromCosts, type GptRawListItem } from "@/lib/csv/gptRawExport";
import { undoArchiveDrafts, UNDO_TOAST_MS } from "@/lib/drafts/quickUndo";

function timestamp(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function GptRawList({ products }: { products: GptRawListItem[] }) {
  const router = useRouter();
  const [exported, setExported] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"export" | "archive" | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Keep the download result visible immediately while the server refresh catches up.
  const current = useMemo(() => products.filter((p) => !hidden.has(p.id)).map((p) =>
    overrides[p.id] ? { ...p, gpt_exported_at: overrides[p.id] } : p
  ), [products, hidden, overrides]);
  const rows = current.filter((p) => Boolean(p.gpt_exported_at) === exported);
  const ids = rows.filter((p) => selected.has(p.id)).map((p) => p.id);
  useEffect(() => { setSelected(new Set()); }, [exported, products]);
  useEffect(() => { setOverrides({}); setHidden(new Set()); }, [products]);

  async function exportCsv() {
    if (!ids.length || busy) return;
    setBusy("export");
    try {
      const response = await fetch("/api/exports/gpt-raw", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: ids })
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "無法產生檔案，請稍後再試");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const a = document.createElement("a");
      a.href = url;
      a.download = `交給GPT-原始資料-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}-${ids.length}件.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      const now = d.toISOString();
      setOverrides((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, now])) }));
      setSelected(new Set());
      showToast(`已匯出 ${ids.length} 件，檔案已下載`, "success");
      router.refresh();
    } catch (error) {
      showToast(`匯出失敗：${error instanceof TypeError ? "連線失敗，請稍後再試" : error instanceof Error ? error.message : "請稍後再試"}`, "error");
    } finally { setBusy(null); }
  }

  async function archive() {
    if (!ids.length || busy) return;
    setBusy("archive");
    try {
      const response = await fetch("/api/drafts/batch/archive", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: ids, action: "archive" })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "批次封存失敗");
      const archivedIds: string[] = payload.archivedIds ?? [];
      setHidden((prev) => new Set([...prev, ...archivedIds]));
      setSelected(new Set());
      showToast(payload.message || `已封存 ${archivedIds.length} 筆`, "success", UNDO_TOAST_MS.archive, {
        actionLabel: archivedIds.length ? "復原" : undefined,
        onAction: archivedIds.length ? async () => {
          const result = await undoArchiveDrafts(archivedIds);
          showToast(result.message, result.ok ? "success" : "error");
          if (result.ok) setHidden((prev) => new Set([...prev].filter((id) => !archivedIds.includes(id))));
          router.refresh();
        } : undefined
      });
      router.refresh();
    } catch (error) {
      showToast(error instanceof TypeError ? "批次封存連線失敗" : error instanceof Error ? error.message : "批次封存失敗", "error");
    } finally { setBusy(null); }
  }

  return <>
    <div className="pill-group" role="group" aria-label="匯出狀態">
      <button type="button" className={`pill-btn${!exported ? " active" : ""}`} onClick={() => setExported(false)}>待匯出 {current.filter((p) => !p.gpt_exported_at).length}</button>
      <button type="button" className={`pill-btn${exported ? " active" : ""}`} onClick={() => setExported(true)}>已匯出 {current.filter((p) => p.gpt_exported_at).length}</button>
    </div>
    <div className="rc-batch-strip">
      <label className="rc-header-select-all">
        <input type="checkbox" aria-label="全選目前列表" disabled={Boolean(busy) || !rows.length}
          checked={rows.length > 0 && ids.length === rows.length}
          ref={(el) => { if (el) el.indeterminate = ids.length > 0 && ids.length < rows.length; }}
          onChange={() => setSelected(ids.length === rows.length ? new Set() : new Set(rows.map((p) => p.id)))} />
        <span>{ids.length ? `已選 ${ids.length} 筆` : "勾選商品以匯出"}</span>
      </label>
      <div className="rc-batch-actions batch-actions">
        <Button type="button" size="sm" variant="primary" disabled={Boolean(busy) || !ids.length} onClick={() => void exportCsv()}>{busy === "export" ? "匯出中…" : `⬇ ${exported ? "重新匯出" : "匯出原始 CSV"}（${ids.length}）`}</Button>
        <Button type="button" size="sm" disabled={Boolean(busy) || !ids.length} onClick={() => void archive()}>封存</Button>
      </div>
    </div>
    {!rows.length ? <div className="empty-state"><p className="empty-state-desc">{exported ? "還沒有匯出過。" : "沒有待匯出的商品。左邊選「交給 GPT」再送出，就會出現在這裡。"}</p></div> : rows.map((p) => {
      const image = [...(p.product_images ?? [])].filter((i) => i.image_type === "main").sort((a, b) => a.sort_order - b.sort_order)[0];
      const imageUrl = image?.processed_file_url || image?.original_file_url;
      const variants = p.product_variants ?? [];
      const costs = (variants.length ? variants.map((v) => v.cny_price) : [p.cny_price]).filter((v): v is number => typeof v === "number" && v > 0.01);
      const min = Math.min(...costs), max = Math.max(...costs);
      const title = p.original_title || p.taobao_title || "";
      const warnings = gptPriceWarningsFromCosts(
        p.server_price_confidence ?? p.client_price_confidence,
        p.cny_price,
        variants.map((v) => v.cny_price)
      );
      return <div className="lib-row" key={p.id}>
        <input type="checkbox" aria-label={`選取 ${title}`} checked={selected.has(p.id)} disabled={Boolean(busy)} onChange={() => setSelected((prev) => { const next = new Set(prev); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })} />
        {imageUrl ? <img className="lib-thumb" style={{ width: 48, height: 48 }} src={imageUrl} alt="" /> : <span className="lib-thumb lib-thumb--empty" style={{ width: 48, height: 48 }}>—</span>}
        <div className="lib-body">
          <div className="lib-title" style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.source_url ? <a href={p.source_url} target="_blank" rel="noopener noreferrer">{title}</a> : title}</div>
          <div className="lib-meta"><span className="lib-meta-text">{p.source_platform} · {variants.length} 款 · {costs.length ? `成本 ¥${min}${min === max ? "" : `–¥${max}`}` : "成本未抓到"} · 送出 {timestamp(p.gpt_handoff_at)}{p.gpt_exported_at ? ` · 已匯出 ${timestamp(p.gpt_exported_at)}` : ""}</span>
            {warnings ? <span className="schip schip--warn" style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere" }}>{warnings}</span> : null}
          </div>
        </div>
        <div className="lib-actions"><a className="mini-btn" href={`/drafts/new?draft=${p.id}`}>回輸入區</a></div>
      </div>;
    })}
  </>;
}
