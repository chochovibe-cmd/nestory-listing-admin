/**
 * Browser-storage secret policy shared by verify-no-secrets + its regression test.
 *
 * localStorage/sessionStorage are allowed for non-sensitive UI state. We only flag
 * writes whose key/value expression looks like credentials, tokens, private keys,
 * webhooks, or other authentication material.
 */

const SENSITIVE_STORAGE_NAME_PATTERN =
  /(?:api[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|bearer[_-]?token|client[_-]?secret|private[_-]?key|service[_-]?role|secret|password|credential|authorization|webhook(?:[_-]?url)?|(?:shopify|github|openai|anthropic)[_-]?(?:key|token))/i;

const STORAGE_SET_ITEM_PATTERNS = [
  /(?:(?:window|globalThis)\s*\.\s*)?(?:localStorage|sessionStorage)\s*\.\s*setItem\s*\(([\s\S]{0,500}?)\)/gi,
  /\bstorage\s*\.\s*setItem\s*\(([\s\S]{0,500}?)\)/gi
];

const STORAGE_ASSIGNMENT_PATTERN =
  /(?:(?:window|globalThis)\s*\.\s*)?(?:localStorage|sessionStorage)\s*(?:\.\s*([A-Za-z_$][\w$]*)|\[\s*([^\]]{1,160})\s*\])\s*=\s*([^;\n]{0,320})/gi;

function compactSnippet(value) {
  return value.replace(/\s+/g, " ").trim().slice(0, 180);
}

export function findSensitiveBrowserStorageWrites(source) {
  const findings = [];

  for (const pattern of STORAGE_SET_ITEM_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const args = match[1] ?? "";
      if (SENSITIVE_STORAGE_NAME_PATTERN.test(args)) {
        findings.push({
          kind: "setItem",
          snippet: compactSnippet(match[0])
        });
      }
    }
  }

  STORAGE_ASSIGNMENT_PATTERN.lastIndex = 0;
  let assignment;
  while ((assignment = STORAGE_ASSIGNMENT_PATTERN.exec(source)) !== null) {
    const keyOrProperty = `${assignment[1] ?? ""} ${assignment[2] ?? ""}`;
    const value = assignment[3] ?? "";
    if (SENSITIVE_STORAGE_NAME_PATTERN.test(`${keyOrProperty} ${value}`)) {
      findings.push({
        kind: "assignment",
        snippet: compactSnippet(assignment[0])
      });
    }
  }

  return findings;
}
