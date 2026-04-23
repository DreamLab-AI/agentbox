import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ensureLazyDir, readLazyJson, writeLazyJson, readLazyFile, writeLazyFile } from "./store.js";

// --- Types ---

interface Task {
  id: string;
  title: string;
  status: "todo" | "active" | "done" | "stuck";
  phase: Phase;
  created: string;
  updated: string;
}

type Phase = "read" | "plan" | "implement" | "validate" | "document";

interface Plan {
  goal: string;
  created: string;
  updated: string;
  tasks: Task[];
}

const PHASES: Phase[] = ["read", "plan", "implement", "validate", "document"];

const PHASE_ICON: Record<Phase, string> = {
  read: "📖",
  plan: "📋",
  implement: "🔨",
  validate: "✓",
  document: "📝",
};

const STATUS_ICON: Record<string, string> = {
  todo: "[ ]",
  active: " > ",
  done: "[x]",
  stuck: "[!]",
};

// --- Plan I/O ---

function loadPlan(root: string): Plan | null {
  return readLazyJson<Plan | null>(root, null, "plan.json");
}

function savePlan(root: string, p: Plan): void {
  ensureLazyDir(root);
  p.updated = new Date().toISOString();
  writeLazyJson(root, p, "plan.json");
  writeLazyFile(root, renderPlanMarkdown(p), "plan.md");
}

function renderPlanMarkdown(p: Plan): string {
  const lines = [`# Plan: ${p.goal}`, `Created: ${p.created}`, ""];

  // Group tasks by phase
  for (const phase of PHASES) {
    const phaseTasks = p.tasks.filter((t) => t.phase === phase);
    if (phaseTasks.length === 0) continue;

    lines.push(`## ${PHASE_ICON[phase]} ${phase.charAt(0).toUpperCase() + phase.slice(1)}`);
    for (const t of phaseTasks) {
      lines.push(`- ${STATUS_ICON[t.status]} **${t.title}** _(${t.status})_`);
    }
    lines.push("");
  }

  // Tasks without phase grouping (legacy)
  const ungrouped = p.tasks.filter((t) => !PHASES.includes(t.phase));
  if (ungrouped.length > 0) {
    lines.push("## Tasks");
    for (const t of ungrouped) {
      lines.push(`- ${STATUS_ICON[t.status]} **${t.title}** _(${t.status})_`);
    }
    lines.push("");
  }

  const done = p.tasks.filter((t) => t.status === "done").length;
  const total = p.tasks.length;
  const currentPhase = detectCurrentPhase(p);
  lines.push(`Progress: ${done}/${total} (${total ? Math.round((done / total) * 100) : 0}%) | Phase: ${PHASE_ICON[currentPhase]} ${currentPhase}`);

  return lines.join("\n") + "\n";
}

function detectCurrentPhase(p: Plan): Phase {
  // Find the earliest phase that has active or todo tasks
  for (const phase of PHASES) {
    const phaseTasks = p.tasks.filter((t) => t.phase === phase);
    if (phaseTasks.some((t) => t.status === "active")) return phase;
  }
  for (const phase of PHASES) {
    const phaseTasks = p.tasks.filter((t) => t.phase === phase);
    if (phaseTasks.some((t) => t.status === "todo")) return phase;
  }
  return "document"; // All done
}

