/**
 * D6-open: LINE Messaging API push (Flex).
 * ⚠ Do NOT use LINE Notify (shut down 2025-03).
 * Missing config → skipped.
 */

import type { NotifyLineConfig } from "@/lib/notifications/config";
import type { ChannelAttemptResult } from "@/lib/notifications/types";

const LINE_PUSH_API = "https://api.line.me/v2/bot/message/push";
const DEFAULT_TIMEOUT_MS = 8_000;

export type SendLineFlexInput = {
  config: NotifyLineConfig | null;
  /** Flex message object: { type: "flex", altText, contents } */
  flexMessage: Record<string, unknown>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

/**
 * Push the same Flex to each user id in config.
 * status "sent" if at least one user push succeeds.
 */
export async function sendLineFlex(input: SendLineFlexInput): Promise<ChannelAttemptResult> {
  const { config, flexMessage, timeoutMs = DEFAULT_TIMEOUT_MS } = input;
  if (!config) {
    return {
      channel: "line",
      status: "skipped",
      reason: "missing_line_messaging_config"
    };
  }

  // Guard: never call legacy Notify endpoint
  if (LINE_PUSH_API.includes("notify-api.line.me")) {
    return {
      channel: "line",
      status: "error",
      reason: "line_notify_forbidden"
    };
  }

  const fetchFn = input.fetchImpl ?? fetch;
  let anyOk = false;
  let lastError = "";

  for (const userId of config.userIds) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchFn(LINE_PUSH_API, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.channelAccessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          to: userId,
          messages: [flexMessage]
        }),
        signal: controller.signal
      });

      if (res.ok) {
        anyOk = true;
      } else {
        const body = await res.text().catch(() => "");
        lastError = `line_http_${res.status}:${body.slice(0, 100)}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }
  }

  if (anyOk) {
    return { channel: "line", status: "sent" };
  }

  return {
    channel: "line",
    status: "error",
    reason: (lastError || "line_push_failed").slice(0, 160)
  };
}
