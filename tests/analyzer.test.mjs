import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  buildProjectIndex,
  formatDebtReport,
  getCurrentDiff,
  runCleanVibeNextAudit,
  runCleanVibeReactAudit,
  runCleanVibeIndexSummary,
  runCleanVibeProjectAudit,
  scanNextRisks,
  scanReactRisks,
  scanDebtRisks,
  scanProjectRisks,
  getWorkspaceCachePath,
} from "../src/analyzer/index.mjs";

function makeFixture() {
  const cwd = mkdtempSync(join(tmpdir(), "vibe-audit-"));
  mkdirSync(join(cwd, "src", "shared", "utils"), { recursive: true });
  mkdirSync(join(cwd, "src", "features", "billing"), { recursive: true });
  mkdirSync(join(cwd, "src", "features", "auth"), { recursive: true });
  mkdirSync(join(cwd, "src", "components"), { recursive: true });
  mkdirSync(join(cwd, "tests"), { recursive: true });

  writeFileSync(
    join(cwd, "src", "shared", "utils", "money.ts"),
    [
      "export function formatCurrency(cents: number) {",
      "  return `$${(cents / 100).toFixed(2)}`;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(cwd, "src", "features", "auth", "session.ts"),
    [
      "export function getSessionUser() {",
      "  return { id: 'u_123' };",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(cwd, "src", "features", "billing", "invoice.ts"),
    [
      "import { formatCurrency } from '../../shared/utils/money';",
      "",
      "export function renderInvoice(cents: number) {",
      "  return formatCurrency(cents);",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(cwd, "tests", "invoice.test.ts"),
    "import '../src/features/billing/invoice';\n",
  );

  execFileSync("git", ["init"], { cwd, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "base"],
    { cwd, stdio: "ignore" },
  );

  return cwd;
}

test("buildProjectIndex scans TS/JS files, exports, imports, shared utilities, and caches outside the workspace", async () => {
  const cwd = makeFixture();

  const index = await buildProjectIndex({ cwd });

  assert.equal(index.cwd, cwd);
  assert.ok(index.files.some((file) => file.path === "src/shared/utils/money.ts"));
  assert.ok(index.files.some((file) => file.path === "src/features/billing/invoice.ts"));
  assert.ok(index.sharedUtilities.some((utility) => utility.name === "formatCurrency"));
  assert.ok(index.exports.some((entry) => entry.name === "formatCurrency"));
  assert.ok(index.imports.some((entry) => entry.source.includes("shared/utils/money")));
  assert.ok(index.metrics.totalFiles >= 4);
  assert.match(getWorkspaceCachePath(cwd), /cleanvibe/);
  assert.ok(!getWorkspaceCachePath(cwd).startsWith(cwd));
});

test("getCurrentDiff returns the current working tree diff", async () => {
  const cwd = makeFixture();
  writeFileSync(
    join(cwd, "src", "features", "billing", "invoice.ts"),
    [
      "import { formatCurrency } from '../../shared/utils/money';",
      "",
      "export function renderInvoice(cents: number) {",
      "  return formatCurrency(cents);",
      "}",
      "",
      "export function renderInvoiceTitle() {",
      "  return 'Invoice';",
      "}",
      "",
    ].join("\n"),
  );

  const diff = await getCurrentDiff({ cwd });

  assert.match(diff.text, /renderInvoiceTitle/);
  assert.deepEqual(diff.files, ["src/features/billing/invoice.ts"]);
});

test("getCurrentDiff includes untracked source files by default", async () => {
  const cwd = makeFixture();
  writeFileSync(
    join(cwd, "src", "features", "billing", "newPlanner.ts"),
    [
      "export function planInvoice(input: any) {",
      "  // TODO: quick planner spike",
      "  if (!input) return null;",
      "  return input;",
      "}",
      "",
    ].join("\n"),
  );

  const diff = await getCurrentDiff({ cwd });

  assert.ok(diff.files.includes("src/features/billing/newPlanner.ts"));
  assert.match(diff.text, /new file mode 100644/);
  assert.match(diff.text, /quick planner spike/);
  assert.deepEqual(diff.untrackedFiles, ["src/features/billing/newPlanner.ts"]);
});

test("scanDebtRisks reports duplicate logic with a concrete reuse target", async () => {
  const cwd = makeFixture();
  const diff = [
    "diff --git a/src/features/billing/moneyCopy.ts b/src/features/billing/moneyCopy.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/features/billing/moneyCopy.ts",
    "@@ -0,0 +1,4 @@",
    "+export function formatCurrency(cents: number) {",
    "+  return `$${(cents / 100).toFixed(2)}`;",
    "+}",
    "+",
  ].join("\n");
  const index = await buildProjectIndex({ cwd });

  const result = await scanDebtRisks({ cwd, diff, index });

  assert.ok(result.findings.some((finding) => finding.category === "duplicate"));
  const duplicate = result.findings.find((finding) => finding.category === "duplicate");
  assert.equal(duplicate.reuseTarget.path, "src/shared/utils/money.ts");
  assert.equal(duplicate.reuseTarget.symbol, "formatCurrency");
});

test("scanDebtRisks reports architecture boundary drift for feature-to-feature imports", async () => {
  const cwd = makeFixture();
  const index = await buildProjectIndex({ cwd });
  const diff = [
    "diff --git a/src/features/billing/invoice.ts b/src/features/billing/invoice.ts",
    "--- a/src/features/billing/invoice.ts",
    "+++ b/src/features/billing/invoice.ts",
    "@@ -1,3 +1,4 @@",
    "+import { getSessionUser } from '../auth/session';",
    " import { formatCurrency } from '../../shared/utils/money';",
  ].join("\n");

  const result = await scanDebtRisks({ cwd, diff, index });

  assert.ok(result.findings.some((finding) => finding.category === "architecture-boundary"));
});

test("scanDebtRisks reports complexity growth, missing tests, and suspicious shortcuts", async () => {
  const cwd = makeFixture();
  const index = await buildProjectIndex({ cwd });
  const diff = [
    "diff --git a/src/features/billing/reconcile.ts b/src/features/billing/reconcile.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/features/billing/reconcile.ts",
    "@@ -0,0 +1,18 @@",
    "+export function reconcile(input: any) {",
    "+  // TODO: quick fix until real ledger lands",
    "+  if (!input) return null;",
    "+  if (input.pending) return 'pending';",
    "+  for (const item of input.items) {",
    "+    if (item.failed) {",
    "+      try {",
    "+        return item.fallback;",
    "+      } catch (error) {",
    "+        return null;",
    "+      }",
    "+    }",
    "+  }",
    "+  return 'ok';",
    "+}",
  ].join("\n");

  const result = await scanDebtRisks({ cwd, diff, index });
  const categories = result.findings.map((finding) => finding.category);

  assert.ok(categories.includes("complexity"));
  assert.ok(categories.includes("test-gap"));
  assert.ok(categories.includes("shortcut"));
});

test("scanDebtRisks returns at most seven teamlead-ready findings with stable schema", async () => {
  const cwd = makeFixture();
  const index = await buildProjectIndex({ cwd });
  const diff = [
    "diff --git a/src/features/billing/reconcile.ts b/src/features/billing/reconcile.ts",
    "new file mode 100644",
    "--- /dev/null",
    "+++ b/src/features/billing/reconcile.ts",
    "@@ -0,0 +1,12 @@",
    "+import { getSessionUser } from '../auth/session';",
    "+export function formatCurrency(cents: number) {",
    "+  // FIXME temporary any escape hatch",
    "+  const value: any = cents;",
    "+  if (value > 0) return `$${(value / 100).toFixed(2)}`;",
    "+  if (value === 0) return '$0.00';",
    "+  for (const item of []) console.log(item);",
    "+  return 'bad';",
    "+}",
  ].join("\n");

  const result = await scanDebtRisks({ cwd, diff, index });

  assert.equal(result.policy.aiContext, "diff-only-plus-minimal-snippets");
  assert.ok(result.findings.length <= 7);
  for (const finding of result.findings) {
    assert.match(finding.id, /^debt-/);
    assert.ok(["high", "medium", "low"].includes(finding.severity));
    assert.equal(typeof finding.category, "string");
    assert.equal(typeof finding.file, "string");
    assert.equal(typeof finding.message, "string");
    assert.equal(typeof finding.whyItMatters, "string");
    assert.equal(typeof finding.suggestedNextStep, "string");
  }
});

test("formatDebtReport returns a concise Markdown report instead of raw JSON", async () => {
  const result = {
    summary: {
      status: "debt-risk",
      totalFindings: 1,
      changedFiles: ["src/features/billing/moneyCopy.ts"],
      untrackedFiles: ["src/features/billing/moneyCopy.ts"],
    },
    policy: {
      aiContext: "diff-only-plus-minimal-snippets",
      maxFindings: 7,
      autoFix: false,
    },
    findings: [
      {
        id: "debt-001",
        severity: "high",
        category: "duplicate",
        file: "src/features/billing/moneyCopy.ts",
        message: "New code appears to reimplement formatCurrency.",
        whyItMatters: "Duplicated helpers drift over time.",
        suggestedNextStep: "Reuse the shared helper.",
        reuseTarget: {
          path: "src/shared/utils/money.ts",
          symbol: "formatCurrency",
        },
      },
    ],
  };

  const report = formatDebtReport(result);

  assert.match(report, /^## Vibe Audit/);
  assert.match(report, /Status: Debt risk/);
  assert.match(report, /Untracked included: 1/);
  assert.match(report, /Reuse target: `src\/shared\/utils\/money.ts#formatCurrency`/);
  assert.doesNotMatch(report, /^\{/);
});

test("scanProjectRisks audits the whole project, not only the current diff", async () => {
  const cwd = makeFixture();
  writeFileSync(
    join(cwd, "src", "features", "billing", "legacyPlanner.ts"),
    [
      "import { getSessionUser } from '../auth/session';",
      "",
      "export function formatCurrency(cents: number) {",
      "  // TODO: temporary duplicate planner helper",
      "  const value: any = cents;",
      "  if (value > 0) return `$${(value / 100).toFixed(2)}`;",
      "  if (value === 0) return '$0.00';",
      "  for (const item of []) console.log(item);",
      "  return 'bad';",
      "}",
      "",
    ].join("\n"),
  );
  execFileSync("git", ["add", "."], { cwd, stdio: "ignore" });
  execFileSync(
    "git",
    ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "planner debt"],
    { cwd, stdio: "ignore" },
  );

  const index = await buildProjectIndex({ cwd });
  const result = await scanProjectRisks({ cwd, index });
  const categories = result.findings.map((finding) => finding.category);

  assert.equal(result.summary.scope, "project");
  assert.ok(categories.includes("duplicate"));
  assert.ok(categories.includes("architecture-boundary"));
  assert.ok(categories.includes("complexity"));
  assert.ok(categories.includes("shortcut"));
  assert.ok(result.findings.length <= 7);
});

test("runCleanVibeProjectAudit returns branded Markdown for a whole-project audit", async () => {
  const cwd = makeFixture();
  writeFileSync(
    join(cwd, "src", "features", "billing", "legacyPlanner.ts"),
    [
      "import { getSessionUser } from '../auth/session';",
      "export function formatCurrency(cents: number) {",
      "  // FIXME temporary duplicate planner helper",
      "  if (cents > 0) return `$${(cents / 100).toFixed(2)}`;",
      "  return '$0.00';",
      "}",
      "",
    ].join("\n"),
  );

  const report = await runCleanVibeProjectAudit({ cwd });

  assert.match(report, /^## CleanVibe Project Audit/);
  assert.match(report, /Scope: Whole project/);
  assert.match(report, /architecture-boundary|duplicate|shortcut/);
  assert.doesNotMatch(report, /^\{/);
});

test("runCleanVibeIndexSummary returns project index metrics as Markdown", async () => {
  const cwd = makeFixture();

  const report = await runCleanVibeIndexSummary({ cwd });

  assert.match(report, /^## CleanVibe Index/);
  assert.match(report, /Files indexed:/);
  assert.match(report, /Shared utilities:/);
  assert.doesNotMatch(report, /^\{/);
});

test("scanReactRisks finds component complexity, hook drift, fetch-in-component, and accessibility debt", async () => {
  const cwd = makeFixture();
  mkdirSync(join(cwd, "src", "features", "planner"), { recursive: true });
  writeFileSync(
    join(cwd, "src", "features", "planner", "Planner.tsx"),
    [
      "import React, { useEffect, useMemo, useState } from 'react';",
      "",
      "export function Planner() {",
      "  const [items, setItems] = useState([]);",
      "  const [filter, setFilter] = useState('all');",
      "  const [selected, setSelected] = useState(null);",
      "  const [busy, setBusy] = useState(false);",
      "  useEffect(() => {",
      "    fetch('/api/plans').then((r) => r.json()).then(setItems);",
      "  }, []);",
      "  const visible = items.filter((item) => item.status === filter).sort();",
      "  if (busy) return <div>Loading</div>;",
      "  if (!items.length) return <div onClick={() => setSelected(null)}>Empty</div>;",
      "  return <section>{visible.map((item) => <button onClick={() => setSelected(item)}>{item.name}</button>)}</section>;",
      "}",
      "",
    ].join("\n"),
  );

  const result = await scanReactRisks({ cwd });
  const categories = result.findings.map((finding) => finding.category);

  assert.equal(result.summary.pack, "react");
  assert.ok(categories.includes("react-component-complexity"));
  assert.ok(categories.includes("react-hook-drift"));
  assert.ok(categories.includes("react-data-fetching"));
  assert.ok(categories.includes("react-accessibility"));
});

test("scanNextRisks finds route handler, client/server boundary, and uncached fetch issues", async () => {
  const cwd = makeFixture();
  mkdirSync(join(cwd, "app", "dashboard"), { recursive: true });
  mkdirSync(join(cwd, "app", "api", "plans"), { recursive: true });
  writeFileSync(
    join(cwd, "app", "dashboard", "page.tsx"),
    [
      "'use client';",
      "import fs from 'node:fs';",
      "export default async function DashboardPage() {",
      "  const data = await fetch('https://example.com/api/plans');",
      "  return <pre>{JSON.stringify(data)}</pre>;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(cwd, "app", "api", "plans", "route.ts"),
    [
      "export async function GET(req: Request) {",
      "  return Response.json({ ok: true });",
      "}",
      "",
    ].join("\n"),
  );

  const result = await scanNextRisks({ cwd });
  const categories = result.findings.map((finding) => finding.category);

  assert.equal(result.summary.pack, "next");
  assert.ok(categories.includes("next-client-server-boundary"));
  assert.ok(categories.includes("next-fetch-cache"));
  assert.ok(categories.includes("next-route-handler"));
});

test("runCleanVibeReactAudit and runCleanVibeNextAudit return branded Markdown", async () => {
  const cwd = makeFixture();
  mkdirSync(join(cwd, "src", "components"), { recursive: true });
  writeFileSync(
    join(cwd, "src", "components", "PlanCard.tsx"),
    [
      "import { useEffect, useState } from 'react';",
      "export function PlanCard() {",
      "  const [plan, setPlan] = useState(null);",
      "  useEffect(() => { fetch('/api/plans').then((r) => r.json()).then(setPlan); }, []);",
      "  return <div onClick={() => setPlan(null)}>{plan?.name}</div>;",
      "}",
      "",
    ].join("\n"),
  );
  mkdirSync(join(cwd, "app", "api", "plans"), { recursive: true });
  writeFileSync(
    join(cwd, "app", "api", "plans", "route.ts"),
    "export async function POST(req: Request) { return Response.json({ ok: true }); }\n",
  );

  const reactReport = await runCleanVibeReactAudit({ cwd });
  const nextReport = await runCleanVibeNextAudit({ cwd });

  assert.match(reactReport, /^## CleanVibe React Audit/);
  assert.match(nextReport, /^## CleanVibe Next Audit/);
  assert.doesNotMatch(reactReport, /^\{/);
  assert.doesNotMatch(nextReport, /^\{/);
});
