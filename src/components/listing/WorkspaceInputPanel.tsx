"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { calculatePrice, CostCurrency, defaultPricingSettings, PricingSettings } from "@/lib/pricing";
import { getStoredPricingSettings, setStoredPricingSettings } from "@/lib/pricingSettingsStore";
import { SALE_STATUS_OPTIONS } from "@/lib/saleStatus";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { ImageUploader } from "@/components/listing/ImageUploader";
import {
  GENERATION_PROGRESS_EVENT,
  GENERATION_STEP_LABELS,
  type GenerationProgress,
  type StepStatus
} from "@/components/listing/generationProgress";
import { createClient } from "@/lib/supabase/client";
import type { SaleStatus } from "@/types/domain";

const TONE_OPTIONS = [
  { value: "黑膠文藝收藏感", emoji: "🎙️", desc: "像懂收藏的選物店，沉穩、有故事感" },
  { value: "日系選物店溫柔感", emoji: "🌸", desc: "溫柔清楚，適合同事快速審稿" },
  { value: "可愛周邊輕鬆感", emoji: "🧸", desc: "可愛但不浮誇，適合小物與周邊" }
] as const;

const LENGTH_OPTIONS = ["精簡", "標準", "詳細"] as const;
const SOURCE_OPTIONS = ["淘寶", "閑魚", "蝦皮"] as const;

type VariantRow = { name: string; sku: string; price: string; qty: string };

// B1: 生成四步驟進度卡. The panel (left) drives the card, DraftResultsPanel
// (right) renders it, bridged by a window event (see generationProgress.ts) --
// same cross-component pattern the pricing settings already use
// (nestory:pricing-settings-changed). Steps map honestly onto our two real
// network phases (analyze-images then generate); we do NOT fake a streaming
// animation (that waits for A20).
function emitProgress(model: GenerationProgress) {
  window.dispatchEvent(new CustomEvent<GenerationProgress>(GENERATION_PROGRESS_EVENT, { detail: model }));
}

