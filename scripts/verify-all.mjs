import { spawnSync } from "node:child_process";

const scripts = [
  "scripts/verify-static.mjs",
  "scripts/verify-requirements.mjs",
  "scripts/verify-contracts.mjs",
  "scripts/verify-sql-schema.mjs",
  "scripts/verify-mock-flow.mjs",
  "scripts/verify-no-secrets.mjs"
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    shell: false
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("All no-dependency checks passed");
