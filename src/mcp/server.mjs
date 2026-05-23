#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import {
	buildProjectIndex,
	getCurrentDiff,
	runCleanVibeDiffAudit,
	runCleanVibeIndexSummary,
	runCleanVibeNextAudit,
	runCleanVibeProjectAudit,
	runCleanVibeReactAudit,
	scanDebtRisks,
	scanNextRisks,
	scanProjectRisks,
	scanReactRisks,
} from "../analyzer/index.mjs";

const tools = [
	{
		name: "build_project_index",
		description:
			"Scan a TypeScript/JavaScript workspace and cache a lightweight architecture index outside the repo.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "get_current_diff",
		description: "Read the current git diff for the workspace.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
				staged: {
					type: "boolean",
					description: "Read staged changes instead of the working tree.",
				},
			},
		},
	},
	{
		name: "scan_debt_risks",
		description:
			"Compare the current diff against the architecture index and return concise technical debt findings.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
				diff: {
					type: "string",
					description:
						"Optional diff text. If omitted, the current working tree diff is used.",
				},
			},
		},
	},
	{
		name: "scan_project_risks",
		description:
			"Audit the whole TypeScript/JavaScript project index for technical debt risks, not only the current diff.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "scan_react_risks",
		description:
			"Audit React components for component complexity, hook drift, direct data fetching, render performance, and accessibility debt.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "scan_next_risks",
		description:
			"Audit Next.js app/pages files for client/server boundary, fetch cache, and route handler debt.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "run_cleanvibe_project_audit",
		description:
			"Run a whole-project CleanVibe audit and return a concise Markdown report suitable for direct Cursor chat output.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "run_cleanvibe_diff_audit",
		description:
			"Run a CleanVibe audit for the current git diff and untracked source files, returning Markdown.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
				staged: {
					type: "boolean",
					description: "Read staged changes instead of the working tree.",
				},
			},
		},
	},
	{
		name: "run_cleanvibe_index_summary",
		description:
			"Refresh the CleanVibe project index and return a concise Markdown summary.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "run_cleanvibe_react_audit",
		description: "Run the CleanVibe React detector pack and return Markdown.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
	{
		name: "run_cleanvibe_next_audit",
		description: "Run the CleanVibe Next.js detector pack and return Markdown.",
		inputSchema: {
			type: "object",
			properties: {
				cwd: {
					type: "string",
					description:
						"Workspace directory. Defaults to the current process cwd.",
				},
			},
		},
	},
];

const debugLogPath = process.env.CLEANVIBE_MCP_DEBUG_LOG;
let buffer = Buffer.alloc(0);
let inputChain = Promise.resolve();
let outputMode = "framed";

debug("server_start", { cwd: process.cwd(), node: process.version });

if (process.stdout.isTTY === false && process.stdout._handle?.setBlocking) {
	process.stdout._handle.setBlocking(true);
}

process.stdin.on("data", (chunk) => {
	debug("stdin_data", {
		bytes: chunk.length,
		prefix: chunk.toString("utf8", 0, Math.min(chunk.length, 200)).replace(/\r/g, "\\r").replace(/\n/g, "\\n"),
	});
	buffer = Buffer.concat([buffer, chunk]);
	inputChain = inputChain.then(() => drainMessages()).catch((error) => {
		debug("drain_error", { message: error.message, stack: error.stack });
	});
});

async function drainMessages() {
	while (buffer.length > 0) {
		const headerDelimiter = findHeaderDelimiter(buffer);
		if (!headerDelimiter) {
			const handled = await handleLineDelimitedFallback();
			if (!handled) return;
			continue;
		}

		const header = buffer.slice(0, headerDelimiter.index).toString("utf8");
		const lengthMatch = header.match(/Content-Length:\s*(\d+)/i);
		if (!lengthMatch) {
			buffer = buffer.slice(headerDelimiter.index + headerDelimiter.length);
			continue;
		}

		const length = Number(lengthMatch[1]);
		const bodyStart = headerDelimiter.index + headerDelimiter.length;
		const bodyEnd = bodyStart + length;
		if (buffer.length < bodyEnd) return;

		const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
		buffer = buffer.slice(bodyEnd);
		outputMode = "framed";
		try {
			await handleMessage(JSON.parse(body));
		} catch (error) {
			debug("json_parse_error", { message: error.message, body: body.slice(0, 500) });
			throw error;
		}
	}
}

function findHeaderDelimiter(data) {
	const crlfIndex = data.indexOf("\r\n\r\n");
	const lfIndex = data.indexOf("\n\n");

	if (crlfIndex === -1 && lfIndex === -1) return null;
	if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
		return { index: crlfIndex, length: 4 };
	}
	return { index: lfIndex, length: 2 };
}

