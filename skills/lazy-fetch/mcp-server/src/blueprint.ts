import { execSync } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join, relative } from "path";
import { parse as parseYaml } from "yaml";
import { ensureLazyDir, readLazyJson, writeLazyJson, writeLazyFile } from "./store.js";

// --- Types ---

interface BlueprintStep {
  name: string;
  type: "run" | "prompt" | "gate" | "gather" | "remember";
  // run: shell command
  command?: string;
  // prompt: instruction for Claude Code
  prompt?: string;
  // gate: condition check
  gate?: {
    on_fail: "retry" | "stop" | "skip";
    max_retries?: number;
  };
  // gather: task description for context
  task?: string;
  // remember: key-value
  key?: string;
  value?: string;
}

interface Blueprint {
  name: string;
  description: string;
  input?: string; // description of expected input
  steps: BlueprintStep[];
}

interface BlueprintRun {
  blueprint: string;
  input: string;
  started: string;
  currentStep: number;
  status: "running" | "completed" | "failed" | "waiting";
  stepResults: StepResult[];
}

interface StepResult {
  name: string;
  type: string;
  status: "done" | "failed" | "skipped" | "waiting";
  output?: string;
  retries?: number;
}

// --- YAML parsing with validation ---

function parseBlueprint(content: string): Blueprint {
  let raw: any;
  try {
    raw = parseYaml(content);
  } catch (err: any) {
    throw new Error(`Invalid YAML: ${err.message}`);
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("Blueprint must be a YAML object");
  }
  if (!raw.name || typeof raw.name !== "string") {
    throw new Error("Blueprint missing 'name' (string)");
  }
  if (!raw.description || typeof raw.description !== "string") {
    throw new Error("Blueprint missing 'description' (string)");
  }
  if (!Array.isArray(raw.steps) || raw.steps.length === 0) {
    throw new Error("Blueprint must have a non-empty 'steps' array");
  }

  const validTypes = new Set(["run", "prompt", "gate", "gather", "remember"]);
  const steps: BlueprintStep[] = [];

  for (let i = 0; i < raw.steps.length; i++) {
    const s = raw.steps[i];
    if (!s.name) throw new Error(`Step ${i + 1} missing 'name'`);
    if (!s.type || !validTypes.has(s.type)) {
      throw new Error(`Step "${s.name}" has invalid type "${s.type}". Valid: ${[...validTypes].join(", ")}`);
    }

    const step: BlueprintStep = {
      name: String(s.name),
      type: s.type,
    };

    if (s.command != null) step.command = String(s.command);
    if (s.prompt != null) step.prompt = String(s.prompt);
    if (s.task != null) step.task = String(s.task);
    if (s.key != null) step.key = String(s.key);
    if (s.value != null) step.value = String(s.value);

    if (s.gate && typeof s.gate === "object") {
      step.gate = {
        on_fail: s.gate.on_fail ?? "stop",
        max_retries: s.gate.max_retries != null ? Number(s.gate.max_retries) : undefined,
      };
    }

    steps.push(step);
  }

  return {
    name: raw.name,
    description: raw.description,
    input: raw.input ? String(raw.input) : undefined,
    steps,
  };
}

// --- Template substitution ---

function substitute(template: string, vars: Record<string, string>): string {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => vars[key] ?? `\${${key}}`);
}

// --- Runner ---

function loadBlueprintFile(root: string, nameOrPath: string): Blueprint {
  // Try exact path, then blueprints/, then .lazy/blueprints/
  const candidates = [
    nameOrPath,
    join(root, "blueprints", nameOrPath),
    join(root, "blueprints", `${nameOrPath}.yaml`),
    join(root, ".lazy", "blueprints", nameOrPath),
    join(root, ".lazy", "blueprints", `${nameOrPath}.yaml`),
    join(root, "blueprints", `${nameOrPath}.yml`),
    join(root, ".lazy", "blueprints", `${nameOrPath}.yml`),
  ];

  for (const p of candidates) {
    if (existsSync(p)) {
      return parseBlueprint(readFileSync(p, "utf-8"));
    }
  }

  throw new Error(`Blueprint not found: ${nameOrPath}\nSearched: ${candidates.join(", ")}`);
}

