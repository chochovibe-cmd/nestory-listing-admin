"use client";

import { useState } from "react";
import type { ProductDraft, ProductImage } from "@/types/domain";

export function ResultTabs({ draft, images }: { draft: ProductDraft; images: ProductImage[] }) {
  const [tab, setTab] = useState<"copy" | "seo" | "images" | "warnings">("copy");

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>審核結果</h2>
        <span className="status">{draft.generation_mode}</span>
      </div>
      <div className="panel-body">
        <div className="tabs">
          <button type="button" onClick={() => setTab("copy")}>文案</button>
          <button type="button" onClick={() => setTab("seo")}>SEO</button>
          <button type="button" onClick={() => setTab("images")}>圖片</button>
          <button type="button" onClick={() => setTab("warnings")}>警告</button>
        </div>
        {tab === "copy" && (
          <div className="tab-panel">
            <h3>{draft.title_zh ?? "尚未產生標題"}</h3>
            <div dangerouslySetInnerHTML={{ __html: draft.description_html ?? "尚未產生商品描述" }} />
            {draft.spec_text ? <p>{draft.spec_text}</p> : null}
          </div>
        )}
        {tab === "seo" && (
          <div className="tab-panel">
            <strong>SEO Title</strong>
            <p>{draft.seo_title ?? "尚未產生"}</p>
            <strong>SEO Description</strong>
            <p>{draft.seo_description ?? "尚未產生"}</p>
            <strong>Tags</strong>
            <p>{draft.tags?.join(", ") || "尚未產生"}</p>
          </div>
        )}
        {tab === "images" && (
          <div className="tab-panel">
            <div className="thumbs">
              {images.map((image) => (
                <img
                  alt={image.alt_text ?? image.image_type}
                  key={image.id}
                  src={image.processed_file_url ?? image.original_file_url ?? image.generated_file_url ?? ""}
                />
              ))}
            </div>
          </div>
        )}
        {tab === "warnings" && (
          <div className="tab-panel">
            {draft.warnings?.length ? draft.warnings.map((warning) => <p key={warning}>{warning}</p>) : "沒有警告"}
          </div>
        )}
      </div>
    </div>
  );
}
