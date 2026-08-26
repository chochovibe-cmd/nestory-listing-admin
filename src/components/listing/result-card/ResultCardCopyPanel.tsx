"use client";

import { Button } from "@/components/ui/Button";
import {
  APPROVED_STATUSES,
  CopyPreviewBlock,
  FieldVersionHeader,
  PROVIDER_LABELS,
  type DiscardArm
} from "@/components/listing/result-card/resultCardUi";
import { descriptionPreviewHtml } from "@/lib/contentGenerator/htmlFormat";
import type { CopyVersionField, VersionEntry } from "@/lib/drafts/copyVersionHistory";
import type { PriceMode, ProductDraft } from "@/types/domain";

/** S2: 文案分頁 — 從 ResultCard 展開區拆出。 */
export function ResultCardCopyPanel({
  draft,
  priceMode,
  characterChipWarned,
  detectTypeLabel,
  sku,
  detectedCategory,
  missingCharacters,
  quickAddingCharacter,
  regenerating,
  regeneratingField,
  comboSaving,
  historyLoaded,
  versionsByField,
  versionIndex,
  displayByField,
  copyDirty,
  discardArm,
  title,
  whyWeChoseIt,
  productHighlights,
  description,
  descriptionView,
  faq,
  faqView,
  specText,
  onSpecTextChange,
  onDetectedCategoryChange,
  onSkuChange,
  onQuickAddCharacter,
  onSwitchVersion,
  onRegenField,
  onSetFieldDisplay,
  onDescriptionViewChange,
  onFaqViewChange,
  onSaveCombo
}: {
  draft: ProductDraft;
  priceMode: PriceMode;
  characterChipWarned: boolean;
  detectTypeLabel: string;
  sku: string;
  detectedCategory: string;
  missingCharacters: string[];
  quickAddingCharacter: string | null;
  regenerating: boolean;
  regeneratingField: CopyVersionField | null;
  comboSaving: boolean;
  historyLoaded: boolean;
  versionsByField: Record<CopyVersionField, VersionEntry[]>;
  versionIndex: Record<CopyVersionField, number>;
  displayByField: Record<CopyVersionField, string>;
  copyDirty: Partial<Record<CopyVersionField, boolean>>;
  discardArm: DiscardArm;
  title: string;
  whyWeChoseIt: string;
  productHighlights: string;
  description: string;
  descriptionView: "preview" | "source";
  faq: string;
  faqView: "preview" | "html";
  /** UX-PKG5: local editable mid-field (not CopyVersionField). */
  specText: string;
  onSpecTextChange: (value: string) => void;
  onDetectedCategoryChange: (value: string) => void;
  onSkuChange: (value: string) => void;
  onQuickAddCharacter: (name: string) => void;
  onSwitchVersion: (field: CopyVersionField, nextIndex: number) => void;
  onRegenField: (field: CopyVersionField) => void;
  onSetFieldDisplay: (field: CopyVersionField, value: string, dirty: boolean) => void;
  onDescriptionViewChange: (view: "preview" | "source") => void;
  onFaqViewChange: (view: "preview" | "html") => void;
  onSaveCombo: () => void;
}) {
  const fieldBusy = regeneratingField != null || regenerating || comboSaving;

  return (
    <div className="rc-tabpanel rc-tabpanel--copy" role="tabpanel">
      <div className="rc-tabpanel-grid">
        <div className="rc-field rc-span-2">
          <div className="rc-label">快速狀態</div>
          <div className="rc-text">
            {APPROVED_STATUSES.has(draft.status) ? (
              <span className="audit-badge ok">已審核</span>
            ) : (
              <span className="audit-badge">待審核</span>
            )}
            　來源：{draft.source_platform ?? "-"}
            　成本：{draft.cny_price.toLocaleString()}
            　模式：{priceMode === "single" ? "單一售價" : "特價"}
            　定價：
            {priceMode === "single"
              ? "不適用"
              : draft.compare_at_price
                ? `NT$${draft.compare_at_price.toLocaleString()}`
                : "未填"}
            　AI：{PROVIDER_LABELS[draft.generation_provider] ?? draft.generation_provider}
          </div>
        </div>
        <div className="rc-field">
          <div className="rc-label">原始標題</div>
          <div className="muted">{draft.taobao_title ?? draft.original_title ?? "-"}</div>
        </div>

        <div className="rc-field">
          <div className="rc-label">AI 偵測</div>
          <div className="rc-text">
            IP：{draft.ip_name || "—"}
            ｜角色：{draft.character_name || "—"}
            {characterChipWarned ? " ⚠" : ""}
            ｜型態：{detectTypeLabel || "—"}
            ｜SKU：{sku || "—"}
          </div>
          {missingCharacters.length > 0 ? (
            <div className="rc-quick-add-list">
              {missingCharacters.map((name) => (
                <div className="rc-quick-add-row" key={name}>
                  <span className="price-soft-warn">
                    ⚠ 角色「{name}」尚未建檔
                    {!draft.ip_name ? "（請先確認 IP 已建檔）" : ""}
                  </span>
                  <Button
                    size="sm"
                    disabled={
                      !draft.ip_name ||
                      quickAddingCharacter === name ||
                      regenerating ||
                      regeneratingField != null
                    }
                    onClick={() => onQuickAddCharacter(name)}
                    type="button"
                  >
                    {quickAddingCharacter === name ? "新增中…" : "一鍵新增角色"}
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
        <div className="row rc-span-2">
          <div className="field">
            <label>AI 偵測類型</label>
            <input
              className="edit-input"
              onChange={(event) => onDetectedCategoryChange(event.target.value)}
              value={detectedCategory}
            />
          </div>
          <div className="field">
            <label>SKU</label>
            <input
              className="edit-input"
              onChange={(event) => onSkuChange(event.target.value)}
              value={sku}
            />
          </div>
        </div>

        {!historyLoaded ? <div className="muted rc-span-2">載入版本歷史…</div> : null}

        <div className="rc-copy-group rc-span-2">
          <div className="rc-copy-group-title">標題與賣點</div>
          <p className="rc-copy-group-dest muted">→ 標題／賣點 metafield</p>
        </div>
        <div className="field">
          <FieldVersionHeader
            discardArm={discardArm}
            displayValue={displayByField.enriched_title}
            field="enriched_title"
            fieldBusy={fieldBusy}
            isDirty={Boolean(copyDirty.enriched_title)}
            onRegen={onRegenField}
            onSwitchVersion={onSwitchVersion}
            regeneratingField={regeneratingField}
            versionIndex={versionIndex.enriched_title ?? 0}
            versions={versionsByField.enriched_title}
          />
          <input
            className="edit-input"
            onChange={(event) => onSetFieldDisplay("enriched_title", event.target.value, true)}
            value={title}
          />
        </div>
        <div className="field">
          <FieldVersionHeader
            discardArm={discardArm}
            displayValue={displayByField.why_we_chose_it}
            field="why_we_chose_it"
            fieldBusy={fieldBusy}
            isDirty={Boolean(copyDirty.why_we_chose_it)}
            onRegen={onRegenField}
            onSwitchVersion={onSwitchVersion}
            regeneratingField={regeneratingField}
            versionIndex={versionIndex.why_we_chose_it ?? 0}
            versions={versionsByField.why_we_chose_it}
          />
          <textarea
            className="edit-textarea"
            onChange={(event) => onSetFieldDisplay("why_we_chose_it", event.target.value, true)}
            rows={3}
            value={whyWeChoseIt}
          />
        </div>
        <div className="field rc-span-2">
          <FieldVersionHeader
            discardArm={discardArm}
            displayValue={displayByField.product_highlights}
            field="product_highlights"
            fieldBusy={fieldBusy}
            isDirty={Boolean(copyDirty.product_highlights)}
            onRegen={onRegenField}
            onSwitchVersion={onSwitchVersion}
            regeneratingField={regeneratingField}
            versionIndex={versionIndex.product_highlights ?? 0}
            versions={versionsByField.product_highlights}
          />
          <textarea
            className="edit-textarea"
            onChange={(event) => onSetFieldDisplay("product_highlights", event.target.value, true)}
            placeholder="每點一行（可加・）"
            rows={4}
            value={productHighlights}
          />
        </div>

        <div className="rc-copy-group rc-span-2">
          <div className="rc-copy-group-title">上架描述</div>
          <p className="rc-copy-group-dest muted">→ 商品介紹內文</p>
        </div>
        <div className="field rc-span-2">
          <div className="rc-view-tabs">
            <FieldVersionHeader
              discardArm={discardArm}
              displayValue={displayByField.generated_description_html}
              field="generated_description_html"
              fieldBusy={fieldBusy}
              isDirty={Boolean(copyDirty.generated_description_html)}
              onRegen={onRegenField}
              onSwitchVersion={onSwitchVersion}
              regeneratingField={regeneratingField}
              versionIndex={versionIndex.generated_description_html ?? 0}
              versions={versionsByField.generated_description_html}
            />
          </div>
          <div className="rc-view-tabs" style={{ marginBottom: 6 }}>
            <span className="rc-view-tabs-buttons">
              <button
                className={descriptionView === "preview" ? "active" : ""}
                onClick={() => onDescriptionViewChange("preview")}
                type="button"
              >
                預覽
              </button>
              <button
                className={descriptionView === "source" ? "active" : ""}
                onClick={() => onDescriptionViewChange("source")}
                type="button"
              >
                純文字
              </button>
            </span>
          </div>
          {descriptionView === "preview" ? (
            <CopyPreviewBlock
              html={descriptionPreviewHtml(description, draft.generation_tone, draft.sale_status)}
            />
          ) : (
            <textarea
              className="edit-textarea"
              onChange={(event) =>
                onSetFieldDisplay("generated_description_html", event.target.value, true)
              }
              rows={10}
              value={description}
            />
          )}
        </div>

        <div className="rc-copy-group rc-span-2">
          <div className="rc-copy-group-title">規格中繼</div>
          <p className="rc-copy-group-dest muted">→ Shopify 規格／給 D 段</p>
        </div>
        <div className="rc-field rc-span-2">
          <div className="rc-label">商品規格</div>
          <textarea
            className="edit-textarea"
            onChange={(event) => onSpecTextChange(event.target.value)}
            placeholder="（空）可手填材質、尺寸、包裝內容等"
            rows={4}
            value={specText}
          />
        </div>

        <div className="rc-copy-group rc-span-2">
          <div className="rc-copy-group-title">FAQ</div>
          <p className="rc-copy-group-dest muted">→ FAQ metafield</p>
        </div>
        <div className="field rc-span-2">
          <div className="rc-view-tabs">
            <FieldVersionHeader
              discardArm={discardArm}
              displayValue={displayByField.generated_faq_html}
              field="generated_faq_html"
              fieldBusy={fieldBusy}
              isDirty={Boolean(copyDirty.generated_faq_html)}
              onRegen={onRegenField}
              onSwitchVersion={onSwitchVersion}
              regeneratingField={regeneratingField}
              versionIndex={versionIndex.generated_faq_html ?? 0}
              versions={versionsByField.generated_faq_html}
            />
          </div>
          <div className="rc-view-tabs" style={{ marginBottom: 6 }}>
            <span className="rc-view-tabs-buttons">
              <button
                className={faqView === "preview" ? "active" : ""}
                onClick={() => onFaqViewChange("preview")}
                type="button"
              >
                預覽
              </button>
              <button
                className={faqView === "html" ? "active" : ""}
                onClick={() => onFaqViewChange("html")}
                type="button"
              >
                純文字
              </button>
            </span>
          </div>
          {faqView === "preview" ? (
            <CopyPreviewBlock html={faq || "<p>尚無內容</p>"} />
          ) : (
            <textarea
              className="edit-textarea"
              onChange={(event) => onSetFieldDisplay("generated_faq_html", event.target.value, true)}
              rows={6}
              value={faq}
            />
          )}
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
