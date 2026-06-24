"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { categoryOptions } from "@/lib/categories";
import { calculatePrice } from "@/lib/pricing";
import { createClient } from "@/lib/supabase/client";

export function ProductInputForm({ userId }: { userId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState(categoryOptions[0].value);
  const [note, setNote] = useState("");
  const [taobaoUrl, setTaobaoUrl] = useState("");
  const [message, setMessage] = useState("");
  const parsedPrice = Number(price || 0);
  const pricing = parsedPrice > 0 ? calculatePrice(parsedPrice) : null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("建立商品草稿中...");

    if (!title.trim() || !parsedPrice || parsedPrice <= 0) {
      setMessage("請輸入商品標題與有效 CNY 價格");
      return;
    }

    const { data, error } = await supabase
      .from("product_drafts")
      .insert({
        taobao_title: title.trim(),
        original_title: title.trim(),
        taobao_url: taobaoUrl.trim() || null,
        cny_price: parsedPrice,
        twd_cost: pricing?.costTwd,
        twd_price: pricing?.sellPrice,
        pricing_formula: pricing?.pricingFormula,
        category,
        note: note.trim() || null,
        status: "pending_copy",
        generation_mode: "codex_skill",
        generation_provider: "codex",
        generation_status: "pending",
        publish_mode: "active",
        publish_method: "shopify_api",
        publish_status: "pending",
        created_by: userId
      })
      .select("id")
      .single();

    if (error) {
      setMessage(error.message);
      return;
    }

    router.push(`/drafts/${data.id}`);
  }

  return (
    <form className="panel" onSubmit={submit}>
      <div className="panel-header">
        <h2>商品資料</h2>
        <span className="status pending">pending_copy</span>
      </div>
      <div className="panel-body">
        <div className="field">
          <label>淘寶原標題</label>
          <textarea onChange={(e) => setTitle(e.target.value)} placeholder="貼上淘寶原始標題..." value={title} />
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
        <div className="field">
          <label>淘寶連結（可留空，未來 Apify / 爬蟲預留）</label>
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
        <button className="primary" type="submit">建立商品佇列</button>
        {message ? <div className="notice">{message}</div> : null}
      </div>
    </form>
  );
}
