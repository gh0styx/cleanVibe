import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  dirname,
  extname,
  join,
  normalize,
  relative,
  resolve,
} from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORE_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
]);
const MAX_FINDINGS = 7;

export function getWorkspaceCachePath(cwd) {
  const key = createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 16);
  const base = process.env.CLEANVIBE_CACHE_DIR || process.env.XDG_CACHE_HOME || tmpdir();
  return join(base, "cleanvibe", key, "project-index.json");
}

export async function buildProjectIndex({ cwd = process.cwd(), writeCache = true } = {}) {
  const root = resolve(cwd);
  const files = [];
  const imports = [];
  const exports = [];
  const sharedUtilities = [];

  for (const absolutePath of await listSourceFiles(root)) {
    const content = await readFile(absolutePath, "utf8");
    const path = toPosix(relative(root, absolutePath));
    const fileImports = parseImports(content, path);
    const fileExports = parseExports(content, path);
    const complexity = estimateComplexity(content);

    imports.push(...fileImports);
    exports.push(...fileExports);
    files.push({
      path,
      imports: fileImports.map((entry) => entry.source),
      exports: fileExports.map((entry) => entry.name),
      lines: content.split(/\r?\n/).length,
      complexity,
    });

    if (isSharedUtilityPath(path)) {
      for (const exported of fileExports) {
        sharedUtilities.push({
          name: exported.name,
          path,
          signature: exported.signature,
        });
      }
    }
  }

  const index = {
    version: 1,
    cwd: root,
    generatedAt: new Date().toISOString(),
    files,
    imports,
    exports,
    sharedUtilities,
    metrics: {
      totalFiles: files.length,
      totalExports: exports.length,
      totalImports: imports.length,
      averageComplexity:
        files.length === 0
          ? 0
          : Number((files.reduce((sum, file) => sum + file.complexity, 0) / files.length).toFixed(2)),
    },
  };

  if (writeCache) {
    const cachePath = getWorkspaceCachePath(root);
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  }

  return index;
}

export async function getCurrentDiff({ cwd = process.cwd(), staged = false } = {}) {
  const args = ["diff", "--no-ext-diff"];
  if (staged) args.push("--staged");
  args.push("--");

  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
    });
    const untrackedFiles = staged ? [] : await listUntrackedSourceFiles(cwd);
    const untrackedDiff = await buildUntrackedDiff(cwd, untrackedFiles);
    const text = [stdout, untrackedDiff].filter(Boolean).join(stdout && untrackedDiff ? "\n" : "");
    return {
      text,
      files: parseDiffFiles(text).map((file) => file.path),
      untrackedFiles,
    };
  } catch (error) {
    return {
      text: "",
      files: [],
      untrackedFiles: [],
      error: `Unable to read git diff: ${error.message}`,
    };
  }
}

export async function scanDebtRisks({
  cwd = process.cwd(),
  diff,
  index,
} = {}) {
  const root = resolve(cwd);
  const projectIndex = index || (await buildProjectIndex({ cwd: root }));
  const diffText = typeof diff === "string" ? diff : diff?.text || "";
  const changedFiles = parseDiffFiles(diffText);
  const untrackedFiles = Array.isArray(diff?.untrackedFiles) ? diff.untrackedFiles : inferUntrackedFiles(diffText);
  const findings = [];

  for (const file of changedFiles) {
    findings.push(...detectDuplicateLogic(file, projectIndex));
    findings.push(...detectArchitectureBoundaryDrift(file));
    findings.push(...detectComplexityGrowth(file));
    findings.push(...detectSuspiciousShortcuts(file));
    findings.push(...detectPerformanceHints(file));
  }

  findings.push(...detectTestGaps(changedFiles));

  const normalized = dedupeFindings(findings)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, MAX_FINDINGS)
    .map((finding, index) => ({
      id: `debt-${String(index + 1).padStart(3, "0")}`,
      ...finding,
    }));

  return {
    summary: {
      status: normalized.some((finding) => finding.severity === "high")
        ? "debt-risk"
        : normalized.length > 0
          ? "watch"
          : "ok",
      totalFindings: normalized.length,
      changedFiles: changedFiles.map((file) => file.path),
      untrackedFiles,
    },
    policy: {
      aiContext: "diff-only-plus-minimal-snippets",
      maxFindings: MAX_FINDINGS,
      autoFix: false,
    },
    findings: normalized,
  };
}

