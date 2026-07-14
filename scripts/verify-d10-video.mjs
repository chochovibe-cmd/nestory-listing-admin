/**
 * D10-open: video_urls + EXTERNAL_VIDEO + Showmore link tail.
 * Pure logic mirrors + static wiring checks. No network / Shopify / DB.
 *
 * Run: node scripts/verify-d10-video.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

// --- Pure mirrors (keep in sync with src/lib/media/videoUrls.ts) ---

const MAX_VIDEO_URLS = 3;

function isYouTubeHost(hostname) {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  return (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtu.be" ||
    host.endsWith(".youtube.com")
  );
}

function canonicalizeYouTubeUrl(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  let url;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProtocol);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (!isYouTubeHost(url.hostname)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    if (!id || !/^[\w-]{6,}$/i.test(id)) return null;
    return `https://www.youtube.com/watch?v=${id}`;
  }
  const v = url.searchParams.get("v");
  if (v && /^[\w-]{6,}$/i.test(v)) {
    return `https://www.youtube.com/watch?v=${v}`;
  }
  const pathMatch = url.pathname.match(/\/(?:embed|shorts|live|v)\/([\w-]{6,})/i);
  if (pathMatch?.[1]) {
    return `https://www.youtube.com/watch?v=${pathMatch[1]}`;
  }
  return null;
}

function normalizeVideoUrls(raw) {
  const list = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") list.push(item);
      else if (item && typeof item === "object" && typeof item.url === "string") list.push(item.url);
    }
  } else if (typeof raw === "string") {
    list.push(...raw.split(/\r?\n/));
  }
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const t = String(item).trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= MAX_VIDEO_URLS) break;
  }
  return out;
}

function buildExternalVideoMedia(raw, altBase) {
  const normalized = normalizeVideoUrls(raw);
  const accepted = [];
  const skipped = [];
  const media = [];
  const alt = (altBase && String(altBase).trim()) || "Nestory product video";
  for (const entry of normalized) {
    const canonical = canonicalizeYouTubeUrl(entry);
    if (!canonical) {
      skipped.push(entry);
      continue;
    }
    if (accepted.includes(canonical)) continue;
    accepted.push(canonical);
    media.push({
      originalSource: canonical,
      mediaContentType: "EXTERNAL_VIDEO",
      alt
    });
  }
  const warnings = [];
  if (skipped.length > 0) {
    const preview = skipped
      .map((s) => (s.length > 48 ? `${s.slice(0, 45)}…` : s))
      .join("、");
    warnings.push(`影片連結略過 ${skipped.length} 筆（僅支援 YouTube）：${preview}`);
  }
  return { accepted, skipped, media, warnings };
}

function escapeHtmlAttr(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function appendVideoLinksHtml(html, raw) {
  const { accepted } = buildExternalVideoMedia(raw);
  if (!accepted.length) return html;
  const blocks = accepted
    .map(
      (url) =>
        `<p>▶ 商品影片：<a href="${escapeHtmlAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHtmlAttr(url)}</a></p>`
    )
    .join("");
  const base = html ?? "";
  if (!base.trim()) return blocks;
  return `${base}${blocks}`;
}

// --- Tests ---

console.log("\nD10-open video_urls / EXTERNAL_VIDEO\n");

await check("normalize: trim, dedupe, max 3", () => {
  const got = normalizeVideoUrls([
    " https://www.youtube.com/watch?v=aaaaaaaaaaa ",
    "https://www.youtube.com/watch?v=aaaaaaaaaaa",
    "https://youtu.be/bbbbbbbbbbb",
    "https://youtu.be/ccccccccccc",
    "https://youtu.be/ddddddddddd"
  ]);
  assert.equal(got.length, 3);
  assert.equal(got[0], "https://www.youtube.com/watch?v=aaaaaaaaaaa");
  assert.equal(got[2], "https://youtu.be/ccccccccccc");
});

await check("canonicalize youtu.be / shorts / bare host", () => {
  assert.equal(
    canonicalizeYouTubeUrl("https://youtu.be/dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  assert.equal(
    canonicalizeYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  assert.equal(
    canonicalizeYouTubeUrl("youtube.com/watch?v=dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
});

await check("non-YouTube skipped + warning; YouTube becomes EXTERNAL_VIDEO", () => {
  const r = buildExternalVideoMedia(
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://vimeo.com/12345",
      "not-a-url"
    ],
    "測試商品"
  );
  assert.equal(r.media.length, 1);
  assert.equal(r.media[0].mediaContentType, "EXTERNAL_VIDEO");
  assert.equal(r.media[0].originalSource, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assert.equal(r.media[0].alt, "測試商品");
  assert.equal(r.skipped.length, 2);
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /略過 2 筆/);
});

await check("empty video_urls → no media / no warnings", () => {
  const r = buildExternalVideoMedia([]);
  assert.deepEqual(r.media, []);
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.accepted, []);
});

await check("IMAGE then EXTERNAL_VIDEO order (merge simulation)", () => {
  const images = [
    { originalSource: "https://cdn.example/a.webp", alt: "a", mediaContentType: "IMAGE" }
  ];
  const video = buildExternalVideoMedia(["https://youtu.be/dQw4w9WgXcQ"]);
  const media = [...images, ...video.media];
  assert.equal(media.length, 2);
  assert.equal(media[0].mediaContentType, "IMAGE");
  assert.equal(media[1].mediaContentType, "EXTERNAL_VIDEO");
});

await check("Showmore appendVideoLinksHtml only on accepted YouTube", () => {
  const base = "<p>介紹</p>";
  const withVid = appendVideoLinksHtml(base, ["https://youtu.be/dQw4w9WgXcQ"]);
  assert.match(withVid, /▶ 商品影片/);
  assert.match(withVid, /watch\?v=dQw4w9WgXcQ/);
  assert.ok(withVid.startsWith(base));
  const noVid = appendVideoLinksHtml(base, ["https://vimeo.com/1"]);
  assert.equal(noVid, base);
  const empty = appendVideoLinksHtml(base, []);
  assert.equal(empty, base);
});

await check("source wiring: videoUrls.ts exists + exports", () => {
  const src = read("src/lib/media/videoUrls.ts");
  assert.match(src, /EXTERNAL_VIDEO/);
  assert.match(src, /MAX_VIDEO_URLS = 3/);
  assert.match(src, /buildExternalVideoMedia/);
  assert.match(src, /appendVideoLinksHtml/);
});

await check("payload merges video media + videoWarnings", () => {
  const src = read("src/lib/shopify/payload.ts");
  assert.match(src, /buildExternalVideoMedia/);
  assert.match(src, /mediaWithVideos/);
  assert.match(src, /videoWarnings/);
});

await check("publishDraft merges videoWarnings into draft.warnings", () => {
  const src = read("src/lib/shopify/publishDraft.ts");
  assert.match(src, /videoWarnings/);
  assert.match(src, /draft\.warnings/);
});

await check("showmore appends video links; matrixify does not", () => {
  const showmore = read("src/lib/csv/showmore.ts");
  assert.match(showmore, /appendVideoLinksHtml/);
  const matrixify = read("src/lib/csv/matrixify.ts");
  assert.doesNotMatch(matrixify, /appendVideoLinksHtml|video_urls|EXTERNAL_VIDEO/);
});

await check("form: WorkspaceInputPanel video section + persist video_urls", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(src, /影片連結/);
  assert.match(src, /videoUrlsText/);
  assert.match(src, /video_urls:\s*parseVideoUrlsFromTextarea/);
  assert.match(src, /videoSectionOpen/);
});

await check("autosave includes videoUrlsText", () => {
  const src = read("src/lib/drafts/workspaceAutosave.ts");
  assert.match(src, /videoUrlsText/);
});

await check("domain video_urls: string[]", () => {
  const src = read("src/types/domain.ts");
  assert.match(src, /video_urls:\s*string\[\]/);
});

await check("zero new migration for D10 (005 already has video_urls)", () => {
  const m005 = read("supabase/migrations/005_phase2_columns.sql");
  assert.match(m005, /video_urls/);
  const migrations = fs.readdirSync(path.join(root, "supabase/migrations"));
  assert.ok(!migrations.some((f) => /028|d10|video/i.test(f)));
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
