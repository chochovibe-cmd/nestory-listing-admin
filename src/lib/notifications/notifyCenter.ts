/**
 * D6-open: Notify center — dual channel dispatch (Email Resend + LINE Messaging Flex).
 * Provider-swappable layer; missing keys → per-channel skipped.
 */

import { sendLineFlex } from "@/lib/notifications/channels/lineMessaging";
import { sendResendEmail } from "@/lib/notifications/channels/resend";
import {
  loadNotifyConfig,
  summarizeDispatch,
  type NotifyAppConfig
} from "@/lib/notifications/config";
import {
  buildImageBatchDoneEmail,
  buildImageBatchDoneFlex,
  buildImageBatchStuckEmail,
  buildImageBatchStuckFlex
} from "@/lib/notifications/templates/imageBatch";
import type {
  ImageBatchNotifyPayload,
  NotifyDispatchResult,
  NotifyEventType,
  StuckBatchNotifyPayload
} from "@/lib/notifications/types";

export type NotifyCenterDeps = {
  config?: NotifyAppConfig;
  fetchImpl?: typeof fetch;
};

export async function dispatchImageBatchDone(
  payload: ImageBatchNotifyPayload,
  deps: NotifyCenterDeps = {}
): Promise<NotifyDispatchResult> {
  const config = deps.config ?? loadNotifyConfig();
  const emailBody = buildImageBatchDoneEmail(payload);
  const flex = buildImageBatchDoneFlex(payload);

  const [email, line] = await Promise.all([
    sendResendEmail({
      config: config.email,
      subject: emailBody.subject,
      text: emailBody.text,
      html: emailBody.html,
      fetchImpl: deps.fetchImpl
    }),
    sendLineFlex({
      config: config.line,
      flexMessage: flex,
      fetchImpl: deps.fetchImpl
    })
  ]);

  return finalize("image_batch_done", [email, line]);
}

export async function dispatchImageBatchStuck(
  payload: StuckBatchNotifyPayload,
  deps: NotifyCenterDeps = {}
): Promise<NotifyDispatchResult> {
  const config = deps.config ?? loadNotifyConfig();
  const emailBody = buildImageBatchStuckEmail(payload);
  const flex = buildImageBatchStuckFlex(payload);

  const [email, line] = await Promise.all([
    sendResendEmail({
      config: config.email,
      subject: emailBody.subject,
      text: emailBody.text,
      html: emailBody.html,
      fetchImpl: deps.fetchImpl
    }),
    sendLineFlex({
      config: config.line,
      flexMessage: flex,
      fetchImpl: deps.fetchImpl
    })
  ]);

  return finalize("image_batch_stuck", [email, line]);
}

function finalize(
  event: NotifyEventType,
  attempts: NotifyDispatchResult["attempts"]
): NotifyDispatchResult {
  const { anySent, allSkipped, allFailedOrError } = summarizeDispatch(attempts);
  return { event, attempts, anySent, allSkipped, allFailedOrError };
}