export async function scanProjectRisks({
  cwd = process.cwd(),
  index,
} = {}) {
  const root = resolve(cwd);
  const projectIndex = index || (await buildProjectIndex({ cwd: root }));
  const findings = [
    ...detectProjectDuplicateExports(projectIndex),
    ...detectProjectArchitectureBoundaryDrift(projectIndex),
    ...detectProjectComplexity(projectIndex),
    ...(await detectProjectShortcuts(root, projectIndex)),
  ];

  const normalized = dedupeFindings(findings)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, MAX_FINDINGS)
    .map((finding, index) => ({
      id: `debt-${String(index + 1).padStart(3, "0")}`,
      ...finding,
    }));

  return {
    summary: {
      status: normalized.some((finding) => finding.severity === "high")
        ? "debt-risk"
        : normalized.length > 0
          ? "watch"
          : "ok",
      scope: "project",
      totalFindings: normalized.length,
      totalFiles: projectIndex.metrics.totalFiles,
      generatedAt: projectIndex.generatedAt,
    },
    policy: {
      aiContext: "project-index-plus-minimal-snippets",
      maxFindings: MAX_FINDINGS,
      autoFix: false,
    },
    findings: normalized,
  };
}

export async function scanReactRisks({
  cwd = process.cwd(),
  index,
} = {}) {
  const root = resolve(cwd);
  const projectIndex = index || (await buildProjectIndex({ cwd: root }));
  const reactFiles = projectIndex.files.filter((file) => isReactFile(file.path));
  const findings = [];

  for (const file of reactFiles) {
    const content = await readTextIfInside(root, file.path);
    if (!content) continue;
    findings.push(...detectReactComponentComplexity(file, content));
    findings.push(...detectReactHookDrift(file, content));
    findings.push(...detectReactDataFetching(file, content));
    findings.push(...detectReactRenderPerformance(file, content));
    findings.push(...detectReactAccessibility(file, content));
  }

  return normalizePackResult({
    pack: "react",
    totalFiles: reactFiles.length,
    findings,
    policyContext: "react-index-plus-minimal-snippets",
  });
}

export async function scanNextRisks({
  cwd = process.cwd(),
  index,
} = {}) {
  const root = resolve(cwd);
  const projectIndex = index || (await buildProjectIndex({ cwd: root }));
  const nextFiles = projectIndex.files.filter((file) => isNextFile(file.path));
  const findings = [];

  for (const file of nextFiles) {
    const content = await readTextIfInside(root, file.path);
    if (!content) continue;
    findings.push(...detectNextClientServerBoundary(file, content));
    findings.push(...detectNextFetchCache(file, content));
    findings.push(...detectNextRouteHandler(file, content));
  }

  return normalizePackResult({
    pack: "next",
    totalFiles: nextFiles.length,
    findings,
    policyContext: "next-index-plus-minimal-snippets",
  });
}

export function formatCleanVibeReport(result, { title, scope }) {
  const status = formatStatus(result.summary?.status || "ok");
  const findings = result.findings || [];
  const lines = [
    `## ${title}`,
    `Status: ${status}`,
    `Scope: ${scope}`,
    `Findings: ${findings.length}`,
  ];

  if (typeof result.summary?.totalFiles === "number") {
    lines.push(`Files analyzed: ${result.summary.totalFiles}`);
  }
  if (Array.isArray(result.summary?.changedFiles)) {
    lines.push(`Changed files analyzed: ${result.summary.changedFiles.length}`);
  }
  if (Array.isArray(result.summary?.untrackedFiles) && result.summary.untrackedFiles.length > 0) {
    lines.push(`Untracked included: ${result.summary.untrackedFiles.length}`);
  }

  lines.push("");

  if (findings.length === 0) {
    lines.push("No high-signal technical debt risks found.");
    lines.push("");
    lines.push("_CleanVibe did not modify files._");
    return lines.join("\n");
  }

  findings.forEach((finding, index) => {
    lines.push(`${index + 1}. [${finding.severity}] ${finding.category} - \`${finding.file}\``);
    lines.push(`   What changed: ${finding.message}`);
    lines.push(`   Why it matters: ${finding.whyItMatters}`);
    lines.push(`   Suggested next step: ${finding.suggestedNextStep}`);
    if (finding.reuseTarget) {
      lines.push(`   Reuse target: \`${finding.reuseTarget.path}#${finding.reuseTarget.symbol}\``);
    }
    lines.push("");
  });

  lines.push("_CleanVibe did not modify files._");
  return lines.join("\n");
}

