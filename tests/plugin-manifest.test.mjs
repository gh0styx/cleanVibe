import assert from "node:assert/strict";
import { spawn } from "node:child_process";
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
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), ["mcp"]);
  assert.equal(mcpConfig.mcpServers.mcp.type, "stdio");
  assert.equal(mcpConfig.mcpServers.mcp.command, "node");
  assert.deepEqual(mcpConfig.mcpServers.mcp.args, ["./src/mcp/server.mjs"]);
  assert.match(mcpServerSource, /serverInfo: \{ name: "cleanvibe", version: "0\.1\.0" \}/);
});

test("MCP server accepts LF-delimited Content-Length headers", async () => {
  const output = await runMcpProbe("\n\n");

  assert.match(output, /"serverInfo":\{"name":"cleanvibe","version":"0\.1\.0"\}/);
  assert.match(output, /"name":"run_cleanvibe_react_audit"/);
});

test("MCP server responds with JSON lines when requests use JSON lines", async () => {
  const output = await runMcpLineProbe();

  assert.match(output, /^{"jsonrpc":"2\.0","id":1,"result":/);
  assert.match(output, /"serverInfo":\{"name":"cleanvibe","version":"0\.1\.0"\}/);
  assert.match(output, /"name":"run_cleanvibe_react_audit"/);
});

function runMcpProbe(delimiter) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["./src/mcp/server.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP probe timed out. stdout=${stdout} stderr=${stderr}`));
    }, 2000);

    child.on("exit", () => {
      clearTimeout(timeout);
      if (stderr) reject(new Error(stderr));
      else resolve(stdout);
    });

    child.stdin.write(frame({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, delimiter));
    child.stdin.write(frame({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }, delimiter));
    child.stdin.write(frame({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, delimiter));
    child.stdin.end();
  });
}

function frame(message, delimiter) {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body, "utf8")}${delimiter}${body}`;
}

function runMcpLineProbe() {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["./src/mcp/server.mjs"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`MCP line probe timed out. stdout=${stdout} stderr=${stderr}`));
    }, 2000);

    child.on("exit", () => {
      clearTimeout(timeout);
      if (stderr) reject(new Error(stderr));
      else resolve(stdout);
    });

    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })}\n`);
    child.stdin.end();
  });
}
