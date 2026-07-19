/**
 * SYN-0: write HASHES.md + syn0-hashes.json for sample artifacts.
 * Usage: node scripts/syn0-hash.mjs
 */
import { readdirSync, writeFileSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { OUT_DIR, ensureDirs } from "./syn0-shared.mjs";

ensureDirs();

function sha256File(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex");
}

const rows = [];
for (const f of readdirSync(OUT_DIR).sort()) {
  if (f.startsWith(".")) continue;
  const p = join(OUT_DIR, f);
  if (statSync(p).isDirectory()) continue;
  const buf = readFileSync(p);
  rows.push({ file: f, bytes: buf.length, sha256: sha256File(p) });
}

const tdir = join(OUT_DIR, "templates");
try {
  for (const f of readdirSync(tdir).sort()) {
    const p = join(tdir, f);
    if (!statSync(p).isFile()) continue;
    const buf = readFileSync(p);
    rows.push({
      file: `templates/${f}`,
      bytes: buf.length,
      sha256: sha256File(p)
    });
  }
} catch {
  /* no templates yet */
}

const generatedAt = new Date().toISOString();
const md = [
  "# SYN-0 打樣檔 hash 表",
  "",
  `> 產生時間：${generatedAt}`,
  "> 演算法：SHA-256（hex）",
  "",
  "| 檔案 | bytes | sha256 |",
  "|---|---:|---|",
  ...rows.map((r) => `| \`${r.file}\` | ${r.bytes} | \`${r.sha256}\` |`),
  ""
].join("\n");

writeFileSync(join(OUT_DIR, "HASHES.md"), md, "utf8");
writeFileSync(
  join(OUT_DIR, "syn0-hashes.json"),
  JSON.stringify({ generatedAt, files: rows }, null, 2),
  "utf8"
);
console.log(md);
console.log(`wrote ${rows.length} hashes`);
