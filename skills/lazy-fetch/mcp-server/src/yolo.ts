import { readFileSync, existsSync } from "fs";
import { join, resolve } from "path";
import { readLazyJson, writeLazyJson, readLazyFile, appendLazyFile } from "./store.js";
import { check } from "./process.js";
import { journal, snapshot } from "./persist.js";
import { secureGate } from "./secure.js";

// --- Types ---

type SprintStatus = "pending" | "active" | "done" | "failed";

interface Sprint {
  id: string;
  title: string;
  tasks: string[];
  status: SprintStatus;
  started?: string;
  completed?: string;
  validation?: {
    pass: boolean;
    output: string;
    notes: string;
  };
}

interface YoloPlan {
  prdFile: string;
  prdContent: string;
  goal: string;
  sprints: Sprint[];
  created: string;
  updated: string;
}

interface YoloState {
  plan: YoloPlan;
  currentSprint: number;
  status: "ready" | "running" | "paused" | "completed" | "failed";
  iterations: number;
  maxIterationsPerSprint: number;
  snapshotBefore?: string;
  runId?: string;
}

const YOLO_FILE = "yolo.json";

// --- Event Logging ---

interface YoloEvent {
  ts: string;
  event: string;
  sprint?: string;
  data?: Record<string, unknown>;
  durationMs?: number;
}

function logEvent(root: string, runId: string, event: YoloEvent): void {
  appendLazyFile(root, JSON.stringify(event) + "\n", "runs", runId, "events.jsonl");
}

function getRunId(state: YoloState): string {
  return state.runId ?? `yolo-${state.plan.created.split("T")[0]}`;
}

function loadEvents(root: string, runId: string): YoloEvent[] {
  const raw = readLazyFile(root, "runs", runId, "events.jsonl");
  if (!raw) return [];
  return raw.trim().split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean) as YoloEvent[];
}

// --- State I/O ---

function loadState(root: string): YoloState | null {
  return readLazyJson<YoloState | null>(root, null, YOLO_FILE);
}

function saveState(root: string, state: YoloState): void {
  state.plan.updated = new Date().toISOString();
  writeLazyJson(root, state, YOLO_FILE);
}

// --- PRD Parsing ---

