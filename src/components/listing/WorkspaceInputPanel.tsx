"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { calculatePrice, CostCurrency, defaultPricingSettings, PricingSettings } from "@/lib/pricing";
import { getStoredPricingSettings, setStoredPricingSettings } from "@/lib/pricingSettingsStore";
import { SALE_STATUS_OPTIONS } from "@/lib/saleStatus";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { readStoredRunMode } from "@/components/ModeSwitcher";
import { ImageUploader } from "@/components/listing/ImageUploader";
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

type Stage = "form" | "created";

export function WorkspaceInputPanel({ userId }: { userId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [stage, setStage] = useState<Stage>("form");
  const [draftId, setDraftId] = useState<string | null>(null);

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

  function resetForNextItem() {
    setStage("form");
    setDraftId(null);
    setTitle("");
    setSource(SOURCE_OPTIONS[0]);
    setPrice("");
    setCostCurrency("CNY");
    setTaobaoUrl("");
    setNote("");
    setVariants([]);
    setManualPricingEnabled(false);
    setManualCompareAtPrice("");
    setManualSellPrice("");
    setUseWebSearch(false);
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!title.trim() || !parsedPrice || parsedPrice <= 0) {
      setMessage("請輸入商品標題與有效 CNY 價格");
      return;
    }

    setSubmitting(true);
    setMessage("建立商品草稿中...");

    const { data, error } = await supabase
      .from("product_drafts")
      .insert({
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
        generation_mode: "api_llm",
        generation_provider: "codex",
        generation_status: "pending",
        publish_mode: "active",
        publish_method: "shopify_api",
        publish_status: "pending",
        created_by: userId
      })
      .select("id")
      .single();

    if (error || !data) {
      setSubmitting(false);
      setMessage(error?.message ?? "建立失敗");
      return;
    }

    const filledVariants = variants.filter((row) => row.name.trim());
    if (filledVariants.length > 0) {
      await supabase.from("product_variants").insert(
        filledVariants.map((row) => ({
          draft_id: data.id,
          option1_name: "款式",
          option1_value: row.name.trim(),
          sku: row.sku.trim() || null,
          twd_price: row.price ? Number(row.price) : null,
          inventory_quantity: row.qty ? Number(row.qty) : 0
        }))
      );
    }
    const variantSummary = filledVariants
      .map((row) => `${row.name.trim()}${row.price ? ` 售價${row.price}` : ""}`)
      .join("、");

    setDraftId(data.id);
    setStage("created");
    setMessage("生成文案中...");

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId: data.id,
        provider: readStoredAiProvider(),
        mode: readStoredRunMode(),
        useWebSearch,
        source,
        variantSummary: variantSummary || undefined,
        tone,
        copyLength
      })
    });
    const payload = await response.json();

    setSubmitting(false);

    if (!response.ok) {
      setMessage(payload.error ?? "生成失敗，可以到右側卡片按「重新生成」再試一次");
    } else if (payload.draftState === "blocked") {
      setMessage("AI 判斷資料不足（多半是 IP 未對到建檔清單）：" + payload.validationErrors.join("；") + "。可在右側卡片修正「AI 偵測類型」等欄位後按「重新生成」。");
    } else {
      setMessage("生成完成，可以在右側卡片繼續上傳圖片或編輯文案");
    }

    router.refresh();
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>✦ 新增商品</h2>
      </div>
      <div className="panel-body">
        {stage === "form" ? (
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

            <div className="field">
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
              <textarea onChange={(e) => setTitle(e.target.value)} placeholder="貼上來源商品標題，AI 會整理成 Shopify 商品標題..." rows={2} value={title} />
            </div>
            <div className="field">
              <label>成本價格</label>
              <div className="price-row">
                <input min="0" onChange={(e) => setPrice(e.target.value)} step="0.01" type="number" value={price} />
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

            <button className="btn-add" disabled={submitting} type="submit">
              {submitting ? "處理中..." : "建立商品並生成文案"}
            </button>
            {message ? <div className="notice">{message}</div> : null}
          </form>
        ) : null}
        {stage === "form" ? (
          <>
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
          </>
        ) : null}
        {stage === "created" ? (
          <div style={{ display: "grid", gap: 14 }}>
            {message ? <div className="notice">{message}</div> : null}
            <div className="field">
              <label>上傳圖片</label>
              {draftId ? <ImageUploader draftId={draftId} userId={userId} /> : null}
            </div>
            <a className="button" href="#results-list">
              ↓ 查看已生成的商品內容
            </a>
            <button className="btn-add" onClick={resetForNextItem} type="button">
              ＋ 填寫下一筆商品
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
