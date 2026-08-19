import fs from "node:fs";
import path from "node:path";
import { findSensitiveBrowserStorageWrites } from "./browser-storage-secret-policy.mjs";
import { collectClientReachableFiles } from "./client-module-graph.mjs";
import { findClientSecretEnvAccesses } from "./client-secret-reference-policy.mjs";

const root = process.cwd();

const forbiddenRootEntries = [
  ".env",
  ".env.production",
  ".env.development"
];

const errors = [];

for (const entry of forbiddenRootEntries) {
  if (fs.existsSync(path.join(root, entry))) {
    errors.push(`Forbidden root entry exists: ${entry}`);
  }
}

const sourceFiles = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (/\.(ts|tsx|js|mjs|json|md|sql|ps1)$/.test(entry.name)) {
      sourceFiles.push(fullPath);
    }
  }
}

for (const dir of ["src", "docs", "scripts", "supabase", "fixtures"]) {
  const fullPath = path.join(root, dir);
  if (fs.existsSync(fullPath)) walk(fullPath);
}

for (const rootFile of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".env.example"]) {
  const fullPath = path.join(root, rootFile);
  if (fs.existsSync(fullPath)) sourceFiles.push(fullPath);
}

const gitignore = fs.existsSync(path.join(root, ".gitignore"))
  ? fs.readFileSync(path.join(root, ".gitignore"), "utf8")
  : "";

for (const ignoredEntry of ["node_modules/", ".pnpm-store/"]) {
  if (!gitignore.includes(ignoredEntry)) {
    errors.push(`Generated dependency entry is not ignored: ${ignoredEntry}`);
  }
}

if (!/\.env\.\*/.test(gitignore)) {
  errors.push("Local env files are not ignored: .env.*");
}

const clientReachable = collectClientReachableFiles(root);
const forbiddenPatterns = [
  { label: "frontend Anthropic API call", pattern: /api\.anthropic/i, clientOnly: true },
  { label: "Anthropic-looking key", pattern: /sk-ant-/i },
  { label: "OpenAI-looking key", pattern: /sk-proj-|sk-[A-Za-z0-9]{20,}/i },
  { label: "Shopify token-looking key", pattern: /shpat_/i },
  { label: "GitHub token-looking key", pattern: /ghp_[A-Za-z0-9_]{20,}/i },
  { label: "Google API-looking key", pattern: /AIza[A-Za-z0-9_-]{20,}/i }
];

for (const file of sourceFiles) {
  const relative = path.relative(root, file);
  if (/^scripts[\\/]verify-.*\.mjs$/.test(relative)) continue;
  const source = fs.readFileSync(file, "utf8");
  const isClientReachable = clientReachable.has(file);

  if (isClientReachable) {
    for (const finding of findSensitiveBrowserStorageWrites(source)) {
      errors.push(
        `${relative} matched browser storage secret write (${finding.kind}: ${finding.snippet})`
      );
    }
    for (const finding of findClientSecretEnvAccesses(source)) {
      errors.push(
        `${relative} matched client secret env access (${finding.kind}: ${finding.snippet})`
      );
    }
  }

  for (const { label, pattern, clientOnly } of forbiddenPatterns) {
    if (clientOnly && !isClientReachable) continue;
    if (pattern.test(source)) {
      errors.push(`${relative} matched ${label}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`No-secret checks passed; ${clientReachable.size} client-reachable modules inspected`);
