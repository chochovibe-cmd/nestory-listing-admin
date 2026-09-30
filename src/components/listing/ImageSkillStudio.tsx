"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { showToast } from "@/components/Toast";
import {
  approximateOutputCostUsd,
  IMAGE_SKILL_STYLE_LABELS,
  IMAGE_SKILL_TASK_LABELS,
  imageSkillUsesApi,
  type ImageSkillQuality,
  type ImageSkillStyle,
  type ImageSkillTask
} from "@/lib/images/imageSkills";
import type { ProductImage } from "@/types/domain";

const TASK_HINTS: Record<ImageSkillTask, string> = {
  square_pad: "只加畫布與留白，不裁商品、不拉伸。0 次圖片 API。",
  square_ai: "背景需要自然延展時用。商品本體仍以原圖為準。",
  hero_enhance: "保留商品本體，只整理背景、留白、光線與主圖構圖。",
  creative_hero: "可選最多 4 張商品／實拍參考，做一張新的主視覺。",
  ad_creative: "做 4:5 廣告型詳情圖；AI 只生無字視覺底，繁中由 Nestory 疊字。"
};

function bestThumb(image: ProductImage): string {
  return (
    image.list_thumb_url ||
    image.processed_file_url ||
    image.original_file_url ||
    image.generated_file_url ||
    ""
  );
}

function isReferenceCandidate(image: ProductImage): boolean {
  return image.image_type !== "generated_detail" && Boolean(image.original_file_url || image.processed_file_url);
}

function requiresSingleReference(task: ImageSkillTask): boolean {
  return task === "square_pad" || task === "square_ai" || task === "hero_enhance";
}

