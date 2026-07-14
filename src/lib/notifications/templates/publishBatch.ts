/**
 * D6-#2 / notify2: Email + LINE Flex for publish_batch_done (#2).
 * Q2-B: Email lists fail/skip (all) + success ≤20; LINE counts only.
 * Pure builders — no I/O.
 */

import type { PublishBatchNotifyPayload } from "@/lib/notifications/types";
import { shortBatchId } from "@/lib/notifications/templates/imageBatch";

export { shortBatchId };

/** Q2-B: Email success title list hard cap. */
export const PUBLISH_NOTIFY_MAX_SUCCESS_LINES = 20;

/** Truncate product titles for readable Email lines. */
export const PUBLISH_NOTIFY_TITLE_MAX = 28;

export function truncateNotifyTitle(
  title: string | null | undefined,
  max: number = PUBLISH_NOTIFY_TITLE_MAX
): string {
  const t = (title || "未命名草稿").trim() || "未命名草稿";
  if (t.length <= max) return t;
  if (max <= 1) return "…";
  return `${t.slice(0, max - 1)}…`;
}

export function formatPublishNotifyLine(
  title: string,
  errorMessage?: string | null
): string {
  const t = truncateNotifyTitle(title);
  const reason = errorMessage?.trim();
  if (!reason) return t;
  return `${t} — ${reason}`;
}

/**
 * Split terminal item rows into Email list fields (pure).
 * success capped at PUBLISH_NOTIFY_MAX_SUCCESS_LINES.
 */
export function buildPublishNotifyLineLists(
  items: Array<{
    draftId: string;
    itemStatus: string;
    errorMessage?: string | null;
    title?: string | null;
  }>,
  maxSuccess: number = PUBLISH_NOTIFY_MAX_SUCCESS_LINES
): {
  successLines: string[];
  failedLines: string[];
  skippedLines: string[];
  successTruncated: boolean;
  doneCount: number;
  failedCount: number;
  skippedCount: number;
} {
  const successAll: string[] = [];
  const failedLines: string[] = [];
  const skippedLines: string[] = [];

  for (const item of items) {
    const title = item.title || "未命名草稿";
    if (item.itemStatus === "done") {
      successAll.push(truncateNotifyTitle(title));
    } else if (item.itemStatus === "failed") {
      failedLines.push(
        formatPublishNotifyLine(title, item.errorMessage || "未知錯誤")
      );
    } else if (item.itemStatus === "skipped") {
      skippedLines.push(
        formatPublishNotifyLine(title, item.errorMessage || "已略過")
      );
    }
  }

  const successTruncated = successAll.length > maxSuccess;
  const successLines = successAll.slice(0, maxSuccess);

  return {
    successLines,
    failedLines,
    skippedLines,
    successTruncated,
    doneCount: successAll.length,
    failedCount: failedLines.length,
    skippedCount: skippedLines.length
  };
}

