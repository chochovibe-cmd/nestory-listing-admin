import fs from "node:fs";
import path from "node:path";

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

// Next.js Route Handlers (src/app/api/**) and the provider modules they call
// (src/lib/providers/**) are server-only by framework convention -- they never
// ship to the browser bundle, so calling Anthropic/OpenAI or reading their
// secret env vars there is expected, not a leak. Everything else under src/
// is fair game to flag (React components, client-shared libs, etc).
const clientScope = /^src[\\/](?!app[\\/]api[\\/]|lib[\\/]providers[\\/])/;

// localStorage itself isn't a leak -- the original concern was API keys/tokens
// stored client-side (the old PWA prototype did that). These files only ever
// store a UI preference string (theme name, provider pill choice), never a
// secret, so they're an explicit allowlist rather than a blanket ban.
const localStorageAllowlist = new Set([
  path.join("src", "app", "layout.tsx"),
  path.join("src", "components", "ProviderSwitcher.tsx"),
  path.join("src", "components", "ThemeSwitcher.tsx")
]);

const forbiddenPatterns = [
  { label: "browser localStorage usage", pattern: /localStorage/i, scope: /^src[\\/]/, except: localStorageAllowlist },
  { label: "frontend Anthropic API call", pattern: /api\.anthropic/i, scope: clientScope },
  { label: "OpenAI secret env name in source", pattern: /OPENAI_API_KEY/i, scope: clientScope },
  { label: "Anthropic secret env name in source", pattern: /ANTHROPIC_API_KEY/i, scope: clientScope },
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
  for (const { label, pattern, scope, except } of forbiddenPatterns) {
    if (scope && !scope.test(relative)) continue;
    if (except && except.has(relative)) continue;
    if (pattern.test(source)) {
      errors.push(`${relative} matched ${label}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log("No-secret checks passed");
