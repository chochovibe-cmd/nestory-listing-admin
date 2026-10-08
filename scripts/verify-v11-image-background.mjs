import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const workspace = read("src/components/listing/WorkspaceInputPanel.tsx");
const queue = read("src/app/api/generation-queue/route.ts");
const captureRoute = read("src/app/api/import/product-page/route.ts");
const capture = read("src/lib/import/createCaptureDraft.ts");
const fetchRemote = read("src/lib/import/fetchRemoteImages.ts");

console.log("V1.1 image backgrounding");

assert.doesNotMatch(
  workspace,
  /await Promise\.allSettled\(uploadPromisesRef\.current\)/,
  "new-item submit must not wait for local image uploads",
);
assert.match(workspace, /expectedImageCount = imageCounts\.main \+ imageCounts\.detail/);
assert.match(workspace, /expectedImageCount/);
assert.doesNotMatch(workspace, /disabled=\{submitting \|\| imagesUploading\}/);
assert.match(workspace, /圖片背景上傳中，可直接排隊/);

assert.match(queue, /IMAGE_READY_TIMEOUT_MS = 2 \* 60_000/);
assert.match(queue, /expectedImageCount\?: number/);
assert.match(queue, /waitForCaptureImages\?: boolean/);
assert.match(queue, /captureImageFetchStatus/);
assert.match(queue, /\.from\("product_images"\)/);
assert.match(queue, /圖片背景上傳未完成/);
assert.match(queue, /擷取圖片背景處理逾時/);
assert.match(queue, /image_fetch_status/);

assert.match(captureRoute, /import \{ after, NextRequest \} from "next\/server"/);
assert.match(captureRoute, /deferImages: true/);
assert.match(captureRoute, /after\(async \(\) =>/);
assert.match(captureRoute, /completeCaptureDraftImages/);

assert.match(capture, /image_fetch_status:/);
assert.match(capture, /image_fetch_expected:/);
assert.match(capture, /if \(input\.deferImages\)/);
assert.match(capture, /applyVariantImageIds\(mapped\.variantRows, \{\}\)/);
assert.match(capture, /export async function completeCaptureDraftImages/);
assert.match(capture, /\.is\("image_id", null\)/);
assert.match(capture, /image_fetch_finished_at/);

assert.match(fetchRemote, /const workerCount = Math\.min\(5, jobs\.length\)/);
assert.match(fetchRemote, /Promise\.all\(Array\.from\(\{ length: workerCount \}/);
assert.match(fetchRemote, /IMAGE_FETCH_TIMEOUT_MS/);
assert.match(fetchRemote, /MAX_IMAGE_BYTES/);

console.log("V1.1 image backgrounding checks passed");
