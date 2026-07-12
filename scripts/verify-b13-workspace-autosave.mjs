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

// --- formFieldsFromAutosaveSnapshot mirror ---
function formFieldsFromAutosaveSnapshot(snap) {
  return {
    draftId: typeof snap.draftId === "string" && snap.draftId ? snap.draftId : null,
    title: typeof snap.title === "string" ? snap.title : "",
    source: typeof snap.source === "string" ? snap.source : "",
    price: typeof snap.price === "string" ? snap.price : snap.price != null ? String(snap.price) : "",
    costCurrency: snap.costCurrency === "TWD" ? "TWD" : "CNY",
    taobaoUrl: typeof snap.taobaoUrl === "string" ? snap.taobaoUrl : "",
    note: typeof snap.note === "string" ? snap.note : "",
    specText: typeof snap.specText === "string" ? snap.specText : "",
    saleStatus: typeof snap.saleStatus === "string" ? snap.saleStatus : "",
    inventoryUnlimited: snap.inventoryUnlimited !== false,
    inventoryQuantity: typeof snap.inventoryQuantity === "string" ? snap.inventoryQuantity : "",
    inventoryOpen: Boolean(snap.inventoryOpen),
    tone: typeof snap.tone === "string" ? snap.tone : "",
    copyLength: typeof snap.copyLength === "string" ? snap.copyLength : "標準",
    useWebSearch: snap.useWebSearch !== false,
    priceMode: snap.priceMode === "single" ? "single" : "sale",
    manualPricingEnabled: Boolean(snap.manualPricingEnabled),
    manualCompareAtPrice:
      typeof snap.manualCompareAtPrice === "string" ? snap.manualCompareAtPrice : "",
    manualSellPrice: typeof snap.manualSellPrice === "string" ? snap.manualSellPrice : "",
    profitDriven: Boolean(snap.profitDriven),
    targetProfitInput: typeof snap.targetProfitInput === "string" ? snap.targetProfitInput : "",
    variantDimensions: Array.isArray(snap.variantDimensions)
      ? snap.variantDimensions.map((d) => ({ name: String(d?.name ?? "") }))
      : [],
    variants: Array.isArray(snap.variants)
      ? snap.variants.map((row, i) => ({
          optionValues: [
            String(row?.optionValues?.[0] ?? ""),
            String(row?.optionValues?.[1] ?? ""),
            String(row?.optionValues?.[2] ?? ""),
          ],
          cost: String(row?.cost ?? ""),
          sellPrice: String(row?.sellPrice ?? ""),
          compareAt: String(row?.compareAt ?? ""),
          priceLocked: Boolean(row?.priceLocked),
          qty: String(row?.qty ?? ""),
          sku: String(row?.sku ?? ""),
          imageId: row?.imageId ?? null,
          sortOrder: typeof row?.sortOrder === "number" ? row.sortOrder : i,
        }))
      : [],
  };
}

await check("formFieldsFromAutosaveSnapshot restores all product fields", () => {
  const fields = formFieldsFromAutosaveSnapshot({
    version: VERSION,
    savedAt: new Date().toISOString(),
    draftId: "uuid-1",
    title: "自動保存測試：三麗鷗美樂蒂掛飾",
    source: "淘寶",
    price: "79.11",
    costCurrency: "CNY",
    taobaoUrl: "https://example.com/item",
    note: "含底座",
    specText: "材質：PVC",
    saleStatus: "海外代購（約14天）",
    inventoryUnlimited: true,
    inventoryQuantity: "",
    inventoryOpen: false,
    tone: "可愛周邊輕鬆感",
    copyLength: "標準",
    useWebSearch: true,
    priceMode: "sale",
    manualPricingEnabled: false,
    manualCompareAtPrice: "",
    manualSellPrice: "",
    profitDriven: false,
    targetProfitInput: "",
    variantDimensions: [{ name: "款式" }],
    variants: [
      {
        optionValues: ["粉色", "", ""],
        cost: "50",
        sellPrice: "380",
        compareAt: "480",
        priceLocked: false,
        qty: "",
        sku: "",
        imageId: null,
        sortOrder: 0,
      },
    ],
  });
  assert.equal(fields.title, "自動保存測試：三麗鷗美樂蒂掛飾");
  assert.equal(fields.price, "79.11");
  assert.equal(fields.note, "含底座");
  assert.equal(fields.specText, "材質：PVC");
  assert.equal(fields.draftId, "uuid-1");
  assert.equal(fields.variants.length, 1);
  assert.equal(fields.variants[0].optionValues[0], "粉色");
  assert.equal(fields.variants[0].cost, "50");
  assert.equal(fields.variantDimensions[0].name, "款式");
});

await check("source: workspaceAutosave module + panel wiring hooks", () => {
  const mod = fs.readFileSync(path.join(root, "src/lib/drafts/workspaceAutosave.ts"), "utf8");
  assert.ok(mod.includes("WORKSPACE_AUTOSAVE_KEY"));
  assert.ok(mod.includes("多分頁同開時後寫贏") || mod.includes("last write wins"));
  assert.ok(mod.includes("7 * 24"));
  assert.ok(mod.includes("formatAutosaveAgeLabel"));
  assert.ok(mod.includes("formFieldsFromAutosaveSnapshot"));

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
  // fix(B13): restore path must flushSync + re-read storage + suppress autosave
  assert.ok(panel.includes("flushSync"), "continueRestore must flushSync apply");
  assert.ok(panel.includes("suppressAutosaveRef"), "must suppress autosave during restore");
  assert.ok(panel.includes("formFieldsFromAutosaveSnapshot"));
  assert.ok(
    panel.includes("loadWorkspaceAutosave(storage)") ||
      panel.includes("loadWorkspaceAutosave(\n") ||
      /loadWorkspaceAutosave\(\s*storage/.test(panel),
    "continueRestore must re-read localStorage"
  );
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
