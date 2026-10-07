import { createHash } from "node:crypto";
import type { createServiceSupabaseClient } from "@/lib/supabase/server";
import {
  canonicalizeYouTubeUrl,
  normalizeVideoUrls
} from "@/lib/media/videoUrls";
import { fetchServerVideo } from "@/lib/media/fetchServerVideo";
import {
  getYouTubeAccessToken,
  readYouTubeIntegrationStatus
} from "@/lib/youtube/oauth";
import {
  uploadYouTubeVideoBuffer,
  type YouTubeUploadResult
} from "@/lib/youtube/upload";

type ServiceSupabase = ReturnType<typeof createServiceSupabaseClient>;

type DraftVideoShape = {
  id: string;
  title_zh?: string | null;
  taobao_title?: string | null;
  video_urls?: unknown;
};

type VideoMapValue = {
  status: "completed" | "blocked_private";
  youtube_url: string;
  youtube_video_id: string;
  privacy_status: string;
  uploaded_at: string;
  source_host: string;
};

export type EnsureDraftVideosResult = {
  videoUrls: string[];
  warnings: string[];
  converted: number;
  reused: number;
  hadFailures: boolean;
};

type EnsureDeps = {
  fetchVideo?: typeof fetchServerVideo;
  getAccessToken?: typeof getYouTubeAccessToken;
  uploadVideo?: typeof uploadYouTubeVideoBuffer;
};

const VIDEO_MAP_PREFIX = "youtube_video_map_v1:";
const TAOBAO_VIDEO_HOST_SUFFIXES = [
  "taobao.com",
  "tmall.com",
  "alicdn.com",
  "tbcdn.cn",
  "taobaocdn.com"
];

function hostMatches(hostname: string, suffix: string): boolean {
  const host = hostname.toLowerCase();
  return host === suffix || host.endsWith(`.${suffix}`);
}

export function isSupportedTaobaoVideoSource(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  return TAOBAO_VIDEO_HOST_SUFFIXES.some((suffix) =>
    hostMatches(url.hostname, suffix)
  );
}

function sourceIdentity(raw: string): { hash: string; host: string } | null {
  try {
    const url = new URL(raw);
    const stable = `${url.origin}${url.pathname}`;
    return {
      hash: createHash("sha256").update(stable).digest("hex"),
      host: url.hostname.toLowerCase()
    };
  } catch {
    return null;
  }
}

function mapKey(hash: string): string {
  return `${VIDEO_MAP_PREFIX}${hash}`;
}

async function readVideoMap(
  serviceSupabase: ServiceSupabase,
  hash: string
): Promise<VideoMapValue | null> {
  const { data, error } = await serviceSupabase
    .from("team_settings")
    .select("value")
    .eq("key", mapKey(hash))
    .maybeSingle();
  if (error) return null;
  const value = data?.value as Partial<VideoMapValue> | null | undefined;
  if (
    !value ||
    (value.status !== "completed" && value.status !== "blocked_private") ||
    typeof value.youtube_url !== "string" ||
    typeof value.youtube_video_id !== "string" ||
    typeof value.uploaded_at !== "string"
  ) {
    return null;
  }
  return value as VideoMapValue;
}

async function saveVideoMap(
  serviceSupabase: ServiceSupabase,
  hash: string,
  value: VideoMapValue
): Promise<string | null> {
  const { error } = await serviceSupabase.from("team_settings").upsert(
    {
      key: mapKey(hash),
      value,
      updated_by: null
    },
    { onConflict: "key" }
  );
  return error?.message ?? null;
}

function isFreshBlockedPrivate(value: VideoMapValue): boolean {
  if (value.status !== "blocked_private") return false;
  const at = Date.parse(value.uploaded_at);
  return Number.isFinite(at) && Date.now() - at < 24 * 60 * 60 * 1000;
}

function draftVideoTitle(draft: DraftVideoShape): string {
  return draft.title_zh?.trim() || draft.taobao_title?.trim() || "潮巢商品影片";
}

function uniqueWarnings(warnings: string[]): string[] {
  return [...new Set(warnings.map((warning) => warning.trim()).filter(Boolean))].slice(0, 12);
}