function parsePrdToSprints(prdContent: string): { goal: string; sprints: Sprint[] } {
  const lines = prdContent.split("\n");

  // Extract goal from first heading
  const goalLine = lines.find(l => /^#\s+/.test(l));
  const goal = goalLine?.replace(/^#+\s*/, "").trim() || "Project from PRD";

  // Try to find sprint/phase sections
  const sprintSections: { title: string; tasks: string[] }[] = [];
  let currentSection: { title: string; tasks: string[] } | null = null;

  for (const line of lines) {
    // Match ## headings as sprint boundaries
    const headingMatch = line.match(/^##\s+(.+)/);
    if (headingMatch) {
      if (currentSection) sprintSections.push(currentSection);
      currentSection = { title: headingMatch[1].trim(), tasks: [] };
      continue;
    }

    // Collect bullet points as tasks
    const bulletMatch = line.match(/^[\s]*[-*]\s+(.+)/);
    if (bulletMatch && currentSection) {
      const task = bulletMatch[1].trim();
      // Skip very short items (likely not real tasks)
      if (task.length > 5) {
        currentSection.tasks.push(task);
      }
    }
  }
  if (currentSection) sprintSections.push(currentSection);

  // Filter out sections that are just metadata (no tasks)
  const validSections = sprintSections.filter(s => s.tasks.length > 0);

  let sprints: Sprint[];

  if (validSections.length >= 2) {
    // PRD has structure — use it
    sprints = validSections.map((s, i) => ({
      id: `sprint-${i + 1}`,
      title: s.title,
      tasks: s.tasks,
      status: "pending" as SprintStatus,
    }));
  } else {
    // Unstructured PRD — collect all tasks and divide into 3 sprints
    const allTasks = sprintSections.flatMap(s => s.tasks);

    if (allTasks.length === 0) {
      // No bullet points at all — create generic sprints from prose
      sprints = [
        { id: "sprint-1", title: "Foundation & Setup", tasks: ["Set up project structure, dependencies, and core types based on the PRD"], status: "pending" },
        { id: "sprint-2", title: "Core Implementation", tasks: ["Implement the main features described in the PRD"], status: "pending" },
        { id: "sprint-3", title: "Validation & Polish", tasks: ["Add tests, fix edge cases, validate all features work end-to-end"], status: "pending" },
      ];
    } else {
      // Divide tasks into sprints of roughly equal size
      const chunkSize = Math.max(1, Math.ceil(allTasks.length / 3));
      const names = ["Foundation", "Core Features", "Polish & Validation"];
      sprints = [];
      for (let i = 0; i < 3; i++) {
        const tasks = allTasks.slice(i * chunkSize, (i + 1) * chunkSize);
        if (tasks.length > 0) {
          sprints.push({
            id: `sprint-${i + 1}`,
            title: names[i],
            tasks,
            status: "pending",
          });
        }
      }
    }
  }

  return { goal, sprints };
}

// --- Validation ---

async function runValidation(root: string): Promise<{ pass: boolean; output: string }> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));

  try {
    await check(root);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  const output = lines.join("\n");
  // Only fail on real check failures (✗), not warnings or missing tools
  const hasFailures = lines.some(l => l.includes("✗"));
  return { pass: !hasFailures, output };
}

// --- Format Helpers ---

function formatSprintPlan(sprints: Sprint[]): string {
  return sprints.map(s => {
    const statusIcon = s.status === "done" ? "✓" : s.status === "active" ? ">" : s.status === "failed" ? "✗" : " ";
    const taskList = s.tasks.map(t => `  - ${t}`).join("\n");
    return `### ${statusIcon} ${s.title} (${s.status})\n${taskList}`;
  }).join("\n\n");
}

// --- Master Prompt ---

function generateMasterPrompt(state: YoloState): string {
  const { plan } = state;
  const sprintPlan = formatSprintPlan(plan.sprints);

  return `
# YOLO Mode — Autonomous Project Execution

You are in YOLO mode. Execute this project end-to-end, sprint by sprint, without stopping.

## Goal
${plan.goal}

## PRD
\`\`\`
${plan.prdContent.slice(0, 6000)}
\`\`\`

## Sprint Plan
${sprintPlan}

## Your Loop

For each sprint:

1. **Check status** — Call \`lazy_yolo_status\` to see the current sprint and its tasks
2. **Gather context** — Call \`lazy_gather\` with the sprint title to find relevant files
3. **Execute tasks** — For each task in the sprint, pick the right approach:
   - **Adding new functionality?** → Run \`lazy_blueprint_run\` with name \`add-feature\` and the task as input
   - **Fixing a bug?** → Run \`lazy_blueprint_run\` with name \`fix-bug\` and the bug description as input
   - **Trying something uncertain?** → Run \`lazy_blueprint_run\` with name \`experiment\` and the idea as input
   - **Setup/config/simple tasks?** → Implement directly, then run \`lazy_check\`
4. **Follow blueprint prompts** — Blueprints return agentic steps (analyze, implement, document). Execute each prompt in order.
5. **Validate** — Call \`lazy_check\` to verify typecheck + tests pass
6. **Fix issues** — If checks fail, fix them. Repeat step 5 (max 3 attempts per sprint).
7. **Advance** — Call \`lazy_yolo_advance\` with brief notes. This validates and moves to the next sprint.
8. **Repeat** — Continue with the next sprint. Do not stop.

## Blueprints Available

- \`add-feature\` — Full loop: gather → research → plan → implement → typecheck → test → document → remember
- \`fix-bug\` — Targeted: gather → checkpoint → analyze → fix → typecheck → test → remember
- \`experiment\` — Safe: gather → branch → implement → validate → evaluate (keeps or discards)
- \`review-code\` — Audit: gather → diff → typecheck → review → suggest

Use blueprints via MCP: \`lazy_blueprint_run\` with \`name\` and \`input\` parameters.

## Rules

- NEVER stop to ask for confirmation. Keep going until all sprints are done.
- NEVER skip validation. Every sprint must pass checks before advancing.
- **Use blueprints for tasks that match** — they enforce a structured workflow with checkpoints and validation.
- If \`lazy_yolo_advance\` reports a validation failure, fix the issues and try again.
- Use \`lazy_remember\` for important decisions so later sprints have context.
- Use \`lazy_journal\` to log significant choices or tradeoffs.
- Use \`lazy_snapshot\` before risky changes within a sprint.
- Keep changes minimal. Ship the simplest thing that works.
- After the final sprint, do one last \`lazy_check\` and commit all work.

## Start Now

Sprint 1 is ready. Call \`lazy_yolo_status\` to see the first sprint's tasks, then begin.
`.trim();
}

// --- Public API ---

export async function yoloStart(root: string, prdPath: string): Promise<string> {
  // Check for existing yolo session
  const existing = loadState(root);
  if (existing && existing.status === "running") {
    const current = existing.plan.sprints[existing.currentSprint];
    return `Yolo mode already running!\n\n` +
      `  Goal: "${existing.plan.goal}"\n` +
      `  Sprint ${existing.currentSprint + 1}/${existing.plan.sprints.length}: ${current?.title ?? "?"}\n\n` +
      `Use 'lazy yolo status' to see progress or 'lazy yolo reset' to start over.`;
  }

  // Pre-flight: quick selftest
  const { selftest: runSelftest } = await import("./selftest.js");
  const preflight = await preflightCheck(root, runSelftest);
  if (preflight) return preflight;

  // Read PRD
  const fullPath = resolve(root, prdPath);
  if (!existsSync(fullPath)) {
    process.exitCode = 1;
    return `PRD file not found: ${prdPath}`;
  }

  const prdContent = readFileSync(fullPath, "utf-8");
  if (!prdContent.trim()) {
    process.exitCode = 1;
    return `PRD file is empty: ${prdPath}`;
  }

  // Parse PRD into sprints
  const { goal, sprints } = parsePrdToSprints(prdContent);

  // Take a snapshot before we start
  const snapName = `pre-yolo-${new Date().toISOString().split("T")[0]}`;
  await snapshot(root, snapName);

  // Create state
  const now = new Date().toISOString();
  const runId = `yolo-${now.replace(/[:.]/g, "-").slice(0, 19)}`;
  const state: YoloState = {
    plan: {
      prdFile: prdPath,
      prdContent,
      goal,
      sprints,
      created: now,
      updated: now,
    },
    currentSprint: 0,
    status: "running",
    iterations: 0,
    maxIterationsPerSprint: 3,
    snapshotBefore: snapName,
    runId,
  };

  // Mark first sprint as active
  state.plan.sprints[0].status = "active";
  state.plan.sprints[0].started = now;

  saveState(root, state);

  // Log start event
  logEvent(root, runId, {
    ts: now,
    event: "yolo-start",
    data: { goal, sprintCount: sprints.length, prdFile: prdPath, totalTasks: sprints.reduce((n, s) => n + s.tasks.length, 0) },
  });

  // Journal the start
  await journal(root, `YOLO mode started: "${goal}" — ${sprints.length} sprint(s) from ${prdPath}`);

  return generateMasterPrompt(state);
}

async function preflightCheck(root: string, runSelftest: (quick: boolean, report: boolean) => Promise<void>): Promise<string | null> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  let failed = false;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));
  const origExitCode = process.exitCode;

  try {
    await runSelftest(true, false);
    failed = process.exitCode === 1;
  } catch {
    failed = true;
  } finally {
    console.log = origLog;
    console.error = origErr;
  }

  if (failed) {
    process.exitCode = 1;
    return `Pre-flight selftest failed! Fix lazy-fetch before running yolo mode.\n\n${lines.join("\n")}`;
  }

  process.exitCode = origExitCode;
  return null;
}

