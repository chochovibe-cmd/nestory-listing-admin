"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CollapsibleSection } from "@/components/listing/CollapsibleSection";
import { Button } from "@/components/ui/Button";
import {
  AI_PROVIDER_STORAGE_KEY,
  readStoredAiProvider
} from "@/components/ProviderSwitcher";
import {
  defaultAutomationPrefs,
  getStoredAutomationPrefs,
  setStoredAutomationPrefs,
  type AutomationPrefs,
  type WorkerMode
} from "@/lib/automationPrefsStore";
import { canAccessSettings, isAdmin } from "@/lib/auth/roles";
import { defaultPricingSettings, type PricingSettings } from "@/lib/pricing";
import {
  getStoredPricingSettings,
  setStoredPricingSettings
} from "@/lib/pricingSettingsStore";
import {
  FX_REFERENCE_CHANGED_EVENT,
  getStoredFxReference,
  isFreshFxReference,
  setStoredFxReference,
  type FxReference
} from "@/lib/fx/fxReferenceStore";
import { createClient, hasSupabaseBrowserEnv } from "@/lib/supabase/client";
import { showToast } from "@/components/Toast";
import type { UserRole } from "@/types/domain";

type AiProvider = "openai" | "claude";
type ThemeId = "dark" | "nordic" | "kitty";

type StatusPayload = {
  supabase: boolean;
  aiProvider: { openai: boolean; claude: boolean };
  shopify: boolean;
  shopifyMock: boolean;
};

const THEMES: { value: ThemeId; icon: string; title: string }[] = [
  { value: "dark", icon: "🌑", title: "夜色" },
  { value: "nordic", icon: "🐰", title: "奶茶" },
  { value: "kitty", icon: "🎀", title: "海鹽" }
];

const SECTION_IDS = ["model", "pricing", "automation", "appearance", "connection"] as const;
type SectionId = (typeof SECTION_IDS)[number];

function isSectionId(value: string | null): value is SectionId {
  return SECTION_IDS.includes(value as SectionId);
}

/**
 * C2 settings page body — five B17 collapsible sections.
 * Write locks: System Prompt + automation prefs = admin; pricing/theme/model default = all operators.
 * No secrets / webhook URL in client storage (Q8-A-restricted).
 * UX-B2-P15: embedded=true for mobile settings sheet (same logic; no second page shell).
 */
