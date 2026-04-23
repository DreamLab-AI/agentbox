#!/usr/bin/env node

import { plan, planFromFile, status, update, check, add, read, next, remove, resetPlan } from "./process.js";
import { remember, recall, journal, snapshot } from "./persist.js";
import { context, gather, watch, claudemd } from "./context.js";
import { blueprintRun, blueprintList, blueprintShow } from "./blueprint.js";
import { findLazyRoot, ensureLazyDir } from "./store.js";
import { selftest } from "./selftest.js";
import { secure } from "./secure.js";

const HELP = `
lazy — CLI companion for Claude Code
       minimum effort, maximum result.

  The Loop (read → plan → implement → validate → document):
    lazy read                  Get up to date — git, plan, memory
    lazy plan <goal>           Break a goal into phased steps
    lazy plan --file <file>    Import tasks from a markdown file
    lazy add <task> [phase]    Add a task to the current plan
    lazy status                Where are we? What's next?
    lazy update <task> <status>  Mark progress (todo|active|done|stuck)
    lazy done <task>           Shorthand for update <task> done
    lazy stuck <task>          Shorthand for update <task> stuck
    lazy next                  Show next task and gather context for it
    lazy check                 Validate — tests, lint, types, plan progress

  Context:
    lazy context               Repo map with symbol index
    lazy context <query>       Find files, content, and symbols
    lazy gather <task>         Pre-hydrate context for a Claude Code session
    lazy watch                 Learn which files matter from git history
    lazy claudemd              Generate context file for Claude Code

  Blueprints:
    lazy bp list               Show available blueprints
    lazy bp show <name>        Show blueprint steps
    lazy bp run <name> <input> Execute a blueprint

  Persist:
    lazy remember <key> <val>  Store a fact across sessions
    lazy recall [key]          Retrieve stored knowledge
    lazy journal [entry]       Append to / read decision log
    lazy snapshot [name]       Save current project state

  Yolo (autonomous mode):
    lazy yolo <prd-file>       Parse PRD, sprint plan, execute autonomously
    lazy yolo <prd> --dry-run  Preview sprint plan without writing state
    lazy yolo status           Show yolo mode progress
    lazy yolo report           Run scorecard: process quality, build quality
    lazy yolo reset            Clear yolo state and start over

  Security:
    lazy secure                Full security audit of the codebase
    lazy secure --gate         Quick check (critical + high only, for CI/yolo gates)

  Validate:
    lazy selftest              Run all self-validation checks
    lazy selftest --quick      Skip git and yolo tests
    lazy selftest --report     Output JSON metrics for tracking

  Other:
    lazy init                  Initialize .lazy/ in current project
    lazy init --update         Refresh hooks, commands, blueprints to latest
    lazy upgrade               Update lazy-fetch itself from GitHub
    lazy help                  Show this help
`;