export async function yoloStatus(root: string): Promise<string> {
  const state = loadState(root);
  if (!state) {
    return "No active yolo session. Run 'lazy yolo <prd-file>' to start.";
  }

  const { plan, currentSprint, status } = state;
  const total = plan.sprints.length;
  const done = plan.sprints.filter(s => s.status === "done").length;
  const current = plan.sprints[currentSprint];

  const lines: string[] = [];
  lines.push(`\n  YOLO Mode — ${status.toUpperCase()}`);
  lines.push("─".repeat(55));
  lines.push(`  Goal: ${plan.goal}`);
  lines.push(`  Progress: ${done}/${total} sprints done`);

  if (current && status === "running") {
    lines.push(`\n  Current: Sprint ${currentSprint + 1} — ${current.title}`);
    lines.push(`  Tasks:`);
    for (const t of current.tasks) {
      lines.push(`    - ${t}`);
    }
    if (current.validation) {
      lines.push(`\n  Last validation: ${current.validation.pass ? "✓ PASSED" : "✗ FAILED"}`);
    }
  }

  if (status === "completed") {
    lines.push(`\n  All sprints completed!`);
  }

  // Show all sprints overview
  lines.push(`\n  Sprint Overview:`);
  for (let i = 0; i < plan.sprints.length; i++) {
    const s = plan.sprints[i];
    const icon = s.status === "done" ? "✓" : s.status === "active" ? ">" : s.status === "failed" ? "✗" : " ";
    const marker = i === currentSprint && status === "running" ? " ◄" : "";
    lines.push(`    ${icon} Sprint ${i + 1}: ${s.title} (${s.status})${marker}`);
  }

  return lines.join("\n");
}

