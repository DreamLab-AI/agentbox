# Hooks Automation — Complete Configuration Templates and Real-World Examples

Reference material extracted from SKILL.md.

---

## Complete Hook Configuration (`settings.json`)

### Advanced Configuration — All Features

```json
{
  "hooks": {
    "enabled": true,
    "debug": false,
    "timeout": 5000,

    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook pre-edit --file '${tool.params.file_path}' --auto-assign-agent --validate-syntax",
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
            "command": "npx claude-flow hook pre-task --description '${tool.params.task}' --auto-spawn-agents --load-memory",
            "async": true
          }
        ]
      },
      {
        "matcher": "^Grep$",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook pre-search --query '${tool.params.pattern}' --check-cache"
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
            "command": "npx claude-flow hook post-edit --file '${tool.params.file_path}' --memory-key 'edits/${tool.params.file_path}' --auto-format --train-patterns",
            "async": true
          }
        ]
      },
      {
        "matcher": "^Task$",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook post-task --task-id '${result.task_id}' --analyze-performance --store-decisions --export-learnings",
            "async": true
          }
        ]
      },
      {
        "matcher": "^Grep$",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook post-search --query '${tool.params.pattern}' --cache-results --train-patterns"
          }
        ]
      }
    ],

    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook session-start --session-id '${session.id}' --load-context"
          }
        ]
      }
    ],

    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook session-end --session-id '${session.id}' --export-metrics --generate-summary --cleanup-temp"
          }
        ]
      }
    ]
  }
}
```

### Protected File Patterns

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit|MultiEdit)$",
        "hooks": [
          {
            "type": "command",
            "command": "npx claude-flow hook check-protected --file '${tool.params.file_path}'"
          }
        ]
      }
    ]
  }
}
```

### Automatic Testing on Write

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "^Write$",
        "hooks": [
          {
            "type": "command",
            "command": "test -f '${tool.params.file_path%.js}.test.js' && npm test '${tool.params.file_path%.js}.test.js'",
            "continueOnError": true
          }
        ]
      }
    ]
  }
}
```

---

## MCP Tool Integration

Hooks automatically call MCP tools internally. These examples show what runs under the hood.

### Pre-Task Hook with Agent Spawning

```javascript
// Hook command:
// npx claude-flow hook pre-task --description "Build REST API"

// Internally calls:
mcp__claude-flow__agent_spawn {
  type: "backend-dev",
  capabilities: ["api", "database", "testing"]
}

mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/task/api-build/context",
  namespace: "coordination",
  value: JSON.stringify({
    description: "Build REST API",
    agents: ["backend-dev"],
    started: Date.now()
  })
}
```

### Post-Edit Hook with Memory Storage

```javascript
// Hook command:
// npx claude-flow hook post-edit --file "api/auth.js"

// Internally calls:
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/edits/api/auth.js",
  namespace: "coordination",
  value: JSON.stringify({
    file: "api/auth.js",
    timestamp: Date.now(),
    changes: { added: 45, removed: 12 },
    formatted: true,
    linted: true
  })
}

// NOTE: mcp__claude-flow__neural_train is not currently available — use neural_patterns instead
mcp__claude-flow__neural_patterns {
  action: "learn",
  operation: "coordination",
  metadata: { source: "edit-pattern", file: "api/auth.js" }
}
```

### Session End Hook with State Persistence

```javascript
// Hook command:
// npx claude-flow hook session-end --session-id "dev-2024"

// Internally calls:
// NOTE: mcp__claude-flow__memory_persist is not currently available
// Use memory_usage with long TTL instead:
mcp__claude-flow__memory_usage {
  action: "store",
  key: "session-state/dev-2024",
  namespace: "sessions",
  value: JSON.stringify(sessionState),
  ttl: 2592000
}

mcp__claude-flow__swarm_status { swarmId: "current" }
// Then generates metrics summary
```

---

## Memory Coordination Protocol

All hooks follow a standardized three-phase memory protocol.

### Phase 1: STATUS — Hook Starts

