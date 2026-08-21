# File Structure

Full layout of the lazy-fetch skill directory.

```
skills/lazy-fetch/
  SKILL.md              This documentation
  references/           Deep-dive docs (context engine, security scanner, yolo mode, this tree)
  mcp-config.json       MCP server configuration for Claude Code
  mcp-server/
    src/                TypeScript source (unmodified from upstream)
      mcp-server.ts     MCP server entry point (25 tools)
      cli.ts            CLI entry point
      store.ts          .lazy/ directory I/O helpers
      process.ts        Plan management (plan, status, update, check, read)
      persist.ts        Memory, journal, snapshot
      context.ts        Symbol extraction, file search, repo map
      blueprint.ts      YAML blueprint parser and runner
      secure.ts         23-rule security scanner
      yolo.ts           PRD-to-sprints autonomous execution
      selftest.ts       Self-validation test suite
    dist/               Compiled JavaScript (ready to run)
    package.json        Dependencies
    tsconfig.json       TypeScript configuration
  hooks/
    session-start.sh    SessionStart -- inject plan, memory, git into context
    session-stop.sh     Stop -- auto-journal changes, update access patterns
    post-edit-check.sh  PostToolUse -- typecheck after code edits
    pre-compact.sh      PreCompact -- snapshot state before compaction
    detect-check.sh     Auto-detect project typecheck command
    detect-test.sh      Auto-detect project test runner
  blueprints/
    fix-bug.yaml        Bug fix workflow
    add-feature.yaml    Feature development workflow
    experiment.yaml     Experimental change with rollback
    review-code.yaml    Code review workflow
    improve.yaml        Self-improvement loop (AutoResearch pattern)
  commands/             15 slash command definitions (.md)
  tools/
    install.sh          Global installation script
    test.sh             Smoke test suite
    ruvector-bridge.sh  Memory sync to RuVector
```
