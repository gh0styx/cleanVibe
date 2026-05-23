import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync(".cursor-plugin/plugin.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const mcpConfig = JSON.parse(readFileSync("mcp.json", "utf8"));
const mcpServerSource = readFileSync("src/mcp/server.mjs", "utf8");

test("Cursor plugin manifest uses marketplace-compatible top-level component pointers", () => {
  assert.equal(manifest.name, "cleanvibe");
  assert.equal(manifest.displayName, "CleanVibe");
  assert.equal(manifest.category, "developer-tools");
  assert.equal(manifest.skills, "./skills/");
  assert.equal(manifest.commands, "./commands/");
  assert.equal(manifest.mcp, "./mcp.json");
  assert.ok(Array.isArray(manifest.keywords));
  assert.ok(!("components" in manifest));
});

test("release URLs point to the public repository", () => {
  assert.equal(manifest.repository, "https://github.com/gh0styx/cleanVibe");
  assert.equal(manifest.homepage, "https://github.com/gh0styx/cleanVibe");
  assert.equal(packageJson.repository.url, "https://github.com/gh0styx/cleanVibe.git");
  assert.equal(packageJson.homepage, "https://github.com/gh0styx/cleanVibe#readme");
});

test("MCP registration uses CleanVibe branding", () => {
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ["cleanvibe"]);
  assert.match(mcpServerSource, /serverInfo: \{ name: "cleanvibe", version: "0\.1\.0" \}/);
});