```javascript
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/hooks/pre-edit/status",
  namespace: "coordination",
  value: JSON.stringify({
    status: "running",
    hook: "pre-edit",
    file: "src/auth.js",
    timestamp: Date.now()
  })
}
```

### Phase 2: PROGRESS — Hook Processes

```javascript
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/hooks/pre-edit/progress",
  namespace: "coordination",
  value: JSON.stringify({
    progress: 50,
    action: "validating syntax",
    file: "src/auth.js"
  })
}
```

### Phase 3: COMPLETE — Hook Finishes

```javascript
mcp__claude-flow__memory_usage {
  action: "store",
  key: "swarm/hooks/pre-edit/complete",
  namespace: "coordination",
  value: JSON.stringify({
    status: "complete",
    result: "success",
    agent_assigned: "backend-dev",
    syntax_valid: true,
    backup_created: true
  })
}
```

---

## Hook Response Format

### Continue Response

```json
{
  "continue": true,
  "reason": "All validations passed",
  "metadata": {
    "agent_assigned": "backend-dev",
    "syntax_valid": true,
    "file": "src/auth.js"
  }
}
```

### Block Response

```json
{
  "continue": false,
  "reason": "Protected file - manual review required",
  "metadata": {
    "file": ".env.production",
    "protection_level": "high",
    "requires": "manual_approval"
  }
}
```

### Warning Response

```json
{
  "continue": true,
  "reason": "Syntax valid but complexity high",
  "warnings": [
    "Cyclomatic complexity: 15 (threshold: 10)",
    "Consider refactoring for better maintainability"
  ],
  "metadata": {
    "complexity": 15,
    "threshold": 10
  }
}
```

---

## Git Hook Scripts

### Pre-Commit Hook

```bash
#!/bin/bash
# .git/hooks/pre-commit  (or managed via husky)

FILES=$(git diff --cached --name-only --diff-filter=ACM)

for FILE in $FILES; do
  npx claude-flow hook pre-edit --file "$FILE" --validate-syntax
  if [ $? -ne 0 ]; then
    echo "Validation failed for $FILE"
    exit 1
  fi
  npx claude-flow hook post-edit --file "$FILE" --auto-format
done

npm test
exit $?
```

### Post-Commit Hook

```bash
#!/bin/bash
# .git/hooks/post-commit

COMMIT_HASH=$(git rev-parse HEAD)
COMMIT_MSG=$(git log -1 --pretty=%B)

npx claude-flow hook notify \
  --message "Commit completed: $COMMIT_MSG" \
  --level info \
  --swarm-status
```

### Pre-Push Hook (Quality Gate)

```bash
#!/bin/bash
# .git/hooks/pre-push

npm run test:all

npx claude-flow hook session-end --generate-report --export-metrics

TRUTH_SCORE=$(npx claude-flow metrics score --format json | jq -r '.truth_score')

if (( $(echo "$TRUTH_SCORE < 0.95" | bc -l) )); then
  echo "Truth score below threshold: $TRUTH_SCORE < 0.95"
  exit 1
fi

exit 0
```

---

## Custom Hook Creation

### Custom Hook Template

```javascript
// .claude/hooks/custom-quality-check.js

module.exports = {
  name: 'custom-quality-check',
  type: 'pre',
  matcher: /\.(ts|js)$/,

  async execute(context) {
    const { file, content } = context;

    const complexity = await analyzeComplexity(content);
    const securityIssues = await scanSecurity(content);

    await storeInMemory({
      key: `quality/${file}`,
      value: { complexity, securityIssues }
    });

    if (complexity > 15 || securityIssues.length > 0) {
      return {
        continue: false,
        reason: 'Quality checks failed',
        warnings: [
          `Complexity: ${complexity} (max: 15)`,
          `Security issues: ${securityIssues.length}`
        ]
      };
    }

    return {
      continue: true,
      reason: 'Quality checks passed',
      metadata: { complexity, securityIssues: 0 }
    };
  }
};
```

