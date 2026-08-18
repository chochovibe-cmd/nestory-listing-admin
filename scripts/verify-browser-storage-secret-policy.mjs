import assert from "node:assert/strict";
import fs from "node:fs";
import { findSensitiveBrowserStorageWrites } from "./browser-storage-secret-policy.mjs";

const safeSamples = [
  'window.localStorage.setItem("nestory-theme", "dark");',
  'localStorage.setItem(PREFS_KEY, JSON.stringify(next));',
  'window.sessionStorage.setItem("result-sort", sortMode);',
  'storage.setItem(TONE_MEMORY_KEY, JSON.stringify(map));',
  `// NEVER store tokens or secrets here\nwindow.localStorage.setItem(AUTOMATION_PREFS_KEY, JSON.stringify(next));`
];

for (const sample of safeSamples) {
  assert.deepEqual(
    findSensitiveBrowserStorageWrites(sample),
    [],
    `safe browser-storage sample was incorrectly blocked: ${sample}`
  );
}

const unsafeSamples = [
  'window.localStorage.setItem("openaiApiKey", apiKey);',
  'sessionStorage.setItem(AUTH_TOKEN_KEY, accessToken);',
  'storage.setItem("make_webhook_url", webhookUrl);',
  'localStorage.clientSecret = clientSecret;',
  'window.localStorage["service_role"] = serviceRoleKey;'
];

for (const sample of unsafeSamples) {
  assert.ok(
    findSensitiveBrowserStorageWrites(sample).length > 0,
    `sensitive browser-storage sample was not blocked: ${sample}`
  );
}

// Current legitimate app usages that previously made verify:no-secrets drift.
for (const file of [
  "src/lib/automationPrefsStore.ts",
  "src/lib/drafts/toneMemory.ts",
  "src/components/listing/DraftResultsPanel.tsx"
]) {
  const source = fs.readFileSync(file, "utf8");
  assert.deepEqual(
    findSensitiveBrowserStorageWrites(source),
    [],
    `${file} should remain valid non-sensitive browser storage`
  );
}

const verifier = fs.readFileSync("scripts/verify-no-secrets.mjs", "utf8");
assert.match(verifier, /findSensitiveBrowserStorageWrites/);
assert.doesNotMatch(verifier, /localStorageAllowlist/);
assert.doesNotMatch(verifier, /browser localStorage usage/);

console.log("Browser-storage secret-policy checks passed");