export async function runVibeAudit({ cwd = process.cwd(), staged = false } = {}) {
  const index = await buildProjectIndex({ cwd });
  const diff = await getCurrentDiff({ cwd, staged });
  const scan = await scanDebtRisks({ cwd, diff, index });
  return formatCleanVibeReport(scan, {
    title: "CleanVibe Diff Audit",
    scope: "Current git diff plus untracked source files",
  });
}

export async function runCleanVibeDiffAudit({ cwd = process.cwd(), staged = false } = {}) {
  const index = await buildProjectIndex({ cwd });
  const diff = await getCurrentDiff({ cwd, staged });
  const scan = await scanDebtRisks({ cwd, diff, index });
  return formatCleanVibeReport(scan, {
    title: "CleanVibe Diff Audit",
    scope: "Current git diff plus untracked source files",
  });
}

export async function runCleanVibeProjectAudit({ cwd = process.cwd() } = {}) {
  const index = await buildProjectIndex({ cwd });
  const scan = await scanProjectRisks({ cwd, index });
  return formatCleanVibeReport(scan, {
    title: "CleanVibe Project Audit",
    scope: "Whole project",
  });
}

export async function runCleanVibeIndexSummary({ cwd = process.cwd() } = {}) {
  const index = await buildProjectIndex({ cwd });
  return [
    "## CleanVibe Index",
    `Workspace: \`${index.cwd}\``,
    `Files indexed: ${index.metrics.totalFiles}`,
    `Exports: ${index.metrics.totalExports}`,
    `Imports: ${index.metrics.totalImports}`,
    `Shared utilities: ${index.sharedUtilities.length}`,
    `Average complexity: ${index.metrics.averageComplexity}`,
    "",
    "_Index cache is stored outside the project. No source files were modified._",
  ].join("\n");
}

export async function runCleanVibeReactAudit({ cwd = process.cwd() } = {}) {
  const index = await buildProjectIndex({ cwd });
  const scan = await scanReactRisks({ cwd, index });
  return formatCleanVibeReport(scan, {
    title: "CleanVibe React Audit",
    scope: "React project files",
  });
}

export async function runCleanVibeNextAudit({ cwd = process.cwd() } = {}) {
  const index = await buildProjectIndex({ cwd });
  const scan = await scanNextRisks({ cwd, index });
  return formatCleanVibeReport(scan, {
    title: "CleanVibe Next Audit",
    scope: "Next.js app/pages/API files",
  });
}

async function listSourceFiles(root) {
  const result = [];

  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".cursor") {
        if (IGNORE_DIRS.has(entry.name)) continue;
      }

      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) await walk(absolutePath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (SOURCE_EXTENSIONS.has(extname(entry.name))) result.push(absolutePath);
    }
  }

  try {
    const rootStat = await stat(root);
    if (rootStat.isDirectory()) await walk(root);
  } catch {
    return [];
  }

  return result;
}

async function listUntrackedSourceFiles(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd, maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout
      .split(/\r?\n/)
      .map((path) => path.trim())
      .filter(Boolean)
      .filter((path) => SOURCE_EXTENSIONS.has(extname(path)));
  } catch {
    return [];
  }
}

async function buildUntrackedDiff(cwd, files) {
  const sections = [];
  for (const file of files) {
    const absolutePath = resolve(cwd, file);
    if (!isInside(resolve(cwd), absolutePath)) continue;
    try {
      await access(absolutePath);
      const content = await readFile(absolutePath, "utf8");
      sections.push([
        `diff --git a/${file} b/${file}`,
        "new file mode 100644",
        "--- /dev/null",
        `+++ b/${file}`,
        `@@ -0,0 +1,${content.split(/\r?\n/).length} @@`,
        ...content.split(/\r?\n/).map((line) => `+${line}`),
      ].join("\n"));
    } catch {
      // Ignore files that disappear or cannot be read as text between git and analysis.
    }
  }
  return sections.join("\n");
}

async function readTextIfInside(root, path) {
  const absolutePath = resolve(root, path);
  if (!isInside(root, absolutePath)) return "";
  try {
    return await readFile(absolutePath, "utf8");
  } catch {
    return "";
  }
}

