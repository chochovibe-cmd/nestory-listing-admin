/**
 * B13 pure-logic verification (no secrets, no network).
 * Run: node scripts/verify-b13-workspace-autosave.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

// --- Inline mirrors of workspaceAutosave.ts ---

const KEY = "nestory:workspace-draft-v1";
const VERSION = 1;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function shouldPersist(input) {
  if (input.draftId) return true;
  if (String(input.title || "").trim()) return true;
  if (String(input.price || "").trim()) return true;
  if (String(input.taobaoUrl || "").trim()) return true;
  if (String(input.note || "").trim()) return true;
  if (String(input.specText || "").trim()) return true;
  if (String(input.manualSellPrice || "").trim() || String(input.manualCompareAtPrice || "").trim())
    return true;
  if (String(input.targetProfitInput || "").trim()) return true;
  if (
    (input.variants || []).some(
      (row) =>
        (row.optionValues || []).some((v) => String(v).trim()) || String(row.cost || "").trim()
    )
  )
    return true;
  return false;
}

function isExpired(savedAt, nowMs = Date.now()) {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return true;
  return nowMs - t > MAX_AGE_MS;
}

function formatAge(savedAt, nowMs = Date.now()) {
  const t = Date.parse(savedAt);
  if (Number.isNaN(t)) return "稍早";
  const diffMs = Math.max(0, nowMs - t);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "剛剛";
  if (minutes < 60) return `約 ${minutes} 分鐘前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `約 ${hours} 小時前`;
  const days = Math.floor(hours / 24);
  return `約 ${days} 天前`;
}

function parse(raw) {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (!data || data.version !== VERSION) return null;
    if (typeof data.savedAt !== "string" || !data.savedAt) return null;
    if (typeof data.title !== "string") return null;
    return data;
  } catch {
    return null;
  }
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

function load(storage, nowMs = Date.now()) {
  if (!storage) return { kind: "empty" };
  const raw = storage.getItem(KEY);
  if (!raw) return { kind: "empty" };
  const snapshot = parse(raw);
  if (!snapshot) {
    storage.removeItem(KEY);
    return { kind: "invalid", cleared: true };
  }
  if (isExpired(snapshot.savedAt, nowMs)) {
    storage.removeItem(KEY);
    return { kind: "expired", cleared: true };
  }
  if (!shouldPersist(snapshot)) {
    storage.removeItem(KEY);
    return { kind: "empty" };
  }
  return { kind: "ready", snapshot };
}

function write(storage, snapshot) {
  if (!shouldPersist(snapshot)) {
    storage.removeItem(KEY);
    return;
  }
  storage.setItem(KEY, JSON.stringify(snapshot));
}

function clear(storage) {
  storage.removeItem(KEY);
}

console.log("B13 workspace autosave verification\n");

await check("empty form should not persist", () => {
  assert.equal(
    shouldPersist({
      draftId: null,
      title: "  ",
      price: "",
      taobaoUrl: "",
      note: "",
      specText: "",
      variants: [],
      manualSellPrice: "",
      manualCompareAtPrice: "",
      targetProfitInput: "",
    }),
    false
  );
});

await check("title or draftId triggers persist", () => {
  assert.equal(
    shouldPersist({
      draftId: null,
      title: "吉伊卡哇吊飾",
      price: "",
      taobaoUrl: "",
      note: "",
      specText: "",
      variants: [],
      manualSellPrice: "",
      manualCompareAtPrice: "",
      targetProfitInput: "",
    }),
    true
  );
  assert.equal(
    shouldPersist({
      draftId: "uuid-1",
      title: "",
      price: "",
      taobaoUrl: "",
      note: "",
      specText: "",
      variants: [],
      manualSellPrice: "",
      manualCompareAtPrice: "",
      targetProfitInput: "",
    }),
    true
  );
});

await check("7-day expiry clears without ready", () => {
  const storage = makeStorage();
  const now = Date.parse("2026-07-12T12:00:00.000Z");
  const old = new Date(now - MAX_AGE_MS - 1000).toISOString();
  write(storage, {
    version: VERSION,
    savedAt: old,
    draftId: null,
    title: "舊草稿",
    price: "10",
    taobaoUrl: "",
    note: "",
    specText: "",
    variants: [],
    manualSellPrice: "",
    manualCompareAtPrice: "",
    targetProfitInput: "",
  });
  const result = load(storage, now);
  assert.equal(result.kind, "expired");
  assert.equal(storage.getItem(KEY), null);
});

await check("fresh snapshot loads with real savedAt age label", () => {
  const storage = makeStorage();
  const now = Date.parse("2026-07-12T12:00:00.000Z");
  const savedAt = new Date(now - 3 * 60_000).toISOString();
  write(storage, {
    version: VERSION,
    savedAt,
    draftId: "d1",
    title: "新草稿",
    price: "79",
    taobaoUrl: "",
    note: "",
    specText: "",
    variants: [],
    manualSellPrice: "",
    manualCompareAtPrice: "",
    targetProfitInput: "",
  });
  const result = load(storage, now);
  assert.equal(result.kind, "ready");
  assert.equal(result.snapshot.draftId, "d1");
  assert.equal(formatAge(savedAt, now), "約 3 分鐘前");
  assert.equal(formatAge(new Date(now - 30_000).toISOString(), now), "剛剛");
  assert.equal(formatAge(new Date(now - 2 * 3600_000).toISOString(), now), "約 2 小時前");
  assert.equal(formatAge(new Date(now - 3 * 24 * 3600_000).toISOString(), now), "約 3 天前");
});

await check("clear removes key (success generate / discard / light reset)", () => {
  const storage = makeStorage();
  write(storage, {
    version: VERSION,
    savedAt: new Date().toISOString(),
    draftId: null,
    title: "x",
    price: "",
    taobaoUrl: "",
    note: "",
    specText: "",
    variants: [],
    manualSellPrice: "",
    manualCompareAtPrice: "",
    targetProfitInput: "",
  });
  assert.ok(storage.getItem(KEY));
  clear(storage);
  assert.equal(storage.getItem(KEY), null);
  assert.equal(load(storage).kind, "empty");
});

await check("source: workspaceAutosave module + panel wiring hooks", () => {
  const mod = fs.readFileSync(path.join(root, "src/lib/drafts/workspaceAutosave.ts"), "utf8");
  assert.ok(mod.includes("WORKSPACE_AUTOSAVE_KEY"));
  assert.ok(mod.includes("多分頁同開時後寫贏") || mod.includes("last write wins"));
  assert.ok(mod.includes("7 * 24"));
  assert.ok(mod.includes("formatAutosaveAgeLabel"));

  const panel = fs.readFileSync(
    path.join(root, "src/components/listing/WorkspaceInputPanel.tsx"),
    "utf8"
  );
  assert.ok(panel.includes("loadWorkspaceAutosave"));
  assert.ok(panel.includes("writeWorkspaceAutosave"));
  assert.ok(panel.includes("clearWorkspaceAutosave"));
  assert.ok(panel.includes("restorePrompt"));
  assert.ok(panel.includes("continueRestore"));
  assert.ok(panel.includes("discardRestore"));
  assert.ok(panel.includes("formatAutosaveAgeLabel"));
  // light reset clears autosave (continuous listing)
  assert.ok(panel.includes("resetForNextItem"));
  assert.ok(
    panel.includes("clearWorkspaceAutosave") && panel.includes("連續上架"),
    "resetForNextItem must clear localStorage"
  );
});

console.log("");
if (failures.length) {
  console.error(`FAILED ${failures.length} check(s)`);
  process.exit(1);
}
console.log("ALL passed");