### Register Custom Hook

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "^(Write|Edit)$",
        "hooks": [
          {
            "type": "script",
            "script": ".claude/hooks/custom-quality-check.js"
          }
        ]
      }
    ]
  }
}
```

---

## Real-World Examples

### Example 1: Full-Stack Development Workflow

```bash
# Session start
npx claude-flow hook session-start --session-id "fullstack-feature"

# Pre-task planning
npx claude-flow hook pre-task \
  --description "Build user profile feature - frontend + backend + tests" \
  --auto-spawn-agents --optimize-topology

# Backend work
npx claude-flow hook pre-edit --file "api/profile.js"
# ... implement backend ...
npx claude-flow hook post-edit --file "api/profile.js" --memory-key "profile/backend" --train-patterns

# Frontend work (reads backend details from memory)
npx claude-flow hook pre-edit --file "components/Profile.jsx"
# ... implement frontend ...
npx claude-flow hook post-edit --file "components/Profile.jsx" --memory-key "profile/frontend" --train-patterns

# Testing (reads both from memory)
npx claude-flow hook pre-task --description "Test profile feature" --load-memory

# Session end
npx claude-flow hook session-end --session-id "fullstack-feature" --export-metrics --generate-summary
```

### Example 2: Debugging with Hooks

```bash
npx claude-flow hook session-start --session-id "debug-memory-leak"

npx claude-flow hook pre-task \
  --description "Debug memory leak in event handlers" \
  --load-memory --estimate-complexity

# Search for event emitters
npx claude-flow hook pre-search --query "EventEmitter"
npx claude-flow hook post-search --query "EventEmitter" --cache-results

# Fix the issue
npx claude-flow hook pre-edit --file "services/events.js" --backup-file
# ... fix code ...
npx claude-flow hook post-edit --file "services/events.js" --memory-key "debug/memory-leak-fix" --validate-output

npx claude-flow hook post-task --task-id "memory-leak-fix" --analyze-performance --generate-report
npx claude-flow hook session-end --session-id "debug-memory-leak" --export-metrics
```

### Example 3: Multi-Agent Refactoring

```bash
# Initialize swarm
npx claude-flow hook pre-task \
  --description "Refactor legacy codebase to modern patterns" \
  --auto-spawn-agents --optimize-topology

# Agent 1: Code Analyzer
npx claude-flow hook pre-task --description "Analyze code complexity"
npx claude-flow hook post-task --task-id "analysis" --store-decisions

# Agent 2: Refactoring (reads analysis from memory)
npx claude-flow hook session-restore --session-id "swarm-refactor" --restore-memory

for file in src/**/*.js; do
  npx claude-flow hook pre-edit --file "$file" --backup-file
  # ... refactor ...
  npx claude-flow hook post-edit --file "$file" --memory-key "refactor/$file" --auto-format --train-patterns
done

# Agent 3: Testing
npx claude-flow hook pre-task --description "Generate tests for refactored code" --load-memory

# Broadcast completion
npx claude-flow hook notify --message "Refactoring complete - all tests passing" --broadcast
```

### Agent Coordination — Two-Agent Handoff

```bash
# Agent 1: Backend Developer
npx claude-flow hook pre-task --description "Implement user authentication API" --auto-spawn-agents --load-memory
npx claude-flow hook pre-edit --file "api/auth.js" --auto-assign-agent --validate-syntax
# ... code changes ...
npx claude-flow hook post-edit --file "api/auth.js" --memory-key "swarm/backend/auth-api" --auto-format --train-patterns
npx claude-flow hook notify --message "Auth API implementation complete" --swarm-status --broadcast
npx claude-flow hook post-task --task-id "auth-api" --analyze-performance --store-decisions --export-learnings

# Agent 2: Test Engineer (receives notification, reads memory)
npx claude-flow hook session-restore --session-id "swarm-current" --restore-memory
# Memory contains: swarm/backend/auth-api with implementation details
npx claude-flow hook pre-task --description "Write tests for auth API" --load-memory
npx claude-flow hook post-edit --file "api/auth.test.js" --memory-key "swarm/testing/auth-api-tests" --train-patterns
npx claude-flow hook notify --message "Auth API tests complete - 100% coverage" --broadcast
```
