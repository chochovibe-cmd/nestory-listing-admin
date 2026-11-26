/**
 * GPT export only: content-addressed Shopify Files + signed, short-lived export proofs.
 * No mutation of product_images, no cleanup, no product create/publish.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { GptRawProduct } from "@/lib/csv/gptRawExport";
import { fetchServerImage } from "@/lib/images/fetchServerImage";
import { callShopifyAdminGraphQL } from "@/lib/shopify/adminGraphQL";
import { isShopifyCdnUrl, uploadProcessedImageToShopifyFiles } from "@/lib/shopify/filesUpload";
import { assertShopifyEnvironment, readNestoryEnvironment } from "@/lib/env/nestoryEnv";

export const GPT_CDN_BATCH_SIZE = 4;
const PROOF_TTL_MS = 2 * 60 * 60 * 1000;
export type GptCdnCandidate = { draftId: string; imageId: string; sourceUrl: string };
export type GptCdnProof = { url: string; expiresAt: number; signature: string };

export function isGptCdnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && isShopifyCdnUrl(url);
  } catch { return false; }
}

/** Match precisely the images the existing CSV serializer can emit. */
export function gptCdnCandidates(products: GptRawProduct[]): GptCdnCandidate[] {
  return products.flatMap((product) => {
    const referenced = new Set(product.product_variants.map((v) => v.image_id));
    return product.product_images.flatMap((image) => {
      if (image.image_type !== "main" && image.image_type !== "detail" && !referenced.has(image.id)) return [];
      const sourceUrl = (image.processed_file_url || image.original_file_url || "").trim();
      return sourceUrl ? [{ draftId: product.id, imageId: image.id, sourceUrl }] : [];
    });
  });
}

function signatureFor(candidate: GptCdnCandidate, userId: string, url: string, expiresAt: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(JSON.stringify(["nestory-gpt-cdn-v1", userId, candidate.draftId, candidate.imageId, candidate.sourceUrl, url, expiresAt]))
    .digest("hex");
}

export function createGptCdnProof(candidate: GptCdnCandidate, userId: string, url: string, secret: string, now = Date.now()): GptCdnProof {
  if (!secret || !isGptCdnUrl(url)) throw new Error("Invalid CDN proof input");
  const expiresAt = now + PROOF_TTL_MS;
  return { url, expiresAt, signature: signatureFor(candidate, userId, url, expiresAt, secret) };
}

export function verifyGptCdnProof(candidate: GptCdnCandidate, userId: string, proof: unknown, secret: string, now = Date.now()): string | null {
  if (!secret || !proof || typeof proof !== "object") return null;
  const p = proof as Partial<GptCdnProof>;
  if (typeof p.url !== "string" || !isGptCdnUrl(p.url) || typeof p.expiresAt !== "number" ||
      !Number.isSafeInteger(p.expiresAt) || p.expiresAt <= now || p.expiresAt > now + PROOF_TTL_MS ||
      typeof p.signature !== "string" || !/^[a-f0-9]{64}$/.test(p.signature)) return null;
  const expected = signatureFor(candidate, userId, p.url, p.expiresAt, secret);
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(p.signature, "hex")) ? p.url : null;
}

/** Work on copies only; the raw serializer and original draft stay untouched. */
export function withGptCdnUrls(products: GptRawProduct[], urls: ReadonlyMap<string, string>): GptRawProduct[] {
  return products.map((product) => ({
    ...product,
    product_images: product.product_images.map((image) => {
      const url = urls.get(image.id);
      return url ? { ...image, processed_file_url: url } : image;
    })
  }));
}

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tiff", "image/bmp": "bmp"
};
export function gptCdnFilename(bytes: Buffer, mimeType: string): string {
  const ext = EXTENSIONS[mimeType];
  if (!ext) throw new Error("Shopify 不支援此圖片格式");
  return "nestory-gpt-" + createHash("sha256").update(bytes).digest("hex") + "." + ext;
}

