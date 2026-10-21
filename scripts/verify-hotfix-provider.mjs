/**
 * HOTFIX-PROVIDER verifier (offline): Claude fallback + retry provider selection.
 * No network, Supabase, Shopify, or browser session writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { register } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
register(pathToFileURL(path.join(root, "scripts", "publish-guard-loader.mjs")).href);
const src = (rel) => pathToFileURL(path.join(root, rel)).href;
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

const provider = await import(src("src/lib/drafts/queueProvider.ts"));

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failures.push(name);
    console.error(`  ✗ ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

console.log("HOTFIX-PROVIDER — provider fallback + retry");

await check("effectiveQueueProvider fallback matrix", () => {
  assert.equal(provider.effectiveQueueProvider("claude", false), "openai");
  assert.equal(provider.effectiveQueueProvider("claude", true), "claude");
  assert.equal(provider.effectiveQueueProvider("openai", true), "openai");
  assert.equal(provider.effectiveQueueProvider("xxx", true), "openai");
});

await check("generation queue normalizes enqueue and retry providers", () => {
  const source = read("src/app/api/generation-queue/route.ts");
  const token = "effectiveQueueProvider(rawInput.provider, hasClaudeKey())";
  assert.equal(source.split(token).length - 1, 2);
  assert.match(source, /body\.provider/);
  assert.match(source, /input_payload:\s*retryInput/);
});

await check("direct generate route normalizes provider", () => {
  const source = read("src/app/api/generate/route.ts");
  assert.ok(source.includes("effectiveQueueProvider(body.provider, hasClaudeKey())"));
});

await check("failed-card retry follows current stored model", () => {
  const source = read("src/components/listing/ResultCard.tsx");
  assert.ok(
    source.includes('action: "retry", draftId: draft.id, provider: readStoredAiProvider()')
  );
});

console.log(`\nHOTFIX-PROVIDER verifier: ${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.error("Failed: " + failures.join(", "));
  process.exit(1);
}
