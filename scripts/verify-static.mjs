import fs from "node:fs";
import path from "node:path";

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
const alwaysForbiddenPatterns = [/sk-ant-/i, /shpat_/i];
// Next.js Route Handlers (src/app/api/**) and the provider modules they call
// (src/lib/providers/**) are server-only by framework convention -- calling
// Anthropic/OpenAI or reading their secret env vars there is expected.
const clientOnlyForbiddenPatterns = [/api\.anthropic/i, /OPENAI_API_KEY/i, /ANTHROPIC_API_KEY/i];
const serverOnlyDir = /^src[\\/](app[\\/]api[\\/]|lib[\\/]providers[\\/])/;
// localStorage itself isn't a leak -- the original concern was API keys/tokens
// stored client-side (the old PWA prototype did that). These files only ever
// store a UI preference string (theme name, provider pill choice), never a
// secret, so they're an explicit allowlist rather than a blanket ban.
const localStorageAllowlist = new Set([
  path.join("src", "app", "layout.tsx"),
  path.join("src", "components", "ProviderSwitcher.tsx"),
  path.join("src", "components", "ThemeSwitcher.tsx"),
  path.join("src", "components", "ExchangeRateWidget.tsx"),
  path.join("src", "components", "ModeSwitcher.tsx"),
  path.join("src", "lib", "pricingSettingsStore.ts")
]);

const forbiddenHits = [];
for (const [file, source] of sourceFiles) {
  const relative = path.relative(root, file);
  const isServerOnly = serverOnlyDir.test(relative);
  const patterns = isServerOnly ? alwaysForbiddenPatterns : [...alwaysForbiddenPatterns, ...clientOnlyForbiddenPatterns];

  for (const pattern of patterns) {
    if (pattern.test(source)) {
      forbiddenHits.push(`${relative} matched ${pattern}`);
    }
  }

  if (/localStorage/i.test(source) && !localStorageAllowlist.has(relative)) {
    forbiddenHits.push(`${relative} matched /localStorage/i`);
  }
}

if (forbiddenHits.length) {
  console.error("Forbidden source patterns:");
  console.error(forbiddenHits.join("\n"));
  process.exit(1);
}

console.log(`Static checks passed: ${files.length} TS/TSX files`);
