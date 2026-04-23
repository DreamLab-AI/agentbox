import { mkdirSync, mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { execSync } from "child_process";

// --- Types ---

interface TestResult {
  name: string;
  pass: boolean;
  ms: number;
  error?: string;
}

interface SelftestReport {
  timestamp: string;
  version: string;
  results: TestResult[];
  passed: number;
  failed: number;
  totalMs: number;
}

// --- Helpers ---

function captureOutput(fn: () => void): string {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));
  try {
    fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return lines.join("\n");
}

async function captureAsync(fn: () => Promise<void>): Promise<string> {
  const lines: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
  console.error = (...args: any[]) => lines.push(args.map(String).join(" "));
  try {
    await fn();
  } finally {
    console.log = origLog;
    console.error = origErr;
  }
  return lines.join("\n");
}

// --- Test Runner ---

async function runTest(name: string, fn: () => Promise<void>): Promise<TestResult> {
  const start = performance.now();
  try {
    await fn();
    return { name, pass: true, ms: Math.round(performance.now() - start) };
  } catch (err: any) {
    return { name, pass: false, ms: Math.round(performance.now() - start), error: err.message };
  }
}

function assert(condition: boolean, msg: string): void {
  if (!condition) throw new Error(msg);
}

function assertIncludes(output: string, needle: string, context: string): void {
  if (!output.includes(needle)) {
    throw new Error(`${context}: expected output to include "${needle}"\nGot: ${output.slice(0, 200)}`);
  }
}

// --- Tests ---

