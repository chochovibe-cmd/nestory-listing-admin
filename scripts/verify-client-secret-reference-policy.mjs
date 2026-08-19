import fs from "node:fs";
import path from "node:path";
import { collectClientReachableFiles } from "./client-module-graph.mjs";
import { findClientSecretEnvAccesses } from "./client-secret-reference-policy.mjs";

const safeSamples = [
  'const label = "OPENAI_API_KEY";',
  'const note = "SUPABASE_SERVICE_ROLE_KEY is configured server-side";',
  'const url = process.env.NEXT_PUBLIC_SUPABASE_URL;',
  'const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;'
];

for (const sample of safeSamples) {
  const findings = findClientSecretEnvAccesses(sample);
  if (findings.length) {
    console.error("Safe client env sample was rejected:", sample, findings);
    process.exit(1);
  }
}

const unsafeSamples = [
  "const key = process.env.OPENAI_API_KEY;",
  "const secret = process.env['SHOPIFY_CLIENT_SECRET'];",
  "const { SUPABASE_SERVICE_ROLE_KEY } = process.env;",
  "const webhook = process.env.MAKE_WEBHOOK_URL;",
  "const token = process.env.WORKER_API_TOKEN;"
];

for (const sample of unsafeSamples) {
  const findings = findClientSecretEnvAccesses(sample);
  if (!findings.length) {
    console.error("Sensitive client env access was not rejected:", sample);
    process.exit(1);
  }
}

const root = process.cwd();
const clientReachable = collectClientReachableFiles(root);
const mustBeClientReachable = [
  "src/components/settings/SettingsPanel.tsx",
  "src/lib/automationPrefsStore.ts",
  "src/lib/supabase/client.ts"
].map((relative) => path.join(root, relative));
const mustStayServerOnly = [
  "src/lib/supabase/server.ts",
  "src/lib/shopify/adminToken.ts",
  "src/lib/notifications/make.ts"
].map((relative) => path.join(root, relative));

for (const file of mustBeClientReachable) {
  if (!clientReachable.has(file)) {
    console.error(`Expected client-reachable module was not discovered: ${path.relative(root, file)}`);
    process.exit(1);
  }
}

for (const file of mustStayServerOnly) {
  if (clientReachable.has(file)) {
    console.error(`Server-only module became reachable from a use-client boundary: ${path.relative(root, file)}`);
    process.exit(1);
  }
}

const settingsPanel = fs.readFileSync("src/components/settings/SettingsPanel.tsx", "utf8");
if (findClientSecretEnvAccesses(settingsPanel).length) {
  console.error("SettingsPanel should only mention server secret env names as UI text, not access them.");
  process.exit(1);
}

const supabaseClient = fs.readFileSync("src/lib/supabase/client.ts", "utf8");
if (findClientSecretEnvAccesses(supabaseClient).length) {
  console.error("Supabase browser client should only read NEXT_PUBLIC_* env values.");
  process.exit(1);
}

console.log(`Client secret env reference policy passed; ${clientReachable.size} client-reachable modules mapped`);
