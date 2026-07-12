"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import {
  calculatePrice,
  CostCurrency,
  defaultPricingSettings,
  type PriceMode,
  type PricingSettings
} from "@/lib/pricing";
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
import {
  MAX_SCREENSHOT_IMAGES,
  planScreenshotFill,
  type RecognitionFields,
  type ScreenshotMode
} from "@/lib/screenshotRecognition";
import type { SaleStatus } from "@/types/domain";
import {
  formRowsToDbInserts,
  recalculateUnlockedVariantPrices,
  type VariantDimension,
  type VariantFormRow
} from "@/lib/variants";
import { VariantEditor, repriceVariants } from "@/components/listing/VariantEditor";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";
import { FieldHelp } from "@/components/listing/FieldHelp";
import {
  buildWorkspaceAutosaveSnapshot,
  clearWorkspaceAutosave,
  formFieldsFromAutosaveSnapshot,
  formatAutosaveAgeLabel,
  loadWorkspaceAutosave,
  writeWorkspaceAutosave,
  type WorkspaceAutosaveSnapshot
} from "@/lib/drafts/workspaceAutosave";
import { scheduleRouterRefresh } from "@/lib/drafts/scheduleRouterRefresh";

/** B7: insert-first overwrite so a failed insert never leaves variants empty. */
async function persistProductVariants(
  client: ReturnType<typeof createClient>,
  draftId: string,
  rows: Record<string, unknown>[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: oldRows, error: loadError } = await client
    .from("product_variants")
    .select("id")
    .eq("draft_id", draftId);

  if (loadError) {
    return { ok: false, error: `讀取舊款式失敗（未改動任何列）：${loadError.message}` };
  }
  const oldIds = (oldRows ?? []).map((r) => r.id as string);

  if (rows.length === 0) {
    if (oldIds.length === 0) return { ok: true };
    const { error: delError } = await client
      .from("product_variants")
      .delete()
      .eq("draft_id", draftId);
    if (delError) {
      return { ok: false, error: `清空款式失敗（舊列仍在，可重試）：${delError.message}` };
    }
    return { ok: true };
  }

  const { error: insertError } = await client.from("product_variants").insert(rows);
  if (insertError) {
    return {
      ok: false,
      error: `寫入新款式失敗（舊款式仍保留，可重試）：${insertError.message}`
    };
  }

  if (oldIds.length > 0) {
    const { error: delError } = await client.from("product_variants").delete().in("id", oldIds);
    if (delError) {
      return {
        ok: false,
        error: `新款式已寫入，但清除舊列失敗（可能暫時重複，請再按一次生成/儲存以清理）：${delError.message}`
      };
    }
  }
  return { ok: true };
}

// B8: 6 tones aligned with COPY_TONES / Mockup tone-cards (A9 backend already had all 6).
const TONE_OPTIONS = [
  { value: "黑膠文藝收藏感", emoji: "🎙️", desc: "沉穩、有故事感" },
  { value: "日系選物店溫柔感", emoji: "🌸", desc: "溫柔清楚好審稿" },
  { value: "可愛周邊輕鬆感", emoji: "🧸", desc: "可愛不浮誇" },
  { value: "中二熱血宣言", emoji: "🔥", desc: "動漫梗、招式感" },
  { value: "小編聊天口吻", emoji: "💬", desc: "像 IG 限動推坑" },
  { value: "依IP自動匹配", emoji: "✨", desc: "鬼滅→熱血、吉伊卡哇→軟萌" },
] as const;

const LENGTH_OPTIONS = ["精簡", "標準", "詳細"] as const;
const DEFAULT_TONE = TONE_OPTIONS[0].value;
const DEFAULT_COPY_LENGTH: (typeof LENGTH_OPTIONS)[number] = "標準";
const DEFAULT_WEB_SEARCH = true;
const MODEL_CYCLE: Array<"claude" | "openai"> = ["claude", "openai"];
const MODEL_LABEL = {
  claude: "Claude",
  openai: "GPT",
} as const;
type ModelLabel = (typeof MODEL_LABEL)["claude"] | (typeof MODEL_LABEL)["openai"];
const SOURCE_OPTIONS = ["淘寶", "閑魚", "蝦皮"] as const;

type InventoryPolicy = "deny" | "continue";
type B3Status = { kind: "info" | "ok" | "error"; text: string } | null;
type DedupeHit = { id: string; title: string | null; status: string; createdAt: string };
type VariantImageOption = { id: string; url: string; label: string };

// B1: 生成四步驟進度卡. The panel (left) drives the card, DraftResultsPanel
// (right) renders it, bridged by a window event (see generationProgress.ts) --
// same cross-component pattern the pricing settings already use
// (nestory:pricing-settings-changed). Steps map honestly onto our two real
// network phases (analyze-images then generate); we do NOT fake a streaming
// animation (that waits for A20).
function emitProgress(model: GenerationProgress) {
  window.dispatchEvent(new CustomEvent<GenerationProgress>(GENERATION_PROGRESS_EVENT, { detail: model }));
}

