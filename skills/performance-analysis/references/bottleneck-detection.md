# Bottleneck Detection & Profiling

Full reference for `claude-flow performance bottleneck` and real-time
performance profiling. Covers command options, the metric taxonomy, output
format, common bottleneck patterns, and MCP integration.

## Command Syntax

Verified against `claude-flow performance bottleneck --help` (ruflo v3.38.21) —
this is the real, minimal option set. There is no top-level `bottleneck`
command (it lives under `performance`), and no `--swarm-id`/`--time-range`/
`--threshold`/`--export`/`--fix` flag in this build:

```bash
claude-flow performance bottleneck [options]
```

### Options
- `-c, --component <name>` - Component to analyze
- `-d, --depth <level>` - Analysis depth: quick, full (default: quick)

### Usage Examples
```bash
# Quick detection pass
claude-flow performance bottleneck

# Full analysis
claude-flow performance bottleneck -d full

# Scope to one component
claude-flow performance bottleneck -c coordinator -d full
```

To apply fixes, follow up with `claude-flow performance optimize --apply` (see
[optimisation-and-operations.md](optimisation-and-operations.md)) — bottleneck
detection and fix application are separate commands in this build, not one
`--fix` flag on `bottleneck`.

## Metrics Analyzed

**Communication Bottlenecks:**
- Message queue delays
- Agent response times
- Coordination overhead
- Memory access patterns
- Inter-agent communication latency

**Processing Bottlenecks:**
- Task completion times
- Agent utilization rates
- Parallel execution efficiency
- Resource contention
- CPU/memory usage patterns

**Memory Bottlenecks:**
- Cache hit rates
- Memory access patterns
- Storage I/O performance
- Neural pattern loading times
- Memory allocation efficiency

**Network Bottlenecks:**
- API call latency
- MCP communication delays
- External service timeouts
- Concurrent request limits
- Network throughput issues

## Output Format

```
🔍 Bottleneck Analysis Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Summary
├── Time Range: Last 1 hour
├── Agents Analyzed: 6
├── Tasks Processed: 42
└── Critical Issues: 2

🚨 Critical Bottlenecks
1. Agent Communication (35% impact)
   └── coordinator → coder-1 messages delayed by 2.3s avg

2. Memory Access (28% impact)
   └── Neural pattern loading taking 1.8s per access

⚠️ Warning Bottlenecks
1. Task Queue (18% impact)
   └── 5 tasks waiting > 10s for assignment

💡 Recommendations
1. Switch to hierarchical topology (est. 40% improvement)
2. Enable memory caching (est. 25% improvement)
3. Increase agent concurrency to 8 (est. 20% improvement)

✅ Quick Fixes Available
Run `claude-flow performance optimize --apply` to apply:
- Enable smart caching
- Optimize message routing
- Adjust agent priorities
```

Illustrative report shape above; the live CLI does not print box-drawing
output by default — pass `--format json`/`table` on `performance metrics` for
machine-readable results.

## Real-time Profiling

Automatic analysis during task execution:
- Execution time vs. complexity
- Agent utilization rates
- Resource constraints
- Operation patterns

### Common Bottleneck Patterns

**Time Bottlenecks:**
- Tasks taking > 5 minutes
- Sequential operations that could parallelize
- Redundant file operations
- Inefficient algorithm implementations

**Coordination Bottlenecks:**
- Single agent for complex tasks
- Unbalanced agent workloads
- Poor topology selection
- Excessive synchronization points

**Resource Bottlenecks:**
- High operation count (> 100)
- Memory constraints
- I/O limitations
- Thread pool saturation

## MCP Integration

```javascript
// Check for bottlenecks in Claude Code
mcp__claude-flow__bottleneck_analyze({
  timeRange: "1h",
  threshold: 20,
  autoFix: false
})

// NOTE: mcp__claude-flow__task_results is not currently available — use
// mcp__claude-flow__task_status or swarm_status for task-level detail instead.
mcp__claude-flow__task_status({ taskId: "task-123" })
```

**Result Format:**
```json
{
  "bottlenecks": [
    {
      "type": "coordination",
      "severity": "high",
      "description": "Single agent used for complex task",
      "recommendation": "Spawn specialized agents for parallel work",
      "impact": "35%",
      "affectedComponents": ["coordinator", "coder-1"]
    }
  ],
  "improvements": [
    {
      "area": "execution_time",
      "suggestion": "Use parallel task execution",
      "expectedImprovement": "30-50% time reduction",
      "implementationSteps": [
        "Split task into smaller units",
        "Spawn 3-4 specialized agents",
        "Use mesh topology for coordination"
      ]
    }
  ],
  "metrics": {
    "avgExecutionTime": "142s",
    "agentUtilization": "67%",
    "cacheHitRate": "82%",
    "parallelizationFactor": 1.2
  }
}
```