async function main() {
  const [cmd, ...args] = process.argv.slice(2);

  if (!cmd || cmd === "help" || cmd === "--help" || cmd === "-h") {
    console.log(HELP.trim());
    return;
  }

  if (cmd === "init") {
    const forceUpdate = args.includes("--update") || args.includes("-u");
    const cwd = process.cwd();
    const dir = ensureLazyDir(cwd);

    const { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, copyFileSync, chmodSync } = await import("fs");
    const { join, dirname } = await import("path");
    const lazyFetchRoot = dirname(new URL(import.meta.url).pathname);
    const projectRoot = join(lazyFetchRoot, "..");

    if (forceUpdate) {
      console.log("Updating lazy-fetch scaffolding...");
    } else {
      console.log(`Initialized .lazy/ at ${dir}`);
    }

    // --- Scaffold .lazy/ internal structure ---

    const lazySubdirs = ["context", "snapshots", "runs"];
    for (const sub of lazySubdirs) {
      const subPath = join(dir, sub);
      if (!existsSync(subPath)) mkdirSync(subPath, { recursive: true });
    }

    // Seed files — only create if missing (never overwrite user data)
    const seedFiles: Record<string, string> = {
      "memory.json": JSON.stringify({}, null, 2) + "\n",
      "journal.md": "# Lazy Fetch Journal\n",
      "plan.json": "null\n",
      "plan.md": "",
      "CONTEXT.md": "",
      "context/symbols.json": JSON.stringify({ built: null, symbolCount: 0, symbols: [] }, null, 2) + "\n",
      "context/access.json": JSON.stringify({}, null, 2) + "\n",
    };

    for (const [file, content] of Object.entries(seedFiles)) {
      const filePath = join(dir, file);
      if (!existsSync(filePath)) {
        writeFileSync(filePath, content, "utf-8");
      }
    }
    console.log("  .lazy/ structure ready");

    // --- Scaffold project-level integration files ---
    // With --update: always overwrite hooks, blueprints, commands, settings, mcp
    // Without: only create if missing

    // Copy hooks (always overwrite on --update)
    const hooksDir = join(cwd, "hooks");
    const srcHooks = join(projectRoot, "hooks");
    if (existsSync(srcHooks)) {
      if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });
      if (forceUpdate || !readdirSync(hooksDir).some(f => f.endsWith(".sh"))) {
        for (const f of readdirSync(srcHooks)) {
          copyFileSync(join(srcHooks, f), join(hooksDir, f));
          chmodSync(join(hooksDir, f), 0o755);
        }
        console.log(forceUpdate ? "  Updated hooks/" : "  Copied hooks/");
      }
    }

    // Copy blueprints (always overwrite on --update)
    const bpDir = join(cwd, "blueprints");
    const srcBp = join(projectRoot, "blueprints");
    if (existsSync(srcBp)) {
      if (!existsSync(bpDir)) mkdirSync(bpDir, { recursive: true });
      const yamlFiles = readdirSync(srcBp).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"));
      if (forceUpdate || !existsSync(join(bpDir, yamlFiles[0] ?? ""))) {
        for (const f of yamlFiles) {
          copyFileSync(join(srcBp, f), join(bpDir, f));
        }
        console.log(forceUpdate ? "  Updated blueprints/" : "  Copied blueprints/");
      }
    }

    // .claude/settings.json (always overwrite on --update)
    const claudeDir = join(cwd, ".claude");
    const settingsPath = join(claudeDir, "settings.json");
    if (forceUpdate || !existsSync(settingsPath)) {
      const srcSettings = join(projectRoot, ".claude", "settings.json");
      if (existsSync(srcSettings)) {
        mkdirSync(claudeDir, { recursive: true });
        writeFileSync(settingsPath, readFileSync(srcSettings, "utf-8"));
        console.log(forceUpdate ? "  Updated .claude/settings.json" : "  Created .claude/settings.json");
      }
    }

    // .claude/commands/ (always overwrite on --update)
    const commandsDir = join(claudeDir, "commands");
    const srcCommands = join(projectRoot, ".claude", "commands");
    if (existsSync(srcCommands)) {
      if (!existsSync(commandsDir)) mkdirSync(commandsDir, { recursive: true });
      if (forceUpdate || readdirSync(commandsDir).length === 0) {
        for (const f of readdirSync(srcCommands)) {
          copyFileSync(join(srcCommands, f), join(commandsDir, f));
        }
        console.log(forceUpdate ? "  Updated .claude/commands/" : "  Created .claude/commands/");
      }
    }

    // .mcp.json (always overwrite on --update)
    const mcpPath = join(cwd, ".mcp.json");
    if (forceUpdate || !existsSync(mcpPath)) {
      const mcpConfig = {
        mcpServers: {
          "lazy-fetch": {
            command: "node",
            args: ["dist/mcp-server.js"],
            cwd: projectRoot,
          },
        },
      };
      writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n");
      console.log(forceUpdate ? "  Updated .mcp.json" : "  Created .mcp.json");
    }

    // CLAUDE.md — inject lazy-fetch section into user's project
    const claudeMdPath = join(cwd, "CLAUDE.md");
    const templatePath = join(projectRoot, "templates", "CLAUDE_PROJECT.md");
    if (existsSync(templatePath)) {
      const template = readFileSync(templatePath, "utf-8");
      const SECTION_START = "## Lazy Fetch (CLI Companion)";

      if (!existsSync(claudeMdPath)) {
        // No CLAUDE.md — create one with the template
        writeFileSync(claudeMdPath, template, "utf-8");
        console.log("  Created CLAUDE.md with lazy-fetch guidance");
      } else {
        const existing = readFileSync(claudeMdPath, "utf-8");
        if (!existing.includes("Lazy Fetch")) {
          // CLAUDE.md exists but has no lazy-fetch section — append
          const separator = existing.endsWith("\n") ? "\n" : "\n\n";
          writeFileSync(claudeMdPath, existing + separator + template, "utf-8");
          console.log("  Appended lazy-fetch section to CLAUDE.md");
        } else if (forceUpdate) {
          // Replace existing lazy-fetch section with latest template
          const startIdx = existing.indexOf(SECTION_START);
          // Find the next ## heading after the lazy-fetch section (or end of file)
          const afterStart = existing.indexOf("\n## ", startIdx + SECTION_START.length);
          const before = existing.substring(0, startIdx);
          const after = afterStart !== -1 ? existing.substring(afterStart + 1) : "";
          const merged = after
            ? before + template + (template.endsWith("\n") ? "\n" : "\n\n") + after
            : before + template;
          writeFileSync(claudeMdPath, merged, "utf-8");
          console.log("  Updated lazy-fetch section in CLAUDE.md");
        } else {
          console.log("  CLAUDE.md already contains lazy-fetch section (skip)");
        }
      }
    }

    if (!forceUpdate) {
      console.log(`
  Project structure:
    .lazy/
      plan.json, memory.json, journal.md, CONTEXT.md
      context/   snapshots/   runs/
    hooks/               Hook scripts for Claude Code events
    blueprints/          YAML workflow definitions
    .claude/
      settings.json      Hook configuration
      commands/           Slash commands (/project:read, etc.)
    .mcp.json            MCP server config
    CLAUDE.md            Lazy-fetch guidance for Claude Code

  Run 'lazy read' to get started.
  After updating lazy-fetch, run 'lazy init --update' to refresh.`);
    } else {
      console.log("\n  All scaffolding updated to latest version.");
      console.log("  Your data (.lazy/plan, memory, journal) was preserved.");
    }
    return;
  }

  if (cmd === "upgrade") {
    const { dirname } = await import("path");
    const { execSync } = await import("child_process");
    const lazyFetchRoot = dirname(new URL(import.meta.url).pathname);
    const projectRoot = dirname(lazyFetchRoot);

    console.log("\n  Upgrading lazy-fetch...");
    console.log("─".repeat(55));
    try {
      const branch = execSync("git branch --show-current", { cwd: projectRoot, encoding: "utf-8" }).trim();
      console.log(`  Pulling latest from ${branch}...`);
      execSync("git pull", { cwd: projectRoot, encoding: "utf-8", stdio: "pipe" });
      console.log("  Installing dependencies...");
      execSync("npm install", { cwd: projectRoot, encoding: "utf-8", stdio: "pipe" });
      console.log("  Building...");
      execSync("npm run build", { cwd: projectRoot, encoding: "utf-8", stdio: "pipe" });
      console.log("\n  lazy-fetch upgraded!");
      console.log("  Run 'lazy init --update' in your projects to refresh hooks/commands.");
    } catch (err: any) {
      console.error(`  Upgrade failed: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  const root = findLazyRoot(process.cwd()) ?? process.cwd();

  switch (cmd) {
    // The Loop
    case "read":
      await read(root);
      break;
    case "plan":
      if (args[0] === "--reset") { await resetPlan(root); break; }
      if (args[0] === "--file" || args[0] === "-f") {
        await planFromFile(root, args[1]);
        break;
      }
      await plan(root, args.join(" "));
      break;
    case "add": {
      const validPhases = ["read", "plan", "implement", "validate", "document"];
      const lastArg = args[args.length - 1];
      const hasPhase = args.length > 1 && validPhases.includes(lastArg);
      const title = hasPhase ? args.slice(0, -1).join(" ") : args.join(" ");
      const phase = hasPhase ? lastArg : undefined;
      await add(root, title, phase);
      break;
    }
    case "status":
      await status(root);
      break;
    case "update":
      await update(root, args[0], args[1]);
      break;
    case "done":
      await update(root, args[0], "done");
      break;
    case "stuck":
      await update(root, args[0], "stuck");
      break;
    case "next":
      await next(root);
      break;
    case "remove":
    case "rm":
      await remove(root, args.join(" "));
      break;
    case "check":
      await check(root);
      break;

    // Context
    case "context":
      await context(root, args.join(" ") || undefined);
      break;
    case "gather":
      await gather(root, args.join(" "));
      break;
    case "watch":
      await watch(root);
      break;
    case "claudemd":
      await claudemd(root);
      break;

    // Blueprints
    case "bp":
    case "blueprint": {
      const [sub, ...bpArgs] = args;
      if (!sub || sub === "list") {
        console.log(await blueprintList(root));
      } else if (sub === "show") {
        console.log(await blueprintShow(root, bpArgs[0]));
      } else if (sub === "run") {
        console.log(await blueprintRun(root, bpArgs[0], bpArgs.slice(1).join(" ")));
      } else {
        // Shorthand: lazy bp fix-bug "the description"
        console.log(await blueprintRun(root, sub, bpArgs.join(" ")));
      }
      break;
    }

    // Persist
    case "remember":
      await remember(root, args[0], args.slice(1).join(" "));
      break;
    case "recall":
      await recall(root, args[0]);
      break;
    case "journal":
      await journal(root, args.length ? args.join(" ") : undefined);
      break;
    case "snapshot":
      await snapshot(root, args[0]);
      break;

    // Security
    case "secure":
    case "security": {
      const gate = args.includes("--gate") || args.includes("-g");
      await secure(root, gate);
      break;
    }

    // Selftest
    case "selftest": {
      const quick = args.includes("--quick") || args.includes("-q");
      const report = args.includes("--report") || args.includes("-r");
      await selftest(quick, report);
      break;
    }

    // Yolo
    case "yolo": {
      const [sub] = args;
      if (sub === "status") {
        const { yoloStatus } = await import("./yolo.js");
        console.log(await yoloStatus(root));
      } else if (sub === "report") {
        const { yoloReport } = await import("./yolo.js");
        console.log(await yoloReport(root));
      } else if (sub === "reset") {
        const { yoloReset } = await import("./yolo.js");
        await yoloReset(root);
      } else if (args.includes("--dry-run")) {
        const prdFile = args.find(a => a !== "--dry-run");
        if (prdFile) {
          const { yoloDryRun } = await import("./yolo.js");
          console.log(await yoloDryRun(root, prdFile));
        } else {
          console.error("Usage: lazy yolo <prd-file> --dry-run");
          process.exitCode = 1;
        }
      } else if (sub) {
        const { yoloStart } = await import("./yolo.js");
        console.log(await yoloStart(root, sub));
      } else {
        console.error("Usage: lazy yolo <prd-file>");
        console.error("       lazy yolo status");
        console.error("       lazy yolo reset");
        process.exitCode = 1;
      }
      break;
    }

    default:
      console.error(`Unknown command: ${cmd}\nRun 'lazy help' for usage.`);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