export function SettingsPanel({ embedded = false }: { embedded?: boolean } = {}) {
  const searchParams = useSearchParams();
  const initialSection = searchParams.get("section");

  const [role, setRole] = useState<UserRole | null>(null);
  const [roleReady, setRoleReady] = useState(false);

  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    model: false,
    pricing: false,
    automation: false,
    appearance: false,
    connection: false
  });

  const [provider, setProvider] = useState<AiProvider>("openai");
  const [pricing, setPricing] = useState<PricingSettings>(defaultPricingSettings);
  const [liveRate, setLiveRate] = useState<number | null>(null);
  const [liveRateLoading, setLiveRateLoading] = useState(false);
  const [liveRateError, setLiveRateError] = useState<string | null>(null);
  const [applyNotice, setApplyNotice] = useState<string | null>(null);

  const [automation, setAutomation] = useState<AutomationPrefs>(defaultAutomationPrefs);
  const [theme, setTheme] = useState<ThemeId>("dark");

  const [status, setStatus] = useState<StatusPayload | null>(null);
  const [statusChecking, setStatusChecking] = useState(false);
  const statusAttemptedRef = useRef(false);

  // CAP-1: personal capture token (operator+admin); double-confirm for reset (UX-E T28)
  const [captureHasToken, setCaptureHasToken] = useState(false);
  const [capturePrefix, setCapturePrefix] = useState<string | null>(null);
  const [captureCreatedAt, setCaptureCreatedAt] = useState<string | null>(null);
  const [capturePlainOnce, setCapturePlainOnce] = useState<string | null>(null);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureResetArm, setCaptureResetArm] = useState(false);
  const [captureLoaded, setCaptureLoaded] = useState(false);

  const admin = isAdmin(role);
  const allowed = canAccessSettings(role);

  useEffect(() => {
    if (isSectionId(initialSection)) {
      setOpen((prev) => ({ ...prev, [initialSection]: true }));
    }
  }, [initialSection]);

  const loadCaptureTokenStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/capture-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "status" })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        setCaptureLoaded(true);
        return;
      }
      setCaptureHasToken(Boolean(payload.hasToken));
      setCapturePrefix(typeof payload.prefix === "string" ? payload.prefix : null);
      setCaptureCreatedAt(typeof payload.created_at === "string" ? payload.created_at : null);
      setCaptureLoaded(true);
    } catch {
      setCaptureLoaded(true);
    }
  }, []);

  async function issueCaptureToken(action: "generate" | "reset") {
    setCaptureBusy(true);
    setCapturePlainOnce(null);
    try {
      const res = await fetch("/api/settings/capture-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.ok) {
        const err =
          typeof payload.message === "string"
            ? payload.message
            : typeof payload.error === "string"
              ? payload.error
              : "擷取 token 操作失敗";
        showToast(err, "error");
        return;
      }
      const token = typeof payload.token === "string" ? payload.token : null;
      setCaptureHasToken(true);
      setCapturePrefix(typeof payload.prefix === "string" ? payload.prefix : null);
      setCaptureCreatedAt(typeof payload.created_at === "string" ? payload.created_at : null);
      setCapturePlainOnce(token);
      setCaptureResetArm(false);
      showToast(
        action === "reset" ? "已重設擷取 token，請複製新金鑰" : "已產生擷取 token，請複製保存",
        "success"
      );
    } catch {
      showToast("擷取 token 連線失敗", "error");
    } finally {
      setCaptureBusy(false);
    }
  }

  function onCaptureTokenPrimaryClick() {
    if (captureBusy) return;
    if (!captureHasToken) {
      void issueCaptureToken("generate");
      return;
    }
    // UX-E T28: double-confirm — first click arms, second executes
    if (!captureResetArm) {
      setCaptureResetArm(true);
      return;
    }
    void issueCaptureToken("reset");
  }

  async function copyCaptureToken() {
    if (!capturePlainOnce) return;
    try {
      await navigator.clipboard.writeText(capturePlainOnce);
      showToast("已複製擷取 token", "success");
    } catch {
      showToast("複製失敗，請手動選取複製", "warn");
    }
  }

  useEffect(() => {
    if (!hasSupabaseBrowserEnv()) {
      setRoleReady(true);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    async function loadRole() {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth.user;
      if (!user) {
        if (!cancelled) {
          setRole(null);
          setRoleReady(true);
        }
        return;
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!cancelled) {
        setRole((profile?.role as UserRole | undefined) ?? null);
        setRoleReady(true);
      }
    }

    void loadRole();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void loadRole();
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    setProvider(readStoredAiProvider());
    setPricing(getStoredPricingSettings());
    setAutomation(getStoredAutomationPrefs());
    // Hydrate 今日參考 from device store when still Taiwan-calendar-day fresh.
    const ref = getStoredFxReference();
    if (isFreshFxReference(ref) && ref) {
      setLiveRate(ref.rate);
    }
    try {
      const stored = window.localStorage.getItem("nestory_theme") as ThemeId | null;
      if (stored === "dark" || stored === "nordic" || stored === "kitty") {
        setTheme(stored);
      } else if (document.body.dataset.theme) {
        const t = document.body.dataset.theme as ThemeId;
        if (t === "dark" || t === "nordic" || t === "kitty") setTheme(t);
      }
    } catch {
      /* ignore */
    }

    function onPricing(event: Event) {
      const detail = (event as CustomEvent<PricingSettings>).detail;
      if (detail) setPricing({ ...defaultPricingSettings, ...detail });
      else setPricing(getStoredPricingSettings());
    }
    function onAuto(event: Event) {
      const detail = (event as CustomEvent<AutomationPrefs>).detail;
      if (detail) setAutomation({ ...defaultAutomationPrefs, ...detail });
      else setAutomation(getStoredAutomationPrefs());
    }
    function onFxRef(event: Event) {
      const detail = (event as CustomEvent<FxReference>).detail;
      if (detail && isFreshFxReference(detail)) {
        setLiveRate(detail.rate);
      }
    }
    window.addEventListener("nestory:pricing-settings-changed", onPricing);
    window.addEventListener("nestory:automation-prefs-changed", onAuto);
    window.addEventListener(FX_REFERENCE_CHANGED_EVENT, onFxRef);
    return () => {
      window.removeEventListener("nestory:pricing-settings-changed", onPricing);
      window.removeEventListener("nestory:automation-prefs-changed", onAuto);
      window.removeEventListener(FX_REFERENCE_CHANGED_EVENT, onFxRef);
    };
  }, []);

  // CAP-1: load token mask when settings access is confirmed
  useEffect(() => {
    if (!roleReady || !allowed) return;
    void loadCaptureTokenStatus();
  }, [roleReady, allowed, loadCaptureTokenStatus]);

  // Clear reset arm when leaving automation section or after idle
  useEffect(() => {
    if (!open.automation) setCaptureResetArm(false);
  }, [open.automation]);

  /** C6: fetch via server /api/fx/cny-twd only — never browser→open.er-api direct. */
  const fetchLiveRate = useCallback(async () => {
    setLiveRateLoading(true);
    setLiveRateError(null);
    setApplyNotice(null);
    try {
      const response = await fetch("/api/fx/cny-twd", { cache: "no-store" });
      const data = (await response.json()) as {
        ok?: boolean;
        rate?: number;
        asOf?: string;
        source?: string;
        message?: string;
      };
      if (
        !response.ok ||
        !data.ok ||
        typeof data.rate !== "number" ||
        !Number.isFinite(data.rate)
      ) {
        setLiveRate(null);
        setLiveRateError(
          data.message || "無法取得今日匯率，請稍後再試（不影響已套用中的匯率）。"
        );
        return;
      }
      const rounded = Math.round(data.rate * 100) / 100;
      // Reference only — does not change nestory_pricing_settings.rate.
      setStoredFxReference({
        rate: rounded,
        source: typeof data.source === "string" ? data.source : "api",
        asOf: typeof data.asOf === "string" ? data.asOf : undefined
      });
      setLiveRate(rounded);
    } catch {
      setLiveRate(null);
      setLiveRateError("無法取得今日匯率，請稍後再試（不影響已套用中的匯率）。");
    } finally {
      setLiveRateLoading(false);
    }
  }, []);

  const checkStatus = useCallback(async () => {
    statusAttemptedRef.current = true;
    setStatusChecking(true);
    try {
      const response = await fetch("/api/status");
      setStatus((await response.json()) as StatusPayload);
    } catch {
      setStatus(null);
    } finally {
      setStatusChecking(false);
    }
  }, []);

  // First open of connection section (incl. ?section=connection) probes once.
  useEffect(() => {
    if (open.connection && !statusAttemptedRef.current && !statusChecking) {
      void checkStatus();
    }
  }, [open.connection, statusChecking, checkStatus]);

  function toggle(id: SectionId) {
    setOpen((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function chooseProvider(next: AiProvider) {
    setProvider(next);
    window.localStorage.setItem(AI_PROVIDER_STORAGE_KEY, next);
  }

  function updatePricing(key: keyof PricingSettings, value: number) {
    if (!Number.isFinite(value)) return;
    setPricing((current) => {
      const next = { ...current, [key]: value };
      setStoredPricingSettings({ [key]: value });
      return next;
    });
  }

  function applyLiveRate() {
    if (liveRate == null) {
      setApplyNotice("請先按「抓取今日匯率」再套用。");
      return;
    }
    // Only this action mutates applied rate (pricing store).
    updatePricing("rate", liveRate);
    setApplyNotice(`已套用今日匯率 ${liveRate.toFixed(2)}（本裝置；頂欄套用中與公式會同步）。`);
  }

  function patchAutomation(patch: Partial<AutomationPrefs>) {
    if (!admin) return;
    setAutomation((current) => {
      const next = { ...current, ...patch };
      setStoredAutomationPrefs(patch);
      return next;
    });
  }

  function chooseTheme(value: ThemeId) {
    setTheme(value);
    document.body.dataset.theme = value;
    try {
      window.localStorage.setItem("nestory_theme", value);
    } catch {
      /* ignore */
    }
  }

  const shellClass = embedded
    ? "settings-page settings-page--embedded"
    : "container settings-page";
  const ShellTag = embedded ? "div" : "main";

  if (!roleReady) {
    return (
      <ShellTag className={shellClass}>
        {embedded ? null : <h1 className="settings-page-title">⚙ 設定</h1>}
        <p className="settings-page-lead">載入中…</p>
      </ShellTag>
    );
  }

  if (!allowed) {
    return (
      <ShellTag className={shellClass}>
        {embedded ? null : <h1 className="settings-page-title">⚙ 設定</h1>}
        <p className="settings-page-lead">
          請先登入具上架權限的帳號（admin／operator）才能使用設定。
        </p>
        <p>
          <Link className="button" href="/login">
            前往登入
          </Link>
        </p>
      </ShellTag>
    );
  }

  return (
    <ShellTag className={shellClass}>
      {embedded ? null : <h1 className="settings-page-title">⚙ 設定</h1>}
      {embedded ? null : (
        <p className="settings-page-lead">
          分類收合。定價與本機偏好會立刻生效；System Prompt 版本庫與自動化管線標示「待接線」的項目不會假裝已通。
          {admin ? null : " 你目前是 operator：可改定價／模型／外觀；System Prompt 與自動化僅 Admin 可改。"}
        </p>
      )}

      <div className="settings-stack">
        {/* ── 1. Model + System Prompt ── */}
        <CollapsibleSection
          open={open.model}
          onToggle={() => toggle("model")}
          summary={provider === "claude" ? "預設 Claude" : "預設 GPT"}
          title="🤖 AI 模型與 System Prompt"
        >
          <p className="settings-section-hint">
            這裡的 Provider 是<strong>全域預設</strong>。工作檯「本次模型」仍只影響單次生成（B8）。
            頂欄 ⋯ 也可切模型／模式／部署檢查。
          </p>
          <div className="pill-group" aria-label="預設文案 Provider" style={{ marginBottom: 12 }}>
            <button
              className={`pill-btn${provider === "claude" ? " active" : ""}`}
              onClick={() => chooseProvider("claude")}
              type="button"
            >
              Claude
            </button>
            <button
              className={`pill-btn${provider === "openai" ? " active" : ""}`}
              onClick={() => chooseProvider("openai")}
              type="button"
            >
              GPT
            </button>
            <button className="pill-btn" disabled title="未來：分欄位分 Provider" type="button">
              DeepSeek（未來）
            </button>
          </div>

          <div className="label-with-help" style={{ marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)" }}>
              System Prompt（逐版記錄）
            </span>
            <span className="settings-admin-tag">Admin</span>
          </div>
          {admin ? (
            <div>
              <textarea
                disabled
                rows={4}
                style={{ width: "100%", fontSize: 12 }}
                value="（待接線）正式 System Prompt 仍由程式／環境設定提供。此區為版本管理骨架，不會在本包改動 generate 讀取路徑。"
              />
              <p className="notice" style={{ marginTop: 8 }}>
                待 SQL／待接線：版本表 migration 已預留（026，可之後再執行）。本包<strong>不要求</strong>
                立刻跑 SQL；generate <strong>不會</strong>改讀資料庫 prompt。
              </p>
              <div className="settings-actions">
                <span className="settings-muted">目前：程式內建版 · 未接版本庫</span>
                <Button size="sm" disabled type="button">
                  歷史版本
                </Button>
                <Button size="sm" disabled type="button">
                  儲存新版
                </Button>
              </div>
            </div>
          ) : (
            <p className="settings-section-hint">僅 Admin 可檢視與編輯 System Prompt 版本。</p>
          )}
        </CollapsibleSection>

        {/* ── 2. Pricing ── */}
        <CollapsibleSection
          open={open.pricing}
          onToggle={() => toggle("pricing")}
          summary={`匯率 ${pricing.rate.toFixed(2)} · Showmore +${pricing.showmoreMarkupPercent}%`}
          title="💰 定價規則"
        >
          <div className="settings-row">
            <span>
              套用中匯率{" "}
              <b className="rate-val">{pricing.rate.toFixed(2)}</b>
            </span>
            <span className="settings-muted">
              今日匯率{" "}
              {liveRate != null ? (
                <b>{liveRate.toFixed(2)}</b>
              ) : (
                <span>—</span>
              )}
            </span>
            <Button
              size="sm"
              loading={liveRateLoading}
              onClick={() => void fetchLiveRate()}
              type="button"
            >
              抓取今日匯率
            </Button>
            <Button size="sm" disabled={liveRate == null} onClick={applyLiveRate} type="button">
              套用今日匯率
            </Button>
          </div>
          {liveRateError ? <div className="notice">{liveRateError}</div> : null}
          {applyNotice ? <div className="notice">{applyNotice}</div> : null}
          <p className="settings-section-hint">
            開頁自動抓與每日 Cron 只更新「今日參考」，不會改算價。要把參考寫進公式請按「套用今日匯率」。頂欄顯示套用中＋今日參考；無一鍵直接改套用中。
          </p>

          <div className="settings-grid">
            <div className="field">
              <label>CNY 匯率</label>
              <input
                onChange={(e) => updatePricing("rate", Number(e.target.value))}
                step="0.01"
                type="number"
                value={pricing.rate}
              />
            </div>
            <div className="field">
              <label>成本係數</label>
              <input
                onChange={(e) => updatePricing("costMultiplier", Number(e.target.value))}
                step="0.01"
                type="number"
                value={pricing.costMultiplier}
              />
            </div>
            <div className="field">
              <label>利潤加成</label>
              <input
                onChange={(e) => updatePricing("marginMultiplier", Number(e.target.value))}
                step="0.01"
                type="number"
                value={pricing.marginMultiplier}
              />
            </div>
            <div className="field">
              <label>定價加成（原價）</label>
              <input
                onChange={(e) => updatePricing("compareAtMultiplier", Number(e.target.value))}
                step="0.01"
                type="number"
                value={pricing.compareAtMultiplier}
              />
            </div>
            <div className="field">
              <label>最低售價 TWD</label>
              <input
                onChange={(e) => updatePricing("minPrice", Number(e.target.value))}
                step="1"
                type="number"
                value={pricing.minPrice}
              />
            </div>
            <div className="field">
              <label>Showmore 加價 %</label>
              <input
                onChange={(e) => updatePricing("showmoreMarkupPercent", Number(e.target.value))}
                step="0.5"
                type="number"
                value={pricing.showmoreMarkupPercent}
              />
            </div>
          </div>
          <div className="formula-preview">
            售價 ＝ 成本 × {pricing.rate.toFixed(2)} × {pricing.costMultiplier.toFixed(2)} ×{" "}
            {pricing.marginMultiplier.toFixed(2)}
            <br />
            定價 ＝ 成本 × {pricing.rate.toFixed(2)} × {pricing.costMultiplier.toFixed(2)} ×{" "}
            {pricing.compareAtMultiplier.toFixed(2)}
            <br />
            Showmore 匯出時另加 {pricing.showmoreMarkupPercent}% 後再尾數美化（匯出時已套用）
          </div>
          <div className="settings-note">
            與工作檯底部「定價規則設定」共用本機儲存，雙向同步。
            <br />
            ✨ 尾數美化：低／中／高價帶順眼數字；手填利潤時跳最近美化價。
            <br />
            Showmore +% 暫存本機（Q9-A），匯出 CSV 時帶入；日後可轉 team_settings。
          </div>
        </CollapsibleSection>

        {/* ── 3. Automation ── */}
        <CollapsibleSection
          open={open.automation}
          onToggle={() => toggle("automation")}
          summary={
            automation.workerMode === "off"
              ? "Worker 關閉"
              : automation.workerMode === "codex"
                ? "Codex"
                : "Make"
          }
          title="⚙️ 自動化與通知"
        >
          <p className="settings-section-hint">
            非敏感偏好可先存本機。Make Webhook URL <strong>禁止</strong>存在瀏覽器；未有伺服器端安全儲存前欄位停用。
            圖片批次完成通知（D6）以伺服器環境變數為準（RESEND_*／LINE_*）；下方勾選暫不擋 server 寄送。
            {!admin ? " 僅 Admin 可改此區。" : null}
          </p>
          <div className="pill-group" aria-label="Worker 模式" style={{ marginBottom: 10 }}>
            {(
              [
                ["make", "Make（預設）"],
                ["codex", "Codex"],
                ["off", "關閉"]
              ] as const
            ).map(([mode, label]) => (
              <button
                className={`pill-btn${automation.workerMode === mode ? " active" : ""}`}
                disabled={!admin}
                key={mode}
                onClick={() => patchAutomation({ workerMode: mode as WorkerMode })}
                type="button"
              >
                {label}
              </button>
            ))}
            <button className="pill-btn" disabled title="穩定後自架" type="button">
              n8n（未來）
            </button>
          </div>
          <div className="settings-row">
            <label className="check-row">
              <input
                checked={automation.emailNotify}
                disabled={!admin}
                onChange={(e) => patchAutomation({ emailNotify: e.target.checked })}
                type="checkbox"
              />
              Email 通知（本機偏好 · 真寄需 RESEND_API_KEY／RESEND_FROM／NOTIFY_EMAIL_TO）
            </label>
            <label className="check-row">
              <input
                checked={automation.lineNotify}
                disabled={!admin}
                onChange={(e) => patchAutomation({ lineNotify: e.target.checked })}
                type="checkbox"
              />
              LINE Messaging（本機偏好 · 真推需 LINE_CHANNEL_ACCESS_TOKEN／LINE_USER_ID；非 LINE Notify）
            </label>
          </div>
          <div className={`field settings-field-disabled`} style={{ marginTop: 8 }}>
            <label>Make Webhook URL</label>
            <input
              disabled
              placeholder="Phase D 接通後由伺服器端安全儲存"
              type="url"
              value=""
            />
            <p className="settings-muted" style={{ marginTop: 6 }}>
              不會寫入 localStorage。管線 Phase D 接通後再生效。
            </p>
          </div>

          {/* CAP-1: personal capture token — operator+admin; not admin-only */}
          <div className="settings-row" style={{ marginTop: 14, alignItems: "flex-start" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: "var(--text-muted)" }}>
                擷取 token（Chrome 小工具）
              </div>
              <p className="settings-section-hint" style={{ marginTop: 4, marginBottom: 0 }}>
                Chrome 擷取小工具用的個人金鑰。只能新建草稿，不能改別人的資料。外洩就按重設。
              </p>
              <p className="settings-muted" style={{ marginTop: 6 }}>
                {captureLoaded
                  ? captureHasToken
                    ? `目前：${capturePrefix ?? "ncap_••••"}`
                    : "尚未產生"
                  : "載入中…"}
                {captureCreatedAt
                  ? ` · ${new Date(captureCreatedAt).toLocaleString("zh-TW")}`
                  : null}
              </p>
              {capturePlainOnce ? (
                <div className="field" style={{ marginTop: 8 }}>
                  <label>新 token（只顯示一次）</label>
                  <input readOnly type="text" value={capturePlainOnce} />
                  <div className="settings-actions" style={{ marginTop: 6 }}>
                    <Button size="sm" onClick={() => void copyCaptureToken()} type="button">
                      複製
                    </Button>
                    <span className="settings-muted">離開或重整後無法再顯示完整內容</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="settings-actions" style={{ flexShrink: 0 }}>
              <Button
                size="sm"
                variant={captureResetArm ? "danger" : "secondary"}
                loading={captureBusy}
                onClick={onCaptureTokenPrimaryClick}
                type="button"
              >
                {!captureHasToken
                  ? "產生"
                  : captureResetArm
                    ? "確定重設？"
                    : "重設"}
              </Button>
              {captureResetArm ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={captureBusy}
                  onClick={() => setCaptureResetArm(false)}
                  type="button"
                >
                  取消
                </Button>
              ) : null}
            </div>
          </div>
        </CollapsibleSection>

        {/* ── 4. Appearance ── */}
        <CollapsibleSection
          open={open.appearance}
          onToggle={() => toggle("appearance")}
          summary={THEMES.find((t) => t.value === theme)?.title ?? "主題"}
          title="🎨 外觀主題"
        >
          <div className="pill-group" aria-label="主題">
            {THEMES.map((item) => (
              <button
                className={`pill-btn${theme === item.value ? " active" : ""}`}
                key={item.value}
                onClick={() => chooseTheme(item.value)}
                type="button"
              >
                {item.icon} {item.title}
              </button>
            ))}
          </div>
          <p className="settings-section-hint" style={{ marginTop: 10 }}>
            每個裝置各自記住（與頂欄主題切換同一資料）。不改全站間距字級（BX-P）。
          </p>
        </CollapsibleSection>

        {/* ── 5. Connection ── */}
        <CollapsibleSection
          open={open.connection}
          onToggle={() => toggle("connection")}
          summary={status ? "已檢查" : "點開檢查"}
          title="🔌 連線狀態"
        >
          <div className="settings-conn-list">
            <ConnRow
              label="Supabase"
              ok={status?.supabase}
              text={
                !status ? "未檢查" : status.supabase ? "已連線" : "連線失敗"
              }
            />
            <ConnRow
              label="OpenAI"
              ok={status?.aiProvider.openai}
              text={
                !status ? "未檢查" : status.aiProvider.openai ? "已設定" : "未設定"
              }
            />
            <ConnRow
              label="Claude"
              ok={status?.aiProvider.claude}
              text={
                !status ? "未檢查" : status.aiProvider.claude ? "已設定" : "未設定"
              }
            />
            <ConnRow
              label="Shopify Admin API"
              ok={status?.shopify}
              text={
                !status
                  ? "未檢查"
                  : status.shopify
                    ? status.shopifyMock
                      ? "已設定（mock）"
                      : "已設定"
                    : "未設定"
              }
            />
            {/*
              UX-J T58: no separate image/vision field on /api/status yet.
              Vision currently shares OPENAI_API_KEY with aiProvider.openai —
              show real green/red; never fake Phase D readiness. (No new API route.)
              Fable note: optional future status.vision / status.imageProvider columns.
            */}
            <ConnRow
              label="Vision / Image Provider"
              ok={!status ? null : status.aiProvider.openai}
              text={
                !status
                  ? "未檢查"
                  : status.aiProvider.openai
                    ? "已設定（與 OpenAI 共用 key）"
                    : "未設定 OPENAI_API_KEY"
              }
            />
            <p className="settings-muted">
              獨立 Image Provider 連線檢查尚未接（需後端補 status 欄）
            </p>
          </div>
          <div className="settings-actions">
            <Button
              size="sm"
              loading={statusChecking}
              onClick={() => void checkStatus()}
              type="button"
            >
              重新檢查連線
            </Button>
          </div>
        </CollapsibleSection>
      </div>
    </ShellTag>
  );
}

function ConnRow({
  label,
  text,
  ok
}: {
  label: string;
  text: string;
  ok: boolean | null | undefined;
}) {
  const schip =
    ok === true
      ? "schip schip--ok"
      : ok === false
        ? "schip schip--error"
        : "schip schip--idle";
  return (
    <div className="settings-conn-row">
      <span>{label}</span>
      <span className={schip}>{text}</span>
    </div>
  );
}