function inferUntrackedFiles(diffText) {
  const files = [];
  let currentPath = null;
  let isNewFile = false;
  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("diff --git ")) {
      if (currentPath && isNewFile) files.push(currentPath);
      currentPath = null;
      isNewFile = false;
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (match) currentPath = match[2];
      continue;
    }
    if (line === "new file mode 100644") isNewFile = true;
  }
  if (currentPath && isNewFile) files.push(currentPath);
  return files;
}

function parseImports(content, path) {
  const imports = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      imports.push({ path, source: match[1] });
    }
  }

  return imports;
}

function parseExports(content, path) {
  const exports = [];
  const namedExportPattern =
    /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  const declarationPattern = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(|\bconst\s+([A-Za-z_$][\w$]*)\s*=/g;

  for (const match of content.matchAll(namedExportPattern)) {
    const name = match[1];
    exports.push({
      path,
      name,
      signature: normalizeSignature(extractFunctionLikeBlock(content, name)),
    });
  }

  if (exports.length === 0 && isSharedUtilityPath(path)) {
    for (const match of content.matchAll(declarationPattern)) {
      const name = match[1] || match[2];
      exports.push({
        path,
        name,
        signature: normalizeSignature(extractFunctionLikeBlock(content, name)),
      });
    }
  }

  return exports;
}

function parseDiffFiles(diffText) {
  const files = [];
  let current = null;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith("+++ b/")) {
      if (current) files.push(current);
      current = {
        path: line.slice("+++ b/".length),
        addedLines: [],
      };
      continue;
    }

    if (!current) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.addedLines.push(line.slice(1));
    }
  }

  if (current) files.push(current);
  return files.filter((file) => file.path && file.path !== "/dev/null");
}

function detectDuplicateLogic(file, index) {
  const addedText = file.addedLines.join("\n");
  const addedFunctions = parseAddedFunctionNames(addedText);
  const findings = [];

  for (const name of addedFunctions) {
    const target = index.sharedUtilities.find(
      (utility) => utility.name === name && utility.path !== file.path,
    );
    if (!target) continue;

    findings.push({
      severity: "high",
      category: "duplicate",
      file: file.path,
      message: `New code appears to reimplement ${name}.`,
      whyItMatters:
        "Duplicated helpers drift over time and make AI-generated changes harder to review consistently.",
      suggestedNextStep: `Import and reuse ${name} from ${target.path} instead of maintaining another implementation.`,
      reuseTarget: {
        path: target.path,
        symbol: target.name,
      },
      evidence: minimalSnippet(file.addedLines, name),
    });
  }

  return findings;
}

function detectArchitectureBoundaryDrift(file) {
  const findings = [];
  const sourceFeature = featureName(file.path);
  if (!sourceFeature) return findings;

  for (const line of file.addedLines) {
    const importSource = extractImportSource(line);
    if (!importSource) continue;

    const targetFeature = targetFeatureName(file.path, importSource);
    if (!targetFeature || targetFeature === sourceFeature) continue;

    findings.push({
      severity: "high",
      category: "architecture-boundary",
      file: file.path,
      message: `Feature ${sourceFeature} now imports directly from feature ${targetFeature}.`,
      whyItMatters:
        "Direct feature-to-feature imports usually bypass shared contracts and create tight coupling between product areas.",
      suggestedNextStep:
        "Move the shared behavior behind a shared module, service boundary, or explicit public feature API before relying on it.",
      evidence: line.trim(),
    });
  }

  return findings;
}

function detectComplexityGrowth(file) {
  const addedText = file.addedLines.join("\n");
  const decisionPoints = estimateComplexity(addedText);
  if (file.addedLines.length < 10 && decisionPoints < 5) return [];

  return [
    {
      severity: decisionPoints >= 6 ? "high" : "medium",
      category: "complexity",
      file: file.path,
      message: `This change adds ${decisionPoints} decision points across ${file.addedLines.length} lines.`,
      whyItMatters:
        "Fast AI edits often hide branching complexity inside one function, which makes future fixes riskier.",
      suggestedNextStep:
        "Split the branch-heavy logic into named helpers and add focused tests around each branch before it grows further.",
      evidence: minimalSnippet(file.addedLines, "if") || minimalSnippet(file.addedLines, "for"),
    },
  ];
}