export async function ensureDraftVideosOnYouTube(input: {
  serviceSupabase: ServiceSupabase;
  draft: DraftVideoShape;
  deps?: EnsureDeps;
}): Promise<EnsureDraftVideosResult> {
  const original = normalizeVideoUrls(input.draft.video_urls ?? []);
  if (!original.length) {
    return { videoUrls: [], warnings: [], converted: 0, reused: 0, hadFailures: false };
  }

  const output = [...original];
  const rawIndexes = original
    .map((url, index) => ({ url, index }))
    .filter(({ url }) => !canonicalizeYouTubeUrl(url));
  if (!rawIndexes.length) {
    return { videoUrls: original, warnings: [], converted: 0, reused: 0, hadFailures: false };
  }

  const warnings: string[] = [];
  let converted = 0;
  let reused = 0;
  let hadFailures = false;

  if (process.env.YOUTUBE_AUTO_UPLOAD === "false") {
    return {
      videoUrls: original,
      warnings: ["YouTube 自動轉存已停用（YOUTUBE_AUTO_UPLOAD=false）；淘寶原始影片本次不會送到 Shopify。"],
      converted,
      reused,
      hadFailures: true
    };
  }

  const integration = await readYouTubeIntegrationStatus(input.serviceSupabase);
  if (!integration.envConfigured || !integration.connected) {
    return {
      videoUrls: original,
      warnings: [
        !integration.envConfigured
          ? "YouTube 自動轉存尚未完成伺服器設定；淘寶原始影片本次不會送到 Shopify。"
          : "YouTube 尚未在 Nestory 設定頁完成授權；淘寶原始影片本次不會送到 Shopify。"
      ],
      converted,
      reused,
      hadFailures: true
    };
  }

  const fetchVideo = input.deps?.fetchVideo ?? fetchServerVideo;
  const getAccessToken = input.deps?.getAccessToken ?? getYouTubeAccessToken;
  const uploadVideo = input.deps?.uploadVideo ?? uploadYouTubeVideoBuffer;
  let accessToken: string | null = null;

  for (const item of rawIndexes) {
    if (!isSupportedTaobaoVideoSource(item.url)) {
      warnings.push(`影片略過：不是可自動轉存的淘寶／天貓影片來源（${item.url.slice(0, 80)}）`);
      hadFailures = true;
      continue;
    }

    const identity = sourceIdentity(item.url);
    if (!identity) {
      warnings.push("影片略過：來源網址無法建立穩定識別碼");
      hadFailures = true;
      continue;
    }

    const mapped = await readVideoMap(input.serviceSupabase, identity.hash);
    if (mapped?.status === "completed") {
      const canonical = canonicalizeYouTubeUrl(mapped.youtube_url);
      if (canonical) {
        output[item.index] = canonical;
        reused += 1;
        continue;
      }
    }
    if (mapped && isFreshBlockedPrivate(mapped)) {
      warnings.push(
        "YouTube 最近一次上傳被強制成私人影片；24 小時內不重複上傳。Google Cloud 專案通過 YouTube API audit 後可再試。"
      );
      hadFailures = true;
      continue;
    }

    if (!accessToken) {
      try {
        accessToken = await getAccessToken(input.serviceSupabase);
      } catch (error) {
        warnings.push(
          `YouTube 授權更新失敗：${error instanceof Error ? error.message : String(error)}`
        );
        hadFailures = true;
        break;
      }
    }

    const fetched = await fetchVideo(item.url);
    if (!fetched.ok) {
      warnings.push(`淘寶影片下載失敗：${fetched.message}`);
      hadFailures = true;
      continue;
    }

    let uploaded: YouTubeUploadResult;
    try {
      uploaded = await uploadVideo({
        accessToken,
        bytes: fetched.bytes,
        contentType: fetched.contentType,
        title: draftVideoTitle(input.draft)
      });
    } catch (error) {
      uploaded = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        status: null
      };
    }

    if (!uploaded.ok) {
      warnings.push(uploaded.error);
      hadFailures = true;
      continue;
    }

    const mapping: VideoMapValue = {
      status: uploaded.usableForShopify ? "completed" : "blocked_private",
      youtube_url: uploaded.youtubeUrl,
      youtube_video_id: uploaded.videoId,
      privacy_status: uploaded.privacyStatus,
      uploaded_at: new Date().toISOString(),
      source_host: identity.host
    };
    const mapError = await saveVideoMap(input.serviceSupabase, identity.hash, mapping);
    if (mapError) {
      warnings.push(`YouTube 影片已上傳，但去重映射保存失敗：${mapError}`);
    }

    if (!uploaded.usableForShopify) {
      warnings.push(uploaded.warning || "YouTube 影片不是可公開嵌入的狀態");
      hadFailures = true;
      continue;
    }

    const canonical = canonicalizeYouTubeUrl(uploaded.youtubeUrl);
    if (!canonical) {
      warnings.push("YouTube 已回傳影片 ID，但產生的網址未通過 Nestory URL 驗證");
      hadFailures = true;
      continue;
    }
    output[item.index] = canonical;
    converted += 1;
  }

  const normalizedOutput = normalizeVideoUrls(output);
  if (normalizedOutput.join("\n") !== original.join("\n")) {
    const { error } = await input.serviceSupabase
      .from("product_drafts")
      .update({ video_urls: normalizedOutput })
      .eq("id", input.draft.id);
    if (error) {
      warnings.push(
        `YouTube 影片已可使用，但 video_urls 回填失敗：${error.message}；已用去重映射避免下次重複上傳。`
      );
    }
  }

  return {
    videoUrls: normalizedOutput,
    warnings: uniqueWarnings(warnings),
    converted,
    reused,
    hadFailures
  };
}
