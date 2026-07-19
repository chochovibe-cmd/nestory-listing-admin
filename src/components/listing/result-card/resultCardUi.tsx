"use client";

import { useState } from "react";
import {
  COPY_VERSION_FIELD_LABELS,
  type CopyVersionField,
  versionLabel,
  type VersionEntry
} from "@/lib/drafts/copyVersionHistory";

/** UX-L T61: discard-edit arm (independent from actionArm review/revision/return). */
export type DiscardArm =
  | null
  | { kind: "switch"; field: CopyVersionField; nextIndex: number }
  | { kind: "regen"; field: CopyVersionField }
  | { kind: "collapse" };

export const APPROVED_STATUSES = new Set([
  "approved",
  "publishing",
  "draft_created",
  "active_published"
]);

export const PROVIDER_LABELS: Record<string, string> = {
  anthropic: "Claude",
  openai: "GPT",
  codex: "Codex",
  other: "其他"
};

export function CopyButton({ getValue }: { getValue: () => string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    const value = getValue();
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button className={`copy-btn${copied ? " copied" : ""}`} onClick={handleCopy} type="button">
      {copied ? "✓" : "複製"}
    </button>
  );
}

/** B10: ← 版本 N/M → 重生 — version switch is local-only; 重生 spends LLM. */
/** UX-L T61: optional arm labels for discard double-confirm (no window.confirm). */
export function VersionNav({
  label,
  canPrev,
  canNext,
  onPrev,
  onNext,
  onRegen,
  regenBusy,
  regenDisabled,
  switchArmDir = null,
  regenArmed = false
}: {
  label: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onRegen: () => void;
  regenBusy: boolean;
  regenDisabled: boolean;
  switchArmDir?: "prev" | "next" | null;
  regenArmed?: boolean;
}) {
  return (
    <span className="version-nav" onClick={(event) => event.stopPropagation()}>
      <button
        aria-label={switchArmDir === "prev" ? "再點確認切到上一版" : "上一版"}
        className={`version-nav-btn${switchArmDir === "prev" ? " danger" : ""}`}
        disabled={!canPrev || regenBusy}
        onClick={onPrev}
        title={switchArmDir === "prev" ? "再點一次確認切換（會捨棄未存修改）" : undefined}
        type="button"
      >
        {switchArmDir === "prev" ? "⚠" : "←"}
      </button>
      <span className="version-nav-label">{label}</span>
      <button
        aria-label={switchArmDir === "next" ? "再點確認切到下一版" : "下一版"}
        className={`version-nav-btn${switchArmDir === "next" ? " danger" : ""}`}
        disabled={!canNext || regenBusy}
        onClick={onNext}
        title={switchArmDir === "next" ? "再點一次確認切換（會捨棄未存修改）" : undefined}
        type="button"
      >
        {switchArmDir === "next" ? "⚠" : "→"}
      </button>
      <button
        aria-label="只重生此欄"
        className={`version-nav-btn version-nav-regen${regenArmed ? " danger" : ""}`}
        disabled={regenDisabled || regenBusy}
        onClick={onRegen}
        title={
          regenArmed
            ? "再點一次確認：以畫面文字重生，未定案會捨棄"
            : "只重生此欄（會呼叫 AI，需花費）"
        }
        type="button"
      >
        {regenBusy ? "重生中" : regenArmed ? "⚠ 確認重生" : "重生"}
      </button>
    </span>
  );
}

/** T26: 描述／FAQ 預覽預設限高，可展開全文；local state 不寫 localStorage */
export function CopyPreviewBlock({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className={`rc-copy-preview${expanded ? " is-expanded" : ""}`}>
      <div
        className="rc-html-preview rc-copy-preview-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <button
        className="mini-btn rc-copy-preview-toggle"
        onClick={() => setExpanded((v) => !v)}
        type="button"
      >
        {expanded ? "收合" : "展開全文"}
      </button>
    </div>
  );
}

/** Shared version header for copy / SEO fields (S2 extract). */
export function FieldVersionHeader({
  field,
  versions,
  versionIndex,
  displayValue,
  isDirty,
  discardArm,
  regeneratingField,
  fieldBusy,
  onSwitchVersion,
  onRegen
}: {
  field: CopyVersionField;
  versions: VersionEntry[];
  versionIndex: number;
  displayValue: string;
  isDirty: boolean;
  discardArm: DiscardArm;
  regeneratingField: CopyVersionField | null;
  fieldBusy: boolean;
  onSwitchVersion: (field: CopyVersionField, nextIndex: number) => void;
  onRegen: (field: CopyVersionField) => void;
}) {
  const idx = Math.min(versionIndex, Math.max(versions.length - 1, 0));
  const switchArmDir: "prev" | "next" | null =
    discardArm?.kind === "switch" && discardArm.field === field
      ? discardArm.nextIndex < idx
        ? "prev"
        : discardArm.nextIndex > idx
          ? "next"
          : null
      : null;
  const regenArmed = discardArm?.kind === "regen" && discardArm.field === field;

  return (
    <div className="rc-field-hdr">
      <span className="rc-field-hdr-label">
        {COPY_VERSION_FIELD_LABELS[field]}
        <CopyButton getValue={() => displayValue} />
        {isDirty ? <span className="version-dirty-dot" title="未定案修改">·</span> : null}
      </span>
      <VersionNav
        canNext={idx < versions.length - 1}
        canPrev={idx > 0}
        label={versionLabel(idx, versions)}
        onNext={() => onSwitchVersion(field, idx + 1)}
        onPrev={() => onSwitchVersion(field, idx - 1)}
        onRegen={() => onRegen(field)}
        regenArmed={regenArmed}
        regenBusy={regeneratingField === field}
        regenDisabled={fieldBusy && regeneratingField !== field}
        switchArmDir={switchArmDir}
      />
    </div>
  );
}
