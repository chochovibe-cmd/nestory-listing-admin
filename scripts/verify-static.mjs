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
const forbiddenPatterns = [
  /localStorage/i,
  /api\.anthropic/i,
  /OPENAI_API_KEY/i,
  /ANTHROPIC_API_KEY/i,
  /sk-ant-/i,
  /shpat_/i
];

const forbiddenHits = [];
for (const [file, source] of sourceFiles) {
  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      forbiddenHits.push(`${path.relative(root, file)} matched ${pattern}`);
    }
  }
}

if (forbiddenHits.length) {
  console.error("Forbidden source patterns:");
  console.error(forbiddenHits.join("\n"));
  process.exit(1);
}

console.log(`Static checks passed: ${files.length} TS/TSX files`);
