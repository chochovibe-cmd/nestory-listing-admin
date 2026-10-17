import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetchAllRows";

// IMAGE-INTEGRITY: the only place that deletes product_images rows from the client.
// Invariant: unbind variants -> DB delete -> (reference check) -> Storage remove. Never Storage first.
// A row without its file = broken image (bad). A file without its row = orphan (acceptable).
// Shared files are kept: other rows may reuse a URL (generated_detail rows put the MAIN image's
// URL in original_file_url), so a path is only removed when it sits in the deleted row's own
// draft folder ({owner}/{draftId}/...) AND no remaining row of that draft still references it.
// Client-safe on purpose: no "@/..." runtime imports, supabase client is a parameter.
// Speed: the two independent reads run together, and callers that do not need the Storage result
// can pass backgroundStorageCleanup so the DB answer is not held up by the cleanup (see storageCleanup).

export const PRODUCT_IMAGES_BUCKET = "product-images";

const IMAGE_ROW_COLUMNS_FULL =
  "id, draft_id, original_file_url, processed_file_url, generated_file_url, list_thumb_url, vision_mid_url";
// list_thumb_url / vision_mid_url come from migration 039; fall back if it is not applied.
const IMAGE_ROW_COLUMNS_BASE = "id, draft_id, original_file_url, processed_file_url, generated_file_url";

export type ProductImageUrlRow = {
  original_file_url?: string | null;
  processed_file_url?: string | null;
  generated_file_url?: string | null;
  list_thumb_url?: string | null;
  vision_mid_url?: string | null;
};

export type VariantBindingsResult =
  | { ok: true; byImageId: Record<string, string[]>; total: number }
  | { ok: false; error: string };

export type DeleteProductImagesResult = {
  ok: boolean;
  deletedIds: string[];
  failedIds: string[];
  /** Variants whose image_id was cleared and stayed cleared. */
  unboundVariantIds: string[];
  blockedByVariants?: { imageId: string; count: number }[];
  /** Storage cleanup warnings. In background mode this stays empty: read them from storageCleanup. */
  storageWarnings: string[];
  /**
   * Resolves to the Storage cleanup warnings once the cleanup is finished. Never rejects.
   * Already resolved unless backgroundStorageCleanup was set and the delete got that far.
   */
  storageCleanup: Promise<string[]>;
  error?: string;
};

export type DeleteProductImagesOptions = {
  unbindVariants: boolean;
  /** Draft-only orphan cleanup: delete the product_images DB row, but NEVER the Storage files. */
  keepStorageFiles?: boolean;
  /**
   * Default false: the Storage cleanup is awaited before returning. When true the cleanup starts
   * after the DB delete is decided but is NOT awaited (follow it via result.storageCleanup).
   */
  backgroundStorageCleanup?: boolean;
};

type ImageRowInfo = { draftId: string | null; paths: string[] };

type DbError = { message: string; code?: string } | null;
type DbResult = { data: unknown; error: DbError };

/** Public URL (.../object/public/product-images/<path>) -> Storage object path, else null. */
export function productImagesStoragePathFromUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string") return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const marker = `/${PRODUCT_IMAGES_BUCKET}/`;
  const index = trimmed.indexOf(marker);
  if (index < 0) return null;
  const raw = trimmed.slice(index + marker.length).split("#")[0].split("?")[0];
  if (!raw) return null;
  let path = raw;
  try {
    path = decodeURIComponent(raw);
  } catch {
    // malformed %-escape: keep the raw segment
  }
  return path || null;
}

/** All distinct Storage paths (every size) that one product_images row points at. */
export function collectProductImageStoragePaths(row: ProductImageUrlRow | null | undefined): string[] {
  if (!row) return [];
  const urls = [
    row.original_file_url,
    row.processed_file_url,
    row.generated_file_url,
    row.list_thumb_url,
    row.vision_mid_url
  ];
  const paths = new Set<string>();
  for (const url of urls) {
    const path = productImagesStoragePathFromUrl(url);
    if (path) paths.add(path);
  }
  return Array.from(paths);
}

function dedupeIds(ids: readonly string[] | null | undefined): string[] {
  return Array.from(new Set((ids ?? []).filter((id) => typeof id === "string" && id.length > 0)));
}