async function handleLineDelimitedFallback() {
	const newline = buffer.indexOf("\n");
	if (newline === -1) return false;
	const line = buffer.slice(0, newline).toString("utf8").trim();
	buffer = buffer.slice(newline + 1);
	if (/^Content-Length:/i.test(line)) {
		buffer = Buffer.concat([Buffer.from(`${line}\n`, "utf8"), buffer]);
		return false;
	}
	if (line) {
		outputMode = "line";
		await handleMessage(JSON.parse(line));
	}
	return true;
}

async function handleMessage(message) {
	debug("message", { id: message?.id, method: message?.method });
	if (!message || typeof message !== "object") return;
	if (!message.method) return;

	try {
		if (message.method === "initialize") {
			return sendResult(message.id, {
				protocolVersion: "2024-11-05",
				capabilities: {
					tools: { listChanged: false },
				},
				serverInfo: { name: "cleanvibe", version: "0.1.0" },
			});
		}

		if (message.method === "notifications/initialized") return;
		if (message.method === "ping") return sendResult(message.id, {});

		if (message.method === "tools/list") {
			return sendResult(message.id, { tools });
		}

		if (message.method === "tools/call") {
			const result = await callTool(
				message.params?.name,
				message.params?.arguments || {},
			);
			return sendResult(message.id, {
				content: [
					{
						type: "text",
						text:
							typeof result === "string"
								? result
								: JSON.stringify(result, null, 2),
					},
				],
				isError: false,
			});
		}

		if (message.id === undefined || message.id === null) return;
		sendError(message.id, -32601, `Unknown method: ${message.method}`);
	} catch (error) {
		sendError(message.id, -32000, error.stack || error.message);
	}
}

async function callTool(name, args) {
	if (name === "build_project_index") {
		return buildProjectIndex({ cwd: args.cwd });
	}

	if (name === "get_current_diff") {
		return getCurrentDiff({ cwd: args.cwd, staged: Boolean(args.staged) });
	}

	if (name === "run_cleanvibe_project_audit") {
		return runCleanVibeProjectAudit({ cwd: args.cwd });
	}

	if (name === "run_cleanvibe_diff_audit") {
		return runCleanVibeDiffAudit({
			cwd: args.cwd,
			staged: Boolean(args.staged),
		});
	}

	if (name === "run_cleanvibe_index_summary") {
		return runCleanVibeIndexSummary({ cwd: args.cwd });
	}

	if (name === "run_cleanvibe_react_audit") {
		return runCleanVibeReactAudit({ cwd: args.cwd });
	}

	if (name === "run_cleanvibe_next_audit") {
		return runCleanVibeNextAudit({ cwd: args.cwd });
	}

	if (name === "scan_debt_risks") {
		const cwd = args.cwd || process.cwd();
		const diff = args.diff || (await getCurrentDiff({ cwd })).text;
		const index = await buildProjectIndex({ cwd });
		return scanDebtRisks({ cwd, diff, index });
	}

	if (name === "scan_project_risks") {
		const cwd = args.cwd || process.cwd();
		const index = await buildProjectIndex({ cwd });
		return scanProjectRisks({ cwd, index });
	}

	if (name === "scan_react_risks") {
		const cwd = args.cwd || process.cwd();
		const index = await buildProjectIndex({ cwd });
		return scanReactRisks({ cwd, index });
	}

	if (name === "scan_next_risks") {
		const cwd = args.cwd || process.cwd();
		const index = await buildProjectIndex({ cwd });
		return scanNextRisks({ cwd, index });
	}

	throw new Error(`Unknown tool: ${name}`);
}

function sendResult(id, result) {
	if (id === undefined || id === null) return;
	send({ jsonrpc: "2.0", id, result });
}

function sendError(id, code, message) {
	if (id === undefined || id === null) return;
	send({ jsonrpc: "2.0", id, error: { code, message } });
}

function send(payload) {
	const body = JSON.stringify(payload);
	debug("send", { id: payload.id, hasResult: Boolean(payload.result), hasError: Boolean(payload.error), bytes: Buffer.byteLength(body, "utf8") });
	if (outputMode === "line") {
		process.stdout.write(`${body}\n`);
		return;
	}
	process.stdout.write(
		`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`,
	);
}

function debug(event, data = {}) {
	if (!debugLogPath) return;
	try {
		appendFileSync(debugLogPath, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
	} catch {
		// Debug logging must never interfere with the MCP transport.
	}
}
