import fs from "node:fs";
import path from "node:path";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

function listSourceFiles(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      listSourceFiles(fullPath, files);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(fullPath);
    }
  }
  return files;
}

function hasUseClientDirective(source) {
  return /^\s*["']use client["']\s*;?/m.test(source.slice(0, 512));
}

function extractLocalSpecifiers(source) {
  const specifiers = new Set();
  const staticImport = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;
  const dynamicImport = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  let match;
  while ((match = staticImport.exec(source))) specifiers.add(match[1]);
  while ((match = dynamicImport.exec(source))) specifiers.add(match[1]);
  return [...specifiers].filter((specifier) => specifier.startsWith("@/") || specifier.startsWith("."));
}

function resolveLocalModule(root, fromFile, specifier) {
  const unresolved = specifier.startsWith("@/")
    ? path.join(root, "src", specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);

  const candidates = [unresolved];
  for (const ext of SOURCE_EXTENSIONS) candidates.push(`${unresolved}${ext}`);
  for (const ext of SOURCE_EXTENSIONS) candidates.push(path.join(unresolved, `index${ext}`));

  return candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) ?? null;
}

export function collectClientReachableFiles(root = process.cwd()) {
  const srcRoot = path.join(root, "src");
  const sourceFiles = listSourceFiles(srcRoot);
  const sources = new Map(sourceFiles.map((file) => [file, fs.readFileSync(file, "utf8")]));
  const queue = sourceFiles.filter((file) => hasUseClientDirective(sources.get(file) ?? ""));
  const reachable = new Set();

  while (queue.length) {
    const file = queue.shift();
    if (!file || reachable.has(file)) continue;
    reachable.add(file);

    const source = sources.get(file) ?? fs.readFileSync(file, "utf8");
    for (const specifier of extractLocalSpecifiers(source)) {
      const resolved = resolveLocalModule(root, file, specifier);
      if (resolved && !reachable.has(resolved)) queue.push(resolved);
    }
  }

  return reachable;
}
