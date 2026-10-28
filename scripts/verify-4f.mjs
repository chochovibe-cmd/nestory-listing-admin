/**
 * 4f COPY-REF verifier (written by Claude before construction).
 * 文案參考圖：AI 先自動挑（1 主圖＋平均分布詳情圖，共 6 張），老闆可在卡片圖片上點「文案參考」改選（最多 6 張）；
 * 取代沒作用的「規格圖」角標＋站②「規格圖」分頁；重生前先重讀圖片（沒變＝快取）；ImageUploader 詳情圖字樣改掉「不上架」。
 * No network, no database. Run from repo root with: npm run verify:4f
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
register(pathToFileURL(path.join(root, "scripts/publish-guard-loader.mjs")).href);
const src = (name) => pathToFileURL(path.join(root, name)).href;
const ref = await import(src("src/lib/images/copyReference.ts"));
const tabs = await import(src("src/lib/images/station2ImageTabs.ts"));

let passed = 0;
const failed = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (err) {
    failed.push({ name, err });
    console.error("  ✗ " + name + ": " + (err.stack || err));
  }
}

const row = (id, image_type, sort_order, extra = {}) => ({
  id,
  image_type,
  sort_order,
  original_file_url: `https://cdn.shopify.com/s/files/${id}.jpg`,
  vision_mid_url: null,
  ...extra
});
const ids = (list) => list.map((c) => c.id);
// 2 main + 10 detail + 1 variant + 1 generated_detail
const ROWS = [
  row("m1", "main", 0),
  row("m2", "main", 1),
  ...Array.from({ length: 10 }, (_, i) => row(`d${i}`, "detail", i)),
  row("v1", "variant", 2),
  row("g1", "generated_detail", 0)
];

console.log("\n[A] 候選圖與自動挑（和 4f 之前完全一樣）");

await check("A1 copyReferenceCandidates：只收主圖＋詳情圖，網址優先 vision_mid_url，沒網址的不收", () => {
  const c = ref.copyReferenceCandidates([
    ...ROWS,
    row("d-nourl", "detail", 99, { original_file_url: "  ", vision_mid_url: null }),
    row("d-mid", "detail", 50, { vision_mid_url: "https://cdn.shopify.com/mid.jpg?width=1280" })
  ]);
  assert.deepEqual(ids(c).sort(), ["d-mid", "d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7", "d8", "d9", "m1", "m2"].sort());
  assert.equal(c.find((x) => x.id === "d-mid").url, "https://cdn.shopify.com/mid.jpg?width=1280");
});

await check("A2 沒指定＝自動：1 主圖＋平均分布 5 張詳情圖（第一張、最後一張都在）", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  const sel = ref.selectCopyReferenceImages(c, []);
  assert.equal(sel.mode, "auto");
  assert.deepEqual(ids(sel.selected), ["m1", "d0", "d2", "d5", "d7", "d9"]);
});

await check("A3 圖少於 6 張：全部都讀；只有主圖時讀到 6 張主圖為止", () => {
  const few = ref.copyReferenceCandidates([row("m1", "main", 0), row("d0", "detail", 0), row("d1", "detail", 1)]);
  assert.deepEqual(ids(ref.selectCopyReferenceImages(few, []).selected), ["m1", "d0", "d1"]);
  const mains = ref.copyReferenceCandidates(Array.from({ length: 8 }, (_, i) => row(`m${i}`, "main", i)));
  assert.equal(ref.selectCopyReferenceImages(mains, []).selected.length, 6);
});

await check("A4 visionProvider 仍匯出 selectRepresentativeVisionImages／buildVisionSourceFingerprint（舊腳本相容）", () => {
  const s = read("src/lib/providers/visionProvider.ts");
  assert.match(s, /export \{[\s\S]*buildVisionSourceFingerprint,[\s\S]*selectRepresentativeVisionImages,[\s\S]*\} from "@\/lib\/images\/copyReference";/);
  assert.ok(!/function evenlySpaced/.test(s), "pure helpers must live in copyReference.ts only");
  assert.match(s, /const MAX_DESCRIBE_IMAGES = MAX_COPY_REFERENCE_IMAGES;/);
});

console.log("\n[B] 老闆指定（image_flags.copy_reference_image_ids）");

await check("B1 parseCopyReferenceIds：只收字串、去空白去重、最多 6；壞資料＝[]", () => {
  assert.deepEqual(ref.parseCopyReferenceIds(null), []);
  assert.deepEqual(ref.parseCopyReferenceIds([]), []);
  assert.deepEqual(ref.parseCopyReferenceIds({ copy_reference_image_ids: "m1" }), []);
  assert.deepEqual(
    ref.parseCopyReferenceIds({ copy_reference_image_ids: [" a ", "a", 3, null, "", "b", "c", "d", "e", "f", "g"] }),
    ["a", "b", "c", "d", "e", "f"]
  );
  assert.equal(ref.COPY_REFERENCE_FLAG_KEY, "copy_reference_image_ids");
  assert.equal(ref.MAX_COPY_REFERENCE_IMAGES, 6);
});

await check("B2 mergeCopyReferenceIds：保留其他 image_flags 鍵；空陣列＝刪掉這個鍵（回到自動）", () => {
  const flags = { vision_status: "done", vision_source_fingerprint: "v1-x", description_detail_images: "false" };
  const next = ref.mergeCopyReferenceIds(flags, ["d3", "m1", "d3"]);
  assert.deepEqual(next, { ...flags, copy_reference_image_ids: ["d3", "m1"] });
  assert.ok(!("copy_reference_image_ids" in flags), "must not mutate input");
  assert.deepEqual(ref.mergeCopyReferenceIds(next, []), flags);
  assert.deepEqual(ref.mergeCopyReferenceIds(null, ["m1"]), { copy_reference_image_ids: ["m1"] });
});

await check("B3 指定了＝只讀指定的；順序＝主圖在前、再詳情圖，各照 sort_order；不足 6 張不補自動的", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  const sel = ref.selectCopyReferenceImages(c, ["d8", "m2", "d1"]);
  assert.equal(sel.mode, "manual");
  assert.deepEqual(ids(sel.selected), ["m2", "d1", "d8"]);
});

await check("B4 指定的圖被刪光／不是候選（款式圖、合成圖）→ 退回自動", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  assert.equal(ref.selectCopyReferenceImages(c, ["gone1", "gone2"]).mode, "auto");
  assert.equal(ref.selectCopyReferenceImages(c, ["v1", "g1"]).mode, "auto");
  const partly = ref.selectCopyReferenceImages(c, ["gone1", "d4"]);
  assert.equal(partly.mode, "manual");
  assert.deepEqual(ids(partly.selected), ["d4"]);
});

console.log("\n[C] 點角標（toggle）");

await check("C1 自動狀態點一張沒被挑的：自動那 6 張＋這張 → 超過 6 張要擋（reason=max）", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  assert.deepEqual(ref.toggleCopyReference(c, [], "d1"), { ok: false, reason: "max" });
});

await check("C2 自動狀態點一張被挑的：變成指定＝自動那 6 張減掉這張", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  assert.deepEqual(ref.toggleCopyReference(c, [], "d5"), { ok: true, nextIds: ["m1", "d0", "d2", "d7", "d9"] });
});

await check("C3 指定狀態：加一張、拿一張；拿掉最後一張＝[]（回自動）", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  assert.deepEqual(ref.toggleCopyReference(c, ["d1"], "m2"), { ok: true, nextIds: ["d1", "m2"] });
  assert.deepEqual(ref.toggleCopyReference(c, ["m2", "d1"], "d1"), { ok: true, nextIds: ["m2"] });
  assert.deepEqual(ref.toggleCopyReference(c, ["m2"], "m2"), { ok: true, nextIds: [] });
});

await check("C4 款式圖／合成詳情圖／不存在的 id：not_candidate，不寫", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  for (const id of ["v1", "g1", "nope"]) {
    assert.deepEqual(ref.toggleCopyReference(c, [], id), { ok: false, reason: "not_candidate" });
  }
});

await check("C5 copyReferenceBadgeState：auto／manual／off；非候選＝null（不顯示角標）", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  const auto = ref.selectCopyReferenceImages(c, []);
  assert.equal(ref.copyReferenceBadgeState(c, auto, "m1"), "auto");
  assert.equal(ref.copyReferenceBadgeState(c, auto, "d1"), "off");
  assert.equal(ref.copyReferenceBadgeState(c, auto, "v1"), null);
  assert.equal(ref.copyReferenceBadgeState(c, auto, "g1"), null);
  const manual = ref.selectCopyReferenceImages(c, ["d1"]);
  assert.equal(ref.copyReferenceBadgeState(c, manual, "d1"), "manual");
  assert.equal(ref.copyReferenceBadgeState(c, manual, "m1"), "off");
});

await check("C6 copyReferenceHint：自動／指定兩種文案寫死", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  assert.equal(
    ref.copyReferenceHint(ref.selectCopyReferenceImages(c, [])),
    "AI 自動挑了 6 張（標「✓ 自動」）讀圖上的字寫文案；想自己指定就點圖上的「文案參考」，最多 6 張"
  );
  assert.equal(
    ref.copyReferenceHint(ref.selectCopyReferenceImages(c, ["m1", "d2", "d3"])),
    "你指定了 3 張（主圖 1、詳情圖 2）；改完按「↻ 重新生成」或單欄「↻ 重生」才會用新的圖寫文案"
  );
});

console.log("\n[D] 快取指紋（fingerprint）");

await check("D1 沒指定：指紋和 4f 之前的算法一字不差（舊商品不會被重讀）", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  // pre-4f algorithm, copied verbatim
  const legacy = (cands) => {
    const seen = new Set();
    const source = cands
      .filter((x) => x.url.trim())
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((x) => {
        const u = x.url.trim();
        if (seen.has(u)) return false;
        seen.add(u);
        return true;
      })
      .map((x) => `${x.imageType}:${x.sortOrder}:${x.url.trim()}`)
      .join("\n");
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}-${source.length}`;
  };
  assert.equal(ref.buildVisionSourceFingerprint(c), legacy(c));
  assert.equal(ref.buildVisionSourceFingerprint(c, []), legacy(c));
});

await check("D2 指定改了 → 指紋改變；同一組不同順序 → 指紋相同", () => {
  const c = ref.copyReferenceCandidates(ROWS);
  const base = ref.buildVisionSourceFingerprint(c);
  const a = ref.buildVisionSourceFingerprint(c, ["d1", "m1"]);
  assert.notEqual(a, base);
  assert.equal(ref.buildVisionSourceFingerprint(c, ["m1", "d1"]), a);
  assert.notEqual(ref.buildVisionSourceFingerprint(c, ["m1"]), a);
});

console.log("\n[E] /api/analyze-images 與重生");

await check("E1 analyze-images 用 copyReference：選 id、讀 image_flags 指定、只送選中的網址、指定的 id 進指紋", () => {
  const s = read("src/app/api/analyze-images/route.ts");
  assert.match(s, /\.select\("id,image_type,original_file_url,vision_mid_url,sort_order"\)/);
  assert.match(s, /\.select\("id,image_type,original_file_url,sort_order"\)/);
  assert.match(s, /const candidates = copyReferenceCandidates\(rows\);/);
  assert.match(s, /selectCopyReferenceImages\(candidates, parseCopyReferenceIds\(existingFlags\)\)/);
  assert.match(s, /buildVisionSourceFingerprint\(\s*candidates,\s*selection\.mode === "manual"/);
  assert.match(s, /const describeUrls = selection\.selected\.map\(\(candidate\) => candidate\.url\);/);
  assert.ok(!s.includes("selectRepresentativeVisionImages"), "route must not pick images itself");
});

await check("E2 讀圖失敗不清掉舊的 image_description；仍不碰 spec_text／image_status", () => {
  const s = read("src/app/api/analyze-images/route.ts");
  assert.match(s, /imageDescription \? \{ image_description: imageDescription \} : \{\}/);
  assert.ok(!/\{\s*image_description: imageDescription\s*\}, sourceFingerprint\)/.test(s));
  assert.ok(!/spec_text:/.test(s));
  assert.ok(!/image_status:/.test(s));
});

await check("E3 重生（regen_full／regen_field）先呼叫 analyze-images；失敗只提示、照樣重生", () => {
  const s = read("src/components/listing/GenerationQueueRunner.tsx");
  assert.match(s, /async function refreshImageDescriptionForRegen\(draftId: string, title: string\): Promise<void>/);
  assert.match(s, /圖片重讀失敗，這次沿用上次的圖片資訊/);
  const regenStart = s.indexOf('if (jobKind !== "full")');
  const call = s.indexOf("await refreshImageDescriptionForRegen(job.draftId, title);", regenStart);
  const regenFetch = s.indexOf("regenResponse = await fetch(\"/api/generate\"", regenStart);
  assert.ok(regenStart > 0 && call > regenStart && call < regenFetch, "must run before the regen /api/generate call");
  const helper = s.slice(s.indexOf("async function refreshImageDescriptionForRegen"), s.indexOf("async function reportNetworkFailure"));
  assert.ok(!/return\s+false|throw /.test(helper), "failure must not block regen");
});

console.log("\n[F] 畫面：規格圖 → 文案參考");

await check("F1 站② 分頁只剩 主圖／詳情圖；舊規格圖列歸主圖；補圖兩頁都能用", () => {
  assert.deepEqual(tabs.STATION2_IMAGE_SUBTABS, [
    { id: "main", label: "主圖" },
    { id: "detail", label: "詳情圖" }
  ]);
  assert.equal(tabs.isMainSubtabImage({ image_type: "main", is_spec_process: true }), true);
  assert.equal(tabs.isMainSubtabImage({ image_type: "spec", is_spec_process: false }), true);
  assert.equal(tabs.isMainSubtabImage({ image_type: "detail", is_spec_process: false }), false);
  assert.equal(tabs.station2UploadImageType("main"), "main");
  assert.equal(tabs.station2UploadImageType("detail"), "detail");
  assert.equal("isSpecImage" in tabs, false);
});

await check("F2 「規格圖」按鈕全部拿掉（ImageUploader／站②／站③／ResultCard）", () => {
  for (const f of [
    "src/components/listing/ImageUploader.tsx",
    "src/components/listing/Station2ImagePanel.tsx",
    "src/components/listing/result-card/ResultCardImagesPanel.tsx",
    "src/components/listing/ResultCard.tsx"
  ]) {
    const s = read(f);
    assert.ok(!s.includes("標示為規格圖"), f);
    assert.ok(!s.includes("📐 規格圖"), f);
    assert.ok(!/toggleSpec(Mark|OnCard)?\(/.test(s), f);
    assert.ok(!s.includes("規格圖標記失敗"), f);
  }
  const s2 = read("src/components/listing/Station2ImagePanel.tsx");
  assert.ok(!s2.includes("目前排第一的是規格圖"));
  assert.ok(!s2.includes("s2-img-spec-hint"));
  assert.ok(!s2.includes('subtab === "spec"'));
});

await check("F3 文案參考角標：沿用 .pthumb-spec-badge；三種字（文案參考／✓ 自動／✓ 文案參考），站③ 詳情小圖用 compact", () => {
  const c = read("src/components/listing/CopyReferenceControls.tsx");
  assert.match(c, /className=\{`pthumb-spec-badge\$\{state === "manual" \? " active" : ""\}\$\{state === "auto" \? " is-auto" : ""\}\$\{compact \? " is-compact" : ""\}`\}/);
  for (const t of ['"✓ 自動"', '"✓ 文案參考"', '"文案參考"', '"✓ 參考"', '"參考"', "恢復自動挑選", "文案參考圖"]) {
    assert.ok(c.includes(t), t);
  }
  assert.match(c, /\.from\("product_drafts"\)\s*\.select\("image_flags"\)/);
  assert.ok(!c.includes('from("product_images")'), "must never write product_images (dirty trigger)");
  assert.ok(!c.includes("router.refresh"), "no refresh storm");
  assert.ok(!c.includes("markShopifyDirty"), "copy refs never affect Shopify");
  const s2 = read("src/components/listing/Station2ImagePanel.tsx");
  assert.match(s2, /<CopyReferenceRow busy=\{copyRef\.busy\} onReset=\{copyRef\.reset\} selection=\{copyRef\.selection\} \/>/);
  assert.match(s2, /<CopyReferenceBadge[\s\S]*?onToggle=\{\(\) => copyRef\.toggle\(image\.id\)\}/);
  const s3 = read("src/components/listing/result-card/ResultCardImagesPanel.tsx");
  assert.equal((s3.match(/<CopyReferenceBadge/g) || []).length, 2);
  assert.match(s3, /<CopyReferenceBadge\s+compact/);
  assert.match(s3, /<CopyReferenceRow/);
  const rc = read("src/components/listing/ResultCard.tsx");
  assert.match(rc, /const copyReference = useCopyReference\(\{/);
  assert.match(rc, /copyReference=\{copyReference\}/);
});

await check("F4 CSS：只加 .is-auto／.is-compact 兩個修飾，沒有 !important", () => {
  const g = read("src/app/globals.css");
  const auto = g.match(/\.pthumb-spec-badge\.is-auto \{[^}]*\}/);
  const compact = g.match(/\.pthumb-spec-badge\.is-compact \{[^}]*\}/);
  assert.ok(auto && compact);
  assert.match(auto[0], /border-color: var\(--accent\);[\s\S]*color: var\(--accent\);/);
  assert.match(compact[0], /top: auto;[\s\S]*bottom: 3px;[\s\S]*font-size: 9px;/);
  assert.ok(!/!important/.test(auto[0] + compact[0]));
});

await check("F5 ImageUploader 詳情圖字樣不再寫「不上架」；提示改成文案參考說明", () => {
  const s = read("src/components/listing/ImageUploader.tsx");
  assert.ok(s.includes('label: "詳情圖（會放進商品描述，也給 AI 讀字）"'));
  assert.ok(!s.includes("不上架"));
  assert.ok(!s.includes("主圖右上角可標規格圖"));
  assert.ok(s.includes("AI 會自動挑圖讀字；想指定，生成後到審核卡「圖片」分頁點「文案參考」"));
  const s2 = read("src/components/listing/Station2ImagePanel.tsx");
  assert.ok(!s2.includes("不上架"));
  assert.ok(!s2.includes("僅供辨識"));
  assert.ok(!read("src/lib/images/processMarks.ts").includes("詳情圖不上架"));
});

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length > 0) process.exit(1);
