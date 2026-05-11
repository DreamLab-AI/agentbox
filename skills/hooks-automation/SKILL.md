---
name: Hooks Automation
description: Automated coordination, formatting, and learning from Claude Code operations using intelligent hooks with MCP integration. Includes pre/post task hooks, session management, Git integration, memory coordination, and neural pattern training for enhanced development workflows.
---

# Hooks Automation

Intelligent automation system that coordinates, validates, and learns from Claude Code operations through hooks integrated with MCP tools and neural pattern training.

See [EXAMPLES.md](EXAMPLES.md) for complete configuration templates, Git hook scripts, and real-world workflow examples.

## What This Skill Does

**Key Capabilities:**
- **Pre-Operation Hooks**: Validate, prepare, and auto-assign agents before operations
- **Post-Operation Hooks**: Format, analyze, and train patterns after operations
- **Session Management**: Persist state, restore context, generate summaries
- **Memory Coordination**: Synchronize knowledge across swarm agents via three-phase protocol
- **Git Integration**: Automated commit hooks with quality verification
- **Neural Training**: Continuous learning from successful patterns
- **MCP Integration**: Seamless coordination with swarm tools

## When Not To Use

- For one-off swarm orchestration without persistent hooks -- use the swarm-advanced skill instead
- For full development pipelines with quality gates -- use the build-with-quality skill instead
- For GitHub-specific CI/CD workflow authoring -- use the github-workflow-automation skill instead
- For standalone performance profiling and bottleneck detection -- use the performance-analysis skill instead
- For agent memory and pattern storage without hooks -- use the agentdb-memory-patterns skill instead

## Prerequisites

**Required:**
- Claude Flow CLI installed (`npm install -g claude-flow@alpha`)
- Claude Code with hooks enabled
- `.claude/settings.json` with hook configurations

**Optional:**
- MCP servers configured (claude-flow, ruv-swarm)
- Git repository for version control
- Testing framework for quality verification

## Quick Start

```bash
# Initialize with default hooks configuration
npx claude-flow init --hooks
```

Creates `.claude/settings.json` with pre-configured hooks and hook command documentation in `.claude/commands/hooks/`.

### Basic Hook Usage

```bash
npx claude-flow hook pre-task --description "Implement authentication"
npx claude-flow hook post-edit --file "src/auth.js" --memory-key "auth/login"
npx claude-flow hook session-end --session-id "dev-session" --export-metrics
```