export async function selftest(quick: boolean, report: boolean): Promise<void> {
  const totalStart = performance.now();

  // Create isolated temp directory
  const testDir = mkdtempSync(join(tmpdir(), "lazy-selftest-"));

  // Reset process.exitCode between tests
  const resetExitCode = () => { process.exitCode = undefined; };

  console.log("\n  Lazy Fetch Self-Test");
  console.log("─".repeat(55));
  if (quick) console.log("  (quick mode — skipping git and yolo tests)");
  console.log(`  Test dir: ${testDir}\n`);

  // Init a git repo so commands that depend on git work
  if (!quick) {
    execSync("git init -q", { cwd: testDir });
    execSync("git commit --allow-empty -m 'init' -q", { cwd: testDir });
  }

  // Import modules dynamically (they use cwd-relative paths)
  const { ensureLazyDir } = await import("./store.js");
  const { plan, status, update, add, next, remove, resetPlan, check, read } = await import("./process.js");
  const { remember, recall, journal, snapshot } = await import("./persist.js");
  const { context, gather } = await import("./context.js");

  const results: TestResult[] = [];

  // --- init ---
  results.push(await runTest("init: creates .lazy/ directory", async () => {
    ensureLazyDir(testDir);
    assert(existsSync(join(testDir, ".lazy")), ".lazy/ not created");
  }));

  // --- plan ---
  results.push(await runTest("plan: creates plan from goal", async () => {
    resetExitCode();
    const output = await captureAsync(() => plan(testDir, "build a CLI tool"));
    assertIncludes(output, "Plan created", "plan");
    assert(existsSync(join(testDir, ".lazy", "plan.json")), "plan.json not written");
    const planData = JSON.parse(readFileSync(join(testDir, ".lazy", "plan.json"), "utf-8"));
    assert(planData.tasks.length === 5, `expected 5 tasks, got ${planData.tasks.length}`);
    assert(planData.goal === "build a CLI tool", `goal mismatch: ${planData.goal}`);
  }));

  results.push(await runTest("plan: refuses duplicate plan", async () => {
    resetExitCode();
    const output = await captureAsync(() => plan(testDir, "another plan"));
    assertIncludes(output, "Active plan", "duplicate plan");
  }));

  // --- status ---
  results.push(await runTest("status: shows plan progress", async () => {
    resetExitCode();
    const output = await captureAsync(() => status(testDir));
    assertIncludes(output, "build a CLI tool", "status");
    assertIncludes(output, "0/5 done", "status progress");
  }));

  // --- update ---
  results.push(await runTest("update: changes task status", async () => {
    resetExitCode();
    const output = await captureAsync(() => update(testDir, "1", "done"));
    assertIncludes(output, "done", "update");
  }));

  results.push(await runTest("update: done shorthand via numeric index", async () => {
    resetExitCode();
    const output = await captureAsync(() => update(testDir, "2", "done"));
    assertIncludes(output, "done", "done shorthand");
  }));

  // --- add ---
  results.push(await runTest("add: creates new task", async () => {
    resetExitCode();
    const output = await captureAsync(() => add(testDir, "write integration tests", "validate"));
    assertIncludes(output, "Added", "add");
    assertIncludes(output, "validate", "add phase");
  }));

  results.push(await runTest("add: auto-infers phase", async () => {
    resetExitCode();
    const output = await captureAsync(() => add(testDir, "document the API"));
    assertIncludes(output, "document", "add infer");
  }));

  // --- remove ---
  results.push(await runTest("remove: deletes task by name", async () => {
    resetExitCode();
    const output = await captureAsync(() => remove(testDir, "document the API"));
    assertIncludes(output, "Removed", "remove");
  }));

  // --- remember / recall ---
  results.push(await runTest("remember: stores key-value", async () => {
    resetExitCode();
    const output = await captureAsync(() => remember(testDir, "stack", "TypeScript + Node.js"));
    assertIncludes(output, "Stored", "remember");
    const mem = JSON.parse(readFileSync(join(testDir, ".lazy", "memory.json"), "utf-8"));
    assert(mem.stack.value === "TypeScript + Node.js", `memory mismatch: ${mem.stack?.value}`);
  }));

  results.push(await runTest("recall: retrieves stored value", async () => {
    resetExitCode();
    const output = await captureAsync(() => recall(testDir, "stack"));
    assertIncludes(output, "TypeScript", "recall");
  }));

  results.push(await runTest("recall: shows all when no key", async () => {
    resetExitCode();
    const output = await captureAsync(() => recall(testDir));
    assertIncludes(output, "stack", "recall all");
  }));

  results.push(await runTest("remember: updates existing key", async () => {
    resetExitCode();
    const output = await captureAsync(() => remember(testDir, "stack", "TypeScript + Bun"));
    assertIncludes(output, "Updated", "remember update");
  }));

  // --- journal ---
  results.push(await runTest("journal: appends entry", async () => {
    resetExitCode();
    const output = await captureAsync(() => journal(testDir, "decided to use selftest"));
    assertIncludes(output, "Journal entry", "journal write");
  }));

  results.push(await runTest("journal: reads entries", async () => {
    resetExitCode();
    const output = await captureAsync(() => journal(testDir));
    assertIncludes(output, "decided to use selftest", "journal read");
  }));

  // --- snapshot ---
  results.push(await runTest("snapshot: saves state", async () => {
    resetExitCode();
    const output = await captureAsync(() => snapshot(testDir, "test-snapshot"));
    assertIncludes(output, "Snapshot saved", "snapshot");
    assert(existsSync(join(testDir, ".lazy", "snapshots", "test-snapshot.json")), "snapshot file missing");
  }));

  // --- context ---
  if (!quick) {
    // Write a test file so context has something to index
    writeFileSync(join(testDir, "main.ts"), "export function hello(): string { return 'hi'; }\n");
    execSync("git add -A && git commit -m 'add main.ts' -q", { cwd: testDir });

    results.push(await runTest("context: builds repo map", async () => {
      resetExitCode();
      const output = await captureAsync(() => context(testDir));
      assertIncludes(output, "Repo Map", "context");
    }));

    results.push(await runTest("gather: finds relevant files", async () => {
      resetExitCode();
      const output = await captureAsync(() => gather(testDir, "hello function"));
      assertIncludes(output, "Gathering context", "gather");
    }));

    results.push(await runTest("check: runs health check", async () => {
      resetExitCode();
      const output = await captureAsync(() => check(testDir));
      assertIncludes(output, "Health Check", "check");
    }));

    results.push(await runTest("read: loads full state", async () => {
      resetExitCode();
      const output = await captureAsync(() => read(testDir));
      assertIncludes(output, "Getting up to date", "read");
      assertIncludes(output, "build a CLI tool", "read plan");
      assertIncludes(output, "stack", "read memory");
    }));
  }

  // --- yolo dry-run ---
  if (!quick) {
    const testPrdPath = join(testDir, "test-prd.md");
    // Use the bundled test PRD if available, otherwise create a minimal one
    const { dirname } = await import("path");
    const lazyFetchRoot = dirname(new URL(import.meta.url).pathname);
    const bundledPrd = join(lazyFetchRoot, "..", "templates", "test-prd.md");
    if (existsSync(bundledPrd)) {
      writeFileSync(testPrdPath, readFileSync(bundledPrd, "utf-8"));
    } else {
      writeFileSync(testPrdPath, `# Test App\n\n## Auth\n- User login\n- User signup\n\n## Dashboard\n- Activity feed\n- Quick actions\n`);
    }

    // Need to reset the plan first so yolo can create its own
    await resetPlan(testDir);

    results.push(await runTest("yolo dry-run: parses PRD into sprints", async () => {
      resetExitCode();
      const { yoloDryRun } = await import("./yolo.js");
      const output = await yoloDryRun(testDir, testPrdPath);
      assertIncludes(output, "sprint", "yolo dry-run");
      assertIncludes(output, "Sprint", "yolo dry-run sprints");
      // Should NOT have written yolo.json
      const yoloState = join(testDir, ".lazy", "yolo.json");
      if (existsSync(yoloState)) {
        const content = readFileSync(yoloState, "utf-8").trim();
        assert(content === "null" || content === "", "yolo dry-run should not write state");
      }
    }));
  }

  // --- plan reset ---
  results.push(await runTest("plan reset: archives and clears", async () => {
    resetExitCode();
    // Ensure there's a plan to reset (may have been reset by yolo test)
    const planFile = join(testDir, ".lazy", "plan.json");
    const planContent = readFileSync(planFile, "utf-8").trim();
    if (planContent === "null" || planContent === "") {
      await plan(testDir, "temporary plan");
    }
    const output = await captureAsync(() => resetPlan(testDir));
    assertIncludes(output, "cleared", "plan reset");
  }));

  // --- Report ---
  const totalMs = Math.round(performance.now() - totalStart);
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;

  console.log("");
  for (const r of results) {
    const icon = r.pass ? "✓" : "✗";
    const timing = `${r.ms}ms`;
    console.log(`  ${icon} ${r.name} (${timing})`);
    if (!r.pass && r.error) {
      console.log(`    ${r.error.split("\n")[0]}`);
    }
  }

  console.log("\n" + "─".repeat(55));
  console.log(`  Results: ${passed} passed, ${failed} failed (${totalMs}ms)`);

  if (report) {
    const reportData: SelftestReport = {
      timestamp: new Date().toISOString(),
      version: "0.1.0",
      results,
      passed,
      failed,
      totalMs,
    };
    const reportPath = join(process.cwd(), ".lazy", "selftest-report.json");
    try {
      writeFileSync(reportPath, JSON.stringify(reportData, null, 2) + "\n");
      console.log(`  Report: ${reportPath}`);
    } catch {
      // If .lazy doesn't exist in cwd, write to stdout
      console.log(`\n${JSON.stringify(reportData, null, 2)}`);
    }
  }

  // Cleanup
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // best effort
  }

  if (failed > 0) {
    process.exitCode = 1;
  }
}
