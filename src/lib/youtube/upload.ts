import { randomBytes } from "node:crypto";

export type YouTubePrivacy = "public" | "unlisted" | "private";

export type YouTubeUploadResult =
  | {
      ok: true;
      videoId: string;
      youtubeUrl: string;
      privacyStatus: string;
      usableForShopify: boolean;
      warning: string | null;
    }
  | {
      ok: false;
      error: string;
      status: number | null;
    };

export function getYouTubeDefaultPrivacy(): YouTubePrivacy {
  const raw = process.env.YOUTUBE_DEFAULT_PRIVACY?.trim().toLowerCase();
  if (raw === "unlisted" || raw === "private" || raw === "public") return raw;
  return "public";
}

function titleWithinLimit(raw: string): string {
  const text = raw.trim() || "潮巢商品影片";
  return Array.from(text).slice(0, 100).join("");
}

function googleErrorMessage(payload: any, status: number): string {
  const message = payload?.error?.message;
  if (typeof message === "string" && message.trim()) return message.trim();
  const reason = payload?.error?.errors?.[0]?.reason;
  if (typeof reason === "string" && reason.trim()) return reason.trim();
  return `HTTP ${status}`;
}

export async function uploadYouTubeVideoBuffer(input: {
  accessToken: string;
  bytes: Buffer;
  contentType: string;
  title: string;
  privacyStatus?: YouTubePrivacy;
  fetchImpl?: typeof fetch;
}): Promise<YouTubeUploadResult> {
  const privacyStatus = input.privacyStatus ?? getYouTubeDefaultPrivacy();
  const boundary = `nestory_youtube_${randomBytes(12).toString("hex")}`;
  const metadata = {
    snippet: {
      title: titleWithinLimit(input.title),
      description: "",
      categoryId: "22"
    },
    status: {
      privacyStatus,
      embeddable: true,
      selfDeclaredMadeForKids: false
    }
  };

  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${input.contentType}\r\nContent-Transfer-Encoding: binary\r\n\r\n`,
    "utf8"
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
  const body = Buffer.concat([prefix, input.bytes, suffix]);
  const url = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
  url.searchParams.set("part", "snippet,status");
  url.searchParams.set("uploadType", "multipart");
  url.searchParams.set("notifySubscribers", "false");

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
        "Content-Length": String(body.byteLength)
      },
      body,
      cache: "no-store"
    });
  } catch {
    return { ok: false, error: "YouTube upload network request failed", status: null };
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: `YouTube upload failed: ${googleErrorMessage(payload, response.status)}`,
      status: response.status
    };
  }
  const videoId = typeof payload?.id === "string" ? payload.id : "";
  if (!videoId) {
    return {
      ok: false,
      error: "YouTube upload succeeded but no video ID was returned",
      status: response.status
    };
  }
  const actualPrivacy =
    typeof payload?.status?.privacyStatus === "string"
      ? payload.status.privacyStatus
      : privacyStatus;
  const usableForShopify = actualPrivacy === "public" || actualPrivacy === "unlisted";
  const warning = usableForShopify
    ? null
    : actualPrivacy === "private" && privacyStatus !== "private"
      ? "YouTube 將影片強制設為私人。新建立且尚未通過 YouTube API audit 的 Google Cloud 專案可能會遇到此限制；私人影片不能作為 Shopify 前台 EXTERNAL_VIDEO。"
      : "YouTube 影片目前是私人狀態，Shopify 前台無法播放。";

  return {
    ok: true,
    videoId,
    youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
    privacyStatus: actualPrivacy,
    usableForShopify,
    warning
  };
}
