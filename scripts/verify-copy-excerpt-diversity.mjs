import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
if (process.env.NESTORY_TS_IMPORT !== "1") {
  const loader = pathToFileURL(path.join(root, "scripts", "register-ts-loader.mjs")).href;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", loader, path.join(root, "scripts", "verify-copy-excerpt-diversity.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NESTORY_TS_IMPORT: "1" },
  });
  process.exit(result.status ?? 1);
}

const { extractRelevantExcerpt } = await import("../src/lib/providers/webSearch/tavily.ts");

const copy = [
  "【系列背景】Sanrio Kuromi 魔法學院系列，角色戴著紫色尖帽、搭配蝙蝠翅膀造型。",
  "商品圖片展示多種角度。",
  "尺寸約 1.5cm，適合吊飾收藏與隨身裝飾。",
  "功能為磁吸底座，可吸附金屬表面；材質為 PVC。",
  "尺寸約 1.5cm，適合吊飾收藏與隨身裝飾。",
  "促銷資訊請洽客服。",
].join("\n");
const excerpt = extractRelevantExcerpt(copy);
assert.match(excerpt, /Sanrio Kuromi 魔法學院系列/);
assert.match(excerpt, /紫色尖帽、搭配蝙蝠翅膀造型/);
assert.match(excerpt, /尺寸約 1\.5cm/);
assert.match(excerpt, /磁吸底座/);
assert.ok(excerpt.indexOf("Sanrio") < excerpt.indexOf("尺寸約"), "selected sentences keep source order");
assert.equal((excerpt.match(/尺寸約 1\.5cm/g) ?? []).length, 1, "duplicate sentences are removed");
assert.ok(Array.from(excerpt).length <= 400);

assert.equal(extractRelevantExcerpt(" \n\t "), "");
assert.equal(extractRelevantExcerpt("\n尺寸約 1.5cm。\n材質為絨毛。"), "尺寸約 1.5cm。 材質為絨毛。");
assert.match(extractRelevantExcerpt("Hello Kitty plush figure. Size 1.5cm; suitable for bags."), /Size 1\.5cm/);
assert.ok(Array.from(extractRelevantExcerpt(`${"Kuromi 造型商品".repeat(80)}，尺寸 1.5cm`, 40)).length <= 40);
assert.equal(extractRelevantExcerpt("這是一句很長但沒有句號的商品系列造型資料".repeat(30), 40).length <= 40, true);
const overfull = extractRelevantExcerpt(`${"Kuromi 魔法學院系列造型".repeat(70)}。需另備記憶卡。`, 400);
assert.ok(Array.from(overfull).length <= 400);
assert.match(overfull, /Kuromi 魔法學院系列造型/);
assert.match(overfull, /需另備記憶卡/);
assert.equal(extractRelevantExcerpt("尺寸約 1.5cm。", Number.POSITIVE_INFINITY), "尺寸約 1.5cm。");
assert.equal(extractRelevantExcerpt("尺寸約 1.5cm。", -1), "");

console.log("copy excerpt diversity checks passed");