export function ImageSkillStudio({
  open,
  draftId,
  images,
  primaryImageId,
  initialTask = "hero_enhance",
  onClose,
  onImagesChange
}: {
  open: boolean;
  draftId: string;
  images: ProductImage[];
  primaryImageId?: string | null;
  initialTask?: ImageSkillTask;
  onClose: () => void;
  onImagesChange: (next: ProductImage[]) => void;
}) {
  const titleId = useId();
  const supabase = createClient();
  const candidates = useMemo(
    () => images.filter(isReferenceCandidate).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)),
    [images]
  );

  const fallbackPrimary = primaryImageId && candidates.some((img) => img.id === primaryImageId)
    ? primaryImageId
    : candidates[0]?.id ?? "";

  const [task, setTask] = useState<ImageSkillTask>(initialTask);
  const [quality, setQuality] = useState<ImageSkillQuality>("economy");
  const [style, setStyle] = useState<ImageSkillStyle>("chocho");
  const [selectedIds, setSelectedIds] = useState<string[]>(fallbackPrimary ? [fallbackPrimary] : []);
  const [instruction, setInstruction] = useState("");
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [background, setBackground] = useState<"cream" | "white" | "black">("cream");
  const [busy, setBusy] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultCost, setResultCost] = useState<number | null>(null);

  useEffect(() => {
    if (!open) return;
    const primary =
      primaryImageId && candidates.some((img) => img.id === primaryImageId)
        ? primaryImageId
        : candidates[0]?.id ?? "";
    setTask(initialTask);
    setQuality("economy");
    setStyle("chocho");
    setSelectedIds(primary ? [primary] : []);
    setInstruction("");
    setHeadline("");
    setSubline("");
    setBackground("cream");
    setResultUrl(null);
    setResultCost(null);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  // Reset only when opening/switching the requested entry point. Refreshing
  // product_images after a successful run must not erase the just-produced preview.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTask, primaryImageId]);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  if (!open) return null;

  const apiTask = imageSkillUsesApi(task);
  const estimated = approximateOutputCostUsd(task, quality);
  const canRun =
    selectedIds.length > 0 &&
    selectedIds.length <= 4 &&
    (!requiresSingleReference(task) || selectedIds.length === 1) &&
    !busy;

  function selectTask(next: ImageSkillTask) {
    setTask(next);
    setResultUrl(null);
    setResultCost(null);
    if (requiresSingleReference(next) && selectedIds.length > 1) {
      setSelectedIds(selectedIds.slice(0, 1));
    }
  }

  function toggleReference(id: string) {
    if (requiresSingleReference(task)) {
      setSelectedIds([id]);
      return;
    }
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) {
        showToast("最多選 4 張參考圖", "error");
        return prev;
      }
      return [...prev, id];
    });
  }

  async function refreshImages() {
    const { data, error } = await supabase
      .from("product_images")
      .select("*")
      .eq("draft_id", draftId)
      .order("sort_order", { ascending: true });
    if (!error && data) onImagesChange(data as ProductImage[]);
  }

  async function runSkill() {
    if (!canRun) return;
    setBusy(true);
    setResultUrl(null);
    setResultCost(null);
    try {
      const response = await fetch("/api/images/skill-process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId,
          task,
          imageIds: selectedIds,
          quality,
          style,
          instruction,
          headline,
          subline,
          background
        })
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        processedFileUrl?: string;
        estimatedCostUsd?: number;
        usedApi?: boolean;
      };
      if (!response.ok || !data.processedFileUrl) {
        throw new Error(data.error || "圖片處理失敗");
      }
      setResultUrl(data.processedFileUrl);
      setResultCost(
        typeof data.estimatedCostUsd === "number" ? data.estimatedCostUsd : apiTask ? estimated : 0
      );
      await refreshImages();
      showToast(
        task === "square_pad"
          ? "方圖已完成（未使用圖片 API）"
          : "圖片已完成；只產生 1 版，未自動加生候選",
        "success"
      );
    } catch (error) {
      showToast(error instanceof Error ? error.message : "圖片處理失敗", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      aria-labelledby={titleId}
      aria-modal="true"
      className="modal-overlay open"
      role="dialog"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="modal-box approve-summary-modal image-skill-modal">
        <div className="modal-hdr">
          <span id={titleId}>✨ 圖片 AI 工具</span>
          <button className="modal-close" disabled={busy} onClick={onClose} type="button">
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="muted">
            人選任務，Skill 負責執行。預設不做額外 AI 判斷，也不自動生成多張候選。
          </p>

          <fieldset className="station3-fieldset" disabled={busy}>
            <legend className="station3-legend">要做什麼</legend>
            {(Object.keys(IMAGE_SKILL_TASK_LABELS) as ImageSkillTask[]).map((item) => (
              <label className="check-row" key={item}>
                <input
                  checked={task === item}
                  name="image-skill-task"
                  onChange={() => selectTask(item)}
                  type="radio"
                />
                <span>
                  <strong>{IMAGE_SKILL_TASK_LABELS[item]}</strong>
                  <span className="muted"> · {TASK_HINTS[item]}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <fieldset className="station3-fieldset" disabled={busy}>
            <legend className="station3-legend">
              參考圖 {requiresSingleReference(task) ? "（選 1 張）" : "（最多 4 張）"}
            </legend>
            {!requiresSingleReference(task) ? (
              <p className="muted">
                省錢建議：通常選 1–2 張就夠；參考圖越多，圖片 input token 成本越高。
              </p>
            ) : null}
            <div className="imgmark-list imgmark-strip image-skill-reference-strip">
              {candidates.map((image) => {
                const checked = selectedIds.includes(image.id);
                const src = bestThumb(image);
                return (
                  <label
                    className={`pthumb-card image-skill-reference${checked ? " active" : ""}`}
                    key={image.id}
                  >
                    <input
                      checked={checked}
                      onChange={() => toggleReference(image.id)}
                      type={requiresSingleReference(task) ? "radio" : "checkbox"}
                      name={requiresSingleReference(task) ? "image-skill-ref" : undefined}
                    />
                    {src ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img alt="" className="imgmark-thumb" src={src} />
                    ) : null}
                    <span className="muted">
                      {image.image_type === "detail" ? "詳情素材" : "商品圖"}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {task === "square_pad" ? (
            <div className="field">
              <label htmlFor="skill-bg">補色背景</label>
              <select
                id="skill-bg"
                value={background}
                onChange={(event) =>
                  setBackground(event.target.value as "cream" | "white" | "black")
                }
              >
                <option value="cream">米白</option>
                <option value="white">白色</option>
                <option value="black">黑色</option>
              </select>
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="skill-style">視覺方向</label>
                <select
                  id="skill-style"
                  value={style}
                  onChange={(event) => setStyle(event.target.value as ImageSkillStyle)}
                >
                  {(Object.keys(IMAGE_SKILL_STYLE_LABELS) as ImageSkillStyle[]).map((item) => (
                    <option key={item} value={item}>
                      {IMAGE_SKILL_STYLE_LABELS[item]}
                    </option>
                  ))}
                </select>
              </div>

              <fieldset className="station3-fieldset" disabled={busy}>
                <legend className="station3-legend">成本 / 品質</legend>
                <label className="check-row">
                  <input
                    checked={quality === "economy"}
                    name="image-skill-quality"
                    onChange={() => setQuality("economy")}
                    type="radio"
                  />
                  省錢版 · low（預設）
                </label>
                <label className="check-row">
                  <input
                    checked={quality === "standard"}
                    name="image-skill-quality"
                    onChange={() => setQuality("standard")}
                    type="radio"
                  />
                  標準版 · medium（需要精修再用）
                </label>
              </fieldset>
            </>
          )}

          {task === "ad_creative" ? (
            <>
              <div className="field">
                <label htmlFor="skill-headline">廣告主句（選填）</label>
                <input
                  id="skill-headline"
                  maxLength={180}
                  onChange={(event) => setHeadline(event.target.value)}
                  placeholder="例如：掛上包包，可愛直接跟著走。"
                  value={headline}
                />
              </div>
              <div className="field">
                <label htmlFor="skill-subline">副句（選填）</label>
                <input
                  id="skill-subline"
                  maxLength={240}
                  onChange={(event) => setSubline(event.target.value)}
                  placeholder="留空就用商品類型"
                  value={subline}
                />
              </div>
            </>
          ) : null}

          {task !== "square_pad" ? (
            <div className="field">
              <label htmlFor="skill-instruction">補充要求（選填）</label>
              <textarea
                id="skill-instruction"
                maxLength={500}
                onChange={(event) => setInstruction(event.target.value)}
                placeholder="例如：背景簡單一點、商品大一點、不要太 AI。"
                rows={3}
                value={instruction}
              />
            </div>
          ) : null}

          <div className="notice image-skill-cost">
            {apiTask ? (
              <>
                這次只會生成 <strong>1 張</strong>。圖片輸出估計約 US$
                {estimated.toFixed(3)}
                {quality === "economy" ? "；另有少量參考圖 input token。" : "；另有參考圖 input token。"}
              </>
            ) : (
              <>
                <strong>US$0 圖片 API</strong> · 只用伺服器 Sharp 補畫布。
              </>
            )}
          </div>

          {resultUrl ? (
            <div className="image-skill-result">
              <p><strong>最新結果</strong></p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="圖片處理結果" src={resultUrl} />
              <p className="muted">
                本次記錄成本：US$${(resultCost ?? 0).toFixed(3)}。不喜歡可調整要求後再按一次；系統不會自己重生。
              </p>
            </div>
          ) : null}

          <div className="approve-sum-actions">
            <button className="approve-sum-btn" disabled={busy} onClick={onClose} type="button">
              關閉
            </button>
            <button
              className="primary approve-sum-btn"
              disabled={!canRun}
              onClick={() => void runSkill()}
              type="button"
            >
              {busy
                ? "處理中…"
                : task === "square_pad"
                  ? "免費補成方形"
                  : "生成 1 張"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
