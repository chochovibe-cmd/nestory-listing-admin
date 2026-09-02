import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

const root = process.cwd();

function loadTsModule(relativePath, cache = new Map()) {
  const fullPath = path.join(root, relativePath);
  if (cache.has(fullPath)) return cache.get(fullPath);

  const source = fs.readFileSync(fullPath, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    },
    fileName: fullPath
  }).outputText;

  const module = { exports: {} };
  cache.set(fullPath, module.exports);
  const localRequire = (specifier) => {
    if (specifier === "@/lib/sourceFetch/ssrf") {
      return loadTsModule("src/lib/sourceFetch/ssrf.ts", cache);
    }
    if (specifier === "node:dns/promises") {
      return { lookup: async () => [{ address: "8.8.8.8", family: 4 }] };
    }
    throw new Error(`Unexpected verifier import: ${specifier}`);
  };

  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require: localRequire,
    Buffer,
    URL,
    Headers,
    Response,
    AbortController,
    Uint8Array,
    setTimeout,
    clearTimeout
  });
  cache.set(fullPath, module.exports);
  return module.exports;
}

const { fetchServerImage, detectServerImageMagic, SERVER_IMAGE_MAX_REDIRECTS } = loadTsModule(
  "src/lib/images/fetchServerImage.ts"
);

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

assert.equal(detectServerImageMagic(jpeg), "jpeg");
assert.equal(detectServerImageMagic(png), "png");
assert.equal(detectServerImageMagic(Buffer.from("not-an-image")), null);
assert.equal(SERVER_IMAGE_MAX_REDIRECTS, 4);

const publicDns = async () => [{ address: "8.8.8.8", family: 4 }];

{
  const requests = [];
  const result = await fetchServerImage("https://images.example/item.jpg", {
    resolveHost: publicDns,
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    }
  });
  assert.equal(result.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.redirect, "manual");
}

{
  const requests = [];
  const result = await fetchServerImage("https://images.example/redirect", {
    resolveHost: publicDns,
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data" }
      });
    }
  });
  assert.deepEqual(requests, ["https://images.example/redirect"]);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "blocked_url");
}

{
  let fetchCalled = false;
  const result = await fetchServerImage("https://images.example/private-dns", {
    resolveHost: async () => [{ address: "10.0.0.7", family: 4 }],
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response(jpeg, { headers: { "content-type": "image/jpeg" } });
    }
  });
  assert.equal(fetchCalled, false);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "blocked_ip");
}

for (const [name, response, expectedCode] of [
  ["missing content type", new Response(jpeg), "invalid_content_type"],
  ["mismatched content type", new Response(png, { headers: { "content-type": "image/jpeg" } }), "content_type_mismatch"],
  ["non-image bytes", new Response(Buffer.from("plain response"), { headers: { "content-type": "image/png" } }), "invalid_image_magic"]
]) {
  const result = await fetchServerImage(`https://images.example/${name}`, {
    resolveHost: publicDns,
    fetchImpl: async () => response
  });
  assert.equal(result.ok, false, name);
  if (!result.ok) assert.equal(result.code, expectedCode, name);
}

for (const relativePath of [
  "src/lib/import/fetchRemoteImages.ts",
  "src/lib/images/runSharpBatch.ts",
  "src/lib/images/runFinalize.ts",
  "src/lib/images/detailCompose/runComposeDetail.ts",
  "src/lib/providers/openai-image-provider.ts"
]) {
  const source = fs.readFileSync(path.join(root, relativePath), "utf8");
  assert.match(source, /fetchServerImage/, `${relativePath} must use the guarded image downloader`);
  assert.doesNotMatch(source, /redirect:\s*["']follow["']/, `${relativePath} must not bypass redirect validation`);
}

console.log("Secure server-image fetch checks passed");
