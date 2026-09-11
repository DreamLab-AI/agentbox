# Hooks Automation — Configuration Templates and Examples

Reference material extracted from `SKILL.md`. Every `claude-flow hooks`
invocation below uses a real subcommand and real flags, verified against
`claude-flow hooks --help` / `claude-flow hooks <cmd> --help` on 2026-09-09.
If a flag you need is not shown, check the live `--help` output rather than
assuming it exists -- the binary is the source of truth, not this file.

---

## Complete Hook Configuration (`settings.json`)

```json
{
  "hooks": {
    "enabled": true,
    "timeout": 5000,

    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks pre-edit -f '${tool.params.file_path}' -o update",
            "timeout": 3000,
            "continueOnError": true
          }
        ]
      },
      {
        "matcher": "^Task$",
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks pre-task -d '${tool.params.task}'"
          }
        ]
      },
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks pre-command -c '${tool.params.command}'"
          }
        ]
      }
    ],

    "PostToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks post-edit -f '${tool.params.file_path}' --success true"
          }
        ]
      },
      {
        "matcher": "^Task$",
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks post-task -i '${result.task_id}' --success true"
          }
        ]
      },
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks post-command -c '${tool.params.command}' --success true"
          }
        ]
      }
    ],

    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks session-restore -i '${session.id}'"
          }
        ]
      }
    ],

    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "claude-flow hooks session-end"
          }
        ]
      }
    ]
  }
}
```

Note: `SessionStart` is not itself a `claude-flow hooks` subcommand -- it is
the Claude Code event name in `settings.json`. `session-restore` is the
real subcommand to invoke on it (the older `session-start` subcommand is
deprecated in favour of `session-restore`).

---

## MCP Tool Calls Behind the Hooks

The hook subcommands above internally call real `mcp__claude-flow__*` tools.
These examples show what a custom hook script (or a direct agent call) looks
like when it talks to those tools without going through the CLI.

### Task routing and context

```javascript
mcp__claude-flow__agent_spawn({
  agentType: "backend-dev",
  capabilities: ["api", "database", "testing"]
})

mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/task/api-build/context",
  namespace: "coordination",
  value: JSON.stringify({
    description: "Build REST API",
    agents: ["backend-dev"],
    started: Date.now()
  })
})
```

### Post-edit pattern learning

```javascript
mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/edits/api/auth.js",
  namespace: "coordination",
  value: JSON.stringify({
    file: "api/auth.js",
    timestamp: Date.now(),
    changes: { added: 45, removed: 12 }
  })
})

mcp__claude-flow__neural_patterns({
  action: "learn",
  operation: "coordination",
  metadata: { source: "edit-pattern", file: "api/auth.js" }
})
```

### Session-end persistence

```javascript
mcp__claude-flow__memory_usage({
  action: "store",
  key: "session-state/dev-2026",
  namespace: "sessions",
  value: JSON.stringify(sessionState),
  ttl: 2592000
})

mcp__claude-flow__swarm_status({ swarmId: "current" })
```

---

## Memory Coordination Pattern

A convention, not an automatic hook behaviour: apply it inside a custom
hook script if you want a visible status -> progress -> complete trail for
a long-running operation.

### Phase 1: STATUS — operation starts

```javascript
mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/hooks/pre-edit/status",
  namespace: "coordination",
  value: JSON.stringify({ status: "running", hook: "pre-edit", file: "src/auth.js", timestamp: Date.now() })
})
```

### Phase 2: PROGRESS — operation in flight

```javascript
mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/hooks/pre-edit/progress",
  namespace: "coordination",
  value: JSON.stringify({ progress: 50, action: "validating syntax", file: "src/auth.js" })
})
```

### Phase 3: COMPLETE — operation finishes

```javascript
mcp__claude-flow__memory_usage({
  action: "store",
  key: "swarm/hooks/pre-edit/complete",
  namespace: "coordination",
  value: JSON.stringify({ status: "complete", result: "success", agent_assigned: "backend-dev" })
})
```

---

## Git Hook Scripts

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit (or managed via husky)

FILES=$(git diff --cached --name-only --diff-filter=ACM)

for FILE in $FILES; do
  claude-flow hooks pre-edit -f "$FILE"
  claude-flow hooks post-edit -f "$FILE" --success true
done

npm test
exit $?
```

### Post-Commit Hook

```bash
#!/bin/bash
# .git/hooks/post-commit

COMMIT_MSG=$(git log -1 --pretty=%B)

claude-flow hooks notify -m "Commit completed: $COMMIT_MSG" -l info
```

### Pre-Push Hook (quality gate)

```bash
#!/bin/bash
# .git/hooks/pre-push

npm run test:all
claude-flow hooks session-end
```

Anything claiming a numeric "truth score" gate belongs to a different skill
(`verification-quality`) -- there is no `claude-flow metrics score`
subcommand; use `claude-flow hooks metrics` for the learning-metrics
dashboard instead.

---

## Real-World Example: Full-Stack Feature with Session Handoff

```bash
claude-flow hooks session-restore -i fullstack-feature

claude-flow hooks pre-task -d "Build user profile feature: frontend + backend + tests" --auto-spawn

# Backend
claude-flow hooks pre-edit -f api/profile.js
# ... implement backend ...
claude-flow hooks post-edit -f api/profile.js --success true

# Frontend
claude-flow hooks pre-edit -f components/Profile.jsx
# ... implement frontend ...
claude-flow hooks post-edit -f components/Profile.jsx --success true

# Handoff
claude-flow hooks notify -m "Backend + frontend complete, ready for tests" -l info
claude-flow hooks route -t "Write tests for the profile feature"

claude-flow hooks session-end
```
