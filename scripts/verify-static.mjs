import fs from "node:fs";
import path from "node:path";
import { findSensitiveBrowserStorageWrites } from "./browser-storage-secret-policy.mjs";
import { collectClientReachableFiles } from "./client-module-graph.mjs";
import { findClientSecretEnvAccesses } from "./client-secret-reference-policy.mjs";

const root = process.cwd();
const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
}

for (const file of ["package.json", "tsconfig.json"]) {
  JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

walk(path.join(root, "src"));

const missingImports = [];
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const importPattern = /from\s+["'](@\/[^"']+)["']/g;
  let match;
  while ((match = importPattern.exec(source))) {
    const relativeTarget = match[1].replace("@/", "src/");
    const base = path.join(root, relativeTarget);
    const exists = [".ts", ".tsx", "/index.ts", "/index.tsx"].some((suffix) => fs.existsSync(base + suffix))
      || fs.existsSync(base);
    if (!exists) {
      missingImports.push(`${path.relative(root, file)} -> ${match[1]}`);
    }
  }
}

if (missingImports.length) {
  console.error("Missing imports:");
  console.error(missingImports.join("\n"));
  process.exit(1);
}

const sourceFiles = files.map((file) => [file, fs.readFileSync(file, "utf8")]);
const clientReachable = collectClientReachableFiles(root);
const alwaysForbiddenPatterns = [/sk-ant-/i, /shpat_/i];
const clientOnlyForbiddenPatterns = [/api\.anthropic/i];

const forbiddenHits = [];
for (const [file, source] of sourceFiles) {
  const relative = path.relative(root, file);
  const isClientReachable = clientReachable.has(file);
  const patterns = isClientReachable
    ? [...alwaysForbiddenPatterns, ...clientOnlyForbiddenPatterns]
    : alwaysForbiddenPatterns;

  for (const pattern of patterns) {
    if (pattern.test(source)) {
      forbiddenHits.push(`${relative} matched ${pattern}`);
    }
  }

  if (isClientReachable) {
    for (const finding of findSensitiveBrowserStorageWrites(source)) {
      forbiddenHits.push(
        `${relative} matched browser storage secret write (${finding.kind}: ${finding.snippet})`
      );
    }
    for (const finding of findClientSecretEnvAccesses(source)) {
      forbiddenHits.push(
        `${relative} matched client secret env access (${finding.kind}: ${finding.snippet})`
      );
    }
  }
}

if (forbiddenHits.length) {
  console.error("Forbidden source patterns:");
  console.error(forbiddenHits.join("\n"));
  process.exit(1);
}

console.log(`Static checks passed: ${files.length} TS/TSX files; ${clientReachable.size} client-reachable modules`);
