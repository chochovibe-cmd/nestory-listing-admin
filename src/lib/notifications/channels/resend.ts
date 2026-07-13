/**
 * D6-open: Resend email channel.
 * Missing config → skipped (never throw for not configured).
 */

import type { NotifyEmailConfig } from "@/lib/notifications/config";
import type { ChannelAttemptResult } from "@/lib/notifications/types";

const RESEND_API = "https://api.resend.com/emails";
const DEFAULT_TIMEOUT_MS = 8_000;

export type SendResendEmailInput = {
  config: NotifyEmailConfig | null;
  subject: string;
  text: string;
  html?: string;
  timeoutMs?: number;
  /** Inject for tests. */
  fetchImpl?: typeof fetch;
};

export async function sendResendEmail(input: SendResendEmailInput): Promise<ChannelAttemptResult> {
  const { config, subject, text, html, timeoutMs = DEFAULT_TIMEOUT_MS } = input;
  if (!config) {
    return {
      channel: "email",
      status: "skipped",
      reason: "missing_resend_config"
    };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchFn(RESEND_API, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: config.from,
        to: config.to,
        subject,
        text,
        html: html ?? undefined
      }),
      signal: controller.signal
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        channel: "email",
        status: "error",
        reason: `resend_http_${res.status}:${body.slice(0, 120)}`
      };
    }

    let messageId: string | undefined;
    try {
      const json = (await res.json()) as { id?: string };
      if (json?.id) messageId = json.id;
    } catch {
      // ignore parse
    }

    return { channel: "email", status: "sent", messageId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      channel: "email",
      status: "error",
      reason: msg.slice(0, 160)
    };
  } finally {
    clearTimeout(timer);
  }
}