### Minimal `settings.json`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{ "type": "command", "command": "npx claude-flow hook pre-edit --file '${tool.params.file_path}' --memory-key 'swarm/editor/current'" }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{ "type": "command", "command": "npx claude-flow hook pre-bash --command '${tool.params.command}'" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [{ "type": "command", "command": "npx claude-flow hook post-edit --file '${tool.params.file_path}' --memory-key 'swarm/editor/complete' --auto-format --train-patterns" }]
      },
      {
        "matcher": "^Bash$",
        "hooks": [{ "type": "command", "command": "npx claude-flow hook post-bash --command '${tool.params.command}' --update-metrics" }]
      }
    ]
  }
}
```

---

## Available Hooks

### Pre-Operation Hooks (run BEFORE the tool)

| Hook | Trigger | Key Options |
|------|---------|-------------|
| `pre-edit` | File write/edit | `--file`, `--auto-assign-agent`, `--validate-syntax`, `--backup-file` |
| `pre-bash` | Bash command | `--command`, `--check-safety`, `--estimate-resources` |
| `pre-task` | Task tool | `--description`, `--auto-spawn-agents`, `--load-memory`, `--optimize-topology` |
| `pre-search` | Grep tool | `--query`, `--check-cache`, `--optimize-query` |

**`pre-edit`** — Validate file, assign best agent, detect conflicts:
```bash
npx claude-flow hook pre-edit --file "src/auth.js" --auto-assign-agent --validate-syntax
npx claude-flow hook pre-edit --file "production.env" --backup-file --check-conflicts
```

**`pre-task`** — Spawn agents, load memory context, estimate complexity:
```bash
npx claude-flow hook pre-task --description "Implement user authentication" --auto-spawn-agents --load-memory
npx claude-flow hook pre-task --description "Refactor codebase" --optimize-topology
```

### Post-Operation Hooks (run AFTER the tool)

| Hook | Trigger | Key Options |
|------|---------|-------------|
| `post-edit` | File write/edit | `--file`, `--auto-format`, `--memory-key`, `--train-patterns`, `--validate-output` |
| `post-bash` | Bash command | `--command`, `--log-output`, `--update-metrics`, `--store-result` |
| `post-task` | Task tool | `--task-id`, `--analyze-performance`, `--store-decisions`, `--export-learnings` |
| `post-search` | Grep tool | `--query`, `--results`, `--cache-results`, `--train-patterns` |

**`post-edit`** — Auto-format, store to memory, train neural patterns:
```bash
npx claude-flow hook post-edit --file "src/components/Button.jsx" --auto-format
npx claude-flow hook post-edit --file "api/auth.js" --memory-key "auth/login" --train-patterns
```

**`post-task`** — Measure performance, record decisions, export learnings:
```bash
npx claude-flow hook post-task --task-id "auth-implementation" --analyze-performance --store-decisions
```

### MCP Integration Hooks

```bash
npx claude-flow hook mcp-initialized --swarm-id <id>   # Persist swarm topology to memory
npx claude-flow hook agent-spawned --agent-id <id>     # Register agent in coordination memory
npx claude-flow hook task-orchestrated --task-id <id>  # Track task progress
npx claude-flow hook neural-trained --pattern <name>   # Export trained patterns
npx claude-flow hook memory-sync --namespace <ns>      # Sync memory across agents
```

### Session Hooks

```bash
npx claude-flow hook session-start --session-id "dev-2024" --load-context
npx claude-flow hook session-restore --session-id "swarm-20241019" --restore-memory
npx claude-flow hook session-end --session-id "dev-2024" --export-metrics --generate-summary --cleanup-temp
npx claude-flow hook notify --message "Task complete" --level info --broadcast
```

---

## Which Hook to Use When

| Situation | Hook | Flag |
|-----------|------|------|
| About to edit a sensitive file | `pre-edit` | `--backup-file --check-conflicts` |
| Starting complex multi-file task | `pre-task` | `--auto-spawn-agents --load-memory` |
| Finished editing code file | `post-edit` | `--auto-format --train-patterns` |
| Completed a task | `post-task` | `--analyze-performance --store-decisions` |
| Starting new session | `session-start` | `--load-context` |
| Ending session | `session-end` | `--export-metrics --generate-summary` |
| Agent to agent handoff | `notify` | `--broadcast` + `session-restore` on receiver |
| Before git commit | Git `pre-commit` | Run `pre-edit` per staged file |
| Before git push | Git `pre-push` | Run tests + `session-end --generate-report` |

---

## Memory Coordination

All hooks follow a three-phase status→progress→complete pattern using `mcp__claude-flow__memory_usage`. Namespace: `coordination`. Keys follow the pattern `swarm/hooks/<hook-name>/<phase>`.

Full protocol code with all three phases: see [EXAMPLES.md](EXAMPLES.md#memory-coordination-protocol).

---

## Performance Tips

1. Keep hooks under 100ms — use `--async` for heavy operations
2. Cache aggressively — `--cache-results`, `--check-cache`
3. Batch related operations — combine memory writes
4. Set timeouts explicitly — `"timeout": 3000` in settings.json
5. Use `continueOnError: true` for non-blocking hooks

---

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| Hooks not executing | Bad `settings.json` syntax or wrong matcher | Enable debug: `export CLAUDE_FLOW_DEBUG=true`; run `npx claude-flow hook validate-config` |
| Hook timeouts | Heavy sync operations | Add `"async": true` or increase `"timeout"` |
| Memory issues | Missing TTL, namespace collisions | Set TTL; use `npx claude-flow memory usage` to audit |
| Performance problems | Blocking operations, no caching | Profile with `--debug`; add `--check-cache` |

```bash
# Debug mode
export CLAUDE_FLOW_DEBUG=true
npx claude-flow hook pre-edit --file "test.js" --debug
cat .claude-flow/logs/hooks-$(date +%Y-%m-%d).log
npx claude-flow hook validate-config
```

---

## Benefits

- Automatic agent assignment per file type
- Consistent language-specific auto-formatting (Prettier, Black, gofmt)
- Continuous neural pattern learning
- Cross-session memory persistence
- Comprehensive performance metrics
- Quality gates before commits/pushes

---

## Integration with Other Skills

- **SPARC Methodology** - Hooks enhance SPARC workflows
- **Pair Programming** - Automated quality in pairing sessions
- **Verification Quality** - Truth-score validation in hooks
- **GitHub Workflows** - Git integration for commits/PRs
- **Performance Analysis** - Metrics collection in hooks
- **Swarm Advanced** - Multi-agent coordination via hooks

---

## Related Commands

```bash
npx claude-flow init --hooks          # Initialize hooks system
npx claude-flow hook --list           # List available hooks
npx claude-flow hook --test <hook>    # Test specific hook
npx claude-flow memory usage          # Manage memory
npx claude-flow agent spawn           # Spawn agents
npx claude-flow swarm init            # Initialize swarm
```
