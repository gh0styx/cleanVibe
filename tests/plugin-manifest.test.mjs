import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const manifest = JSON.parse(readFileSync(".cursor-plugin/plugin.json", "utf8"));

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
