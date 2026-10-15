// Keeps server.json (MCP Registry listing) on the same version as package.json.
// Usage:
//   node scripts/sync-server-version.js          write package.json's version into server.json
//   node scripts/sync-server-version.js --check  exit 1 if the versions differ
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

if (process.argv.includes("--check")) {
  const mismatched =
    server.version !== version ||
    server.packages.some((p) => p.version !== version);
  if (mismatched) {
    console.error(
      `server.json version does not match package.json (${version}). Run "npm version <patch|minor|major>".`,
    );
    process.exit(1);
  }
} else {
  server.version = version;
  for (const pkg of server.packages) pkg.version = version;
  writeFileSync("server.json", JSON.stringify(server, null, 2) + "\n");
}