function detectSuspiciousShortcuts(file) {
  const shortcutLines = file.addedLines.filter((line) =>
    /\b(TODO|FIXME|HACK|temporary|quick fix|workaround|as any|:\s*any\b|console\.log)\b/i.test(line),
  );
  if (shortcutLines.length === 0) return [];

  return [
    {
      severity: "medium",
      category: "shortcut",
      file: file.path,
      message: "This change introduces a shortcut marker or type escape hatch.",
      whyItMatters:
        "Temporary AI-generated shortcuts tend to become permanent unless they are made explicit and cleaned up quickly.",
      suggestedNextStep:
        "Replace the shortcut with the real boundary/type, or track it as intentional debt with an owner and removal condition.",
      evidence: shortcutLines.slice(0, 3).map((line) => line.trim()).join("\n"),
    },
  ];
}

function detectPerformanceHints(file) {
  const suspiciousLines = file.addedLines.filter((line) =>
    /\b(select\s+\*|await\s+.*\bfor\b|for\s*\(.*await|Promise\.all\s*\(\s*\[?\s*\])\b/i.test(line),
  );
  if (suspiciousLines.length === 0) return [];

  return [
    {
      severity: "low",
      category: "performance",
      file: file.path,
      message: "This change contains a pattern that may become a performance issue.",
      whyItMatters:
        "Broad queries and sequential async loops are common places where prototype code stops scaling.",
      suggestedNextStep:
        "Check whether the query can be narrowed or async work can be batched before merging the change.",
      evidence: suspiciousLines.slice(0, 2).map((line) => line.trim()).join("\n"),
    },
  ];
}

function detectProjectDuplicateExports(index) {
  const byName = new Map();
  for (const exported of index.exports) {
    const entries = byName.get(exported.name) || [];
    entries.push(exported);
    byName.set(exported.name, entries);
  }

  const findings = [];
  for (const [name, entries] of byName.entries()) {
    if (entries.length < 2) continue;
    const sharedTarget = entries.find((entry) => isSharedUtilityPath(entry.path));
    const duplicate = entries.find((entry) => entry.path !== sharedTarget?.path) || entries[1];
    findings.push({
      severity: sharedTarget ? "high" : "medium",
      category: "duplicate",
      file: duplicate.path,
      message: `Project contains ${entries.length} exported definitions named ${name}.`,
      whyItMatters:
        "Repeated exported symbols make it easier for AI edits to pick the wrong implementation and increase drift between modules.",
      suggestedNextStep: sharedTarget
        ? `Consolidate callers on ${name} from ${sharedTarget.path}.`
        : `Pick one owner for ${name} and rename or remove the duplicate exports.`,
      reuseTarget: sharedTarget
        ? {
            path: sharedTarget.path,
            symbol: sharedTarget.name,
          }
        : undefined,
      evidence: entries.map((entry) => entry.path).join("\n"),
    });
  }
  return findings;
}

function detectProjectArchitectureBoundaryDrift(index) {
  const findings = [];
  for (const entry of index.imports) {
    const sourceFeature = featureName(entry.path);
    if (!sourceFeature) continue;
    const targetFeature = targetFeatureName(entry.path, entry.source);
    if (!targetFeature || targetFeature === sourceFeature) continue;
    findings.push({
      severity: "high",
      category: "architecture-boundary",
      file: entry.path,
      message: `Feature ${sourceFeature} imports directly from feature ${targetFeature}.`,
      whyItMatters:
        "Feature-to-feature imports create hidden coupling and make project-wide refactors harder to reason about.",
      suggestedNextStep:
        "Move shared behavior to a shared module or expose a deliberate public API for the target feature.",
      evidence: `import ... from '${entry.source}'`,
    });
  }
  return findings;
}

function detectProjectComplexity(index) {
  return index.files
    .filter((file) => file.complexity >= 4 || file.lines >= 220)
    .map((file) => ({
      severity: file.complexity >= 10 || file.lines >= 350 ? "high" : "medium",
      category: "complexity",
      file: file.path,
      message: `File has complexity ${file.complexity} across ${file.lines} lines.`,
      whyItMatters:
        "Project-wide complexity hotspots are where fast AI edits tend to pile new behavior into already fragile modules.",
      suggestedNextStep:
        "Split the largest responsibilities into named helpers/components before adding more behavior here.",
      evidence: `complexity=${file.complexity}, lines=${file.lines}`,
    }));
}

async function detectProjectShortcuts(root, index) {
  const findings = [];
  for (const file of index.files) {
    const absolutePath = resolve(root, file.path);
    if (!isInside(root, absolutePath)) continue;
    let content = "";
    try {
      content = await readFile(absolutePath, "utf8");
    } catch {
      continue;
    }

    const lines = content.split(/\r?\n/);
    const shortcutLines = lines.filter((line) =>
      /\b(TODO|FIXME|HACK|temporary|quick fix|workaround|as any|:\s*any\b|console\.log)\b/i.test(line),
    );
    if (shortcutLines.length === 0) continue;

    findings.push({
      severity: "medium",
      category: "shortcut",
      file: file.path,
      message: `File contains ${shortcutLines.length} shortcut marker${shortcutLines.length === 1 ? "" : "s"}.`,
      whyItMatters:
        "Project-level shortcut markers are often forgotten after the fast coding session that introduced them.",
      suggestedNextStep:
        "Either resolve the shortcut now or turn it into explicit tracked debt with an owner and removal condition.",
      evidence: shortcutLines.slice(0, 3).map((line) => line.trim()).join("\n"),
    });
  }
  return findings;
}

function detectReactComponentComplexity(file, content) {
  if (!looksLikeReactComponent(content)) return [];
  const useStateCount = countMatches(content, /\buseState\s*\(/g);
  const useEffectCount = countMatches(content, /\buseEffect\s*\(/g);
  const branchCount = countMatches(content, /\b(if|switch|case)\b|\?\s*[^:]+:/g);
  if (useStateCount < 3 && useEffectCount < 2 && branchCount < 4 && file.lines < 180) return [];

  return [{
    severity: useStateCount >= 4 || branchCount >= 6 || file.lines >= 260 ? "high" : "medium",
    category: "react-component-complexity",
    file: file.path,
    message: `Component has ${useStateCount} useState calls, ${useEffectCount} useEffect calls, and ${branchCount} branch points.`,
    whyItMatters:
      "Large React components become magnets for AI edits because UI, state, and behavior live in one place.",
    suggestedNextStep:
      "Extract state transitions into a custom hook and move repeated render branches into focused child components.",
    evidence: `useState=${useStateCount}, useEffect=${useEffectCount}, branches=${branchCount}`,
  }];
}

function detectReactHookDrift(file, content) {
  const effectCount = countMatches(content, /\buseEffect\s*\(/g);
  const emptyEffects = countMatches(content, /\buseEffect\s*\([\s\S]*?\],\s*\[\s*\]\s*\)/g);
  const derivedState = /\buseEffect\s*\([\s\S]*?\bset[A-Z]\w*\s*\([\s\S]*?\],\s*\[[^\]]+\]\s*\)/.test(content);
  if (effectCount < 1 && !derivedState) return [];

  return [{
    severity: derivedState ? "high" : "medium",
    category: "react-hook-drift",
    file: file.path,
    message: `Component uses ${effectCount} effect hook${effectCount === 1 ? "" : "s"}${emptyEffects ? " including empty dependency effects" : ""}.`,
    whyItMatters:
      "Effect-heavy components often mix synchronization, data loading, and derived state, which makes dependency bugs easy to miss.",
    suggestedNextStep:
      "Move side effects into a named custom hook and replace derived state effects with memoized values where possible.",
    evidence: minimalContentSnippet(content, "useEffect"),
  }];
}

function detectReactDataFetching(file, content) {
  if (!/\b(fetch|axios\.[a-z]+)\s*\(/.test(content) || !looksLikeReactComponent(content)) return [];
  return [{
    severity: "medium",
    category: "react-data-fetching",
    file: file.path,
    message: "Component performs data fetching directly inside React UI code.",
    whyItMatters:
      "Direct fetching in components bypasses shared cache/error/loading conventions and is easy for future edits to duplicate.",
    suggestedNextStep:
      "Move fetching into the project data layer or a custom hook such as usePlansQuery/usePlannerData.",
    evidence: minimalContentSnippet(content, "fetch") || minimalContentSnippet(content, "axios"),
  }];
}

function detectReactRenderPerformance(file, content) {
  if (!/\.(map|filter|sort)\s*\(/.test(content) || /\buseMemo\s*\(/.test(content)) return [];
  return [{
    severity: "low",
    category: "react-render-performance",
    file: file.path,
    message: "Render path appears to transform collections without memoization.",
    whyItMatters:
      "Repeated map/filter/sort work in render can become visible once lists grow or parent state changes frequently.",
    suggestedNextStep:
      "Memoize derived lists or move the transformation into a selector/data hook if this component renders often.",
    evidence: minimalContentSnippet(content, ".filter") || minimalContentSnippet(content, ".map"),
  }];
}

function detectReactAccessibility(file, content) {
  const findings = [];
  if (/<div\b[^>]*\bonClick=/.test(content) && !/\b(role|tabIndex|onKeyDown)=/.test(content)) {
    findings.push({
      severity: "medium",
      category: "react-accessibility",
      file: file.path,
      message: "Clickable div without keyboard or semantic role support.",
      whyItMatters:
        "Mouse-only custom controls are hard to use with keyboard and assistive technology.",
      suggestedNextStep:
        "Use a button/link element, or add role, tabIndex, and keyboard handling intentionally.",
      evidence: minimalContentSnippet(content, "onClick"),
    });
  }

  return findings;
}

function detectNextClientServerBoundary(file, content) {
  const isClient = /^\s*['"]use client['"];?/m.test(content);
  const importsServerOnly =
    /\bfrom\s+['"]node:(fs|path|crypto|stream)['"]|\bfrom\s+['"](fs|path|crypto|stream)['"]/.test(content);
  const asyncClientComponent = isClient && /export\s+default\s+async\s+function/.test(content);
  if (!isClient || (!importsServerOnly && !asyncClientComponent)) return [];

  return [{
    severity: "high",
    category: "next-client-server-boundary",
    file: file.path,
    message: "Client component appears to use server-only code or async server-component shape.",
    whyItMatters:
      "Mixing client and server responsibilities causes hydration/build failures and confuses future route edits.",
    suggestedNextStep:
      "Move server-only work to a server component, route handler, or server action and pass serializable props to the client component.",
    evidence: importsServerOnly ? minimalContentSnippet(content, "from 'node:") || minimalContentSnippet(content, "from 'fs") : "export default async function",
  }];
}

function detectNextFetchCache(file, content) {
  if (!isNextPageOrLayout(file.path)) return [];
  const fetchCalls = [...content.matchAll(/\bfetch\s*\(([\s\S]*?)\)/g)];
  const risky = fetchCalls.find((match) => !/\b(cache|next)\s*:/.test(match[1]));
  if (!risky) return [];

  return [{
    severity: "medium",
    category: "next-fetch-cache",
    file: file.path,
    message: "Next.js route fetch does not declare cache or revalidation intent.",
    whyItMatters:
      "Implicit caching behavior is easy to misread and can produce stale data or unnecessary dynamic rendering.",
    suggestedNextStep:
      "Set an explicit fetch cache policy, revalidate value, or move the request behind the project data layer.",
    evidence: risky[0].slice(0, 180),
  }];
}

function detectNextRouteHandler(file, content) {
  if (!/(^|\/)route\.[cm]?[jt]s$/.test(file.path)) return [];
  const hasMethod = /\bexport\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/.test(content);
  const readsRequest = /\b(req|request)\s*:\s*Request\b|\brequest\.json\s*\(|\breq\.json\s*\(/.test(content);
  const hasTryCatch = /\btry\s*\{/.test(content);
  if (!hasMethod || hasTryCatch) return [];

  return [{
    severity: readsRequest ? "medium" : "low",
    category: "next-route-handler",
    file: file.path,
    message: "Route handler has no visible error boundary around request handling.",
    whyItMatters:
      "API route failures become harder to diagnose when parsing, validation, and response shape are not explicit.",
    suggestedNextStep:
      "Add focused validation/error handling or delegate request work to a tested service function.",
    evidence: minimalContentSnippet(content, "export async function"),
  }];
}

function detectTestGaps(changedFiles) {
  const hasTestChange = changedFiles.some((file) => isTestPath(file.path));
  if (hasTestChange) return [];

  return changedFiles
    .filter((file) => isSourcePath(file.path))
    .filter((file) => file.addedLines.some((line) => /\bexport\s+/.test(line)))
    .slice(0, 2)
    .map((file) => ({
      severity: "medium",
      category: "test-gap",
      file: file.path,
      message: "Changed production behavior without a nearby test change in the same diff.",
      whyItMatters:
        "A fast AI pass can look correct while missing regression coverage for the behavior it just introduced.",
      suggestedNextStep:
        "Add or update a focused test for the exported behavior before treating this change as done.",
      evidence: minimalSnippet(file.addedLines, "export"),
    }));
}

function parseAddedFunctionNames(addedText) {
  const names = [];
  const pattern =
    /\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)|\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g;
  for (const match of addedText.matchAll(pattern)) {
    names.push(match[1] || match[2]);
  }
  return names;
}

function extractImportSource(line) {
  const match = line.match(/\bimport\s+(?:type\s+)?(?:[\s\S]*?)\s+from\s+["']([^"']+)["']/);
  return match?.[1];
}

function targetFeatureName(fromPath, importSource) {
  if (!importSource.startsWith(".")) return null;
  const resolved = toPosix(normalize(join(dirname(fromPath), importSource)));
  return featureName(resolved);
}

function featureName(path) {
  return path.match(/(?:^|\/)src\/features\/([^/]+)/)?.[1] || null;
}

function estimateComplexity(content) {
  const matches = content.match(/\b(if|for|while|catch|case|switch|&&|\|\||\?)\b/g);
  return 1 + (matches?.length || 0);
}

function extractFunctionLikeBlock(content, name) {
  const functionStart = content.search(new RegExp(`\\b(function|class|const|let|var)\\s+${escapeRegExp(name)}\\b`));
  if (functionStart === -1) return name;
  const slice = content.slice(functionStart);
  const lines = slice.split(/\r?\n/);
  return lines.slice(0, 12).join("\n");
}

function normalizeSignature(text) {
  return text
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .replace(/[;{}()[\]`"'$]/g, "")
    .trim()
    .slice(0, 240);
}

function dedupeFindings(findings) {
  const seen = new Set();
  const result = [];
  for (const finding of findings) {
    const key = `${finding.category}:${finding.file}:${finding.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(finding);
  }
  return result;
}

function normalizePackResult({ pack, totalFiles, findings, policyContext }) {
  const normalized = dedupeFindings(findings)
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
    .slice(0, MAX_FINDINGS)
    .map((finding, index) => ({
      id: `debt-${String(index + 1).padStart(3, "0")}`,
      ...finding,
    }));

  return {
    summary: {
      status: normalized.some((finding) => finding.severity === "high")
        ? "debt-risk"
        : normalized.length > 0
          ? "watch"
          : "ok",
      scope: "project",
      pack,
      totalFindings: normalized.length,
      totalFiles,
    },
    policy: {
      aiContext: policyContext,
      maxFindings: MAX_FINDINGS,
      autoFix: false,
    },
    findings: normalized,
  };
}

function severityRank(severity) {
  return { low: 1, medium: 2, high: 3 }[severity] || 0;
}

function isSharedUtilityPath(path) {
  return /(^|\/)(shared|common|lib|utils|helpers)(\/|$)/.test(path);
}

function isSourcePath(path) {
  return SOURCE_EXTENSIONS.has(extname(path)) && !isTestPath(path);
}

function isTestPath(path) {
  return /(^|\/)(__tests__|tests?|spec)(\/|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(path);
}

function isReactFile(path) {
  return /\.(tsx|jsx)$/.test(path);
}

function isNextFile(path) {
  return /(^|\/)(app|pages)\//.test(path) && /\.(tsx|jsx|ts|js)$/.test(path);
}

function isNextPageOrLayout(path) {
  return /(^|\/)(page|layout)\.(tsx|jsx|ts|js)$/.test(path);
}

function looksLikeReactComponent(content) {
  return /<[A-Za-z][\s\S]*>/.test(content) && /\bexport\s+(default\s+)?function\b|\bconst\s+[A-Z]\w*\s*=/.test(content);
}

function countMatches(content, pattern) {
  return [...content.matchAll(pattern)].length;
}

function minimalContentSnippet(content, needle) {
  return minimalSnippet(content.split(/\r?\n/), needle);
}

function minimalSnippet(lines, needle) {
  const index = lines.findIndex((line) => line.includes(needle));
  if (index === -1) return "";
  return lines
    .slice(Math.max(0, index - 1), Math.min(lines.length, index + 3))
    .map((line) => line.trim())
    .join("\n");
}

function toPosix(path) {
  return path.split("\\").join("/");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatStatus(status) {
  const label = String(status).split("-").join(" ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function isInside(root, child) {
  const relativePath = relative(root, child);
  return relativePath === "" || (!relativePath.startsWith("..") && !relativePath.startsWith("/"));
}