export async function blueprintRun(root: string, nameOrPath: string, input: string): Promise<string> {
  const bp = loadBlueprintFile(root, nameOrPath);
  const vars: Record<string, string> = { input, name: bp.name };

  ensureLazyDir(root);

  const run: BlueprintRun = {
    blueprint: bp.name,
    input,
    started: new Date().toISOString(),
    currentStep: 0,
    status: "running",
    stepResults: [],
  };

  const output: string[] = [];
  output.push(`\n  Blueprint: ${bp.name}`);
  output.push(`  ${bp.description}`);
  output.push(`  Input: "${input}"`);
  output.push("─".repeat(55));

  for (let i = 0; i < bp.steps.length; i++) {
    const step = bp.steps[i];
    run.currentStep = i;

    output.push(`\n  Step ${i + 1}/${bp.steps.length}: ${step.name} (${step.type})`);

    const result: StepResult = { name: step.name, type: step.type, status: "done" };

    switch (step.type) {
      case "run": {
        const cmd = substitute(step.command ?? "", vars);
        output.push(`  $ ${cmd}`);
        const maxRetries = step.gate?.max_retries ?? 0;
        let retries = 0;
        let success = false;

        while (retries <= maxRetries) {
          try {
            const cmdOutput = execSync(cmd, {
              cwd: root,
              encoding: "utf-8",
              timeout: 120000,
              stdio: ["pipe", "pipe", "pipe"],
            });
            const trimmed = cmdOutput.trim();
            if (trimmed) {
              output.push(`  ${trimmed.split("\n").slice(0, 10).join("\n  ")}`);
              vars[`step_${i}_output`] = trimmed;
            }
            output.push(`  ✓ ${step.name}: passed`);
            success = true;
            break;
          } catch (err: any) {
            retries++;
            const errOutput = (err.stdout || err.stderr || err.message).trim();
            vars[`step_${i}_error`] = errOutput;

            if (retries <= maxRetries) {
              output.push(`  ✗ Failed (attempt ${retries}/${maxRetries + 1}), retrying...`);
              result.retries = retries;
            } else if (step.gate?.on_fail === "skip") {
              output.push(`  ⚠ ${step.name}: failed, skipping`);
              result.status = "skipped";
              success = true; // continue execution
            } else if (step.gate?.on_fail === "stop") {
              output.push(`  ✗ ${step.name}: failed, stopping blueprint`);
              result.status = "failed";
              result.output = errOutput;
              run.stepResults.push(result);
              run.status = "failed";
              saveBlueprintRun(root, run);
              output.push(`\n  Blueprint FAILED at step: ${step.name}`);
              return output.join("\n");
            } else {
              // retry exhausted
              output.push(`  ✗ ${step.name}: failed after ${retries} retries`);
              result.status = "failed";
              result.output = errOutput;
              run.stepResults.push(result);
              run.status = "failed";
              saveBlueprintRun(root, run);
              output.push(`\n  Blueprint FAILED at step: ${step.name}`);
              return output.join("\n");
            }
          }
        }

        if (!success) {
          result.status = "failed";
        }
        break;
      }

      case "prompt": {
        // Agentic step — return the prompt for Claude Code to act on
        const prompt = substitute(step.prompt ?? "", vars);
        output.push(`  → ${prompt}`);
        result.status = "waiting";
        result.output = prompt;
        // Store the prompt for MCP tool to return
        vars[`step_${i}_prompt`] = prompt;
        break;
      }

      case "gather": {
        const task = substitute(step.task ?? input, vars);
        output.push(`  Gathering context for: "${task}"`);
        // Import dynamically to avoid circular deps
        const { gather } = await import("./context.js");
        const lines: string[] = [];
        const origLog = console.log;
        console.log = (...args: any[]) => lines.push(args.map(String).join(" "));
        await gather(root, task);
        console.log = origLog;
        const gatherOutput = lines.join("\n");
        output.push(`  ${lines.slice(0, 10).join("\n  ")}`);
        vars[`step_${i}_output`] = gatherOutput;
        break;
      }

      case "remember": {
        const key = substitute(step.key ?? "", vars);
        const value = substitute(step.value ?? "", vars);
        if (key && value) {
          const { remember } = await import("./persist.js");
          await remember(root, key, value);
          output.push(`  Stored: ${key} → ${value}`);
        }
        break;
      }

      case "gate": {
        const cmd = substitute(step.command ?? "true", vars);
        output.push(`  Checking: ${cmd}`);
        try {
          execSync(cmd, { cwd: root, encoding: "utf-8", timeout: 60000 });
          output.push(`  ✓ Gate passed`);
        } catch {
          const action = step.gate?.on_fail ?? "stop";
          if (action === "skip") {
            output.push(`  ⚠ Gate failed, skipping`);
            result.status = "skipped";
          } else {
            output.push(`  ✗ Gate failed, stopping`);
            result.status = "failed";
            run.stepResults.push(result);
            run.status = "failed";
            saveBlueprintRun(root, run);
            return output.join("\n");
          }
        }
        break;
      }
    }

    run.stepResults.push(result);
  }

  run.status = "completed";
  saveBlueprintRun(root, run);
  output.push("\n" + "─".repeat(55));
  output.push(`  Blueprint "${bp.name}" completed.`);

  // Collect all prompt steps for Claude Code to act on
  const prompts = run.stepResults.filter((r) => r.status === "waiting" && r.output);
  if (prompts.length > 0) {
    output.push("\n  Agentic steps for Claude Code:");
    for (const p of prompts) {
      output.push(`    → ${p.output}`);
    }
  }

  return output.join("\n");
}

