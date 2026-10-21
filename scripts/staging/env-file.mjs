// STAGING 1.6: minimal .env file reader for the staging scripts (no dotenv dependency).
// Values are returned to the caller only -- nothing here ever prints them.
import fs from "node:fs";

export function parseEnvFile(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    } else {
      // Unquoted value: drop a trailing " # comment".
      value = value.replace(/\s+#.*$/, "");
    }
    out[match[1]] = value;
  }
  return out;
}

export function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`找不到環境檔：${filePath}`);
  }
  return parseEnvFile(fs.readFileSync(filePath, "utf8"));
}

/** Throw naming the missing variable names only (never values). */
export function requireVars(env, names, fileLabel) {
  const missing = names.filter((name) => !String(env[name] ?? "").trim());
  if (missing.length > 0) {
    throw new Error(`${fileLabel} 缺少設定：${missing.join("、")}`);
  }
}
