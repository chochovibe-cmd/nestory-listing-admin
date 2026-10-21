// STAGING 1.6: simulate the Chrome extension -- POST a saved capture payload to a
// NON-production Nestory deployment (decision D8: the extension itself never switches).
//
//   node scripts/staging/post-capture-fixture.mjs --base <url> --fixture <json>
//
// Reads STAGING_CAPTURE_TOKEN from .env.local. Same request shape as extension/background.js:
//   POST <base>/api/import/product-page  with  Authorization: Bearer <capture token>
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadEnvFile, requireVars } from "./env-file.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Read PRODUCTION_API_HOSTS out of extension/background.js (single source of truth). Fails closed. */
export function parseProductionApiHosts(backgroundSource) {
  const match = /var\s+PRODUCTION_API_HOSTS\s*=\s*\[([\s\S]*?)\]/.exec(String(backgroundSource));
  const hosts = match ? [...match[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1].toLowerCase()) : [];
  if (hosts.length === 0) {
    throw new Error("讀不到 extension/background.js 的 PRODUCTION_API_HOSTS，為了安全已停止。");
  }
  return hosts;
}

export function normalizeBase(base) {
  let url;
  try {
    url = new URL(String(base ?? "").trim());
  } catch {
    throw new Error("--base 不是合法網址");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("--base 必須是 http(s) 網址");
  return { origin: url.origin, hostname: url.hostname.toLowerCase() };
}

export function assertNotProductionBase(base, productionHosts) {
  const { origin, hostname } = normalizeBase(base);
  if (productionHosts.includes(hostname)) {
    throw new Error(`${hostname} 是正式站，這支腳本拒絕對正式站送出抓取資料。`);
  }
  return origin;
}

/** Top-level keys starting with "_" are notes for humans, not part of the payload. */
export function payloadFromFixture(fixture) {
  return Object.fromEntries(Object.entries(fixture).filter(([key]) => !key.startsWith("_")));
}

function parseArgs(argv) {
  const out = { base: null, fixture: null };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === "--base") out.base = argv[i + 1];
    else if (argv[i] === "--fixture") out.fixture = argv[i + 1];
    else throw new Error(`不認得的參數：${argv[i]}`);
  }
  if (!out.base) throw new Error("缺少 --base <url>");
  if (!out.fixture) throw new Error("缺少 --fixture <json>");
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const hosts = parseProductionApiHosts(fs.readFileSync(path.join(repoRoot, "extension", "background.js"), "utf8"));
  const origin = assertNotProductionBase(args.base, hosts);

  const env = loadEnvFile(path.join(repoRoot, ".env.local"));
  requireVars(env, ["STAGING_CAPTURE_TOKEN"], ".env.local");

  const payload = payloadFromFixture(JSON.parse(fs.readFileSync(path.resolve(args.fixture), "utf8")));
  const response = await fetch(`${origin}/api/import/product-page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.STAGING_CAPTURE_TOKEN.trim()}`
    },
    body: JSON.stringify(payload)
  });
  const json = await response.json().catch(() => null);
  console.log(`HTTP ${response.status}`);
  console.log(JSON.stringify(json, null, 2));
  if (!response.ok) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`失敗：${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