function saveBlueprintRun(root: string, run: BlueprintRun): void {
  const timestamp = run.started.replace(/[:.]/g, "-").slice(0, 19);
  writeLazyJson(root, run, "runs", `${run.blueprint}-${timestamp}.json`);
}

// --- List available blueprints ---

export async function blueprintList(root: string): Promise<string> {
  const dirs = [
    join(root, "blueprints"),
  ];

  const output: string[] = ["\n  Available blueprints:", "─".repeat(55)];

  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    const files = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
    for (const file of files) {
      try {
        const bp = parseBlueprint(readFileSync(join(dir, file), "utf-8"));
        const stepTypes = bp.steps.map((s) =>
          s.type === "run" ? "⚙" : s.type === "prompt" ? "🤖" : s.type === "gate" ? "🚦" : "📎"
        ).join("");
        output.push(`  ${bp.name.padEnd(20)} ${stepTypes}  ${bp.description}`);
      } catch (err: any) {
        output.push(`  ${file.padEnd(20)} (error: ${err.message.slice(0, 50)})`);
      }
    }
  }

  if (output.length === 2) {
    output.push("  No blueprints found in blueprints/");
    output.push("  Create .yaml files there to define workflows.");
  }

  output.push("");
  output.push("  Legend: ⚙ = run (deterministic)  🤖 = prompt (agentic)  🚦 = gate  📎 = other");

  return output.join("\n");
}

// --- Show blueprint details ---

export async function blueprintShow(root: string, nameOrPath: string): Promise<string> {
  const bp = loadBlueprintFile(root, nameOrPath);
  const output: string[] = [];

  output.push(`\n  Blueprint: ${bp.name}`);
  output.push(`  ${bp.description}`);
  if (bp.input) output.push(`  Input: ${bp.input}`);
  output.push("─".repeat(55));

  for (let i = 0; i < bp.steps.length; i++) {
    const s = bp.steps[i];
    const icon = s.type === "run" ? "⚙" : s.type === "prompt" ? "🤖" : s.type === "gate" ? "🚦" : "📎";
    output.push(`  ${i + 1}. ${icon} ${s.name} (${s.type})`);

    if (s.command) output.push(`     $ ${s.command}`);
    if (s.prompt) output.push(`     → ${s.prompt}`);
    if (s.task) output.push(`     🔍 ${s.task}`);
    if (s.gate) output.push(`     on_fail: ${s.gate.on_fail}${s.gate.max_retries ? `, max_retries: ${s.gate.max_retries}` : ""}`);
  }

  return output.join("\n");
}
