/**
 * Module hooks for verify-publish-guard.mjs.
 *
 * - resolve: the existing ts-ext-loader (`@/` + extensionless `.ts`) plus a stub for
 *   `next/headers`, which only exists inside the Next runtime (runPublishBatch ->
 *   notifications -> supabase/server imports it).
 * - load: transpile `.ts` with the project's own `typescript` instead of Node's type
 *   stripping, because some modules import a type without the `type` keyword
 *   (e.g. payload.ts) and stripping cannot elide that, while tsc/transpileModule does.
 */
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { resolve as resolveTs } from "./ts-ext-loader.mjs";

const NEXT_HEADERS_STUB =
  "data:text/javascript,export const cookies = async () => ({ getAll: () => [], set() {} });";

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/headers") {
    return { url: NEXT_HEADERS_STUB, shortCircuit: true };
  }
  return resolveTs(specifier, context, nextResolve);
}

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const source = fs.readFileSync(fileURLToPath(url), "utf8");
    const out = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.Preserve
      },
      fileName: fileURLToPath(url)
    });
    return { format: "module", source: out.outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}
