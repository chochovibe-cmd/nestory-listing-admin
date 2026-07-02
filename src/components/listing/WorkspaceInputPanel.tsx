"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { categoryOptions } from "@/lib/categories";
import { calculatePrice } from "@/lib/pricing";
import { SALE_STATUS_OPTIONS } from "@/lib/saleStatus";
import { readStoredAiProvider } from "@/components/ProviderSwitcher";
import { ImageUploader } from "@/components/listing/ImageUploader";
import { createClient } from "@/lib/supabase/client";
import type { SaleStatus } from "@/types/domain";

const TONE_OPTIONS = [
  { value: "黑膠文藝收藏感", emoji: "🎙️", desc: "像懂收藏的選物店，沉穩、有故事感" },
  { value: "日系選物店溫柔感", emoji: "🌸", desc: "溫柔清楚，適合同事快速審稿" },
  { value: "可愛周邊輕鬆感", emoji: "🧸", desc: "可愛但不浮誇，適合小物與周邊" }
] as const;

const LENGTH_OPTIONS = ["精簡", "標準", "詳細"] as const;

type Stage = "form" | "created";

export function WorkspaceInputPanel({ userId }: { userId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [stage, setStage] = useState<Stage>("form");
  const [draftId, setDraftId] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState(categoryOptions[0].value);
  const [taobaoUrl, setTaobaoUrl] = useState("");
  const [note, setNote] = useState("");
  const [ipName, setIpName] = useState("");
  const [characterName, setCharacterName] = useState("");
  const [productType, setProductType] = useState("");
  const [saleStatus, setSaleStatus] = useState<SaleStatus>(SALE_STATUS_OPTIONS[0]);
  const [tone, setTone] = useState<(typeof TONE_OPTIONS)[number]["value"]>(TONE_OPTIONS[0].value);
  const [copyLength, setCopyLength] = useState<(typeof LENGTH_OPTIONS)[number]>("標準");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsedPrice = Number(price || 0);
  const pricing = parsedPrice > 0 ? calculatePrice(parsedPrice) : null;

  function resetForNextItem() {
    setStage("form");
    setDraftId(null);
    setTitle("");
    setPrice("");
    setTaobaoUrl("");
    setNote("");
    setIpName("");
    setCharacterName("");
    setProductType("");
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
        pricing_formula: pricing?.pricingFormula,
        category,
        note: note.trim() || null,
        ip_name: ipName.trim() || null,
        character_name: characterName.trim() || null,
        product_type: productType.trim() || null,
        sale_status: saleStatus,
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

    setDraftId(data.id);
    setStage("created");
    setMessage("生成文案中...");

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        draftId: data.id,
        provider: readStoredAiProvider(),
        tone,
        copyLength
      })
    });
    const payload = await response.json();

    setSubmitting(false);

    if (!response.ok) {
      setMessage(payload.error ?? "生成失敗，可以到右側卡片按「重新生成」再試一次");
    } else if (payload.draftState === "blocked") {
      setMessage("規則引擎判斷資料不足：" + payload.validationErrors.join("；"));
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
            <div className="field">
              <label>淘寶原標題</label>
              <textarea onChange={(e) => setTitle(e.target.value)} placeholder="貼上淘寶原始標題..." rows={2} value={title} />
            </div>
            <div className="row">
              <div className="field">
                <label>CNY 價格</label>
                <input min="0" onChange={(e) => setPrice(e.target.value)} step="0.01" type="number" value={price} />
              </div>
              <div className="field">
                <label>商品分類</label>
                <select onChange={(e) => setCategory(e.target.value)} value={category}>
                  {categoryOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>IP 名稱</label>
                <input onChange={(e) => setIpName(e.target.value)} value={ipName} />
              </div>
              <div className="field">
                <label>角色名稱</label>
                <input onChange={(e) => setCharacterName(e.target.value)} value={characterName} />
              </div>
            </div>
            <div className="row">
              <div className="field">
                <label>商品類型</label>
                <input onChange={(e) => setProductType(e.target.value)} placeholder="例：吊飾徽章" value={productType} />
              </div>
              <div className="field">
                <label>銷售狀態</label>
                <select onChange={(e) => setSaleStatus(e.target.value as SaleStatus)} value={saleStatus}>
                  {SALE_STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
            </div>

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

            <div className="field">
              <label>淘寶連結（可留空）</label>
              <input onChange={(e) => setTaobaoUrl(e.target.value)} value={taobaoUrl} />
            </div>
            <div className="field">
              <label>補充備註</label>
              <input onChange={(e) => setNote(e.target.value)} placeholder="例如：含底座、預購款、限定版..." value={note} />
            </div>

            {pricing ? (
              <div className="notice">
                預估成本 NT${pricing.costTwd.toLocaleString()} / 建議售價 NT${pricing.sellPrice.toLocaleString()} / 利潤率 {pricing.profitPct}%
              </div>
            ) : null}

            <button className="btn-add" disabled={submitting} type="submit">
              {submitting ? "處理中..." : "建立商品並生成文案"}
            </button>
            {message ? <div className="notice">{message}</div> : null}
          </form>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {message ? <div className="notice">{message}</div> : null}
            <div className="field">
              <label>上傳圖片</label>
              {draftId ? <ImageUploader draftId={draftId} userId={userId} /> : null}
            </div>
            <button className="btn-add" onClick={resetForNextItem} type="button">
              ＋ 填寫下一筆商品
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
