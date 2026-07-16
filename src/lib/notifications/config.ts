/**
 * D6-open: server-only notify config from env.
 * Missing keys → channel skipped (never throw for "not configured").
 */

export type NotifyEmailConfig = {
  apiKey: string;
  from: string;
  to: string[];
};

export type NotifyLineConfig = {
  channelAccessToken: string;
  userIds: string[];
};

export type NotifyAppConfig = {
  email: NotifyEmailConfig | null;
  line: NotifyLineConfig | null;
  appBaseUrl: string | null;
  emailReady: boolean;
  lineReady: boolean;
  anyChannelReady: boolean;
};

function splitList(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Prefer APP_BASE_URL; fallback https://VERCEL_URL (no protocol in VERCEL_URL). */
export function resolveAppBaseUrl(
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const explicit = env.APP_BASE_URL?.trim() || env.NOTIFY_APP_BASE_URL?.trim();
  if (explicit) {
    return explicit.replace(/\/+$/, "");
  }
  const vercel = env.VERCEL_URL?.trim();
  if (vercel) {
    const host = vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    if (host) return `https://${host}`;
  }
  return null;
}

export function buildReviewUrl(
  appBaseUrl: string | null,
  path = "/review"
): string | null {
  if (!appBaseUrl) return null;
  const base = appBaseUrl.replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${base}${p}`;
}

/** R4 §12: image batch done → 生圖工廠「生成完成待審」. */
export function buildImageReviewPendingUrl(
  appBaseUrl: string | null
): string | null {
  return buildReviewUrl(appBaseUrl, "/review?section=pending");
}

/** R4 §12: publish batch done → 發布紀錄批次卡. */
export function buildPublishRecordsBatchUrl(
  appBaseUrl: string | null,
  batchId: string
): string | null {
  if (!batchId?.trim()) {
    return buildReviewUrl(appBaseUrl, "/records?tab=batches");
  }
  const q = new URLSearchParams({
    tab: "batches",
    batch: batchId.trim()
  });
  return buildReviewUrl(appBaseUrl, `/records?${q.toString()}`);
}

export function loadNotifyConfig(env: NodeJS.ProcessEnv = process.env): NotifyAppConfig {
  const resendKey = env.RESEND_API_KEY?.trim() || "";
  const resendFrom = env.RESEND_FROM?.trim() || "";
  const emailTo = splitList(env.NOTIFY_EMAIL_TO || env.RESEND_TO);
  const emailReady = Boolean(resendKey && resendFrom && emailTo.length > 0);
  const email: NotifyEmailConfig | null = emailReady
    ? { apiKey: resendKey, from: resendFrom, to: emailTo }
    : null;

  const lineToken = env.LINE_CHANNEL_ACCESS_TOKEN?.trim() || "";
  const lineUsers = splitList(env.LINE_USER_ID || env.LINE_TO_USER_IDS);
  const lineReady = Boolean(lineToken && lineUsers.length > 0);
  const line: NotifyLineConfig | null = lineReady
    ? { channelAccessToken: lineToken, userIds: lineUsers }
    : null;

  const appBaseUrl = resolveAppBaseUrl(env);

  return {
    email,
    line,
    appBaseUrl,
    emailReady,
    lineReady,
    anyChannelReady: emailReady || lineReady
  };
}

/** Pure: Q3b claim rule — at least one channel "sent". */
export function shouldClaimAfterDispatch(attempts: { status: string }[]): boolean {
  return attempts.some((a) => a.status === "sent");
}

export function summarizeDispatch(attempts: { status: string }[]): {
  anySent: boolean;
  allSkipped: boolean;
  allFailedOrError: boolean;
} {
  const anySent = attempts.some((a) => a.status === "sent");
  const allSkipped =
    attempts.length > 0 && attempts.every((a) => a.status === "skipped");
  const allFailedOrError =
    !anySent && attempts.some((a) => a.status === "error");
  return { anySent, allSkipped, allFailedOrError };
}