function errorText(err: unknown): string {
  if (err && typeof err === "object" && "message" in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

// supabase-js normally returns { error }, but a thrown fetch failure must not skip the
// restore / abort logic below, so convert throws into an error result.
async function run(fn: () => PromiseLike<unknown>): Promise<DbResult> {
  try {
    const res = (await fn()) as { data?: unknown; error?: DbError } | null;
    return { data: res?.data ?? null, error: res?.error ?? null };
  } catch (err) {
    return { data: null, error: { message: errorText(err) } };
  }
}

// product_images rows with every URL column; retries without the 039 columns if they are missing.
async function selectImageRows(
  build: (columns: string, from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: DbError }>
): Promise<DbResult> {
  const load = (columns: string) =>
    run(() => fetchAllRows((from, to) => build(columns, from, to)));
  const full = await load(IMAGE_ROW_COLUMNS_FULL);
  return full.error ? load(IMAGE_ROW_COLUMNS_BASE) : full;
}

function idsOf(data: unknown): string[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((row) => (row && typeof row === "object" ? (row as { id?: unknown }).id : null))
    .filter((id): id is string => typeof id === "string");
}

export async function findVariantBindings(
  supabase: SupabaseClient,
  imageIds: readonly string[]
): Promise<VariantBindingsResult> {
  const ids = dedupeIds(imageIds);
  if (ids.length === 0) return { ok: true, byImageId: {}, total: 0 };
  const res = await run(() =>
    fetchAllRows((from, to) =>
      supabase
        .from("product_variants")
        .select("id, image_id")
        .in("image_id", ids)
        .order("id")
        .range(from, to)
    )
  );
  if (res.error) return { ok: false, error: res.error.message };
  const byImageId: Record<string, string[]> = {};
  let total = 0;
  for (const row of Array.isArray(res.data) ? res.data : []) {
    const variantId = (row as { id?: unknown }).id;
    const imageId = (row as { image_id?: unknown }).image_id;
    if (typeof variantId !== "string" || typeof imageId !== "string") continue;
    (byImageId[imageId] ??= []).push(variantId);
    total += 1;
  }
  return { ok: true, byImageId, total };
}

/** Best-effort: point variants back at their image. Returns the variant ids that could NOT be restored. */
async function restoreBindings(
  supabase: SupabaseClient,
  byImageId: Record<string, string[]>,
  onlyVariantIds?: ReadonlySet<string>
): Promise<string[]> {
  const stuck: string[] = [];
  for (const [imageId, variantIds] of Object.entries(byImageId)) {
    const targets = onlyVariantIds ? variantIds.filter((id) => onlyVariantIds.has(id)) : variantIds;
    if (targets.length === 0) continue;
    const res = await run(() =>
      supabase.from("product_variants").update({ image_id: imageId }).in("id", targets).select("id")
    );
    if (res.error) {
      stuck.push(...targets);
      continue;
    }
    const restored = new Set(idsOf(res.data));
    stuck.push(...targets.filter((id) => !restored.has(id)));
  }
  return stuck;
}

export function deleteProductImagesFailureMessage(result: DeleteProductImagesResult): string {
  if (result.blockedByVariants?.length) return "這張圖仍綁定款式";
  if (result.error) return result.error;
  if (result.failedIds.length > 0) {
    return "圖片未被刪除（可能沒有權限，或草稿目前的狀態不允許刪除圖片）";
  }
  return "未知原因";
}

/**
 * Storage cleanup for rows that are really gone. Never throws and never rejects: every failure
 * becomes a warning (also logged), because the data is already deleted.
 */
async function cleanupStorage(
  supabase: SupabaseClient,
  deletedIds: readonly string[],
  rowsById: ReadonlyMap<string, ImageRowInfo>
): Promise<string[]> {
  const warnings: string[] = [];
  const warn = (message: string) => {
    console.warn("[deleteProductImages]", message);
    warnings.push(message);
  };
  try {
    // 5a) Folder guard: only paths inside the deleted row's own draft folder are ever candidates.
    //     Anything else (other draft, foreign layout) is left as an orphan.
    const candidates = new Set<string>();
    const draftIds = new Set<string>();
    for (const id of deletedIds) {
      const info = rowsById.get(id);
      if (!info?.draftId) continue;
      for (const path of info.paths) {
        if (path.split("/")[1] !== info.draftId) continue;
        candidates.add(path);
        draftIds.add(info.draftId);
      }
    }
    if (candidates.size > 0) {
      // 5b) Reference guard: a path any remaining row of those drafts still uses is a shared file.
      const remaining = await selectImageRows((columns, from, to) =>
        supabase
          .from("product_images")
          .select(columns)
          .in("draft_id", Array.from(draftIds))
          .order("id")
          .range(from, to)
      );
      if (remaining.error) {
        warn(`無法確認圖片檔案是否仍被使用，已略過檔案清理（資料已刪除）：${remaining.error.message}`);
      } else {
        const referenced = new Set<string>();
        for (const row of Array.isArray(remaining.data) ? remaining.data : []) {
          for (const path of collectProductImageStoragePaths(row as ProductImageUrlRow)) {
            referenced.add(path);
          }
        }
        const paths = Array.from(candidates).filter((path) => !referenced.has(path));
        if (paths.length > 0) {
          const { data, error } = await supabase.storage.from(PRODUCT_IMAGES_BUCKET).remove(paths);
          if (error) {
            warn(`圖片檔案清理失敗（資料已刪除）：${error.message}`);
          } else if (Array.isArray(data) && data.length < paths.length) {
            warn(`圖片檔案只清掉 ${data.length}/${paths.length} 個（資料已刪除）`);
          }
        }
      }
    }
  } catch (err) {
    warn(`圖片檔案清理失敗（資料已刪除）：${errorText(err)}`);
  }
  return warnings;
}

export async function deleteProductImages(
  supabase: SupabaseClient,
  imageIds: readonly string[],
  options: DeleteProductImagesOptions
): Promise<DeleteProductImagesResult> {
  const ids = dedupeIds(imageIds);
  const result: DeleteProductImagesResult = {
    ok: true,
    deletedIds: [],
    failedIds: [],
    unboundVariantIds: [],
    storageWarnings: [],
    storageCleanup: Promise.resolve([])
  };
  if (ids.length === 0) return result;

  const fail = (error: string, failedIds: string[] = ids): DeleteProductImagesResult => ({
    ...result,
    ok: false,
    failedIds,
    error
  });

  // 1) Every URL we will need + 2) variants bound to these images (FK product_variants.image_id
  //    has no ON DELETE action). Independent read-only queries: run them together, BEFORE touching anything.
  const [selected, bindings] = await Promise.all([
    selectImageRows((columns, from, to) =>
      supabase
        .from("product_images")
        .select(columns)
        .in("id", ids)
        .order("id")
        .range(from, to)
    ),
    findVariantBindings(supabase, ids)
  ]);
  if (selected.error) return fail(`讀取圖片資料失敗：${selected.error.message}`);
  if (!bindings.ok) return fail(`確認款式綁定失敗：${bindings.error}`);
  const rowsById = new Map<string, ImageRowInfo>();
  for (const row of Array.isArray(selected.data) ? selected.data : []) {
    const r = row as ProductImageUrlRow & { id?: unknown; draft_id?: unknown };
    if (typeof r.id !== "string") continue;
    rowsById.set(r.id, {
      draftId: typeof r.draft_id === "string" && r.draft_id ? r.draft_id : null,
      paths: collectProductImageStoragePaths(r)
    });
  }
  const byImageId = bindings.byImageId;
  const boundVariantIds = Object.values(byImageId).flat();

  if (bindings.total > 0 && !options.unbindVariants) {
    return {
      ...fail("這張圖仍綁定款式，需先解除綁定才能刪除"),
      blockedByVariants: Object.entries(byImageId).map(([imageId, list]) => ({
        imageId,
        count: list.length
      }))
    };
  }

  // 3) Unbind. All-or-restore: if any variant could not be cleared, put back what we cleared.
  let unbound = new Set<string>();
  if (boundVariantIds.length > 0) {
    const res = await run(() =>
      supabase.from("product_variants").update({ image_id: null }).in("id", boundVariantIds).select("id")
    );
    unbound = new Set(idsOf(res.data));
    if (res.error || unbound.size < boundVariantIds.length) {
      // On error the outcome may be unknown (e.g. network drop), so restore everything.
      const stuck = await restoreBindings(supabase, byImageId, res.error ? undefined : unbound);
      const base = res.error
        ? `解除款式圖片綁定失敗：${res.error.message}`
        : "解除款式圖片綁定失敗（部分款式沒有權限修改）";
      return {
        ...fail(stuck.length > 0 ? `${base}；另有 ${stuck.length} 個款式的綁定未能還原` : base),
        unboundVariantIds: stuck
      };
    }
  }

  // 4) Delete the DB rows. A silent RLS no-op returns no error but also no row.
  const deleted = await run(() =>
    supabase.from("product_images").delete().in("id", ids).select("id")
  );
  if (deleted.error) {
    const stuck = boundVariantIds.length > 0 ? await restoreBindings(supabase, byImageId) : [];
    const hint =
      deleted.error.code === "23503" ? "（仍有款式綁定這張圖）" : "";
    const base = `刪除圖片資料失敗${hint}：${deleted.error.message}`;
    return {
      ...fail(stuck.length > 0 ? `${base}；另有 ${stuck.length} 個款式的綁定未能還原` : base),
      unboundVariantIds: stuck
    };
  }
  const deletedSet = new Set(idsOf(deleted.data));
  result.deletedIds = ids.filter((id) => deletedSet.has(id));
  result.failedIds = ids.filter((id) => !deletedSet.has(id));

  result.unboundVariantIds = boundVariantIds.filter((variantId) =>
    result.deletedIds.some((imageId) => byImageId[imageId]?.includes(variantId))
  );
  if (result.failedIds.length > 0 && boundVariantIds.length > 0) {
    const failedBindings: Record<string, string[]> = {};
    for (const imageId of result.failedIds) {
      if (byImageId[imageId]) failedBindings[imageId] = byImageId[imageId];
    }
    const stuck = await restoreBindings(supabase, failedBindings);
    result.unboundVariantIds.push(...stuck);
    if (stuck.length > 0) result.error = `另有 ${stuck.length} 個款式的圖片綁定未能還原`;
  }

  // 5) Storage LAST, and only for rows that are really gone. Never fails the whole delete.
  //    Draft-only variant cleanup intentionally preserves Storage objects for possible recovery.
  result.ok = result.failedIds.length === 0;
  if (options.keepStorageFiles) return result;
  //    In background mode cleanup starts after DB outcome and binding restores are final.
  const cleanup = cleanupStorage(supabase, result.deletedIds, rowsById);
  if (options.backgroundStorageCleanup) {
    result.storageCleanup = cleanup;
    return result;
  }
  result.storageWarnings.push(...(await cleanup));
  result.storageCleanup = Promise.resolve(result.storageWarnings);
  return result;
}
