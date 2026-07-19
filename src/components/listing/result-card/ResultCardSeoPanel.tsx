"use client";

import {
  FieldVersionHeader,
  type DiscardArm
} from "@/components/listing/result-card/resultCardUi";
import type { CopyVersionField, VersionEntry } from "@/lib/drafts/copyVersionHistory";

/** S2: SEO 分頁 — 從 ResultCard 展開區拆出。 */
export function ResultCardSeoPanel({
  historyLoaded,
  versionsByField,
  versionIndex,
  displayByField,
  copyDirty,
  discardArm,
  regeneratingField,
  regenerating,
  comboSaving,
  seoTitle,
  seoDescription,
  onSwitchVersion,
  onRegenField,
  onSetFieldDisplay,
  onSaveCombo
}: {
  historyLoaded: boolean;
  versionsByField: Record<CopyVersionField, VersionEntry[]>;
  versionIndex: Record<CopyVersionField, number>;
  displayByField: Record<CopyVersionField, string>;
  copyDirty: Partial<Record<CopyVersionField, boolean>>;
  discardArm: DiscardArm;
  regeneratingField: CopyVersionField | null;
  regenerating: boolean;
  comboSaving: boolean;
  seoTitle: string;
  seoDescription: string;
  onSwitchVersion: (field: CopyVersionField, nextIndex: number) => void;
  onRegenField: (field: CopyVersionField) => void;
  onSetFieldDisplay: (field: CopyVersionField, value: string, dirty: boolean) => void;
  onSaveCombo: () => void;
}) {
  const fieldBusy = regeneratingField != null || regenerating || comboSaving;

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-tabpanel-grid">
        {!historyLoaded ? <div className="muted rc-span-2">載入版本歷史…</div> : null}
        <div className="field">
          <FieldVersionHeader
            discardArm={discardArm}
            displayValue={displayByField.seo_title}
            field="seo_title"
            fieldBusy={fieldBusy}
            isDirty={Boolean(copyDirty.seo_title)}
            onRegen={onRegenField}
            onSwitchVersion={onSwitchVersion}
            regeneratingField={regeneratingField}
            versionIndex={versionIndex.seo_title ?? 0}
            versions={versionsByField.seo_title}
          />
          <input
            className="edit-input"
            onChange={(event) => onSetFieldDisplay("seo_title", event.target.value, true)}
            value={seoTitle}
          />
        </div>
        <div className="field">
          <FieldVersionHeader
            discardArm={discardArm}
            displayValue={displayByField.meta_description}
            field="meta_description"
            fieldBusy={fieldBusy}
            isDirty={Boolean(copyDirty.meta_description)}
            onRegen={onRegenField}
            onSwitchVersion={onSwitchVersion}
            regeneratingField={regeneratingField}
            versionIndex={versionIndex.meta_description ?? 0}
            versions={versionsByField.meta_description}
          />
          <textarea
            className="edit-textarea"
            onChange={(event) => onSetFieldDisplay("meta_description", event.target.value, true)}
            rows={4}
            value={seoDescription}
          />
        </div>
        <button
          className="btn-save-version rc-span-2"
          disabled={comboSaving || regenerating || regeneratingField != null}
          onClick={onSaveCombo}
          type="button"
        >
          {comboSaving ? "儲存中…" : "✅ 確認儲存此版本組合"}
        </button>
      </div>
    </div>
  );
}