export async function yoloAdvance(root: string, notes?: string): Promise<string> {
  const state = loadState(root);
  if (!state) {
    return "No active yolo session.";
  }

  if (state.status !== "running") {
    return `Yolo mode is ${state.status}. Cannot advance.`;
  }

  const current = state.plan.sprints[state.currentSprint];
  if (!current) {
    return "No current sprint to advance.";
  }

  const runId = getRunId(state);
  const advanceStart = performance.now();

  // Run validation
  const validation = await runValidation(root);

  current.validation = {
    pass: validation.pass,
    output: validation.output.slice(0, 2000),
    notes: notes ?? "",
  };

  state.iterations++;

  // Log validation event
  logEvent(root, runId, {
    ts: new Date().toISOString(),
    event: "validation",
    sprint: current.title,
    data: { pass: validation.pass, attempt: state.iterations },
    durationMs: Math.round(performance.now() - advanceStart),
  });

  if (!validation.pass) {
    // Validation failed — check retry budget
    const sprintIterations = state.iterations;
    if (sprintIterations > state.maxIterationsPerSprint) {
      current.status = "failed";
      state.status = "paused";
      saveState(root, state);

      logEvent(root, runId, {
        ts: new Date().toISOString(),
        event: "sprint-failed",
        sprint: current.title,
        data: { attempts: sprintIterations },
      });

      await journal(root, `YOLO sprint "${current.title}" failed after ${sprintIterations} attempts`);
      return `Sprint "${current.title}" failed validation after ${sprintIterations} attempts.\n\n` +
        `Validation output:\n${validation.output}\n\n` +
        `Yolo mode paused. Fix the issues manually, then run 'lazy yolo resume' or 'lazy yolo reset'.`;
    }

    saveState(root, state);
    return `Sprint "${current.title}" failed validation (attempt ${state.iterations}/${state.maxIterationsPerSprint}).\n\n` +
      `Validation output:\n${validation.output}\n\n` +
      `Fix the issues and call lazy_yolo_advance again.`;
  }

  // Validation passed — run security gate
  const secResult = await secureGate(root);
  logEvent(root, runId, {
    ts: new Date().toISOString(),
    event: "security-gate",
    sprint: current.title,
    data: { pass: secResult.pass, critical: secResult.critical, high: secResult.high },
  });

  if (!secResult.pass) {
    saveState(root, state);
    return `Sprint "${current.title}" passed checks but FAILED security gate.\n\n` +
      `${secResult.critical} critical, ${secResult.high} high severity issue(s) found.\n\n` +
      `${secResult.output}\n\n` +
      `Fix the security issues and call lazy_yolo_advance again.`;
  }

  // All gates passed — advance
  const now = new Date().toISOString();
  current.status = "done";
  current.completed = now;

  const sprintDurationMs = current.started ? new Date(now).getTime() - new Date(current.started).getTime() : 0;

  logEvent(root, runId, {
    ts: now,
    event: "sprint-done",
    sprint: current.title,
    data: { attempts: state.iterations, durationMs: sprintDurationMs, notes: notes ?? "" },
  });

  await journal(root, `YOLO sprint "${current.title}" completed. ${notes ?? ""}`);

  // Check if all done
  const nextIdx = state.currentSprint + 1;
  if (nextIdx >= state.plan.sprints.length) {
    state.status = "completed";
    saveState(root, state);
    await snapshot(root, "post-yolo");

    logEvent(root, runId, {
      ts: now,
      event: "yolo-complete",
      data: {
        totalSprints: state.plan.sprints.length,
        totalDurationMs: new Date(now).getTime() - new Date(state.plan.created).getTime(),
      },
    });

    await journal(root, `YOLO mode completed! All ${state.plan.sprints.length} sprints done.`);

    const done = state.plan.sprints.filter(s => s.status === "done").length;
    return `\n  YOLO MODE COMPLETE!\n` +
      `─${"─".repeat(54)}\n` +
      `  Goal: ${state.plan.goal}\n` +
      `  Sprints: ${done}/${state.plan.sprints.length} done\n\n` +
      `  All sprints completed. Run 'lazy yolo report' for a full scorecard, then commit your work.`;
  }

  // Advance to next sprint
  state.currentSprint = nextIdx;
  state.iterations = 0;
  const next = state.plan.sprints[nextIdx];
  next.status = "active";
  next.started = now;

  saveState(root, state);

  logEvent(root, runId, {
    ts: now,
    event: "sprint-start",
    sprint: next.title,
    data: { sprintIndex: nextIdx, taskCount: next.tasks.length },
  });

  return `Sprint "${current.title}" completed!\n\n` +
    `  Next: Sprint ${nextIdx + 1} — ${next.title}\n` +
    `  Tasks:\n${next.tasks.map(t => `    - ${t}`).join("\n")}\n\n` +
    `  Gather context with lazy_gather and start implementing.`;
}

