"use client";

import Link from "next/link";
import {
  factoryBridgeChipMeta,
  factoryBridgeHref,
  formatFactoryBridgeSummaryLine,
  type FactoryBridgeItem,
  type FactoryBridgeSummary,
} from "@/lib/images/factoryBridge";

/**
 * UX-F T29: 生圖工廠 bridge strip under station pills.
 * Preview + jump only — not a 4th station; hide when empty.
 */
export function FactoryBridgeStrip({
  summary,
  maxCards = 8,
}: {
  summary: FactoryBridgeSummary;
  maxCards?: number;
}) {
  if (summary.items.length === 0) return null;

  const summaryLine = formatFactoryBridgeSummaryLine(summary);
  const ctaHref =
    summary.pendingReview > 0
      ? factoryBridgeHref("pending_review")
      : factoryBridgeHref();
  const cards = summary.items.slice(0, maxCards);

  return (
    <div className="factory-bridge" role="region" aria-label="生圖工廠橋接">
      <div className="factory-bridge-head">
        <div className="factory-bridge-title-row">
          <span className="factory-bridge-title">🏭 生圖工廠</span>
          {summaryLine ? (
            <span className="factory-bridge-summary muted">{summaryLine}</span>
          ) : null}
        </div>
        <Link className="factory-bridge-cta mini-btn" href={ctaHref}>
          打開工廠 →
        </Link>
      </div>
      <div className="factory-bridge-cards">
        {cards.map((item) => (
          <FactoryMiniCard item={item} key={item.draftId} />
        ))}
      </div>
      {summary.items.length > maxCards ? (
        <p className="factory-bridge-more muted">
          另有 {summary.items.length - maxCards} 件，請到工廠查看
        </p>
      ) : null}
    </div>
  );
}

function FactoryMiniCard({ item }: { item: FactoryBridgeItem }) {
  const chip = factoryBridgeChipMeta(item.kind);
  const href = factoryBridgeHref(item.kind, item.draftId);
  return (
    <Link className="factory-mini-card" href={href} title={item.title}>
      <div className="factory-mini-thumb">
        {item.thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" src={item.thumbUrl} />
        ) : (
          <span className="factory-mini-placeholder" aria-hidden>
            🖼
          </span>
        )}
      </div>
      <div className="factory-mini-meta">
        <span className="factory-mini-title">{item.title}</span>
        <span className={chip.className}>{chip.label}</span>
      </div>
    </Link>
  );
}