export function buildPublishBatchDoneEmail(payload: PublishBatchNotifyPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const {
    batchIdShort,
    totalCount,
    doneCount,
    failedCount,
    skippedCount,
    successLines,
    failedLines,
    skippedLines,
    successTruncated,
    recordsUrl
  } = payload;

  const subject = `潮巢｜發布批次完成（成功 ${doneCount}／失敗 ${failedCount}）`;

  const successBlock =
    successLines.length > 0
      ? [
          `成功清單：`,
          ...successLines.map((l) => `  · ${l}`),
          successTruncated
            ? `  · …其餘成功件請至發布紀錄頁查看（僅列前 ${PUBLISH_NOTIFY_MAX_SUCCESS_LINES}）`
            : null
        ].filter(Boolean)
      : doneCount > 0
        ? [`成功：${doneCount} 件`]
        : [];

  const failedBlock =
    failedLines.length > 0
      ? [`失敗清單：`, ...failedLines.map((l) => `  · ${l}`)]
      : failedCount > 0
        ? [`失敗：${failedCount} 件`]
        : [];

  const skippedBlock =
    skippedLines.length > 0
      ? [`略過清單：`, ...skippedLines.map((l) => `  · ${l}`)]
      : skippedCount > 0
        ? [`略過：${skippedCount} 件`]
        : [];

  const lines = [
    `你送出的發布批次已全部到終態。`,
    ``,
    `批次：${batchIdShort}`,
    `合計：${totalCount} 件`,
    `成功：${doneCount} 件`,
    `失敗：${failedCount} 件`,
    skippedCount > 0 ? `略過：${skippedCount} 件` : null,
    ``,
    ...successBlock,
    successBlock.length ? `` : null,
    ...failedBlock,
    failedBlock.length ? `` : null,
    ...skippedBlock,
    skippedBlock.length ? `` : null,
    recordsUrl ? `打開發布紀錄：${recordsUrl}` : `請到 App 的「發布紀錄」頁查看。`,
    ``,
    `— Nestory 上架系統（自動通知）`
  ].filter((x) => x !== null) as string[];

  const text = lines.join("\n");

  const listHtml = (label: string, items: string[], truncatedNote?: string | null) => {
    if (!items.length && !truncatedNote) return "";
    const lis = items.map((l) => `<li>${escapeHtml(l)}</li>`).join("");
    const extra = truncatedNote
      ? `<li style="color:#888">${escapeHtml(truncatedNote)}</li>`
      : "";
    return `<p><strong>${escapeHtml(label)}</strong></p><ul>${lis}${extra}</ul>`;
  };

  const html = `
    <p>你送出的發布批次已全部到終態。</p>
    <ul>
      <li>批次：<code>${escapeHtml(batchIdShort)}</code></li>
      <li>合計：${totalCount} 件</li>
      <li>成功：${doneCount} 件</li>
      <li>失敗：${failedCount} 件</li>
      ${skippedCount > 0 ? `<li>略過：${skippedCount} 件</li>` : ""}
    </ul>
    ${listHtml("成功清單", successLines, successTruncated ? `…其餘成功件請至發布紀錄頁查看（僅列前 ${PUBLISH_NOTIFY_MAX_SUCCESS_LINES}）` : null)}
    ${listHtml("失敗清單", failedLines)}
    ${listHtml("略過清單", skippedLines)}
    <p>${
      recordsUrl
        ? `<a href="${escapeHtml(recordsUrl)}">打開發布紀錄</a>`
        : "請到 App 的「發布紀錄」頁查看。"
    }</p>
    <p style="color:#888;font-size:12px">— Nestory 上架系統（自動通知）</p>
  `.trim();

  return { subject, text, html };
}

/** LINE Messaging API Flex — counts only + deep link (Q2-B). Not LINE Notify. */
export function buildPublishBatchDoneFlex(
  payload: PublishBatchNotifyPayload
): Record<string, unknown> {
  const {
    doneCount,
    failedCount,
    skippedCount,
    totalCount,
    batchIdShort,
    recordsUrl
  } = payload;

  const skipPart = skippedCount > 0 ? ` · 略過 ${skippedCount}` : "";

  const bodyContents: Record<string, unknown>[] = [
    {
      type: "text",
      text: "發布批次完成",
      weight: "bold",
      size: "lg"
    },
    {
      type: "text",
      text: `成功 ${doneCount}／失敗 ${failedCount}（共 ${totalCount}）${skipPart}`,
      wrap: true,
      margin: "md",
      size: "sm"
    },
    {
      type: "text",
      text: `批次 ${batchIdShort}`,
      size: "xs",
      color: "#888888",
      margin: "sm"
    }
  ];

  const footerContents: Record<string, unknown>[] = recordsUrl
    ? [
        {
          type: "button",
          style: "primary",
          action: {
            type: "uri",
            label: "打開紀錄",
            uri: recordsUrl
          }
        }
      ]
    : [
        {
          type: "text",
          text: "請到 App「發布紀錄」查看",
          size: "sm",
          wrap: true,
          align: "center"
        }
      ];

  return {
    type: "flex",
    altText: `發布批次完成：成功 ${doneCount}／失敗 ${failedCount}`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        contents: footerContents
      }
    }
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