export async function yoloDryRun(root: string, prdPath: string): Promise<string> {
  const fullPath = resolve(root, prdPath);
  if (!existsSync(fullPath)) {
    return `PRD file not found: ${prdPath}`;
  }

  const prdContent = readFileSync(fullPath, "utf-8");
  if (!prdContent.trim()) {
    return `PRD file is empty: ${prdPath}`;
  }

  const { goal, sprints } = parsePrdToSprints(prdContent);

  const lines: string[] = [];
  lines.push(`\n  Yolo Dry Run — plan preview (no state written)`);
  lines.push("─".repeat(55));
  lines.push(`  Goal: ${goal}`);
  lines.push(`  Sprints: ${sprints.length}\n`);

  for (const s of sprints) {
    lines.push(`  ### ${s.title}`);
    for (const t of s.tasks) {
      lines.push(`    - ${t}`);
    }
    lines.push("");
  }

  const totalTasks = sprints.reduce((n, s) => n + s.tasks.length, 0);
  lines.push(`  Total: ${sprints.length} sprint(s), ${totalTasks} task(s)`);

  return lines.join("\n");
}

export async function yoloReport(root: string): Promise<string> {
  const state = loadState(root);
  if (!state) {
    return "No yolo session found. Run 'lazy yolo <prd-file>' first.";
  }

  const runId = getRunId(state);
  const events = loadEvents(root, runId);
  const { plan } = state;

  const lines: string[] = [];
  lines.push(`\n  Yolo Run Report — ${plan.goal}`);
  lines.push("─".repeat(55));
  lines.push(`  PRD: ${plan.prdFile}`);
  lines.push(`  Status: ${state.status.toUpperCase()}`);
  lines.push(`  Run ID: ${runId}`);

  // Duration
  const startEvent = events.find(e => e.event === "yolo-start");
  const endEvent = events.find(e => e.event === "yolo-complete");
  if (startEvent && endEvent) {
    const durationMs = new Date(endEvent.ts).getTime() - new Date(startEvent.ts).getTime();
    lines.push(`  Duration: ${formatDuration(durationMs)}`);
  } else if (startEvent) {
    const elapsed = Date.now() - new Date(startEvent.ts).getTime();
    lines.push(`  Elapsed: ${formatDuration(elapsed)} (still running)`);
  }

  // Sprint summary
  const totalSprints = plan.sprints.length;
  const doneSprints = plan.sprints.filter(s => s.status === "done").length;
  const failedSprints = plan.sprints.filter(s => s.status === "failed").length;
  const totalTasks = plan.sprints.reduce((n, s) => n + s.tasks.length, 0);

  lines.push("");
  lines.push("  Process Quality:");

  // First-pass rate: sprints that passed validation on first attempt
  const sprintDoneEvents = events.filter(e => e.event === "sprint-done");
  const firstPassCount = sprintDoneEvents.filter(e => (e.data?.attempts as number) <= 1).length;
  const completedSprints = sprintDoneEvents.length;
  if (completedSprints > 0) {
    lines.push(`    First-pass rate:    ${firstPassCount}/${completedSprints} sprints (${Math.round(firstPassCount / completedSprints * 100)}%)`);
  }

  // Total retries
  const validationEvents = events.filter(e => e.event === "validation");
  const failedValidations = validationEvents.filter(e => !(e.data?.pass));
  lines.push(`    Total validations:  ${validationEvents.length} (${failedValidations.length} failed)`);

  // Sprint failures
  const sprintFailEvents = events.filter(e => e.event === "sprint-failed");
  lines.push(`    Sprint failures:    ${sprintFailEvents.length}`);

  // Build quality (from latest check)
  lines.push("");
  lines.push("  Build Quality:");

  const checkOutput = await captureCheckOutput(root);
  for (const line of checkOutput.split("\n").filter(Boolean)) {
    if (line.includes("✓") || line.includes("✗") || line.includes("⚠")) {
      lines.push(`  ${line}`);
    }
  }

  // Per-sprint breakdown
  lines.push("");
  lines.push("  Sprint Breakdown:");
  for (let i = 0; i < plan.sprints.length; i++) {
    const s = plan.sprints[i];
    const icon = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : s.status === "active" ? ">" : " ";
    const doneEvent = sprintDoneEvents.find(e => e.sprint === s.title);
    const attempts = doneEvent?.data?.attempts ?? "?";
    const durationMs = doneEvent?.data?.durationMs as number | undefined;
    const duration = durationMs ? ` (${formatDuration(durationMs)})` : "";
    lines.push(`    ${icon} Sprint ${i + 1}: ${s.title} — ${s.tasks.length} tasks, ${attempts} attempt(s)${duration}`);
  }

  // Summary
  lines.push("");
  lines.push("─".repeat(55));
  lines.push(`  Sprints: ${doneSprints}/${totalSprints} done, ${failedSprints} failed`);
  lines.push(`  Tasks: ${totalTasks} total`);
  lines.push(`  Events logged: ${events.length}`);

  return lines.join("\n");
}

async function captureCheckOutput(root: string): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));
  try {
    await check(root);
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return lines.join("\n");
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remSecs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export async function yoloReset(root: string): Promise<void> {
  const state = loadState(root);
  if (!state) {
    console.log("No active yolo session.");
    return;
  }

  const { writeFileSync } = await import("fs");
  const { lazyPath } = await import("./store.js");
  writeFileSync(lazyPath(root, YOLO_FILE), "null\n", "utf-8");
  console.log(`Yolo session cleared. Goal was: "${state.plan.goal}"`);
  await journal(root, `YOLO mode reset. Previous goal: "${state.plan.goal}"`);
}
