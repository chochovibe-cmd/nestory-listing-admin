/**
 * CAP-2.5 verify: draft→form map, pending_input gate, open_path, chip nav, no double-insert.
 * Run: node scripts/verify-cap25.mjs  |  pnpm run verify:cap25
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const failures = [];

function check(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const exists = (rel) => fs.existsSync(path.join(root, rel));

console.log("verify-cap25:");

check("files: map + page + panel + quick preview + open_path source", () => {
  assert.ok(exists("src/lib/drafts/mapDraftToWorkspaceForm.ts"));
  assert.ok(exists("src/app/drafts/new/page.tsx"));
  assert.ok(exists("src/components/listing/WorkspaceInputPanel.tsx"));
  assert.ok(exists("src/components/listing/QuickPreviewPanel.tsx"));
  assert.ok(exists("src/components/listing/WorkbenchPageClient.tsx"));
  assert.ok(exists("src/lib/import/createCaptureDraft.ts"));
});

// Mirror pure helpers (keep in sync with mapDraftToWorkspaceForm.ts)
function mapSourcePlatformToForm(platform) {
  const raw = String(platform ?? "").trim();
  if (!raw) return "淘寶";
  if (["淘寶", "閑魚", "蝦皮"].includes(raw)) return raw;
  const s = raw.toLowerCase();
  if (s.includes("shopee") || s.includes("蝦皮")) return "蝦皮";
  if (s.includes("xianyu") || s.includes("闲鱼") || s.includes("閑魚") || s.includes("goofish")) {
    return "閑魚";
  }
  if (
    s.includes("taobao") ||
    s.includes("tmall") ||
    s.includes("淘寶") ||
    s.includes("天貓") ||
    s.includes("天猫")
  ) {
    return "淘寶";
  }
  return "淘寶";
}

function videoUrlsToTextarea(videoUrls) {
  if (!Array.isArray(videoUrls)) {
    if (typeof videoUrls === "string" && videoUrls.trim()) return videoUrls.trim();
    return "";
  }
  return videoUrls
    .map((u) => String(u ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function isPendingInputStatus(status) {
  return status === "pending_input";
}

function mapStatusToPipelineStage(status) {
  switch (status ?? "") {
    case "pending_input":
    case "pending_copy":
    case "processing":
      return "input";
    case "ready_for_review":
    case "needs_revision":
    case "failed":
      return "copy_review";
    case "approved":
      return "image_review";
    case "publishing":
      return "ready";
    case "csv_ready":
    case "draft_created":
    case "active_published":
    case "api_failed":
      return "published";
    case "archived":
      return "archived";
    default:
      return "input";
  }
}

function resolveNonPendingInputRedirect(status) {
  const stage = mapStatusToPipelineStage(status);
  if (stage === "image_review") {
    return { href: "/review", message: "生圖" };
  }
  if (stage === "ready" || stage === "published" || stage === "archived") {
    return { href: "/records", message: "紀錄" };
  }
  return { href: "/drafts/new", message: "審核" };
}

function captureOpenPath(draftId) {
  return `/drafts/new?draft=${encodeURIComponent(draftId)}`;
}

check("pure: source_platform map taobao/tmall/shopee", () => {
  assert.equal(mapSourcePlatformToForm("taobao"), "淘寶");
  assert.equal(mapSourcePlatformToForm("tmall"), "淘寶");
  assert.equal(mapSourcePlatformToForm("shopee"), "蝦皮");
  assert.equal(mapSourcePlatformToForm(null), "淘寶");
});

check("pure: video urls → textarea lines", () => {
  assert.equal(videoUrlsToTextarea(["a", "b"]), "a\nb");
  assert.equal(videoUrlsToTextarea([]), "");
});

check("pure: gate only pending_input; A1 redirects", () => {
  assert.equal(isPendingInputStatus("pending_input"), true);
  assert.equal(isPendingInputStatus("pending_copy"), false);
  assert.equal(isPendingInputStatus("ready_for_review"), false);
  assert.equal(resolveNonPendingInputRedirect("ready_for_review").href, "/drafts/new");
  assert.equal(resolveNonPendingInputRedirect("approved").href, "/review");
  assert.equal(resolveNonPendingInputRedirect("publishing").href, "/records");
  assert.equal(resolveNonPendingInputRedirect("archived").href, "/records");
  assert.equal(resolveNonPendingInputRedirect("pending_copy").href, "/drafts/new");
});

check("pure: captureOpenPath shape", () => {
  const p = captureOpenPath("abc-123");
  assert.equal(p, "/drafts/new?draft=abc-123");
  assert.match(captureOpenPath("a/b"), /draft=a%2Fb/);
});

check("source: createCaptureDraft open_path uses /drafts/new?draft=", () => {
  const src = read("src/lib/import/createCaptureDraft.ts");
  assert.match(src, /captureOpenPath|\/drafts\/new\?draft=/);
  assert.doesNotMatch(src, /return\s+`\/drafts\/\$\{draftId\}`/);
});

check("source: mapDraftToWorkspaceForm exports + CNY + pending_input gate", () => {
  const src = read("src/lib/drafts/mapDraftToWorkspaceForm.ts");
  assert.match(src, /export function mapDraftToWorkspaceForm/);
  assert.match(src, /costCurrency:\s*"CNY"/);
  assert.match(src, /status === "pending_input"/);
  assert.match(src, /resolveNonPendingInputRedirect/);
  assert.match(src, /captureOpenPath/);
});

check("source: new page loads ?draft= and gates non-pending_input", () => {
  const src = read("src/app/drafts/new/page.tsx");
  assert.match(src, /searchParams/);
  assert.match(src, /mapDraftToWorkspaceForm/);
  assert.match(src, /isPendingInputStatus/);
  assert.match(src, /resolveNonPendingInputRedirect/);
  assert.match(src, /initialFromServer/);
  assert.match(src, /redirect\(/);
});

check("source: WorkspaceInputPanel seed props + no B13 auto when seeded", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(src, /initialFromServer/);
  assert.match(src, /applyServerFormSeed/);
  assert.match(src, /serverSeedAppliedRef/);
  assert.match(src, /上次未完成的填寫仍在暫存/);
  // URL seed path must not show restore bar
  assert.match(src, /if \(initialFromServer\) return/);
  // ensureDraftId short-circuits when draftId set → update same id, no insert
  assert.match(
    src,
    /async function ensureDraftId[\s\S]*?if \(draftIdRef\.current\) return draftIdRef\.current[\s\S]*?\.insert\(/
  );
});

check("source: generate path updates same draft when draftId present", () => {
  const src = read("src/components/listing/WorkspaceInputPanel.tsx");
  // persistDraft: update when draftIdRef set
  assert.match(src, /draftIdRef\.current[\s\S]{0,200}\.update\(/);
  assert.match(src, /applyServerFormSeed[\s\S]*?draftIdRef\.current = seed\.draftId/);
});

check("source: QuickPreview input group navigates to form", () => {
  const src = read("src/components/listing/QuickPreviewPanel.tsx");
  assert.match(src, /group === ["']input["']/);
  assert.match(src, /\/drafts\/new\?draft=/);
  assert.match(src, /router\.push/);
  assert.match(src, /emitJumpToDraft/);
  assert.match(src, /未完成→開表單/);
});

check("source: WorkbenchPageClient passes seed props", () => {
  const src = read("src/components/listing/WorkbenchPageClient.tsx");
  assert.match(src, /initialFromServer/);
  assert.match(src, /loadNotice/);
});

check("package: verify:cap25 script present", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.equal(pkg.scripts["verify:cap25"], "node scripts/verify-cap25.mjs");
  const all = read("scripts/verify-all.mjs");
  assert.match(all, /verify-cap25\.mjs/);
});

check("regression: B13 autosave module still present (no ?draft= path)", () => {
  assert.ok(exists("src/lib/drafts/workspaceAutosave.ts"));
  assert.ok(exists("scripts/verify-b13-workspace-autosave.mjs"));
  const panel = read("src/components/listing/WorkspaceInputPanel.tsx");
  assert.match(panel, /loadWorkspaceAutosave/);
  assert.match(panel, /continueRestore|restorePrompt/);
  // when no initialFromServer, B13 detect still runs
  assert.match(panel, /B13 \/ BX4: detect unsent local snapshot/);
});

if (failures.length) {
  console.error(`\nverify-cap25: ${failures.length} failed`);
  process.exit(1);
}
console.log("\nverify-cap25: ALL passed");
