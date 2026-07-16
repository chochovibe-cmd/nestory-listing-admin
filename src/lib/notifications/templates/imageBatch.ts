/**
 * D6-open: Email + LINE Flex copy for image batch events.
 * Pure builders — no I/O.
 */

import type { ImageBatchNotifyPayload, StuckBatchNotifyPayload } from "@/lib/notifications/types";

export function shortBatchId(batchId: string): string {
  return batchId.replace(/-/g, "").slice(0, 8);
}

export function buildImageBatchDoneEmail(payload: ImageBatchNotifyPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const {
    doneCount,
    failedCount,
    skippedCount,
    totalCount,
    regenerateItemCount,
    reviewUrl,
    batchIdShort
  } = payload;

  const regenNote =
    regenerateItemCount > 0
      ? `（其中 ${regenerateItemCount} 件含重生類，建議優先在生圖工廠查看）`
      : "";

  const subject = `潮巢｜圖片批次完成（成功 ${doneCount}／失敗 ${failedCount}）`;

  const lines = [
    `你送出的圖片批次已全部到終態。`,
    ``,
    `批次：${batchIdShort}`,
    `合計：${totalCount} 件`,
    `成功：${doneCount} 件${regenNote}`,
    `失敗：${failedCount} 件`,
    skippedCount > 0 ? `略過：${skippedCount} 件` : null,
    ``,
    reviewUrl ? `打開生圖工廠：${reviewUrl}` : `請到 App 的「生圖工廠」頁查看。`,
    ``,
    `— Nestory 上架系統（自動通知）`
  ].filter((x) => x !== null) as string[];

  const text = lines.join("\n");
  const html = `
    <p>你送出的圖片批次已全部到終態。</p>
    <ul>
      <li>批次：<code>${escapeHtml(batchIdShort)}</code></li>
      <li>合計：${totalCount} 件</li>
      <li>成功：${doneCount} 件${escapeHtml(regenNote)}</li>
      <li>失敗：${failedCount} 件</li>
      ${skippedCount > 0 ? `<li>略過：${skippedCount} 件</li>` : ""}
    </ul>
    <p>${
      reviewUrl
        ? `<a href="${escapeHtml(reviewUrl)}">打開生圖工廠</a>`
        : "請到 App 的「生圖工廠」頁查看。"
    }</p>
    <p style="color:#888;font-size:12px">— Nestory 上架系統（自動通知）</p>
  `.trim();

  return { subject, text, html };
}

export function buildImageBatchStuckEmail(payload: StuckBatchNotifyPayload): {
  subject: string;
  text: string;
  html: string;
} {
  const { batchIdShort, ageHours, totalCount, doneCount, failedCount, reviewUrl, status } =
    payload;

  const subject = `潮巢｜圖片批次卡住提醒（>${Math.floor(ageHours)}h）`;
  const text = [
    `有一筆圖片批次超過 24 小時仍未全部完成。`,
    ``,
    `批次：${batchIdShort}`,
    `狀態：${status}`,
    `已等待約 ${Math.floor(ageHours)} 小時`,
    `進度：成功 ${doneCount}／失敗 ${failedCount}／合計 ${totalCount}`,
    ``,
    reviewUrl ? `打開生圖工廠：${reviewUrl}` : `請到 App 檢查送圖批次或重試 AI 處理。`,
    ``,
    `— Nestory 上架系統（自動通知）`
  ].join("\n");

  const html = `
    <p>有一筆圖片批次超過 24 小時仍未全部完成。</p>
    <ul>
      <li>批次：<code>${escapeHtml(batchIdShort)}</code></li>
      <li>狀態：${escapeHtml(status)}</li>
      <li>已等待約 ${Math.floor(ageHours)} 小時</li>
      <li>進度：成功 ${doneCount}／失敗 ${failedCount}／合計 ${totalCount}</li>
    </ul>
    <p>${
      reviewUrl
        ? `<a href="${escapeHtml(reviewUrl)}">打開生圖工廠</a>`
        : "請到 App 檢查送圖批次或重試 AI 處理。"
    }</p>
    <p style="color:#888;font-size:12px">— Nestory 上架系統（自動通知）</p>
  `.trim();

  return { subject, text, html };
}

/** LINE Messaging API Flex Message (bubble). Not LINE Notify. */
export function buildImageBatchDoneFlex(payload: ImageBatchNotifyPayload): Record<string, unknown> {
  const {
    doneCount,
    failedCount,
    totalCount,
    regenerateItemCount,
    reviewUrl,
    batchIdShort
  } = payload;

  const regen =
    regenerateItemCount > 0 ? `\n重生類 ${regenerateItemCount} 件建議先看` : "";

  const bodyContents: Record<string, unknown>[] = [
    {
      type: "text",
      text: "圖片批次完成",
      weight: "bold",
      size: "lg"
    },
    {
      type: "text",
      text: `成功 ${doneCount}／失敗 ${failedCount}（共 ${totalCount}）${regen}`,
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

  const footerContents: Record<string, unknown>[] = reviewUrl
    ? [
        {
          type: "button",
          style: "primary",
          action: {
            type: "uri",
            label: "打開生圖工廠",
            uri: reviewUrl
          }
        }
      ]
    : [
        {
          type: "text",
          text: "請到 App「生圖工廠」查看",
          size: "sm",
          wrap: true,
          align: "center"
        }
      ];

  return {
    type: "flex",
    altText: `圖片批次完成：成功 ${doneCount}／失敗 ${failedCount}`,
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

export function buildImageBatchStuckFlex(payload: StuckBatchNotifyPayload): Record<string, unknown> {
  const { batchIdShort, ageHours, totalCount, doneCount, failedCount, reviewUrl } = payload;

  const footerContents: Record<string, unknown>[] = reviewUrl
    ? [
        {
          type: "button",
          style: "primary",
          action: {
            type: "uri",
            label: "打開生圖工廠",
            uri: reviewUrl
          }
        }
      ]
    : [
        {
          type: "text",
          text: "請到 App 檢查批次",
          size: "sm",
          wrap: true,
          align: "center"
        }
      ];

  return {
    type: "flex",
    altText: `圖片批次卡住：已等待約 ${Math.floor(ageHours)} 小時`,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "text",
            text: "圖片批次卡住",
            weight: "bold",
            size: "lg",
            color: "#C45C26"
          },
          {
            type: "text",
            text: `已超過 24 小時未完成（約 ${Math.floor(ageHours)} 小時）`,
            wrap: true,
            margin: "md",
            size: "sm"
          },
          {
            type: "text",
            text: `進度 ${doneCount}/${totalCount}（失敗 ${failedCount}）· ${batchIdShort}`,
            size: "xs",
            color: "#888888",
            margin: "sm",
            wrap: true
          }
        ]
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
