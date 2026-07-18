/**
 * Builds supabase/migrations/038_ip_knowledge_pack.sql from
 * DEFAULT_IP_KNOWLEDGE_PACKS in src/lib/providers/ipKnowledgePack.ts
 * Run: node scripts/build-038-knowledge-pack-migration.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcPath = path.join(root, "src/lib/providers/ipKnowledgePack.ts");
const outPath = path.join(root, "supabase/migrations/038_ip_knowledge_pack.sql");
const src = fs.readFileSync(srcPath, "utf8");

const blockMatch = src.match(
  /export const DEFAULT_IP_KNOWLEDGE_PACKS: IpKnowledgePackMap = \{([\s\S]*?)\n\};/,
);
if (!blockMatch) {
  console.error("DEFAULT_IP_KNOWLEDGE_PACKS block not found");
  process.exit(1);
}

const block = blockMatch[1];
const entryRe =
  /(?:^|\n)\s*(?:"([^"]+)"|([A-Za-z0-9@&!.'\u4e00-\u9fff×\-\s]+))\s*:\s*pack\(\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*"((?:\\.|[^"\\])*)"\s*,\s*\[([^\]]*)\]\s*,?\s*\)/g;

function unesc(s) {
  return s.replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
}

const packs = [];
let m;
while ((m = entryRe.exec(block))) {
  const key = (m[1] || m[2]).trim();
  const relations = unesc(m[3]);
  const scenes = unesc(m[4]);
  const fandom_hooks = unesc(m[5]);
  const keywords = [...m[6].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => unesc(x[1]));
  packs.push({ key, relations, scenes, fandom_hooks, keywords });
}

if (packs.length < 20) {
  console.error("parsed too few packs", packs.length);
  process.exit(1);
}

function sqlString(s) {
  return s.replace(/'/g, "''");
}

function packJson(p) {
  return JSON.stringify({
    relations: p.relations,
    scenes: p.scenes,
    fandom_hooks: p.fandom_hooks,
    keywords: p.keywords,
    updated_at: "2026-07-19",
    version: 1,
  });
}

const updates = packs
  .map((p) => {
    const json = sqlString(packJson(p));
    return `update public.ip_catalog
set knowledge_pack = '${json}'::jsonb,
    updated_at = now()
where ip_name = '${sqlString(p.key)}';`;
  })
  .join("\n\n");

const sql = `-- P5 層2: ip_catalog.knowledge_pack jsonb + Top21 seed (code DEFAULT 同源).
-- Apply after 037 in Supabase SQL Editor. SQL only — do not run CLI.
-- Shape: { relations, scenes, fandom_hooks, keywords, updated_at, version }
-- Runtime: DEFAULT in src/lib/providers/ipKnowledgePack.ts; DB non-null overlays.
-- Honesty: packs are for tone/fandom only — never product-spec facts.

alter table public.ip_catalog
  add column if not exists knowledge_pack jsonb;

comment on column public.ip_catalog.knowledge_pack is
  'P5: IP lore pack {relations,scenes,fandom_hooks,keywords,updated_at,version}; tone/fandom only, not product specs.';

-- Seed / refresh Top21 (+ dual keys). Safe to re-run (overwrites knowledge_pack for these names).
${updates}
`;

fs.writeFileSync(outPath, sql, "utf8");
console.log("wrote", outPath, "packs", packs.length);