function makeId(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function inferPhase(title: string): Phase {
  const t = title.toLowerCase();
  if (/read|understand|review|explore|analyze|research|investigate/.test(t)) return "read";
  if (/plan|design|architect|spec|define|outline|break/.test(t)) return "plan";
  if (/implement|build|code|create|add|write|develop|fix/.test(t)) return "implement";
  if (/test|validate|check|verify|lint|type|ci|qa/.test(t)) return "validate";
  if (/doc|document|readme|comment|explain|describe/.test(t)) return "document";
  return "implement"; // default
}

// --- Commands ---

export async function plan(root: string, goal: string): Promise<void> {
  if (!goal.trim()) {
    process.exitCode = 1;
    console.error("Usage: lazy plan <goal>");
    return;
  }

  const existing = loadPlan(root);
  if (existing) {
    const done = existing.tasks.filter((t) => t.status === "done").length;
    const total = existing.tasks.length;
    console.log(`Active plan: "${existing.goal}" (${done}/${total} done)`);
    console.log("Use 'lazy status' to see details, or 'lazy plan --reset' to start fresh.");
    return;
  }

  const now = new Date().toISOString();
  const newPlan: Plan = { goal, created: now, updated: now, tasks: [] };

  // Only split on commas/and if each part has 2+ words (avoids splitting sentences)
  const parts = goal
    .split(/,\s*|\s+and\s+/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const allSubstantial = parts.length > 1 && parts.every((p) => p.split(/\s+/).length >= 2);

  if (allSubstantial) {
    for (const part of parts) {
      newPlan.tasks.push({
        id: makeId(part),
        title: part,
        status: "todo",
        phase: inferPhase(part),
        created: now,
        updated: now,
      });
    }
  } else {
    // Single goal — create the full loop
    newPlan.tasks.push(
      { id: "read", title: `Read & understand: ${goal}`, status: "todo", phase: "read", created: now, updated: now },
      { id: "plan", title: `Plan approach for: ${goal}`, status: "todo", phase: "plan", created: now, updated: now },
      { id: "implement", title: `Implement: ${goal}`, status: "todo", phase: "implement", created: now, updated: now },
      { id: "validate", title: `Validate: ${goal}`, status: "todo", phase: "validate", created: now, updated: now },
      { id: "document", title: `Document: ${goal}`, status: "todo", phase: "document", created: now, updated: now },
    );
  }

  savePlan(root, newPlan);
  console.log(`\nPlan created: "${goal}"`);
  console.log(`${newPlan.tasks.length} task(s):\n`);
  for (const t of newPlan.tasks) {
    console.log(`  ${PHASE_ICON[t.phase]} [ ] ${t.title}`);
  }
  console.log("\nUse 'lazy update <task> active' to start working.");
}

export async function planFromFile(root: string, filePath: string): Promise<void> {
  const { existsSync, readFileSync } = await import("fs");
  const { resolve } = await import("path");

  const fullPath = resolve(root, filePath);
  if (!existsSync(fullPath)) {
    process.exitCode = 1;
    console.error(`File not found: ${filePath}`);
    return;
  }

  const existing = loadPlan(root);
  if (existing) {
    const done = existing.tasks.filter((t) => t.status === "done").length;
    console.log(`Active plan: "${existing.goal}" (${done}/${existing.tasks.length} done)`);
    console.log("Use 'lazy plan --reset' to start fresh.");
    return;
  }

  const content = readFileSync(fullPath, "utf-8");
  const lines = content.split("\n");

  // Extract goal from first heading, or use filename
  const headingLine = lines.find(l => /^#\s+/.test(l));
  const goal = headingLine?.replace(/^#+\s*/, "").trim() || filePath.replace(/\.\w+$/, "");

  const now = new Date().toISOString();
  const newPlan: Plan = { goal, created: now, updated: now, tasks: [] };

  // Parse bullet points as tasks
  for (const line of lines) {
    const match = line.match(/^\s*[-*]\s+(.+)/);
    if (match) {
      const title = match[1].trim();
      if (title.length < 3) continue;

      newPlan.tasks.push({
        id: makeId(title),
        title,
        status: "todo",
        phase: inferPhase(title),
        created: now,
        updated: now,
      });
    }
  }

  if (newPlan.tasks.length === 0) {
    process.exitCode = 1;
    console.error("No tasks found. Use bullet points (- task) in the file.");
    return;
  }

  // Deduplicate IDs
  const seen = new Set<string>();
  for (const t of newPlan.tasks) {
    if (seen.has(t.id)) {
      let n = 2;
      while (seen.has(`${t.id}-${n}`)) n++;
      t.id = `${t.id}-${n}`;
    }
    seen.add(t.id);
  }

  savePlan(root, newPlan);
  console.log(`\nPlan created from ${filePath}: "${goal}"`);
  console.log(`${newPlan.tasks.length} task(s):\n`);
  for (let i = 0; i < newPlan.tasks.length; i++) {
    const t = newPlan.tasks[i];
    console.log(`  ${i + 1}. ${PHASE_ICON[t.phase]} [ ] ${t.title}`);
  }
  console.log("\nUse 'lazy done 1' or 'lazy update <task> active' to start.");
}

export async function add(root: string, title: string, phase?: string): Promise<void> {
  if (!title.trim()) {
    process.exitCode = 1;
    console.error("Usage: lazy add <task> [phase]");
    console.error("Phases: read | plan | implement | validate | document");
    return;
  }

  const p = loadPlan(root);
  if (!p) {
    process.exitCode = 1;
    console.error("No active plan. Use 'lazy plan <goal>' first.");
    return;
  }

  const now = new Date().toISOString();
  const taskPhase = (phase && PHASES.includes(phase as Phase)) ? phase as Phase : inferPhase(title);

  let id = makeId(title);
  const existingIds = new Set(p.tasks.map(t => t.id));
  if (existingIds.has(id)) {
    let n = 2;
    while (existingIds.has(`${id}-${n}`)) n++;
    id = `${id}-${n}`;
  }

  p.tasks.push({
    id,
    title,
    status: "todo",
    phase: taskPhase,
    created: now,
    updated: now,
  });

  savePlan(root, p);
  console.log(`Added: ${PHASE_ICON[taskPhase]} "${title}" (${taskPhase})`);
}

export async function status(root: string): Promise<void> {
  const p = loadPlan(root);
  if (!p) {
    console.log("No active plan. Use 'lazy plan <goal>' to create one.");
    return;
  }

  const currentPhase = detectCurrentPhase(p);

  console.log(`\n  Plan: ${p.goal}`);
  console.log("─".repeat(55));

  // Show tasks grouped by phase
  for (const phase of PHASES) {
    const phaseTasks = p.tasks.filter((t) => t.phase === phase);
    if (phaseTasks.length === 0) continue;

    const marker = phase === currentPhase ? " ◄" : "";
    console.log(`\n  ${PHASE_ICON[phase]} ${phase.toUpperCase()}${marker}`);

    for (const t of phaseTasks) {
      const idx = p.tasks.indexOf(t) + 1;
      console.log(`    ${idx}. ${STATUS_ICON[t.status]} ${t.title}`);
    }
  }

  const done = p.tasks.filter((t) => t.status === "done").length;
  const active = p.tasks.filter((t) => t.status === "active").length;
  const stuck = p.tasks.filter((t) => t.status === "stuck").length;
  const total = p.tasks.length;

  console.log("\n" + "─".repeat(55));
  console.log(`  Progress: ${done}/${total} done${active ? `, ${active} active` : ""}${stuck ? `, ${stuck} stuck` : ""}`);
  console.log(`  Phase: ${PHASE_ICON[currentPhase]} ${currentPhase}`);
}

export async function update(root: string, taskQuery: string, newStatus: string): Promise<void> {
  if (!taskQuery || !newStatus) {
    process.exitCode = 1;
    console.error("Usage: lazy update <task> <status>");
    console.error("Status: todo | active | done | stuck");
    return;
  }

  const validStatuses = ["todo", "active", "done", "stuck"];
  if (!validStatuses.includes(newStatus)) {
    process.exitCode = 1;
    console.error(`Invalid status: ${newStatus}. Use: ${validStatuses.join(", ")}`);
    return;
  }

  const p = loadPlan(root);
  if (!p) {
    process.exitCode = 1;
    console.error("No active plan. Use 'lazy plan <goal>' to create one.");
    return;
  }

  const query = taskQuery.toLowerCase();

  // Support numeric index (1-based)
  const numIndex = parseInt(query, 10);
  if (!isNaN(numIndex) && numIndex >= 1 && numIndex <= p.tasks.length) {
    const task = p.tasks[numIndex - 1];
    task.status = newStatus as Task["status"];
    task.updated = new Date().toISOString();
    savePlan(root, p);
    const next = p.tasks.find((t) => t.status === "todo");
    console.log(`Updated: "${task.title}" → ${newStatus}`);
    if (newStatus === "done" && next) {
      console.log(`Next up: ${PHASE_ICON[next.phase]} "${next.title}"`);
    }
    return;
  }

  const matches = p.tasks.filter(
    (t) => t.id === query || t.title.toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    process.exitCode = 1;
    console.error(`No task matching "${taskQuery}"`);
    console.error("Tasks:", p.tasks.map((t) => t.title).join(", "));
    return;
  }

  if (matches.length > 1) {
    const exact = matches.find(t => t.id === query);
    if (!exact) {
      process.exitCode = 1;
      console.error(`Ambiguous: "${taskQuery}" matches ${matches.length} tasks:`);
      for (const m of matches) {
        console.error(`  - ${m.title} (id: ${m.id})`);
      }
      console.error("Use a more specific query or the task ID.");
      return;
    }
    // Use exact ID match
    matches.splice(0, matches.length, exact);
  }

  const task = matches[0];

  task.status = newStatus as Task["status"];
  task.updated = new Date().toISOString();
  savePlan(root, p);

  const next = p.tasks.find((t) => t.status === "todo");
  console.log(`Updated: "${task.title}" → ${newStatus}`);
  if (newStatus === "done" && next) {
    console.log(`Next up: ${PHASE_ICON[next.phase]} "${next.title}"`);
  }
}

export async function remove(root: string, taskQuery: string): Promise<void> {
  if (!taskQuery) {
    process.exitCode = 1;
    console.error("Usage: lazy remove <task>");
    return;
  }

  const p = loadPlan(root);
  if (!p) {
    process.exitCode = 1;
    console.error("No active plan.");
    return;
  }

  const query = taskQuery.toLowerCase();

  // Support numeric index (1-based)
  const numIndex = parseInt(query, 10);
  if (!isNaN(numIndex) && numIndex >= 1 && numIndex <= p.tasks.length) {
    const removed = p.tasks.splice(numIndex - 1, 1)[0];
    savePlan(root, p);
    console.log(`Removed: "${removed.title}"`);
    return;
  }

  const matches = p.tasks.filter(
    (t) => t.id === query || t.title.toLowerCase().includes(query)
  );

  if (matches.length === 0) {
    process.exitCode = 1;
    console.error(`No task matching "${taskQuery}"`);
    console.error("Tasks:", p.tasks.map((t) => t.title).join(", "));
    return;
  }

  if (matches.length > 1) {
    const exact = matches.find(t => t.id === query);
    if (!exact) {
      process.exitCode = 1;
      console.error(`Ambiguous: "${taskQuery}" matches ${matches.length} tasks:`);
      for (const m of matches) {
        console.error(`  - ${m.title} (id: ${m.id})`);
      }
      console.error("Use a more specific query or the task ID.");
      return;
    }
    matches.splice(0, matches.length, exact);
  }

  const task = matches[0];
  const idx = p.tasks.indexOf(task);
  const removed = p.tasks.splice(idx, 1)[0];
  savePlan(root, p);
  console.log(`Removed: "${removed.title}"`);
}

export async function next(root: string): Promise<void> {
  const p = loadPlan(root);
  if (!p) {
    console.log("No active plan. Use 'lazy plan <goal>' to create one.");
    return;
  }

  const nextTask = p.tasks.find((t) => t.status === "todo");
  if (!nextTask) {
    console.log("All tasks done! Use 'lazy plan --reset' to start fresh.");
    return;
  }

  console.log(`\n  Next up: ${PHASE_ICON[nextTask.phase]} ${nextTask.title}`);
  console.log("─".repeat(55));

  // Auto-gather context for the next task
  const { gather } = await import("./context.js");
  await gather(root, nextTask.title);
}

export async function check(root: string): Promise<void> {
  console.log("\n  Health Check");
  console.log("─".repeat(55));

  interface CheckDef {
    name: string;
    cmd: string;
    detect?: string;
    skip?: (root: string) => boolean;
    parse?: (output: string) => string;
  }

  const checks: CheckDef[] = [
    { name: "Git", cmd: "git status --porcelain", parse: parseGit },
    // TypeScript / JavaScript
    { name: "TypeScript", cmd: "npx tsc --noEmit 2>&1", detect: "tsconfig.json" },
    { name: "ESLint", cmd: "npx eslint . --max-warnings=0 2>&1", detect: "package.json", skip: (r) => {
      // Check for any eslint config
      const configs = [".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs", "eslint.config.ts"];
      return !configs.some(c => existsSync(join(r, c)));
    }},
    { name: "Tests (npm)", cmd: "npm test 2>&1", detect: "package.json", skip: (r) => {
      // Skip if test script is a placeholder
      try {
        const pkg = JSON.parse(readFileSync(join(r, "package.json"), "utf-8"));
        const testCmd = pkg.scripts?.test ?? "";
        return !testCmd || testCmd.includes("no test specified") || testCmd === "echo";
      } catch { return true; }
    }},
    // Python
    { name: "Python (ruff)", cmd: "ruff check . 2>&1", detect: "pyproject.toml" },
    { name: "Python (mypy)", cmd: "mypy . 2>&1", detect: "mypy.ini" },
    { name: "Tests (pytest)", cmd: "pytest 2>&1", detect: "pyproject.toml", skip: (r) => {
      // Run if pytest.ini exists OR pyproject.toml has [tool.pytest] section
      if (existsSync(join(r, "pytest.ini"))) return false;
      if (existsSync(join(r, "conftest.py"))) return false;
      try {
        const pyproj = readFileSync(join(r, "pyproject.toml"), "utf-8");
        return !pyproj.includes("[tool.pytest");
      } catch { return true; }
    }},
    // Rust
    { name: "Rust (check)", cmd: "cargo check 2>&1", detect: "Cargo.toml" },
    { name: "Tests (cargo)", cmd: "cargo test 2>&1", detect: "Cargo.toml" },
    // Go
    { name: "Go (vet)", cmd: "go vet ./... 2>&1", detect: "go.mod" },
    { name: "Tests (go)", cmd: "go test ./... 2>&1", detect: "go.mod" },
  ];

  for (const c of checks) {
    if (c.detect && !findFile(root, c.detect)) continue;
    if (c.skip && c.skip(root)) continue;

    try {
      const output = execSync(c.cmd, { cwd: root, timeout: 60000, encoding: "utf-8" });
      if (c.parse) {
        console.log(`  ${c.parse(output)}`);
      } else {
        console.log(`  ✓ ${c.name}: OK`);
      }
    } catch (err: any) {
      const output = err.stdout || err.stderr || err.message;
      const lines = output.split("\n").filter(Boolean);
      console.log(`  ✗ ${c.name}: ${lines.length} issue(s)`);
    }
  }

  // Quick security gate (secrets + env only)
  try {
    const { secureGate } = await import("./secure.js");
    const sec = await secureGate(root);
    if (sec.pass) {
      console.log("  ✓ Security: no critical/high issues");
    } else {
      console.log(`  ✗ Security: ${sec.critical} critical, ${sec.high} high`);
    }
  } catch {}

  // Also show plan progress if available
  const p = loadPlan(root);
  if (p) {
    const done = p.tasks.filter((t) => t.status === "done").length;
    const total = p.tasks.length;
    const phase = detectCurrentPhase(p);
    console.log(`  ${PHASE_ICON[phase]} Plan: ${done}/${total} done (${phase} phase)`);
  }
}

export async function read(root: string): Promise<void> {
  console.log("\n  Getting up to date...");
  console.log("─".repeat(55));

  // 1. Git status — what changed?
  try {
    const branch = execSync("git branch --show-current", { cwd: root, encoding: "utf-8" }).trim();
    console.log(`\n  Branch: ${branch}`);

    // Recent commits
    const log = execSync('git log --oneline -5 2>/dev/null || echo "(no commits)"', { cwd: root, encoding: "utf-8" }).trim();
    console.log("\n  Recent commits:");
    for (const line of log.split("\n")) {
      console.log(`    ${line}`);
    }

    // Uncommitted changes
    const diff = execSync("git diff --stat 2>/dev/null || true", { cwd: root, encoding: "utf-8" }).trim();
    if (diff) {
      console.log("\n  Uncommitted changes:");
      for (const line of diff.split("\n")) {
        console.log(`    ${line}`);
      }
    }

    // Untracked files
    const untracked = execSync("git ls-files --others --exclude-standard 2>/dev/null || true", { cwd: root, encoding: "utf-8" }).trim();
    if (untracked) {
      const files = untracked.split("\n");
      console.log(`\n  Untracked files (${files.length}):`);
      for (const f of files.slice(0, 10)) {
        console.log(`    ${f}`);
      }
      if (files.length > 10) console.log(`    ... and ${files.length - 10} more`);
    }
  } catch {
    console.log("  (not a git repo)");
  }

  // 2. Plan status
  const p = loadPlan(root);
  if (p) {
    const done = p.tasks.filter((t) => t.status === "done").length;
    const active = p.tasks.filter((t) => t.status === "active");
    const stuck = p.tasks.filter((t) => t.status === "stuck");
    const phase = detectCurrentPhase(p);

    console.log(`\n  Plan: "${p.goal}" — ${done}/${p.tasks.length} done, phase: ${PHASE_ICON[phase]} ${phase}`);

    if (active.length > 0) {
      console.log("  Active:");
      for (const t of active) console.log(`    > ${t.title}`);
    }
    if (stuck.length > 0) {
      console.log("  Stuck:");
      for (const t of stuck) console.log(`    ! ${t.title}`);
    }
  }

  // 3. Memory highlights
  const mem = readLazyJson<Record<string, { value: string }>>(root, {}, "memory.json");
  const memKeys = Object.keys(mem);
  if (memKeys.length > 0) {
    console.log(`\n  Memory: ${memKeys.length} item(s) stored`);
    for (const k of memKeys.slice(0, 5)) {
      console.log(`    ${k}: ${mem[k].value.slice(0, 60)}${mem[k].value.length > 60 ? "..." : ""}`);
    }
  }

  console.log("\n" + "─".repeat(55));
  console.log("  Ready. Use 'lazy status' for full plan or 'lazy gather <task>' for context.");
}

export async function resetPlan(root: string): Promise<void> {
  const p = loadPlan(root);
  if (!p) {
    console.log("No active plan to reset.");
    return;
  }

  // Archive the completed plan
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const archiveName = `plan-${timestamp}.json`;
  writeLazyJson(root, p, "archive", archiveName);

  writeLazyFile(root, "null\n", "plan.json");
  writeLazyFile(root, "", "plan.md");
  console.log(`Plan "${p.goal}" archived and cleared.`);
  console.log(`  Archived to: .lazy/archive/${archiveName}`);
  console.log("Use 'lazy plan <goal>' to start fresh.");
}

// --- Helpers ---

function parseGit(output: string): string {
  const lines = output.split("\n").filter(Boolean);
  if (lines.length === 0) return "✓ Git: clean";
  const modified = lines.filter((l) => /^ ?M/.test(l)).length;
  const added = lines.filter((l) => /^ ?A/.test(l)).length;
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const parts = [];
  if (modified) parts.push(`${modified} modified`);
  if (added) parts.push(`${added} added`);
  if (untracked) parts.push(`${untracked} untracked`);
  return `⚠ Git: ${parts.join(", ")}`;
}

function findFile(root: string, name: string): boolean {
  const paths = [join(root, name), join(root, `.${name}`)];
  return paths.some(existsSync);
}