export function WorkspaceInputPanel({ userId }: { userId: string }) {
  const router = useRouter();
  const supabase = createClient();

  // The draft is created lazily -- either when the operator drops the first
  // image (background upload needs a draft_id) or, if they never add an image,
  // when they press 生成. draftIdRef mirrors the state so ensureDraftId can read
  // it without stale-closure issues across concurrent image drops.
  const [draftId, setDraftId] = useState<string | null>(null);
  const draftIdRef = useRef<string | null>(null);
  const ensureDraftPromiseRef = useRef<Promise<string | null> | null>(null);
  const uploadPromisesRef = useRef<Promise<unknown>[]>([]);
  const [imagesUploading, setImagesUploading] = useState(false);
  // Remounting ImageUploader after a successful generate clears its previews.
  const [formKey, setFormKey] = useState(0);

  const [title, setTitle] = useState("");
  const [source, setSource] = useState<(typeof SOURCE_OPTIONS)[number]>(SOURCE_OPTIONS[0]);
  const [price, setPrice] = useState("");
  const [costCurrency, setCostCurrency] = useState<CostCurrency>("CNY");
  const [taobaoUrl, setTaobaoUrl] = useState("");
  const [note, setNote] = useState("");
  const [variants, setVariants] = useState<VariantRow[]>([]);
  const [saleStatus, setSaleStatus] = useState<SaleStatus>(SALE_STATUS_OPTIONS[0]);
  const [tone, setTone] = useState<(typeof TONE_OPTIONS)[number]["value"]>(TONE_OPTIONS[0].value);
  const [copyLength, setCopyLength] = useState<(typeof LENGTH_OPTIONS)[number]>("標準");
  const [manualPricingEnabled, setManualPricingEnabled] = useState(false);
  const [manualCompareAtPrice, setManualCompareAtPrice] = useState("");
  const [manualSellPrice, setManualSellPrice] = useState("");
  const [useWebSearch, setUseWebSearch] = useState(false);
  const [taobaoUrlOpen, setTaobaoUrlOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(defaultPricingSettings);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ title?: boolean; price?: boolean }>({});
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPricingSettings(getStoredPricingSettings());
    function onChange(event: Event) {
      const detail = (event as CustomEvent<PricingSettings>).detail;
      if (detail) setPricingSettings(detail);
    }
    window.addEventListener("nestory:pricing-settings-changed", onChange);
    return () => window.removeEventListener("nestory:pricing-settings-changed", onChange);
  }, []);

  function updatePricingSetting(key: keyof PricingSettings, value: number) {
    if (Number.isNaN(value)) return;
    setStoredPricingSettings({ [key]: value });
  }

  const parsedPrice = Number(price || 0);
  const parsedPriceRef = useRef(0);
  parsedPriceRef.current = parsedPrice;
  const pricing = parsedPrice > 0
    ? calculatePrice(parsedPrice, {
        settings: pricingSettings,
        currency: costCurrency,
        manualPricing: {
          enabled: manualPricingEnabled,
          sellPrice: Number(manualSellPrice || 0) || null,
          compareAtPrice: Number(manualCompareAtPrice || 0) || null
        }
      })
    : null;

  function updateVariant(index: number, patch: Partial<VariantRow>) {
    setVariants((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  // B1: lazily create the draft so image uploads have a draft_id before the
  // form is submitted. Idempotent + concurrency-guarded (two fast drops share
  // one insert). cny_price is NOT NULL/> 0 in the schema, so we seed it with the
  // price typed so far or a 0.01 placeholder that submit() overwrites with the
  // real cost; twd_cost/twd_price stay null until then, so no bogus price ever
  // shows. Status pending_input surfaces the row as 待輸入 (yellow) in the queue
  // if the operator abandons it before generating (see BX4 cleanup note).
  async function ensureDraftId(): Promise<string | null> {
    if (draftIdRef.current) return draftIdRef.current;
    if (ensureDraftPromiseRef.current) return ensureDraftPromiseRef.current;

    const promise = (async () => {
      const seedCny = parsedPriceRef.current > 0 ? parsedPriceRef.current : 0.01;
      const { data, error } = await supabase
        .from("product_drafts")
        .insert({
          taobao_title: title.trim() || null,
          original_title: title.trim() || null,
          cny_price: seedCny,
          sale_status: saleStatus,
          source_platform: source,
          status: "pending_input",
          created_by: userId
        })
        .select("id")
        .single();

      if (error || !data) {
        ensureDraftPromiseRef.current = null;
        setMessage(error?.message ?? "建立草稿失敗");
        return null;
      }

      draftIdRef.current = data.id;
      setDraftId(data.id);
      // Surface the 待輸入 card in the queue while the operator keeps filling.
      router.refresh();
      return data.id;
    })();

    ensureDraftPromiseRef.current = promise;
    return promise;
  }

  // Write the full form fields onto the draft: UPDATE the lazily-created row, or
  // INSERT a fresh one when no image was ever added. Returns the draft id.
  async function persistDraft(): Promise<string | null> {
    const filledVariants = variants.filter((row) => row.name.trim());

    const fields = {
      taobao_title: title.trim(),
      original_title: title.trim(),
      source_url: taobaoUrl.trim() || null,
      taobao_url: taobaoUrl.trim() || null,
      cny_price: parsedPrice,
      twd_cost: pricing?.costTwd,
      twd_price: pricing?.sellPrice,
      compare_at_price: pricing?.compareAtPrice,
      pricing_formula: pricing?.pricingFormula,
      note: note.trim() || null,
      sale_status: saleStatus,
      source_platform: source,
      status: "pending_copy",
      generation_mode: "api_llm" as const,
      generation_provider: "codex" as const,
      generation_status: "pending" as const,
      publish_mode: "active" as const,
      publish_method: "shopify_api" as const,
      publish_status: "pending" as const
    };

    let id: string;
    if (draftIdRef.current) {
      const { error } = await supabase.from("product_drafts").update(fields).eq("id", draftIdRef.current);
      if (error) {
        setMessage(error.message);
        return null;
      }
      id = draftIdRef.current;
    } else {
      const { data, error } = await supabase
        .from("product_drafts")
        .insert({ ...fields, created_by: userId })
        .select("id")
        .single();
      if (error || !data) {
        setMessage(error?.message ?? "建立失敗");
        return null;
      }
      id = data.id;
      draftIdRef.current = id;
      setDraftId(id);
    }

    if (filledVariants.length > 0) {
      await supabase.from("product_variants").insert(
        filledVariants.map((row) => ({
          draft_id: id,
          option1_name: "款式",
          option1_value: row.name.trim(),
          sku: row.sku.trim() || null,
          twd_price: row.price ? Number(row.price) : null,
          inventory_quantity: row.qty ? Number(row.qty) : 0
        }))
      );
    }

    return id;
  }

  // Requirement 4: analyze-images must NEVER block generation. On any failure we
  // return a warning string (surfaced as 黃字 via the draft's warnings) and let
  // generate run without image info, rather than throwing.
  async function analyzeImages(id: string): Promise<string[]> {
    try {
      const response = await fetch("/api/analyze-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftId: id })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        return [
          payload.error
            ? `圖片辨識未完成（已略過圖片資訊繼續生成）：${payload.error}`
            : "圖片辨識未完成，已略過圖片資訊繼續生成。"
        ];
      }
      return Array.isArray(payload.warnings) ? payload.warnings : [];
    } catch {
      return ["圖片辨識連線失敗，已略過圖片資訊繼續生成。"];
    }
  }

  function stepModel(title: string, statuses: StepStatus[], error?: string): GenerationProgress {
    return { visible: true, title, steps: GENERATION_STEP_LABELS.map((label, i) => ({ label, status: statuses[i] })), error };
  }

  function resetForNextItem() {
    // 連續上架 (light): keep 來源/銷售狀態/語氣/長度/Web Search, clear the rest.
    draftIdRef.current = null;
    ensureDraftPromiseRef.current = null;
    uploadPromisesRef.current = [];
    setDraftId(null);
    setImagesUploading(false);
    setFormKey((current) => current + 1);
    setTitle("");
    setPrice("");
    setTaobaoUrl("");
    setNote("");
    setVariants([]);
    setManualPricingEnabled(false);
    setManualCompareAtPrice("");
    setManualSellPrice("");
    setFieldErrors({});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors: { title?: boolean; price?: boolean } = {};
    if (!title.trim()) errors.title = true;
    if (!parsedPrice || parsedPrice <= 0) errors.price = true;

    if (errors.title || errors.price) {
      setFieldErrors(errors);
      setMessage("請輸入商品標題與有效 CNY 價格");
      (errors.title ? titleRef.current : priceRef.current)?.focus();
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    const cardTitle = title.trim().slice(0, 18);

    setMessage("儲存商品草稿中...");
    const id = await persistDraft();
    if (!id) {
      setSubmitting(false);
      emitProgress({ visible: false, title: "", steps: [] });
      return;
    }

    const hasImages = uploadPromisesRef.current.length > 0;

    // Step 1 done, step 2 (image analysis) active.
    emitProgress(stepModel(cardTitle, ["done", hasImages ? "active" : "done", "pending", "pending"]));

    // Wait for any background image uploads to finish before analysis reads them.
    if (hasImages) {
      setMessage("等待圖片上傳完成...");
      await Promise.allSettled(uploadPromisesRef.current);
    }

    let step2: StepStatus = "done";
    const imageWarnings: string[] = [];
    if (hasImages) {
      setMessage("辨識圖片中（Vision／OCR）...");
      const warnings = await analyzeImages(id);
      if (warnings.length > 0) {
        step2 = "warn";
        imageWarnings.push(...warnings);
      }
    }

    // Step 3 (copy generation) active.
    setMessage("生成文案中...");
    emitProgress(stepModel(cardTitle, ["done", step2, "active", "pending"]));

    let response: Response;
    try {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: id,
          provider: readStoredAiProvider(),
          mode: readStoredRunMode(),
          useWebSearch,
          source,
          variantSummary:
            variants
              .filter((row) => row.name.trim())
              .map((row) => `${row.name.trim()}${row.price ? ` 售價${row.price}` : ""}`)
              .join("、") || undefined,
          tone,
          copyLength,
          imageWarnings
        })
      });
    } catch {
      setSubmitting(false);
      setMessage("生成連線失敗，可以到右側卡片按「重新生成」再試一次");
      emitProgress(stepModel(cardTitle, ["done", step2, "error", "pending"], "生成連線失敗"));
      router.refresh();
      return;
    }

    const payload = await response.json().catch(() => ({}));
    setSubmitting(false);

    if (!response.ok) {
      const errorText = payload.error ?? "生成失敗";
      setMessage(errorText + "，可以到右側卡片按「重新生成」再試一次");
      emitProgress(stepModel(cardTitle, ["done", step2, "error", "pending"], errorText));
      router.refresh();
      return;
    }

    // Requirement 5: success -> all steps done. Card auto-clears once the real
    // ResultCard lands via router.refresh (handled in DraftResultsPanel).
    emitProgress(stepModel(cardTitle, ["done", step2, "done", "done"]));

    if (payload.draftState === "blocked") {
      setMessage(
        "AI 判斷資料不足（多半是 IP 未對到建檔清單）：" +
          (payload.validationErrors ?? []).join("；") +
          "。可在右側卡片修正「AI 偵測類型」等欄位後按「重新生成」。"
      );
    } else {
      setMessage("生成完成，右側卡片可繼續編輯文案；表單已清空，可直接填下一筆。");
      resetForNextItem();
    }

    router.refresh();
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>✦ 新增商品</h2>
      </div>
      <div className="panel-body">
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          <div>
            <button className="settings-toggle" onClick={() => setTaobaoUrlOpen((v) => !v)} type="button">
              <span>🔗 淘寶連結（選填，爬蟲尚未啟用）</span><span>{taobaoUrlOpen ? "▴" : "▾"}</span>
            </button>
            {taobaoUrlOpen ? (
              <div style={{ marginTop: 8 }}>
                <input onChange={(e) => setTaobaoUrl(e.target.value)} placeholder="https://..." value={taobaoUrl} />
              </div>
            ) : null}
          </div>

          <div className={`field${fieldErrors.title ? " error" : ""}`}>
            <div className="source-inline">
              <label>原始商品標題</label>
              <div className="inline-pills">
                <select
                  className="source-pill"
                  onChange={(e) => setSource(e.target.value as (typeof SOURCE_OPTIONS)[number])}
                  value={source}
                >
                  {SOURCE_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
                <select
                  className="source-pill"
                  onChange={(e) => setSaleStatus(e.target.value as SaleStatus)}
                  value={saleStatus}
                >
                  {SALE_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>
            <textarea
              onChange={(e) => { setTitle(e.target.value); setFieldErrors((current) => ({ ...current, title: false })); }}
              placeholder="貼上來源商品標題，AI 會整理成 Shopify 商品標題..."
              ref={titleRef}
              rows={2}
              value={title}
            />
            {fieldErrors.title ? <div className="field-msg">請輸入商品標題</div> : null}
          </div>

          {/* B1: 圖片先選＋背景上傳 -- images now live in the form (before 生成), not
              after it. Marking UI stays the current three zones; the Mockup's
              per-thumbnail 規格圖 toggle is B5's scope. */}
          <div className="field">
            <label>商品圖片（拖入即背景上傳）</label>
            <ImageUploader
              ensureDraftId={ensureDraftId}
              key={formKey}
              onUploadingChange={setImagesUploading}
              trackUpload={(promise) => uploadPromisesRef.current.push(promise)}
              userId={userId}
            />
          </div>

          <div className={`field${fieldErrors.price ? " error" : ""}`}>
            <label>成本價格</label>
            <div className="price-row">
              <input
                min="0"
                onChange={(e) => { setPrice(e.target.value); setFieldErrors((current) => ({ ...current, price: false })); }}
                ref={priceRef}
                step="0.01"
                type="number"
                value={price}
              />
              <div className="currency-toggle">
                <button
                  className={costCurrency === "CNY" ? "active" : ""}
                  onClick={() => setCostCurrency("CNY")}
                  type="button"
                >
                  CNY ¥
                </button>
                <button
                  className={costCurrency === "TWD" ? "active" : ""}
                  onClick={() => setCostCurrency("TWD")}
                  type="button"
                >
                  TWD NT$
                </button>
              </div>
            </div>
            {fieldErrors.price ? <div className="field-msg">請輸入有效的成本價格</div> : null}
          </div>

          <div className="manual-pricing">
            <label className="check-row">
              <input
                checked={manualPricingEnabled}
                onChange={(e) => setManualPricingEnabled(e.target.checked)}
                type="checkbox"
              />
              <span>自填台幣定價與售價（不套用公式）</span>
            </label>
            {manualPricingEnabled ? (
              <div className="manual-price-fields open">
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>定價 TWD</label>
                  <input
                    min="0"
                    onChange={(e) => setManualCompareAtPrice(e.target.value)}
                    placeholder="例如 980"
                    step="1"
                    type="number"
                    value={manualCompareAtPrice}
                  />
                </div>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label>售價 TWD</label>
                  <input
                    min="0"
                    onChange={(e) => setManualSellPrice(e.target.value)}
                    placeholder="例如 780"
                    step="1"
                    type="number"
                    value={manualSellPrice}
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="copy-settings-block">
            <div className="copy-block-title"><span>✎</span> AI 文案設定</div>
            <div className="field">
              <label>AI 文案風格</label>
              <div className="tone-cards">
                {TONE_OPTIONS.map((option) => (
                  <button
                    className={`tone-card${tone === option.value ? " active" : ""}`}
                    key={option.value}
                    onClick={() => setTone(option.value)}
                    type="button"
                  >
                    <span className="tone-emoji">{option.emoji}</span>
                    <span>
                      <span className="tone-title">{option.value}</span>
                      <span className="tone-desc">{option.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>文案長度</label>
              <select onChange={(e) => setCopyLength(e.target.value as (typeof LENGTH_OPTIONS)[number])} value={copyLength}>
                {LENGTH_OPTIONS.map((option) => (
                  <option key={option} value={option}>{option}</option>
                ))}
              </select>
            </div>
            <div className="wsearch-row">
              <div className="wsearch-label">
                🔍 Web Search 補充資訊
                <span>冷門 IP、資訊不足或不確定角色名稱時開啟；會多花一些時間</span>
              </div>
              <div className="toggle-wrap">
                <label className="toggle">
                  <input
                    checked={useWebSearch}
                    onChange={(e) => setUseWebSearch(e.target.checked)}
                    type="checkbox"
                  />
                  <span className="toggle-slider" />
                </label>
                <span className="toggle-cost">{useWebSearch ? "+約 10–15 秒" : "+約 5 秒"}</span>
              </div>
            </div>
          </div>

          <div className="variant-box">
            <div className="variant-head">
              <span>款式 Variants（選填）</span>
              <button
                className="btn-mini"
                onClick={() => setVariants((current) => [...current, { name: "", sku: "", price: "", qty: "" }])}
                type="button"
              >
                新增款式
              </button>
            </div>
            {variants.length === 0 ? (
              <div className="variant-empty">單一款式可留空；多款式商品再新增。</div>
            ) : (
              variants.map((row, index) => (
                <div className="variant-row" key={index}>
                  <input onChange={(e) => updateVariant(index, { name: e.target.value })} placeholder="款式名" value={row.name} />
                  <input onChange={(e) => updateVariant(index, { sku: e.target.value })} placeholder="SKU" value={row.sku} />
                  <input onChange={(e) => updateVariant(index, { price: e.target.value })} placeholder="售價" type="number" value={row.price} />
                  <input onChange={(e) => updateVariant(index, { qty: e.target.value })} placeholder="庫存" type="number" value={row.qty} />
                  <button
                    className="variant-del"
                    onClick={() => setVariants((current) => current.filter((_, i) => i !== index))}
                    title="刪除此款式"
                    type="button"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="field">
            <label>補充備註</label>
            <input onChange={(e) => setNote(e.target.value)} placeholder="例如：含底座、預購款、限定版..." value={note} />
          </div>

          {pricing ? (
            <div className="notice">
              預估成本 NT${pricing.costTwd.toLocaleString()} / 建議售價 NT${pricing.sellPrice.toLocaleString()} / 定價 NT${pricing.compareAtPrice.toLocaleString()} / 利潤率 {pricing.profitPct}%
            </div>
          ) : null}

          <button className="btn-add" disabled={submitting || imagesUploading} type="submit">
            {submitting ? "處理中..." : imagesUploading ? "圖片上傳中，請稍候…" : "建立商品並生成文案"}
          </button>
          {message ? <div className="notice">{message}</div> : null}
        </form>

        <button className="settings-toggle" onClick={() => setSettingsOpen((current) => !current)} type="button">
          <span>⚙ 定價規則設定</span><span>{settingsOpen ? "▴" : "▾"}</span>
        </button>
        {settingsOpen ? (
          <div className="settings-body open">
            <div className="settings-grid">
              <div className="field">
                <label>CNY 匯率</label>
                <input
                  onChange={(e) => updatePricingSetting("rate", Number(e.target.value))}
                  step="0.01"
                  type="number"
                  value={pricingSettings.rate}
                />
              </div>
              <div className="field">
                <label>成本係數</label>
                <input
                  onChange={(e) => updatePricingSetting("costMultiplier", Number(e.target.value))}
                  step="0.01"
                  type="number"
                  value={pricingSettings.costMultiplier}
                />
              </div>
              <div className="field">
                <label>利潤加成</label>
                <input
                  onChange={(e) => updatePricingSetting("marginMultiplier", Number(e.target.value))}
                  step="0.01"
                  type="number"
                  value={pricingSettings.marginMultiplier}
                />
              </div>
              <div className="field">
                <label>定價加成（原價）</label>
                <input
                  onChange={(e) => updatePricingSetting("compareAtMultiplier", Number(e.target.value))}
                  step="0.01"
                  type="number"
                  value={pricingSettings.compareAtMultiplier}
                />
              </div>
              <div className="field">
                <label>最低售價 TWD</label>
                <input
                  onChange={(e) => updatePricingSetting("minPrice", Number(e.target.value))}
                  step="1"
                  type="number"
                  value={pricingSettings.minPrice}
                />
              </div>
            </div>
            <div className="formula-preview">
              售價 ＝ 成本 × {pricingSettings.rate.toFixed(2)} × {pricingSettings.costMultiplier.toFixed(2)} × {pricingSettings.marginMultiplier.toFixed(2)}
              <br />
              定價 ＝ 成本 × {pricingSettings.rate.toFixed(2)} × {pricingSettings.costMultiplier.toFixed(2)} × {pricingSettings.compareAtMultiplier.toFixed(2)}
            </div>
            <div className="settings-note">
              成本係數 {pricingSettings.costMultiplier.toFixed(2)} 含運費手續費緩衝／售價與定價可在上方手動覆蓋。
              <br />
              ✨ 算出的售價會自動「尾數美化」到順眼的價格帶（如 199／299／399／599／990…），不會出現 437 這種零頭。
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
