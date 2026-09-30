import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("\nD10 Phase 2 — Taobao -> YouTube -> Shopify\n");

await check("Taobao capture already supplies video_urls", () => {
  const src = read("extension/lib/adapters/taobao.js");
  assert.match(src, /var video_urls = \[\]/);
  assert.match(src, /video_urls:\s*video_urls/);
  assert.match(src, /uniqueUrls\(video_urls, 3\)/);
});

await check("server video fetch has SSRF, DNS, redirect, timeout and size guards", () => {
  const src = read("src/lib/media/fetchServerVideo.ts");
  assert.match(src, /gateSourceUrl/);
  assert.match(src, /dnsLookup/);
  assert.match(src, /redirect:\s*"manual"/);
  assert.match(src, /SERVER_VIDEO_DEFAULT_MAX_BYTES/);
  assert.match(src, /AbortController/);
  assert.match(src, /video\//);
});

await check("YouTube OAuth uses least-privilege upload scope and encrypted refresh token", () => {
  const src = read("src/lib/youtube/oauth.ts");
  assert.match(src, /youtube\.upload/);
  assert.match(src, /aes-256-gcm/);
  assert.match(src, /YOUTUBE_TOKEN_ENCRYPTION_KEY/);
  assert.match(src, /prompt", "consent"/);
  assert.doesNotMatch(src, /NEXT_PUBLIC_YOUTUBE/);
});

await check("OAuth connect/callback require Admin and state cookie", () => {
  const connect = read("src/app/api/settings/youtube/connect/route.ts");
  const callback = read("src/app/api/settings/youtube/callback/route.ts");
  assert.match(connect, /isAdmin/);
  assert.match(connect, /nestory_youtube_oauth_state/);
  assert.match(callback, /timingSafeEqual/);
  assert.match(callback, /isAdmin/);
  assert.match(callback, /saveYouTubeRefreshToken/);
});

await check("YouTube upload uses videos.insert upload endpoint and suppresses subscriber notifications", () => {
  const src = read("src/lib/youtube/upload.ts");
  assert.match(src, /\/upload\/youtube\/v3\/videos/);
  assert.match(src, /notifySubscribers/);
  assert.match(src, /privacyStatus/);
  assert.match(src, /usableForShopify/);
  assert.match(src, /private/);
});

await check("conversion is restricted to Taobao/Tmall CDN sources and persists canonical YouTube URL", () => {
  const src = read("src/lib/youtube/ensureDraftVideos.ts");
  for (const fragment of ["taobao.com", "tmall.com", "alicdn.com", "tbcdn.cn"]) {
    assert.ok(src.includes(fragment), `missing source host ${fragment}`);
  }
  assert.match(src, /canonicalizeYouTubeUrl/);
  assert.match(src, /youtube_video_map_v1:/);
  assert.match(src, /update\(\{ video_urls: normalizedOutput \}\)/);
  assert.match(src, /YOUTUBE_AUTO_UPLOAD/);
});

await check("real publish prepares YouTube videos; mock publish does not write YouTube", () => {
  const src = read("src/lib/shopify/publishDraftSafe.ts");
  assert.match(src, /ensureDraftVideosOnYouTube/);
  assert.match(src, /if \(!mockMode\)/);
  assert.match(src, /video_urls:\s*preparedVideos\.videoUrls/);
});

await check("Shopify sync preserves existing external video when conversion fails", () => {
  const src = read("src/lib/shopify/syncShopifyProduct.ts");
  assert.match(src, /ensureDraftVideosOnYouTube/);
  assert.match(src, /youtubePrepared\.hadFailures/);
  assert.match(src, /mediaContentType === "EXTERNAL_VIDEO"/);
  assert.match(src, /warnings:\s*youtubePrepared\.warnings/);
});

await check("manual YouTube write route requires explicit confirmation and publisher role", () => {
  const src = read("src/app/api/drafts/[id]/youtube-upload/route.ts");
  assert.match(src, /body\.confirm !== true/);
  assert.match(src, /canPublish/);
  assert.match(src, /ensureDraftVideosOnYouTube/);
});

await check("settings UI exposes connect/reconnect/disconnect without browser secrets", () => {
  const src = read("src/components/settings/SettingsPanel.tsx");
  assert.match(src, /YouTube 商品影片/);
  assert.match(src, /\/api\/settings\/youtube\/connect/);
  assert.match(src, /重新授權 YouTube/);
  assert.match(src, /解除授權/);
  assert.doesNotMatch(src, /YOUTUBE_OAUTH_CLIENT_SECRET|YOUTUBE_TOKEN_ENCRYPTION_KEY/);
});

await check("server env contract documents YouTube Phase 2 only as server variables", () => {
  const env = read(".env.example");
  for (const name of [
    "YOUTUBE_OAUTH_CLIENT_ID",
    "YOUTUBE_OAUTH_CLIENT_SECRET",
    "YOUTUBE_OAUTH_REDIRECT_URI",
    "YOUTUBE_TOKEN_ENCRYPTION_KEY",
    "YOUTUBE_DEFAULT_PRIVACY",
    "YOUTUBE_AUTO_UPLOAD"
  ]) {
    assert.match(env, new RegExp(`^${name}=`, "m"));
  }
  assert.doesNotMatch(env, /NEXT_PUBLIC_YOUTUBE/);
});

await check("publish routes allow longer transfer window", () => {
  assert.match(read("src/app/api/drafts/[id]/publish/route.ts"), /maxDuration = 300/);
  assert.match(read("src/app/api/drafts/batch/publish/route.ts"), /maxDuration = 300/);
});

if (failures.length) {
  console.error(`\nFAILED ${failures.length} YouTube Phase 2 check(s)`);
  process.exit(1);
}
console.log("\nALL YouTube Phase 2 checks passed");
