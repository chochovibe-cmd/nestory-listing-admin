"use client";

import {
  FieldVersionHeader,
  type DiscardArm
} from "@/components/listing/result-card/resultCardUi";
import type { CopyVersionField, VersionEntry } from "@/lib/drafts/copyVersionHistory";

const HANDLE_MAX_LENGTH = 80;

function handleFormatWarning(handle: string): string | null {
  const value = handle.trim();
  if (!value) return null;
  if (value.length > HANDLE_MAX_LENGTH) {
    return `網址 Handle 過長（${value.length}/${HANDLE_MAX_LENGTH}）`;
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    return "網址 Handle 請只用小寫英文字母、數字與連字號（-）";
  }
  return null;
}

/** S2 / SEO Panel V2-A: SEO copy + Google preview + Shopify Handle workbench. */
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
  shopifyHandle,
  autoShopifyHandle,
  shopifyStoreDomain,
  hasRealShopifyProduct,
  handleDuplicateWarning,
  onSwitchVersion,
  onRegenField,
  onSetFieldDisplay,
  onShopifyHandleChange,
  onShopifyHandleBlur,
  onRestoreAutoHandle,
  onSaveSeoPanel
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
  shopifyHandle: string;
  autoShopifyHandle: string;
  shopifyStoreDomain: string | null;
  hasRealShopifyProduct: boolean;
  handleDuplicateWarning: string | null;
  onSwitchVersion: (field: CopyVersionField, nextIndex: number) => void;
  onRegenField: (field: CopyVersionField) => void;
  onSetFieldDisplay: (field: CopyVersionField, value: string, dirty: boolean) => void;
  onShopifyHandleChange: (value: string) => void;
  onShopifyHandleBlur: () => void;
  onRestoreAutoHandle: () => void;
  onSaveSeoPanel: () => void;
}) {
  const fieldBusy = regeneratingField != null || regenerating || comboSaving;
  const normalizedHandle = shopifyHandle.trim();
  const formatWarning = handleFormatWarning(normalizedHandle);
  const handleWarning = formatWarning ?? handleDuplicateWarning;
  const previewTitle = seoTitle.trim() || "商品 SEO 標題預覽";
  const previewDescription =
    seoDescription.trim() || "Meta Description 會顯示在這裡，方便上架前直接確認搜尋結果的樣子。";
  const previewDomain = (shopifyStoreDomain || "chochonest.com")
    .replace(/^https?:\/\//i, "")
    .replace(/\/$/, "");
  const previewPath = `/products/${normalizedHandle || "product-handle"}`;
  const handleChanged = normalizedHandle !== autoShopifyHandle.trim();

  return (
    <div className="rc-tabpanel" role="tabpanel">
      <div className="rc-tabpanel-grid">
        {!historyLoaded ? <div className="muted rc-span-2">載入版本歷史…</div> : null}

        <section
          className="rc-span-2"
          aria-label="Google 搜尋結果預覽"
          style={{
            border: "1px solid rgba(0,0,0,0.10)",
            borderRadius: 14,
            padding: 16,
            background: "#fff"
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 12
            }}
          >
            <strong style={{ fontSize: 13 }}>Google 搜尋結果預覽</strong>
            <span className="muted" style={{ fontSize: 11 }}>即時預覽</span>
          </div>
          <div style={{ fontSize: 12, color: "#1f6f43", overflowWrap: "anywhere" }}>
            {previewDomain}{previewPath}
          </div>
          <div
            style={{
              color: "#1a0dab",
              fontSize: 19,
              lineHeight: 1.3,
              marginTop: 5,
              overflowWrap: "anywhere"
            }}
          >
            {previewTitle}
          </div>
          <div
            style={{
              color: "#4d5156",
              fontSize: 13,
              lineHeight: 1.55,
              marginTop: 6,
              whiteSpace: "pre-wrap"
            }}
          >
            {previewDescription}
          </div>
        </section>

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

        <div className="field rc-span-2">
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: 6
            }}
          >
            <label htmlFor="shopify-handle">Shopify Handle（商品網址）</label>
            <button
              className="btn-link"
              disabled={!autoShopifyHandle.trim() || comboSaving}
              onClick={onRestoreAutoHandle}
              type="button"
            >
              還原自動建議
            </button>
          </div>

          <div
            style={{
              alignItems: "stretch",
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr)",
              gap: 6
            }}
          >
            <div
              className="muted"
              style={{
                border: "1px solid rgba(0,0,0,0.08)",
                borderRadius: 10,
                padding: "9px 10px",
                fontSize: 12,
                overflowWrap: "anywhere"
              }}
            >
              {previewDomain}/products/
            </div>
            <input
              aria-describedby={handleWarning ? "shopify-handle-warning" : undefined}
              aria-invalid={Boolean(handleWarning)}
              autoCapitalize="none"
              autoComplete="off"
              className="edit-input"
              id="shopify-handle"
              onBlur={onShopifyHandleBlur}
              onChange={(event) => onShopifyHandleChange(event.target.value)}
              placeholder="自動產生，不必手動填"
              spellCheck={false}
              value={shopifyHandle}
            />
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              marginTop: 6,
              fontSize: 11
            }}
          >
            <span className={handleWarning ? "price-soft-warn" : "muted"} id="shopify-handle-warning">
              {handleWarning || "平常維持自動即可；只有需要調整網址時再手動修改。"}
            </span>
            <span className="muted">{normalizedHandle.length}/{HANDLE_MAX_LENGTH}</span>
          </div>

          {hasRealShopifyProduct && handleChanged ? (
            <p className="muted" style={{ fontSize: 11, marginTop: 8 }}>
              已連結 Shopify 的商品改網址後，後續同步會沿用既有的舊網址轉址保護。
            </p>
          ) : null}
        </div>

        <button
          className="btn-save-version rc-span-2"
          disabled={comboSaving || regenerating || regeneratingField != null}
          onClick={onSaveSeoPanel}
          type="button"
        >
          {comboSaving ? "儲存中…" : "✅ 儲存 SEO 設定"}
        </button>
      </div>
    </div>
  );
}
