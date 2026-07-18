/**
 * P5 layer1: parse DEFAULT_IP_TONE_MAP from source + assert boss edits.
 * Run: node scripts/verify-p5-ip-tone-map.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(
  path.join(root, "src/lib/providers/ipToneMap.ts"),
  "utf8",
);

const blockMatch = src.match(
  /export const DEFAULT_IP_TONE_MAP[^=]*=\s*\{([\s\S]*?)\n\};/,
);
if (!blockMatch) {
  console.error("MAP_BLOCK_NOT_FOUND");
  process.exit(1);
}

const map = {};
const entryRe =
  /(?:^|\n)\s*(?:"([^"]+)"|([A-Za-z0-9@&!.'\u4e00-\u9fff：:\- ]+))\s*:\s*"([^"]+)"/g;
let m;
while ((m = entryRe.exec(blockMatch[1]))) {
  const key = (m[1] || m[2]).trim();
  map[key] = m[3];
}

const CONCRETE = new Set([
  "黑膠文藝收藏感",
  "日系選物店溫柔感",
  "可愛周邊輕鬆感",
  "中二熱血宣言",
  "小編聊天口吻",
]);

let bad = 0;
const tones = {};
for (const [k, v] of Object.entries(map)) {
  tones[v] = (tones[v] || 0) + 1;
  if (!CONCRETE.has(v)) {
    console.error("INVALID_TONE", k, v);
    bad++;
  }
}

const must = {
  Deadpool: "小編聊天口吻",
  "THE MONSTERS": "黑膠文藝收藏感",
  鏈鋸人: "小編聊天口吻",
  美少女戰士: "黑膠文藝收藏感",
  吉伊卡哇: "可愛周邊輕鬆感",
  鬼滅之刃: "中二熱血宣言",
  星際大戰: "黑膠文藝收藏感",
};
for (const [k, v] of Object.entries(must)) {
  if (map[k] !== v) {
    console.error("MUST_FAIL", k, "got", map[k], "want", v);
    bad++;
  }
}

// No overrides seed in migrations for P5 layer1
const migDir = path.join(root, "supabase/migrations");
for (const f of fs.readdirSync(migDir)) {
  if (!f.endsWith(".sql")) continue;
  if (Number(f.slice(0, 3)) < 38) continue;
  const sql = fs.readFileSync(path.join(migDir, f), "utf8");
  if (sql.includes("ip_tone_map_overrides") && sql.includes("insert")) {
    // 023 is fine; new migrations should not re-seed full map
    if (f.startsWith("038") || f.startsWith("039")) {
      console.error("UNEXPECTED_OVERRIDES_SEED", f);
      bad++;
    }
  }
}

console.log("keys", Object.keys(map).length);
console.log("by_tone", tones);
console.log(bad === 0 ? "ALL_PASSED" : `FAILED ${bad}`);
process.exit(bad === 0 ? 0 : 1);
