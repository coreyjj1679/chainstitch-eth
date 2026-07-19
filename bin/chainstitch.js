#!/usr/bin/env node
/**
 * Thin launcher so `npx chainstitch` / `npm link` work without a separate build.
 * Resolves tsx from the package and runs src/cli/main.ts.
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const entry = path.join(root, "src", "cli", "main.ts");
const tsxCli = require.resolve("tsx/cli", { paths: [root] });

const result = spawnSync(
  process.execPath,
  [tsxCli, entry, ...process.argv.slice(2)],
  { stdio: "inherit", cwd: root, env: process.env },
);
process.exit(result.status ?? 1);