type FileNode = { id: string; fileStatus?: string; image?: { url?: string | null } | null };
type FileQuery = { data?: { files?: { nodes?: FileNode[] }; node?: FileNode | null }; errors?: unknown[] };
const FILE_FIELDS = "id fileStatus ... on MediaImage { image { url } }";
const FIND_FILE = "query GptExportFile($query: String!) { files(first: 10, query: $query) { nodes { " + FILE_FIELDS + " } } }";
const READ_FILE = "query GptExportFileReady($id: ID!) { node(id: $id) { ... on MediaImage { " + FILE_FIELDS + " } } }";

async function findFile(filename: string): Promise<FileNode | null> {
  const { response, result } = await callShopifyAdminGraphQL<FileQuery>(FIND_FILE, { query: 'filename:"' + filename + '"' });
  if (!response.ok || result.errors?.length || !Array.isArray(result.data?.files?.nodes)) throw new Error("Shopify 檔案查詢失敗");
  const nodes = result.data.files.nodes;
  if (nodes.length > 1) throw new Error("Shopify 有多筆同名檔案，請人工確認");
  return nodes[0] ?? null;
}

export function readyGptCdnUrl(node: FileNode | null, filename: string): string | null {
  const url = node?.image?.url;
  if (node?.fileStatus !== "READY" || !url || !isGptCdnUrl(url)) return null;
  const basename = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
  return basename === filename ? url : null;
}

async function waitForReady(id: string, filename: string): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const { response, result } = await callShopifyAdminGraphQL<FileQuery>(READ_FILE, { id });
    if (response.ok && !result.errors?.length) {
      const node = result.data?.node ?? null;
      if (node?.fileStatus === "FAILED") throw new Error("Shopify 圖片處理失敗，請確認檔案庫");
      const url = readyGptCdnUrl(node, filename);
      if (url) return url;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw new Error("Shopify 圖片尚未就緒，請稍後重新匯出");
}

type ResolveDeps = {
  download?: typeof fetchServerImage;
  lookup?: typeof findFile;
  upload?: typeof uploadProcessedImageToShopifyFiles;
  ready?: typeof waitForReady;
};

/** Test seam: no network in verifier; production always uses the existing safe downloader and uploader. */
export async function resolveGptCdnImage(source: string, deps: ResolveDeps = {}): Promise<string> {
  if (isGptCdnUrl(source)) return source;
  const download = deps.download ?? fetchServerImage;
  const lookup = deps.lookup ?? findFile;
  const upload = deps.upload ?? uploadProcessedImageToShopifyFiles;
  const ready = deps.ready ?? waitForReady;
  const image = await download(source, { maxBytes: 20 * 1024 * 1024 });
  if (!image.ok) throw new Error("來源圖片讀取失敗：" + image.message);
  const filename = gptCdnFilename(image.bytes, image.contentType);
  const existing = await lookup(filename);
  if (existing) return readyGptCdnUrl(existing, filename) ?? ready(existing.id, filename);
  // No blind retry: a network failure may still have created the file.
  // RAISE_ERROR prevents concurrent requests from creating duplicate copies.
  const result = await upload({ filename, mimeType: image.contentType, bytes: image.bytes,
    fileSize: image.bytes.byteLength, duplicateResolutionMode: "RAISE_ERROR" });
  if (result.ok || result.fileGid) return ready(result.fileGid!, filename);
  const recovered = await lookup(filename);
  if (recovered) return readyGptCdnUrl(recovered, filename) ?? ready(recovered.id, filename);
  throw new Error("Shopify 圖片上傳失敗，請稍後重新匯出");
}

/** Preview must not create real files in production or bypass mock mode. */
export function assertGptCdnWriteAllowed(): void {
  assertShopifyEnvironment();
  if (process.env.SHOPIFY_PUBLISH_MOCK !== "false" ||
      (process.env.VERCEL_ENV === "preview" && readNestoryEnvironment().shopIsProd)) {
    throw new Error("目前是模擬或非正式商店寫入環境，已停止 Shopify 圖片上傳");
  }
}
