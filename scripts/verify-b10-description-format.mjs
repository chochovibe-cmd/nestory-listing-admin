/**
 * fix(B10) / feat(B10): description field format unification + preview helper.
 *
 * Investigation findings (mirrored as asserts):
 *  - LLM path stores plain text (A23)
 *  - Rule-engine descriptionGenerator previously wrote HTML (<h2>/<p>)
 *  - payload.ts always ran formatPlainTextAsHtml → risk of double-wrap on HTML rows
 *
 * Run: node scripts/verify-b10-description-format.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import fs from "node:fs/promises";

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

async function loadTs(rel) {
  return import(pathToFileURL(path.join(root, rel)).href);
}

// ── Inline mirrors (always run even if TS import fails) ──────────────────

function isLikelyHtml(text) {
  if (!text) return false;
  return /<\/?(?:p|div|br|ul|ol|li|h[1-6]|strong|em|span|a|table|tr|td|th|section|article|header|footer)\b/i.test(
    text
  );
}

function htmlDescriptionToPlainText(html) {
  if (!html) return "";
  let text = html
    .replace(/\r\n?/g, "\n")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\/\s*(?:p|div|h[1-6]|section|article|li|tr)\s*>/gi, "\n\n")
    .replace(/<\s*li\b[^>]*>/gi, "・")
    .replace(/<\/\s*ul\s*>/gi, "\n\n")
    .replace(/<\/\s*ol\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeDescriptionToPlainText(text) {
  if (!text) return "";
  return isLikelyHtml(text) ? htmlDescriptionToPlainText(text) : text;
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const BULLET_PREFIX = /^[・･•➼]\s*/;

function formatPlainTextAsHtml(text) {
  if (!text) return "";
  if (isLikelyHtml(text)) return text;
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks
    .map((block) => {
      const lines = block
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      const bulletLines = lines.filter((line) => BULLET_PREFIX.test(line));
      const headingLines = lines.filter((line) => !BULLET_PREFIX.test(line));
      if (bulletLines.length > 0) {
        const heading =
          headingLines.length > 0 ? `<p>${headingLines.map(escapeHtml).join("<br>")}</p>` : "";
        const items = bulletLines
          .map((line) => `<li>${escapeHtml(line.replace(BULLET_PREFIX, ""))}</li>`)
          .join("");
        return `${heading}<ul>${items}</ul>`;
      }
      return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
    })
    .join("");
}

function descriptionPreviewHtml(text) {
  if (!text) return "<p>尚無內容</p>";
  return formatPlainTextAsHtml(text) || "<p>尚無內容</p>";
}

console.log("B10 description format verification\n");

console.log("1) isLikelyHtml + normalize");
await check("plain text is not HTML", () => {
  assert.equal(isLikelyHtml("商品介紹\n\n這是一段純文字"), false);
});

await check("legacy HTML is detected", () => {
  assert.equal(isLikelyHtml("<h2>商品介紹</h2>\n<p>內容</p>"), true);
});

await check("html → plain strips tags, keeps paragraphs", () => {
  const plain = htmlDescriptionToPlainText(
    "<h2>商品介紹</h2>\n<p>第一段</p>\n<h2>收藏情境</h2>\n<p>第二段</p>"
  );
  assert.equal(isLikelyHtml(plain), false);
  assert.match(plain, /商品介紹/);
  assert.match(plain, /第一段/);
  assert.match(plain, /收藏情境/);
  assert.doesNotMatch(plain, /<p>/);
});

console.log("\n2) formatPlainTextAsHtml guard (no double-wrap)");
await check("plain → gets <p> wrap", () => {
  const html = formatPlainTextAsHtml("第一段\n\n第二段");
  assert.equal(html, "<p>第一段</p><p>第二段</p>");
});

await check("already-HTML → returned as-is (no nested escape)", () => {
  const input = "<h2>商品介紹</h2>\n<p>內容 & 符號</p>";
  const out = formatPlainTextAsHtml(input);
  assert.equal(out, input);
  assert.doesNotMatch(out, /&lt;h2&gt;/);
});

await check("bullets become <ul><li>", () => {
  const html = formatPlainTextAsHtml("賣點\n・A\n・B");
  assert.match(html, /<ul>/);
  assert.match(html, /<li>A<\/li>/);
});

console.log("\n3) preview helper");
await check("empty → 尚無內容", () => {
  assert.equal(descriptionPreviewHtml(""), "<p>尚無內容</p>");
});

await check("plain preview uses same converter", () => {
  assert.equal(descriptionPreviewHtml("你好"), "<p>你好</p>");
});

console.log("\n4) source contracts");
await check("descriptionGenerator no longer emits HTML tags", async () => {
  const src = await fs.readFile(
    path.join(root, "src/lib/contentGenerator/descriptionGenerator.ts"),
    "utf8"
  );
  assert.doesNotMatch(src, /<h2>/);
  assert.doesNotMatch(src, /'<p>'/);
  assert.match(src, /PLAIN TEXT|plain text/i);
});

await check("htmlFormat exports isLikelyHtml + normalize + preview", async () => {
  const src = await fs.readFile(
    path.join(root, "src/lib/contentGenerator/htmlFormat.ts"),
    "utf8"
  );
  assert.match(src, /export function isLikelyHtml/);
  assert.match(src, /export function normalizeDescriptionToPlainText/);
  assert.match(src, /export function descriptionPreviewHtml/);
  assert.match(src, /if \(isLikelyHtml\(text\)\) return text/);
});

await check("ResultCard has description preview/source toggle", async () => {
  const src = await fs.readFile(
    path.join(root, "src/components/listing/ResultCard.tsx"),
    "utf8"
  );
  assert.match(src, /descriptionView/);
  assert.match(src, /descriptionPreviewHtml/);
  assert.match(src, /原始碼/);
});

console.log("\n5) TS module load (best-effort)");
try {
  const mod = await loadTs("src/lib/contentGenerator/htmlFormat.ts");
  await check("TS isLikelyHtml / formatPlainTextAsHtml", () => {
    assert.equal(mod.isLikelyHtml("<p>x</p>"), true);
    assert.equal(mod.formatPlainTextAsHtml("<p>x</p>"), "<p>x</p>");
    assert.equal(mod.formatPlainTextAsHtml("hi"), "<p>hi</p>");
    const plain = mod.normalizeDescriptionToPlainText("<p>第一段</p>");
    assert.equal(mod.isLikelyHtml(plain), false);
  });

  const desc = await loadTs("src/lib/contentGenerator/descriptionGenerator.ts");
  await check("TS generateDescriptionHtml returns plain text", () => {
    const out = desc.generateDescriptionHtml({
      product_name: "測試吊飾",
      product_status: "new",
      ip: "三麗鷗",
      characters: ["Hello Kitty"],
      use_cases: ["桌面"]
    });
    assert.equal(mod.isLikelyHtml(out), false);
    assert.match(out, /商品介紹/);
    assert.match(out, /收藏情境/);
  });
} catch (err) {
  console.log(`  ⚠ TS import skipped (${err.message})`);
}

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