/** Extract Storage object path from a Supabase public URL (bucket product-images). */
function storagePathFromPublicUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const marker = "/product-images/";
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const rest = url.slice(idx + marker.length).split("?")[0];
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest || null;
  }
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
  // B1 (Mockup差異備忘 差異2): 規格以「系統自動整理」為主，此欄是常駐可編輯的補充/修正入口，
  // 預設留空。留空時生成會用 LLM 從證據池整理的規格回寫 spec_text；有填則以此為準不被覆蓋。
  const [specText, setSpecText] = useState("");
  // B7 multi-dimension variants
  const [variantDimensions, setVariantDimensions] = useState<VariantDimension[]>([]);
  const [variants, setVariants] = useState<VariantFormRow[]>([]);
  const [variantWarning, setVariantWarning] = useState<string | null>(null);
  const [variantImages, setVariantImages] = useState<VariantImageOption[]>([]);
  const [saleStatus, setSaleStatus] = useState<SaleStatus>(SALE_STATUS_OPTIONS[0]);
  const [inventoryUnlimited, setInventoryUnlimited] = useState(true);
  const [inventoryQuantity, setInventoryQuantity] = useState("");
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryNotice, setInventoryNotice] = useState("");
  const [tone, setTone] = useState<(typeof TONE_OPTIONS)[number]["value"]>(DEFAULT_TONE);
  const [copyLength, setCopyLength] = useState<(typeof LENGTH_OPTIONS)[number]>(DEFAULT_COPY_LENGTH);
  // B17: advanced sections collapsed by default; auto-open when content / non-default (incl. B13 restore)
  const [aiSectionOpen, setAiSectionOpen] = useState(false);
  const [variantSectionOpen, setVariantSectionOpen] = useState(false);
  const [specSectionOpen, setSpecSectionOpen] = useState(false);
  const [noteSectionOpen, setNoteSectionOpen] = useState(false);
  const prevAiContentRef = useRef(false);
  const prevVariantContentRef = useRef(false);
  const prevSpecContentRef = useRef(false);
  const prevNoteContentRef = useRef(false);
  const [manualPricingEnabled, setManualPricingEnabled] = useState(false);
  const [manualCompareAtPrice, setManualCompareAtPrice] = useState("");
  const [manualSellPrice, setManualSellPrice] = useState("");
  // B6: 特價/單一售價；預設特價。切到單一暫留定價，送出才寫 null。
  const [priceMode, setPriceMode] = useState<PriceMode>("sale");
  const [retainedCompareAt, setRetainedCompareAt] = useState<number | null>(null);
  // B6 A 案：利潤手改驅動售價；成本／幣別／匯率變動時必須清掉，避免殘留舊值。
  const [profitDriven, setProfitDriven] = useState(false);
  const [targetProfitInput, setTargetProfitInput] = useState("");
  // B8: default ON once Tavily backend is wired (老闆 2026-07-12); turn off when rushed.
  const [useWebSearch, setUseWebSearch] = useState(DEFAULT_WEB_SEARCH);
  // B8 D3-A: form model override is single-shot; after generate, fall back to header default.
  const [sessionProvider, setSessionProvider] = useState<"openai" | "claude" | null>(null);
  const [defaultProviderLabel, setDefaultProviderLabel] = useState<ModelLabel>("GPT");
  // B3: 網址抓取入口（誠實停用）＋截圖辨識＋網址查重
  const [fetchBoxOpen, setFetchBoxOpen] = useState(false);
  const [specShotOpen, setSpecShotOpen] = useState(false);
  const [b3Status, setB3Status] = useState<B3Status>(null);
  const [specShotStatus, setSpecShotStatus] = useState<B3Status>(null);
  const [recognizing, setRecognizing] = useState(false);
  const [dedupeHits, setDedupeHits] = useState<DedupeHit[]>([]);
  const [dedupeDismissed, setDedupeDismissed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pricingSettings, setPricingSettings] = useState<PricingSettings>(defaultPricingSettings);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ title?: boolean; price?: boolean; inventory?: boolean }>({});
  // B13 / BX4: restore bar when localStorage has an unsent form snapshot.
  const [restorePrompt, setRestorePrompt] = useState<WorkspaceAutosaveSnapshot | null>(null);
  const [serverImageHint, setServerImageHint] = useState<string | null>(null);
  const [discardBusy, setDiscardBusy] = useState(false);
  /** Skip debounce write until restore bar is resolved (avoid clobbering snapshot with empty form). */
  const [autosaveEnabled, setAutosaveEnabled] = useState(false);
  /**
   * fix(B13): block autosave while restore is applying / for a short window after.
   * Otherwise enabling autosave in the same turn as restore can schedule a write
   * from a still-empty render and race the restored state.
   */
  const suppressAutosaveRef = useRef(false);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const inventoryRef = useRef<HTMLInputElement>(null);
  const productShotInputRef = useRef<HTMLInputElement>(null);
  const specShotInputRef = useRef<HTMLInputElement>(null);
  // 2A 填空時用最新表單值（避免閉包過期）
  const formSnapshotRef = useRef({
    title: "",
    price: "",
    note: "",
    specText: "",
    variants: [] as VariantFormRow[]
  });
  formSnapshotRef.current = { title, price, note, specText, variants };

  // B17: auto-expand advanced sections when content appears (typing, screenshot fill, B13 restore).
  // Only open on false→true so the operator can still collapse manually.
  const aiHasContent =
    tone !== DEFAULT_TONE ||
    copyLength !== DEFAULT_COPY_LENGTH ||
    useWebSearch !== DEFAULT_WEB_SEARCH ||
    sessionProvider !== null;
  const variantHasContent = variants.length > 0 || variantDimensions.length > 0;
  const specHasContent = specText.trim().length > 0;
  const noteHasContent = note.trim().length > 0;

  useEffect(() => {
    if (aiHasContent && !prevAiContentRef.current) setAiSectionOpen(true);
    prevAiContentRef.current = aiHasContent;
  }, [aiHasContent]);
  useEffect(() => {
    if (variantHasContent && !prevVariantContentRef.current) setVariantSectionOpen(true);
    prevVariantContentRef.current = variantHasContent;
  }, [variantHasContent]);
  useEffect(() => {
    if (specHasContent && !prevSpecContentRef.current) setSpecSectionOpen(true);
    prevSpecContentRef.current = specHasContent;
  }, [specHasContent]);
  useEffect(() => {
    if (noteHasContent && !prevNoteContentRef.current) setNoteSectionOpen(true);
    prevNoteContentRef.current = noteHasContent;
  }, [noteHasContent]);

  useEffect(() => {
    setPricingSettings(getStoredPricingSettings());
    function onChange(event: Event) {
      const detail = (event as CustomEvent<PricingSettings>).detail;
      if (detail) {
        // 匯率／係數從其他元件或本機設定變更時，立刻重算並退出利潤驅動。
        setProfitDriven(false);
        setPricingSettings(detail);
      }
    }
    window.addEventListener("nestory:pricing-settings-changed", onChange);
    return () => window.removeEventListener("nestory:pricing-settings-changed", onChange);
  }, []);

  // B8: label for「預設 X」next to the one-shot model button (D3-A).
  useEffect(() => {
    setDefaultProviderLabel(MODEL_LABEL[readStoredAiProvider()]);
  }, []);

  // B13 / BX4: detect unsent local snapshot on mount (7d+ expired → cleared, no bar).
  useEffect(() => {
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    const result = loadWorkspaceAutosave(storage);
    if (result.kind === "ready") {
      setRestorePrompt(result.snapshot);
      setAutosaveEnabled(false);
    } else {
      setAutosaveEnabled(true);
    }
  }, []);

  // B13: debounce form → localStorage (~500ms).
  // Known limit documented in workspaceAutosave.ts: multi-tab last-write-wins.
  useEffect(() => {
    if (!autosaveEnabled || restorePrompt || submitting || suppressAutosaveRef.current) return;
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    const timer = window.setTimeout(() => {
      // Re-check suppress at fire time (restore may have just finished).
      if (suppressAutosaveRef.current) return;
      writeWorkspaceAutosave(
        storage,
        buildWorkspaceAutosaveSnapshot({
          draftId: draftIdRef.current,
          title,
          source,
          price,
          costCurrency,
          taobaoUrl,
          note,
          specText,
          saleStatus,
          inventoryUnlimited,
          inventoryQuantity,
          inventoryOpen,
          tone,
          copyLength,
          useWebSearch,
          priceMode,
          manualPricingEnabled,
          manualCompareAtPrice,
          manualSellPrice,
          profitDriven,
          targetProfitInput,
          variantDimensions,
          variants
        })
      );
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    autosaveEnabled,
    restorePrompt,
    submitting,
    title,
    source,
    price,
    costCurrency,
    taobaoUrl,
    note,
    specText,
    saleStatus,
    inventoryUnlimited,
    inventoryQuantity,
    inventoryOpen,
    tone,
    copyLength,
    useWebSearch,
    priceMode,
    manualPricingEnabled,
    manualCompareAtPrice,
    manualSellPrice,
    profitDriven,
    targetProfitInput,
    variantDimensions,
    variants,
    draftId
  ]);

  function updatePricingSetting(key: keyof PricingSettings, value: number) {
    if (Number.isNaN(value)) return;
    setProfitDriven(false);
    setStoredPricingSettings({ [key]: value });
  }

  function handleCostCurrencyChange(next: CostCurrency) {
    if (next === costCurrency) return;
    setProfitDriven(false);
    setCostCurrency(next);
  }

  function handleCostPriceChange(value: string) {
    setProfitDriven(false);
    setPrice(value);
    setFieldErrors((current) => ({ ...current, price: false }));
  }

  function handleProfitInputChange(value: string) {
    // 直填模式：利潤只讀，不應進到這裡；保險擋一次。
    if (manualPricingEnabled) return;
    setProfitDriven(true);
    setTargetProfitInput(value);
  }

  const parsedPrice = Number(price || 0);
  const parsedPriceRef = useRef(0);
  parsedPriceRef.current = parsedPrice;

  // 有填成本或直填售價時都要算，方便 price-live 即時更新與軟警告。
  const pricing =
    parsedPrice > 0 || (manualPricingEnabled && Number(manualSellPrice || 0) > 0)
      ? calculatePrice(parsedPrice, {
          settings: pricingSettings,
          currency: costCurrency,
          priceMode,
          profitDriven: profitDriven && !manualPricingEnabled,
          targetProfitTwd:
            profitDriven && !manualPricingEnabled
              ? Number(targetProfitInput || 0)
              : null,
          manualPricing: {
            enabled: manualPricingEnabled,
            sellPrice: Number(manualSellPrice || 0) || null,
            compareAtPrice:
              priceMode === "sale"
                ? Number(manualCompareAtPrice || 0) || retainedCompareAt || null
                : null
          }
        })
      : null;

  function handlePriceModeChange(next: PriceMode) {
    if (next === priceMode) return;
    if (next === "single") {
      // 暫留目前定價（公式算出或直填），切回特價可還原直填欄。
      const currentCompare =
        pricing?.compareAtPrice ??
        (manualCompareAtPrice ? Number(manualCompareAtPrice) : null) ??
        retainedCompareAt;
      if (currentCompare && currentCompare > 0) {
        setRetainedCompareAt(currentCompare);
      }
    } else if (next === "sale" && retainedCompareAt && manualPricingEnabled) {
      setManualCompareAtPrice(String(retainedCompareAt));
    }
    setPriceMode(next);
  }

  // 非利潤驅動時，把利潤輸入同步成「售價−成本」，避免幣別／匯率切換後殘留舊利潤。
  useEffect(() => {
    if (manualPricingEnabled) {
      if (pricing) {
        setTargetProfitInput(String(pricing.profitTwd));
      } else {
        setTargetProfitInput("");
      }
      return;
    }
    if (!profitDriven) {
      if (pricing) {
        setTargetProfitInput(String(pricing.profitTwd));
      } else {
        setTargetProfitInput("");
      }
    }
  }, [
    manualPricingEnabled,
    profitDriven,
    pricing?.profitTwd,
    pricing?.costTwd,
    pricing?.sellPrice,
    costCurrency,
    pricingSettings.rate,
    pricingSettings.costMultiplier,
    pricingSettings.marginMultiplier,
    pricingSettings.compareAtMultiplier,
    pricingSettings.minPrice,
    price,
    manualSellPrice,
    priceMode
  ]);

  // B7: reprice unlocked variant rows when currency / rate / price mode changes
  useEffect(() => {
    setVariants((current) => {
      if (current.length === 0) return current;
      return repriceVariants(current, {
        currency: costCurrency,
        priceMode,
        settings: pricingSettings
      });
    });
  }, [
    costCurrency,
    priceMode,
    pricingSettings.rate,
    pricingSettings.costMultiplier,
    pricingSettings.marginMultiplier,
    pricingSettings.compareAtMultiplier,
    pricingSettings.minPrice
  ]);

  // B7: load product images for per-variant picker
  useEffect(() => {
    if (!draftId) {
      setVariantImages([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("product_images")
        .select("id,original_file_url,processed_file_url,image_type,sort_order")
        .eq("draft_id", draftId)
        .order("sort_order", { ascending: true });
      if (cancelled || !data) return;
      setVariantImages(
        data
          .filter((img) => img.image_type === "main" || img.image_type === "variant")
          .map((img, i) => ({
            id: img.id as string,
            url: String(img.processed_file_url || img.original_file_url || ""),
            label: `主圖 ${i + 1}`
          }))
          .filter((img) => img.url)
      );
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase client is stable enough per render cycle; re-fetch on draft/upload
  }, [draftId, formKey, imagesUploading]);

  function handleSaleStatusChange(nextStatus: SaleStatus) {
    setSaleStatus(nextStatus);
    if (nextStatus === "台灣現貨" || nextStatus === "二手現貨") {
      setInventoryOpen(true);
      setInventoryNotice("已切換為現貨類型，請確認庫存；預設仍是無上限。");
    }
  }

  // B3: 網址查重（A12）；只比 URL，不擋送出。
  async function runUrlDedupe(url: string) {
    const trimmed = url.trim();
    if (!trimmed || !/^https?:\/\//i.test(trimmed)) {
      setDedupeHits([]);
      return;
    }
    try {
      const response = await fetch("/api/drafts/check-duplicate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceUrl: trimmed,
          excludeDraftId: draftIdRef.current
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setDedupeHits([]);
        return;
      }
      const matches = Array.isArray(payload.urlMatches) ? payload.urlMatches : [];
      setDedupeHits(
        matches.slice(0, 5).map((row: { id: string; title?: string | null; status?: string; createdAt?: string }) => ({
          id: row.id,
          title: row.title ?? null,
          status: row.status ?? "",
          createdAt: row.createdAt ?? ""
        }))
      );
      setDedupeDismissed(false);
    } catch {
      setDedupeHits([]);
    }
  }

  function handleSourceUrlChange(value: string) {
    setTaobaoUrl(value);
    setDedupeDismissed(false);
  }

  function handleFetchClick() {
    // 誠實停用：爬蟲屬後期 Phase；仍保留網址並跑查重。
    const url = taobaoUrl.trim();
    if (!url) {
      setB3Status({ kind: "error", text: "請先貼上商品網址。" });
      return;
    }
    setB3Status({
      kind: "info",
      text: "網址抓取尚未啟用（爬蟲後期才接）。網址已保留供查重／日後使用；請改用「上傳截圖自動辨識」或手動貼標題。"
    });
    void runUrlDedupe(url);
  }

  /** 暫存截圖 → 公開 URL；路徑 {userId}/temp-screenshots/{uuid}.ext（4A 不建草稿） */
  async function uploadTempScreenshots(files: File[]): Promise<{ urls: string[]; paths: string[] }> {
    const urls: string[] = [];
    const paths: string[] = [];
    for (const file of files.slice(0, MAX_SCREENSHOT_IMAGES)) {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/temp-screenshots/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("product-images").upload(path, file, {
        contentType: file.type || "image/jpeg",
        upsert: false
      });
      if (error) {
        throw new Error(`截圖上傳失敗：${error.message}`);
      }
      const { data } = supabase.storage.from("product-images").getPublicUrl(path);
      urls.push(data.publicUrl);
      paths.push(path);
    }
    return { urls, paths };
  }

  async function removeTempScreenshots(paths: string[]) {
    if (paths.length === 0) return;
    try {
      await supabase.storage.from("product-images").remove(paths);
    } catch {
      // 刪失敗不擋流程、不報錯
    }
  }

  function applyFillPlan(
    plan: ReturnType<typeof planScreenshotFill>,
    setStatus: (s: B3Status) => void
  ) {
    if (plan.title) {
      setTitle(plan.title);
      setFieldErrors((current) => ({ ...current, title: false }));
    }
    if (plan.costCny != null && plan.costCny > 0) {
      setProfitDriven(false);
      setCostCurrency("CNY");
      setPrice(String(plan.costCny));
      setFieldErrors((current) => ({ ...current, price: false }));
    }
    if (plan.note) setNote(plan.note);
    if (plan.specText) setSpecText(plan.specText);
    if (plan.variants) {
      // B7: screenshot fill is 1-dimension 「款式」; reprice unlocked rows.
      setVariantDimensions([{ name: "款式" }]);
      const priced = recalculateUnlockedVariantPrices(plan.variants, {
        currency: costCurrency,
        priceMode,
        settings: pricingSettings
      });
      setVariants(priced);
    }

    const tone = plan.filledLines.length > 0 ? "ok" : "info";
    setStatus({ kind: tone, text: plan.summary });
  }

  async function runScreenshotRecognition(files: FileList | File[], mode: ScreenshotMode) {
    const setStatus = mode === "spec" ? setSpecShotStatus : setB3Status;
    const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (list.length === 0) {
      setStatus({ kind: "error", text: "請選擇圖片檔（截圖）。手動填寫路徑仍可用。" });
      return;
    }
    if (list.length > MAX_SCREENSHOT_IMAGES) {
      setStatus({
        kind: "info",
        text: `一次最多 ${MAX_SCREENSHOT_IMAGES} 張，已取前 ${MAX_SCREENSHOT_IMAGES} 張。`
      });
    }

    setRecognizing(true);
    setStatus({ kind: "info", text: "辨識中…請稍候（可同時繼續手填其他欄位）" });

    let paths: string[] = [];
    try {
      const uploaded = await uploadTempScreenshots(list);
      paths = uploaded.paths;

      const response = await fetch("/api/recognize-screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrls: uploaded.urls, mode })
      });
      const payload = await response.json().catch(() => ({}));

      if (!response.ok) {
        setStatus({
          kind: "error",
          text: `${payload.error ?? "截圖辨識失敗"}。表單仍可手動填寫。`
        });
        return;
      }

      const fields = (payload.fields ?? {}) as RecognitionFields;
      const snap = formSnapshotRef.current;
      const plan = planScreenshotFill(
        {
          title: snap.title,
          price: snap.price,
          note: snap.note,
          specText: snap.specText,
          variants: snap.variants
        },
        {
          title: fields.title ?? null,
          costCny: fields.costCny ?? null,
          features: fields.features ?? null,
          specText: fields.specText ?? null,
          variants: Array.isArray(fields.variants) ? fields.variants : []
        },
        mode
      );
      applyFillPlan(plan, setStatus);
    } catch (error) {
      setStatus({
        kind: "error",
        text: `${error instanceof Error ? error.message : "截圖辨識連線失敗"}。表單仍可手動填寫。`
      });
    } finally {
      // 成功或失敗都嘗試清暫存（失敗靜默）
      await removeTempScreenshots(paths);
      setRecognizing(false);
      if (mode === "product" && productShotInputRef.current) productShotInputRef.current.value = "";
      if (mode === "spec" && specShotInputRef.current) specShotInputRef.current.value = "";
    }
  }

  function getInventoryFields(): { inventory_quantity: number | null; inventory_policy: InventoryPolicy } | null {
    if (inventoryUnlimited) {
      return { inventory_quantity: null, inventory_policy: "continue" };
    }

    if (!inventoryQuantity.trim()) return null;

    const quantity = Number(inventoryQuantity);
    if (!Number.isInteger(quantity) || quantity < 0) return null;

    return { inventory_quantity: quantity, inventory_policy: "deny" };
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
          inventory_quantity: null,
          inventory_policy: "continue",
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
    const filledVariants = variants.filter(
      (row) => row.optionValues.some((v) => v.trim().length > 0)
    );
    const inventoryFields = getInventoryFields();

    if (!inventoryFields) {
      setFieldErrors((current) => ({ ...current, inventory: true }));
      setMessage("庫存數量請填 0 或正整數，或勾選無上限");
      inventoryRef.current?.focus();
      return null;
    }

    // B6: 單一售價送出時 compare_at_price 必為 null（暫留只在記憶體）。
    const compareAtForSave =
      priceMode === "single" ? null : (pricing?.compareAtPrice ?? null);

    const fields = {
      taobao_title: title.trim(),
      original_title: title.trim(),
      source_url: taobaoUrl.trim() || null,
      taobao_url: taobaoUrl.trim() || null,
      cny_price: parsedPrice,
      twd_cost: pricing?.costTwd ?? null,
      twd_price: pricing?.sellPrice ?? null,
      compare_at_price: compareAtForSave,
      price_mode: priceMode,
      pricing_formula: pricing?.pricingFormula ?? {},
      note: note.trim() || null,
      spec_text: specText.trim() || null,
      sale_status: saleStatus,
      source_platform: source,
      inventory_quantity: inventoryFields.inventory_quantity,
      inventory_policy: inventoryFields.inventory_policy,
      // B7: dimension defs (empty when single SKU)
      variant_dimensions: variantDimensions,
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

    // B7: safe insert-first overwrite (never leave variants wiped if insert fails).
    // Also runs when clearing all rows so old multi-variant drafts become single SKU.
    const inserts = formRowsToDbInserts(variantDimensions, filledVariants);
    const persistResult = await persistProductVariants(
      supabase,
      id,
      inserts.map((row) => ({ ...row, draft_id: id }))
    );
    if (!persistResult.ok) {
      setMessage(persistResult.error);
      return null;
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
    // 連續上架 (light): keep 來源/銷售狀態/語氣/長度/Web Search/priceMode, clear the rest.
    // B13: clear localStorage with the same light-reset rules so refresh won't re-prompt.
    clearWorkspaceAutosave(typeof window !== "undefined" ? window.localStorage : null);
    setRestorePrompt(null);
    setServerImageHint(null);
    setAutosaveEnabled(true);

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
    setSpecText("");
    setVariants([]);
    setVariantDimensions([]);
    setVariantWarning(null);
    setInventoryUnlimited(true);
    setInventoryQuantity("");
    setInventoryOpen(false);
    setInventoryNotice("");
    setManualPricingEnabled(false);
    setManualCompareAtPrice("");
    setManualSellPrice("");
    setProfitDriven(false);
    setTargetProfitInput("");
    setB3Status(null);
    setSpecShotStatus(null);
    setDedupeHits([]);
    setDedupeDismissed(false);
    setFetchBoxOpen(false);
    setSpecShotOpen(false);
    // B17: collapse advanced after light reset (tone/length/web kept → AI may stay open if non-default)
    setVariantSectionOpen(false);
    setSpecSectionOpen(false);
    setNoteSectionOpen(false);
    prevVariantContentRef.current = false;
    prevSpecContentRef.current = false;
    prevNoteContentRef.current = false;
    // priceMode 連續上架保留（跟來源／銷售狀態一樣是操作偏好）
    setFieldErrors({});
  }

  function applyWorkspaceSnapshot(snap: WorkspaceAutosaveSnapshot) {
    const fields = formFieldsFromAutosaveSnapshot(snap);

    // Always write every restorable field (unconditional), so a missing optional
    // match on tone/source cannot skip title/price/etc.
    setTitle(fields.title);
    if (SOURCE_OPTIONS.includes(fields.source as (typeof SOURCE_OPTIONS)[number])) {
      setSource(fields.source as (typeof SOURCE_OPTIONS)[number]);
    }
    setPrice(fields.price);
    setCostCurrency(fields.costCurrency === "TWD" ? "TWD" : "CNY");
    setTaobaoUrl(fields.taobaoUrl);
    setNote(fields.note);
    setSpecText(fields.specText);
    if (SALE_STATUS_OPTIONS.includes(fields.saleStatus as SaleStatus)) {
      setSaleStatus(fields.saleStatus as SaleStatus);
    }
    setInventoryUnlimited(fields.inventoryUnlimited);
    setInventoryQuantity(fields.inventoryQuantity);
    setInventoryOpen(fields.inventoryOpen);
    if (TONE_OPTIONS.some((t) => t.value === fields.tone)) {
      setTone(fields.tone as (typeof TONE_OPTIONS)[number]["value"]);
    }
    if (LENGTH_OPTIONS.includes(fields.copyLength as (typeof LENGTH_OPTIONS)[number])) {
      setCopyLength(fields.copyLength as (typeof LENGTH_OPTIONS)[number]);
    }
    setUseWebSearch(fields.useWebSearch);
    setPriceMode(fields.priceMode === "single" ? "single" : "sale");
    setManualPricingEnabled(fields.manualPricingEnabled);
    setManualCompareAtPrice(fields.manualCompareAtPrice);
    setManualSellPrice(fields.manualSellPrice);
    setProfitDriven(fields.profitDriven);
    setTargetProfitInput(fields.targetProfitInput);
    setVariantDimensions(fields.variantDimensions);
    setVariants(fields.variants as VariantFormRow[]);

    // B17 req1: B13 restore must open sections that already have content (don't look like data lost).
    const restoredAi =
      (TONE_OPTIONS.some((t) => t.value === fields.tone) && fields.tone !== DEFAULT_TONE) ||
      fields.copyLength !== DEFAULT_COPY_LENGTH ||
      fields.useWebSearch !== DEFAULT_WEB_SEARCH;
    const restoredVariants =
      (fields.variants?.length ?? 0) > 0 || (fields.variantDimensions?.length ?? 0) > 0;
    const restoredSpec = Boolean(fields.specText?.trim());
    const restoredNote = Boolean(fields.note?.trim());
    if (restoredAi) setAiSectionOpen(true);
    if (restoredVariants) setVariantSectionOpen(true);
    if (restoredSpec) setSpecSectionOpen(true);
    if (restoredNote) setNoteSectionOpen(true);
    // Align prev refs so effects don't fight manual collapse right after restore
    prevAiContentRef.current = restoredAi;
    prevVariantContentRef.current = restoredVariants;
    prevSpecContentRef.current = restoredSpec;
    prevNoteContentRef.current = restoredNote;

    if (fields.draftId) {
      draftIdRef.current = fields.draftId;
      setDraftId(fields.draftId);
    } else {
      draftIdRef.current = null;
      setDraftId(null);
    }
    // Remount ImageUploader only (not the whole form) so previews clear without
    // losing the title/price state we just applied.
    setFormKey((k) => k + 1);
    setServerImageHint(
      fields.draftId
        ? "此草稿在伺服器上可能已有圖片，可再補圖或直接生成（預覽不會自動載回）。"
        : null
    );
    setFieldErrors({});
  }

  /**
   * fix(B13): restore must (1) re-read localStorage as source of truth,
   * (2) flushSync-apply fields so the controlled inputs commit before paint,
   * (3) keep autosave suppressed until after the restored render is live.
   * Previous bug: setRestorePrompt(null)+setAutosaveEnabled(true) in the same
   * turn as setTitle could leave the form empty while localStorage still had data.
   */
  function continueRestore() {
    const storage = typeof window !== "undefined" ? window.localStorage : null;
    const loaded = loadWorkspaceAutosave(storage);
    const snap =
      loaded.kind === "ready" ? loaded.snapshot : restorePrompt;
    if (!snap) {
      setRestorePrompt(null);
      setAutosaveEnabled(true);
      return;
    }

    suppressAutosaveRef.current = true;

    // Commit restored field state + hide bar in one synchronous paint.
    flushSync(() => {
      applyWorkspaceSnapshot(snap);
      setRestorePrompt(null);
      setMessage("已恢復未送出的草稿，可繼續編輯或按生成。");
    });

    // Keep the snapshot alive (refresh savedAt) so a mid-restore refresh still works.
    const fields = formFieldsFromAutosaveSnapshot(snap);
    writeWorkspaceAutosave(
      storage,
      buildWorkspaceAutosaveSnapshot({
        draftId: fields.draftId,
        title: fields.title,
        source: fields.source || source,
        price: fields.price,
        costCurrency: fields.costCurrency,
        taobaoUrl: fields.taobaoUrl,
        note: fields.note,
        specText: fields.specText,
        saleStatus: fields.saleStatus || saleStatus,
        inventoryUnlimited: fields.inventoryUnlimited,
        inventoryQuantity: fields.inventoryQuantity,
        inventoryOpen: fields.inventoryOpen,
        tone: fields.tone || tone,
        copyLength: fields.copyLength,
        useWebSearch: fields.useWebSearch,
        priceMode: fields.priceMode,
        manualPricingEnabled: fields.manualPricingEnabled,
        manualCompareAtPrice: fields.manualCompareAtPrice,
        manualSellPrice: fields.manualSellPrice,
        profitDriven: fields.profitDriven,
        targetProfitInput: fields.targetProfitInput,
        variantDimensions: fields.variantDimensions,
        variants: fields.variants
      })
    );

    // Enable autosave only after restored values are on screen (next macrotask).
    window.setTimeout(() => {
      suppressAutosaveRef.current = false;
      setAutosaveEnabled(true);
    }, 100);

    // Draft existence check is best-effort and must not clear restored fields.
    if (fields.draftId) {
      const draftToCheck = fields.draftId;
      void (async () => {
        const { data, error } = await supabase
          .from("product_drafts")
          .select("id, status")
          .eq("id", draftToCheck)
          .maybeSingle();
        if (error || !data || data.status === "archived") {
          // Only drop draftId binding; keep form text the operator just restored.
          if (draftIdRef.current === draftToCheck) {
            draftIdRef.current = null;
            setDraftId(null);
          }
          setServerImageHint(null);
          setMessage("原草稿已不在（可能已封存），欄位已回填；再生成會建立新草稿。");
          return;
        }
        const { count } = await supabase
          .from("product_images")
          .select("id", { count: "exact", head: true })
          .eq("draft_id", draftToCheck);
        if ((count ?? 0) > 0) {
          setServerImageHint(
            `此草稿伺服器上已有 ${count} 張圖，可再補圖或直接生成（預覽不會自動載回）。`
          );
        } else {
          setServerImageHint(null);
        }
      })();
    }
  }

  /** BX4 D1-A: clear localStorage + soft-archive pending draft; best-effort wipe images. */
  async function discardRestore() {
    if (discardBusy) return;
    setDiscardBusy(true);
    const snap = restorePrompt;
    const draftToDrop = snap?.draftId ?? null;
    clearWorkspaceAutosave(typeof window !== "undefined" ? window.localStorage : null);
    setRestorePrompt(null);
    setServerImageHint(null);
    setAutosaveEnabled(true);

    if (!draftToDrop) {
      setDiscardBusy(false);
      setMessage("已丟棄本機暫存。");
      return;
    }

    try {
      // Soft-archive (authenticated has no DELETE on product_drafts).
      await fetch("/api/drafts/batch/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draftIds: [draftToDrop], action: "archive" })
      });

      // Best-effort: remove image rows + storage objects (product_images allows delete).
      // Paths are not stored as a column — extract from public URL (upload layout: userId/draftId/...).
      const { data: imgs } = await supabase
        .from("product_images")
        .select("id, original_file_url")
        .eq("draft_id", draftToDrop);
      if (imgs?.length) {
        const paths = imgs
          .map((row) => storagePathFromPublicUrl(row.original_file_url as string | null))
          .filter((p): p is string => Boolean(p));
        if (paths.length) {
          try {
            await supabase.storage.from("product-images").remove(paths);
          } catch {
            /* ignore storage cleanup failures */
          }
        }
        await supabase.from("product_images").delete().eq("draft_id", draftToDrop);
      }

      if (draftIdRef.current === draftToDrop) {
        draftIdRef.current = null;
        setDraftId(null);
        setFormKey((k) => k + 1);
      }
      setMessage("已丟棄本機暫存，並將伺服器上的空草稿封存。");
      scheduleRouterRefresh(() => router.refresh());
    } catch {
      setMessage("已清本機暫存；伺服器草稿清理失敗，可稍後在「已封存」或待輸入列表處理。");
    } finally {
      setDiscardBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors: { title?: boolean; price?: boolean } = {};
    if (!title.trim()) errors.title = true;
    if (!parsedPrice || parsedPrice <= 0) errors.price = true;

    if (errors.title || errors.price) {
      setFieldErrors(errors);
      setMessage("請輸入商品標題與有效成本價格");
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

    // B8 D3-A: one-shot provider override; after this request falls back to header default.
    const providerForThisRun = sessionProvider ?? readStoredAiProvider();

    let response: Response;
    try {
      response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftId: id,
          provider: providerForThisRun,
          mode: readStoredRunMode(),
          useWebSearch,
          source,
          variantSummary:
            variants
              .filter((row) => row.optionValues.some((v) => v.trim()))
              .map((row) => {
                const label = row.optionValues.filter((v) => v.trim()).join(" / ");
                return `${label}${row.sellPrice ? ` 售價${row.sellPrice}` : row.cost ? ` 成本${row.cost}` : ""}`;
              })
              .join("、") || undefined,
          tone,
          copyLength,
          imageWarnings
        })
      });
    } catch {
      setSubmitting(false);
      setSessionProvider(null);
      setMessage("生成連線失敗，可以到右側卡片按「重新生成」再試一次");
      emitProgress(stepModel(cardTitle, ["done", step2, "error", "pending"], "生成連線失敗"));
      router.refresh();
      return;
    }

    const payload = await response.json().catch(() => ({}));
    setSubmitting(false);
    // Always clear one-shot override after the attempt (success or fail) so the
    // next generate uses the global default unless the operator clicks again.
    setSessionProvider(null);
    setDefaultProviderLabel(MODEL_LABEL[readStoredAiProvider()]);

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

  function cycleSessionModel() {
    const base = sessionProvider ?? readStoredAiProvider();
    const idx = MODEL_CYCLE.indexOf(base);
    const next = MODEL_CYCLE[(idx + 1) % MODEL_CYCLE.length];
    setSessionProvider(next);
    setDefaultProviderLabel(MODEL_LABEL[readStoredAiProvider()]);
  }

  return (
    <div className="panel">
      <div className="panel-header">
        <h2>✦ 新增商品</h2>
      </div>
      <div className="panel-body">
        <form onSubmit={submit} style={{ display: "grid", gap: 14 }}>
          {/* BX4: unsent draft restore bar — only when localStorage has a fresh snapshot */}
          {restorePrompt ? (
            <div className="notice workspace-restore-notice" role="status">
              <span>
                偵測到未送出的草稿（{formatAutosaveAgeLabel(restorePrompt.savedAt)}
                {restorePrompt.title?.trim()
                  ? `：${restorePrompt.title.trim().slice(0, 24)}${restorePrompt.title.trim().length > 24 ? "…" : ""}`
                  : ""}
                ）。要繼續編輯還是丟掉？
              </span>
              <span style={{ display: "inline-flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                <button
                  className="btn-mini"
                  disabled={discardBusy}
                  onClick={() => void continueRestore()}
                  type="button"
                >
                  繼續編輯
                </button>
                <button
                  className="btn-mini"
                  disabled={discardBusy}
                  onClick={() => void discardRestore()}
                  type="button"
                >
                  {discardBusy ? "處理中…" : "丟棄"}
                </button>
              </span>
            </div>
          ) : null}

          {serverImageHint ? (
            <div className="notice" role="status">
              {serverImageHint}
            </div>
          ) : null}

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
                  onChange={(e) => handleSaleStatusChange(e.target.value as SaleStatus)}
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
              placeholder="貼上來源商品標題（也可用下方網址／截圖自動填入）..."
              ref={titleRef}
              rows={2}
              value={title}
            />
            {fieldErrors.title ? <div className="field-msg">請輸入商品標題</div> : null}

            {/* B3: Mockup 標題區 helper — 網址抓取（誠實停用）＋截圖辨識 */}
            <div className="helper-links">
              <button
                className="helper-link"
                disabled={recognizing}
                onClick={() => setFetchBoxOpen((open) => !open)}
                type="button"
              >
                🔗 貼商品網址自動抓取（淘寶／蝦皮／官網）{fetchBoxOpen ? " ▴" : ""}
              </button>
              <button
                className="helper-link"
                disabled={recognizing}
                onClick={() => productShotInputRef.current?.click()}
                type="button"
              >
                📷 上傳截圖自動辨識（可多張，最多 {MAX_SCREENSHOT_IMAGES} 張）
              </button>
              <input
                accept="image/*"
                multiple
                onChange={(e) => {
                  if (e.target.files?.length) void runScreenshotRecognition(e.target.files, "product");
                }}
                ref={productShotInputRef}
                style={{ display: "none" }}
                type="file"
              />
            </div>
            <div className={`fetch-box${fetchBoxOpen ? " open" : ""}`}>
              <input
                onBlur={() => void runUrlDedupe(taobaoUrl)}
                onChange={(e) => handleSourceUrlChange(e.target.value)}
                placeholder="貼上商品網址..."
                type="url"
                value={taobaoUrl}
              />
              <button className="btn-mini" disabled={recognizing} onClick={handleFetchClick} type="button">
                自動抓取
              </button>
            </div>
            {b3Status ? <div className={`b3-status ${b3Status.kind}`}>{b3Status.text}</div> : null}
            {dedupeHits.length > 0 && !dedupeDismissed ? (
              <div className="dedupe-alert" role="status">
                <div className="dd-body">
                  <div className="dedupe-title">⚠ 這個網址可能已上架過</div>
                  <div className="dedupe-meta">
                    {dedupeHits.map((hit) => (
                      <div key={hit.id}>
                        「{hit.title || "（無標題）"}」· {hit.status || "—"}
                        {hit.createdAt
                          ? ` · ${new Date(hit.createdAt).toLocaleDateString("zh-TW")}`
                          : ""}
                      </div>
                    ))}
                  </div>
                  <div className="dedupe-actions">
                    <button className="btn-mini" onClick={() => setDedupeDismissed(true)} type="button">
                      知道了，繼續
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            <div className="stock-line">
              <span>庫存：{inventoryUnlimited ? "無上限" : `${inventoryQuantity || 0} 件（賣完即止）`}</span>
              <button onClick={() => setInventoryOpen((current) => !current)} type="button">
                {inventoryOpen ? "收合" : "修改"}
              </button>
            </div>
            <div className={`stock-edit${inventoryOpen ? " open" : ""}`}>
              <label className="check-row">
                <input
                  checked={inventoryUnlimited}
                  onChange={(e) => {
                    setInventoryUnlimited(e.target.checked);
                    setFieldErrors((current) => ({ ...current, inventory: false }));
                  }}
                  type="checkbox"
                />
                <span>無上限</span>
              </label>
              <input
                disabled={inventoryUnlimited}
                min="0"
                onChange={(e) => {
                  setInventoryQuantity(e.target.value);
                  setFieldErrors((current) => ({ ...current, inventory: false }));
                }}
                placeholder="實際數量"
                ref={inventoryRef}
                step="1"
                type="number"
                value={inventoryQuantity}
              />
            </div>
            {inventoryNotice ? <div className="field-msg">{inventoryNotice}</div> : null}
            {fieldErrors.inventory ? <div className="field-msg">請填 0 或正整數；若可持續接單，請勾選無上限。</div> : null}
          </div>

          {/* B1: 圖片先選＋背景上傳；B5: 主圖縮圖可切「規格圖」處理標記（非 OCR）。 */}
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

          <div className={`field${fieldErrors.price ? " error" : ""}`} id="f-price">
            <label>
              成本價格 <span className="field-req">必填</span>
            </label>
            <div className="price-row">
              <input
                min="0"
                onChange={(e) => handleCostPriceChange(e.target.value)}
                ref={priceRef}
                step="0.01"
                type="number"
                value={price}
              />
              <div className="currency-toggle">
                <button
                  className={costCurrency === "CNY" ? "active" : ""}
                  onClick={() => handleCostCurrencyChange("CNY")}
                  type="button"
                >
                  ¥ CNY
                </button>
                <button
                  className={costCurrency === "TWD" ? "active" : ""}
                  onClick={() => handleCostCurrencyChange("TWD")}
                  type="button"
                >
                  NT$ TWD
                </button>
              </div>
            </div>
            {fieldErrors.price ? <div className="field-msg">請輸入有效的成本價格</div> : null}

            {/* B6: 特價 / 單一售價二選一（預設特價） */}
            <div className="price-mode" role="group" aria-label="定價模式">
              <button
                className={`price-mode-btn${priceMode === "sale" ? " active" : ""}`}
                onClick={() => handlePriceModeChange("sale")}
                type="button"
              >
                🏷 特價模式（售價＋定價劃線）
              </button>
              <button
                className={`price-mode-btn${priceMode === "single" ? " active" : ""}`}
                onClick={() => handlePriceModeChange("single")}
                type="button"
              >
                單一售價（不填定價）
              </button>
            </div>

            {pricing ? (
              <div className="price-live">
                <span>
                  成本 <b>NT${pricing.costTwd.toLocaleString()}</b>
                </span>
                <span>
                  → 售價 <b>NT${pricing.sellPrice.toLocaleString()}</b>
                </span>
                {priceMode === "sale" && pricing.compareAtPrice != null ? (
                  <span>
                    定價 <s>NT${pricing.compareAtPrice.toLocaleString()}</s>
                  </span>
                ) : null}
                <span className="price-live-profit">
                  利潤{" "}
                  <input
                    aria-label="利潤台幣"
                    className="profit-input"
                    disabled={manualPricingEnabled}
                    onChange={(e) => handleProfitInputChange(e.target.value)}
                    readOnly={manualPricingEnabled}
                    step="1"
                    title={
                      manualPricingEnabled
                        ? "直填模式下利潤只顯示、不反推售價"
                        : "手填利潤後售價跳到最近美化價（可低於成本，僅黃字提醒）"
                    }
                    type="number"
                    value={targetProfitInput}
                  />
                  <span className="profit-pct">約 {pricing.profitPct}%</span>
                  {pricing.profitNote ? (
                    <span className="profit-note">{pricing.profitNote}</span>
                  ) : null}
                </span>
              </div>
            ) : null}

            {pricing?.warnings?.length
              ? pricing.warnings.map((warning) => (
                  <div className="price-soft-warn" key={warning}>
                    ⚠ {warning}
                  </div>
                ))
              : null}

            <div className="price-opts">
              <label className="check-row">
                <input
                  checked={manualPricingEnabled}
                  onChange={(e) => {
                    setProfitDriven(false);
                    setManualPricingEnabled(e.target.checked);
                  }}
                  type="checkbox"
                />
                <span>直填台幣售價/定價</span>
              </label>
            </div>
            {manualPricingEnabled ? (
              <div className={`manual-price-fields open${priceMode === "single" ? " single" : ""}`}>
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
                {priceMode === "sale" ? (
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
                ) : null}
              </div>
            ) : null}
          </div>

          <CollapsibleSection
            className="adv-ai"
            onToggle={() => setAiSectionOpen((v) => !v)}
            open={aiSectionOpen}
            summary={aiHasContent ? tone : undefined}
            title="✎ AI 文案設定"
          >
            <div className="copy-settings-block adv-nested">
              <div className="field">
                <label className="copy-style-label">
                  <span>AI 文案風格</span>
                  <span className="model-quick">
                    <button className="mq-btn" onClick={cycleSessionModel} type="button">
                      🤖 本次：{MODEL_LABEL[sessionProvider ?? readStoredAiProvider()]}
                    </button>
                    <FieldHelp label="本次模型說明">
                      預設用頂部全域模型（目前 {defaultProviderLabel}）。這裡只改「這一次」；生成後會自動回到預設。
                    </FieldHelp>
                  </span>
                </label>
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
              <div className="copy-len-row field">
                <label style={{ margin: 0 }}>文案長度</label>
                <select onChange={(e) => setCopyLength(e.target.value as (typeof LENGTH_OPTIONS)[number])} value={copyLength}>
                  {LENGTH_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </div>
              <div className="wsearch-row">
                <div className="wsearch-label">
                  <span className="wsearch-label-row">
                    🔍 Web Search 補充資訊
                    <FieldHelp label="Web Search 說明">
                      預設開啟（冷門 IP／規格更準）；趕時間可關。查來的內容會標來源提醒核實。
                    </FieldHelp>
                  </span>
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
                  <span className="toggle-cost">{useWebSearch ? "+約 10–15 秒" : "已關閉"}</span>
                </div>
              </div>
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            className="adv-variant"
            onToggle={() => setVariantSectionOpen((v) => !v)}
            open={variantSectionOpen}
            summary={
              variants.length > 0
                ? `已填 ${variants.length} 列`
                : variantDimensions.length > 0
                  ? `${variantDimensions.length} 個維度`
                  : undefined
            }
            title="款式規格"
          >
            <VariantEditor
              currency={costCurrency}
              dimensions={variantDimensions}
              footer={
                <>
                  {/* B3: 規格截圖入口（空表時可填簡單 1 維款式列） */}
                  <button
                    className="spec-shot-toggle"
                    disabled={recognizing}
                    onClick={() => setSpecShotOpen((open) => !open)}
                    type="button"
                  >
                    📸 {specShotOpen ? "▾" : "▸"} 上傳規格截圖自動填入
                  </button>
                  <div className={`spec-shot-body${specShotOpen ? " open" : ""}`}>
                    <div
                      className="spec-shot-drop"
                      onClick={() => !recognizing && specShotInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          if (!recognizing) specShotInputRef.current?.click();
                        }
                      }}
                      role="button"
                      tabIndex={0}
                    >
                      <div>拖拉或點擊上傳規格截圖（最多 {MAX_SCREENSHOT_IMAGES} 張）</div>
                    </div>
                    <input
                      accept="image/*"
                      multiple
                      onChange={(e) => {
                        if (e.target.files?.length) void runScreenshotRecognition(e.target.files, "spec");
                      }}
                      ref={specShotInputRef}
                      style={{ display: "none" }}
                      type="file"
                    />
                    {specShotStatus ? (
                      <div className={`b3-status ${specShotStatus.kind}`} style={{ marginTop: 8 }}>
                        {specShotStatus.text}
                      </div>
                    ) : null}
                  </div>
                </>
              }
              images={variantImages}
              onDimensionsChange={setVariantDimensions}
              onRowsChange={setVariants}
              onWarning={setVariantWarning}
              priceMode={priceMode}
              pricingSettings={pricingSettings}
              rows={variants}
              warning={variantWarning}
            />
          </CollapsibleSection>

          <CollapsibleSection
            className="adv-spec"
            onToggle={() => setSpecSectionOpen((v) => !v)}
            open={specSectionOpen}
            summary={specHasContent ? "已填" : undefined}
            title="商品規格"
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label-with-help">
                <span>商品規格</span>
                <FieldHelp label="商品規格說明">
                  選填。留空時系統會從款式／標題／圖片自動整理；也可先用規格截圖填入。有手填內容時生成不會覆蓋。
                </FieldHelp>
              </label>
              <textarea
                onChange={(e) => setSpecText(e.target.value)}
                placeholder="留空即可——系統會自動整理。例：材質／尺寸／包裝內容"
                rows={3}
                value={specText}
              />
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            className="adv-note"
            onToggle={() => setNoteSectionOpen((v) => !v)}
            open={noteSectionOpen}
            summary={noteHasContent ? "已填" : undefined}
            title="補充備註"
          >
            <div className="field" style={{ marginBottom: 0 }}>
              <label className="label-with-help">
                <span>補充備註</span>
                <FieldHelp label="備註說明">
                  截圖辨識的特色會自動填入空白欄。可手寫含底座、預購、限定等補充給文案用。
                </FieldHelp>
              </label>
              <input onChange={(e) => setNote(e.target.value)} placeholder="例如：含底座、預購款、限定版..." value={note} />
            </div>
          </CollapsibleSection>

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
              成本係數 {pricingSettings.costMultiplier.toFixed(2)} 含運費手續費緩衝。
              <br />
              ✨ 算出的售價會自動「尾數美化」到順眼的價格帶（如 199／299／399／599／990…）。
              <br />
              手填利潤時，售價會跳到「不低於 成本＋利潤」的最近美化價；直填台幣時不套公式。
              <br />
              特價模式會帶定價劃線；單一售價不寫定價（compare_at 留空）。
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
