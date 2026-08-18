const SENSITIVE_ENV_NAME = /(API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|WEBHOOK)/i;

function isSensitiveEnvName(name) {
  if (!name) return false;
  if (/^NEXT_PUBLIC_/i.test(name)) return false;
  return SENSITIVE_ENV_NAME.test(name);
}

export function findClientSecretEnvAccesses(source) {
  const findings = [];

  const dotAccess = /\bprocess\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)\b/g;
  let match;
  while ((match = dotAccess.exec(source))) {
    if (!isSensitiveEnvName(match[1])) continue;
    findings.push({
      kind: "process.env dot access",
      envName: match[1],
      snippet: match[0]
    });
  }

  const bracketAccess = /\bprocess\s*\.\s*env\s*\[\s*["']([A-Z][A-Z0-9_]*)["']\s*\]/g;
  while ((match = bracketAccess.exec(source))) {
    if (!isSensitiveEnvName(match[1])) continue;
    findings.push({
      kind: "process.env bracket access",
      envName: match[1],
      snippet: match[0]
    });
  }

  const destructuring = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*process\s*\.\s*env\b/g;
  while ((match = destructuring.exec(source))) {
    const names = match[1]
      .split(",")
      .map((part) => part.trim().split(/\s*:\s*/)[0]?.trim())
      .filter(Boolean);
    for (const name of names) {
      if (!isSensitiveEnvName(name)) continue;
      findings.push({
        kind: "process.env destructuring",
        envName: name,
        snippet: match[0]
      });
    }
  }

  return findings;
}
